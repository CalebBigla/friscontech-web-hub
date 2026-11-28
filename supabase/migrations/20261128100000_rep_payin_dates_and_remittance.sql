-- Rep pay-ins: a full date, a running balance, and the manager remits what reps paid in.
--
-- A "payment" is only money a sales rep hands to their branch manager. Customer
-- payments are the customer's ledger and stay separate.
--
-- 1. Every pay-in has a payment_date (the day the rep paid in). period stays and is
--    the month of that date, so monthly reports and remittances group as before.
--    Existing pay-ins get the day they were submitted.
-- 2. What a rep still has to pay in is a running balance, whatever the dates:
--      customer payments the rep collected (credited at once, so confirmed by the
--      rep themselves) - every pay-in not declined.
--    Reps don't make walk-in sales, so walk-ins no longer count. Customer payments
--    from the earlier flow (confirmed by the Owner, money already handed over
--    through that chain) are left out.
--    submit_payment(p_payment_date, ...) refuses a pay-in above that balance; the
--    old submit_payment(p_period, ...) still works and dates the pay-in today.
-- 3. submit_manager_remittance: what the manager received for a month is the rep
--    pay-ins of their branch dated in that month that the manager has acknowledged
--    or confirmed, plus the manager's own walk-in sales. Pay-ins are matched by
--    branch, so a new manager also sees what reps paid in before they took over.
--    Earlier remittances of the branch for the month are subtracted. Remittances
--    already submitted keep their stored figures.

-- ----------------------------------------------------------------------------
-- 1. Pay-in date
-- ----------------------------------------------------------------------------
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payment_date DATE;
UPDATE public.payments SET payment_date = (submitted_at)::DATE WHERE payment_date IS NULL;
ALTER TABLE public.payments ALTER COLUMN payment_date SET DEFAULT CURRENT_DATE;
ALTER TABLE public.payments ALTER COLUMN payment_date SET NOT NULL;
COMMENT ON COLUMN public.payments.payment_date IS 'The day the rep paid the money in to their manager';
COMMENT ON COLUMN public.payments.period IS 'YYYY-MM of payment_date (older pay-ins: the month the rep chose)';
CREATE INDEX IF NOT EXISTS idx_payments_rep_date ON public.payments (sales_rep_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_branch_period ON public.payments (branch_id, period, status);

-- ----------------------------------------------------------------------------
-- 2. A rep's running balance
-- ----------------------------------------------------------------------------
-- Customer money the rep collected under the current flow (the rep confirms it on recording).
CREATE OR REPLACE FUNCTION app_private.rep_collected(p_tenant_id UUID, p_rep_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
  SELECT COALESCE(SUM(c.amount), 0) FROM public.customer_payments c
   WHERE c.tenant_id = p_tenant_id AND c.received_by = p_rep_id AND c.status = 'confirmed'
     AND c.confirmed_by = c.received_by;
$$;
REVOKE ALL ON FUNCTION app_private.rep_collected(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.rep_paid_in(p_tenant_id UUID, p_rep_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
  SELECT COALESCE(SUM(p.cash_amount + p.transfer_amount), 0) FROM public.payments p
   WHERE p.tenant_id = p_tenant_id AND p.sales_rep_id = p_rep_id AND p.status <> 'declined';
$$;
REVOKE ALL ON FUNCTION app_private.rep_paid_in(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Still to pay in: collected - paid in (not declined).
CREATE OR REPLACE FUNCTION app_private.rep_balance(p_tenant_id UUID, p_rep_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
  SELECT app_private.rep_collected(p_tenant_id, p_rep_id) - app_private.rep_paid_in(p_tenant_id, p_rep_id);
$$;
REVOKE ALL ON FUNCTION app_private.rep_balance(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Kept for anything that asks per month: customer money collected that month (no walk-ins).
CREATE OR REPLACE FUNCTION app_private.rep_amount_due(p_tenant_id UUID, p_rep_id UUID, p_period TEXT)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
  SELECT COALESCE(SUM(c.amount), 0) FROM public.customer_payments c
   WHERE c.tenant_id = p_tenant_id AND c.received_by = p_rep_id AND c.status = 'confirmed'
     AND c.confirmed_by = c.received_by AND pg_catalog.to_char(c.payment_date, 'YYYY-MM') = p_period;
$$;
REVOKE ALL ON FUNCTION app_private.rep_amount_due(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Submit a pay-in with its date
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_payment(
  p_payment_date DATE, p_cash_amount NUMERIC, p_transfer_amount NUMERIC, p_transfer_reference TEXT, p_note TEXT,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
DECLARE
  v_actor public.users := app_private.actor();
  v_manager UUID;
  v_balance NUMERIC;
  v_row public.payments;
  v_prior JSONB := app_private.replay(p_idempotency_key, 'submit_payment');
BEGIN
  IF v_prior IS NOT NULL THEN
    RETURN pg_catalog.jsonb_populate_record(NULL::public.payments, v_prior);
  END IF;
  IF v_actor.role <> 'sales_rep' THEN PERFORM app_private.deny('Only a sales representative can submit their own payment'); END IF;
  IF v_actor.branch_id IS NULL THEN PERFORM app_private.fail('An active sales representative and branch are required'); END IF;
  IF p_payment_date IS NULL THEN PERFORM app_private.fail('Choose the payment date', 'paymentDate'); END IF;
  IF p_payment_date > app_private.today(v_actor.tenant_id) THEN
    PERFORM app_private.fail('The payment date can''t be in the future', 'paymentDate');
  END IF;
  IF p_cash_amount IS NULL OR p_cash_amount < 0 THEN PERFORM app_private.fail('Cash cannot be negative', 'cashAmount'); END IF;
  IF p_transfer_amount IS NULL OR p_transfer_amount < 0 THEN PERFORM app_private.fail('Transfer cannot be negative', 'transferAmount'); END IF;
  IF p_cash_amount + p_transfer_amount <= 0 THEN PERFORM app_private.fail('Enter the amount you are paying in', 'cashAmount'); END IF;
  IF p_transfer_amount > 0 AND TRIM(COALESCE(p_transfer_reference, '')) = '' THEN
    PERFORM app_private.fail('A transfer reference is required when transfer is greater than zero', 'transferReference');
  END IF;
  SELECT u.id INTO v_manager FROM public.branches b JOIN public.users u ON u.id = b.manager_id
   WHERE b.id = v_actor.branch_id AND u.role = 'manager' AND u.status = 'active';
  IF v_manager IS NULL THEN PERFORM app_private.fail('A branch manager must be assigned before submitting a payment'); END IF;

  -- One pay-in at a time per rep, so two can't both pass the balance check.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('payin:' || v_actor.id::TEXT, 0));
  v_balance := app_private.rep_balance(v_actor.tenant_id, v_actor.id);
  IF p_cash_amount + p_transfer_amount > v_balance THEN
    PERFORM app_private.fail('You can pay in up to ₦' || pg_catalog.to_char(GREATEST(v_balance, 0), 'FM999,999,999,990.00')
      || ': the customer money you collected and haven''t paid in yet', 'transferAmount');
  END IF;

  INSERT INTO public.payments (id, tenant_id, branch_id, sales_rep_id, manager_id, period, payment_date, cash_amount,
                               transfer_amount, transfer_reference, status, submitted_at, note)
  VALUES (app_private.next_id('PAY', 'app_private.payment_seq', 'public.payments'), v_actor.tenant_id, v_actor.branch_id,
          v_actor.id, v_manager, pg_catalog.to_char(p_payment_date, 'YYYY-MM'), p_payment_date, p_cash_amount,
          p_transfer_amount, NULLIF(TRIM(p_transfer_reference), ''), 'submitted', pg_catalog.now(), NULLIF(TRIM(p_note), ''))
  RETURNING * INTO v_row;

  PERFORM app_private.notify(v_row.tenant_id, v_manager, 'payment_awaiting_acknowledgement', 'payment', v_row.id,
    app_private.full_name(v_actor.id) || ' paid in ₦' || pg_catalog.to_char(v_row.cash_amount + v_row.transfer_amount, 'FM999,999,999,990.00')
      || ' (' || v_row.id || ')');
  PERFORM app_private.audit(v_actor, 'PAYMENT_SUBMITTED', v_row.id || ' · paid in ' || pg_catalog.to_char(v_row.payment_date, 'YYYY-MM-DD'),
    'payment', v_row.id, pg_catalog.jsonb_build_object('branchId', v_row.branch_id, 'salesRepId', v_actor.id,
      'managerId', v_manager, 'period', v_row.period, 'paymentDate', v_row.payment_date,
      'cashAmount', v_row.cash_amount, 'transferAmount', v_row.transfer_amount));
  PERFORM app_private.remember(p_idempotency_key, 'submit_payment', pg_catalog.to_jsonb(v_row));
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_payment(DATE, NUMERIC, NUMERIC, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_payment(DATE, NUMERIC, NUMERIC, TEXT, TEXT, UUID) TO authenticated;

-- The month-based call still works (an app not yet updated): it pays in today.
CREATE OR REPLACE FUNCTION public.submit_payment(
  p_period TEXT, p_cash_amount NUMERIC, p_transfer_amount NUMERIC, p_transfer_reference TEXT, p_note TEXT,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS public.payments
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
  SELECT * FROM public.submit_payment(app_private.today((app_private.actor()).tenant_id), p_cash_amount, p_transfer_amount,
                                      p_transfer_reference, p_note, p_idempotency_key);
$$;

-- ----------------------------------------------------------------------------
-- 3. Manager remittance: what the reps paid in
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_manager_remittance(
  p_period TEXT, p_cash_amount NUMERIC, p_transfer_amount NUMERIC, p_transfer_reference TEXT, p_note TEXT
)
RETURNS public.manager_remittances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
DECLARE
  v_actor public.users := app_private.actor();
  v_branch UUID := app_private.managed_branch(v_actor);
  v_payment_ids JSONB;
  v_expense_ids JSONB;
  v_paid_in NUMERIC;
  v_own NUMERIC;
  v_received NUMERIC;
  v_expenses NUMERIC;
  v_previous NUMERIC;
  v_net NUMERIC;
  v_outstanding NUMERIC;
  v_row public.manager_remittances;
BEGIN
  IF v_branch IS NULL THEN PERFORM app_private.deny('Only an active branch manager can submit remittance'); END IF;
  IF NOT app_private.valid_period(p_period, v_actor.tenant_id) THEN
    PERFORM app_private.fail('Choose a valid current or past month', 'period');
  END IF;
  IF p_cash_amount IS NULL OR p_cash_amount < 0 THEN PERFORM app_private.fail('Cash cannot be negative', 'cashAmount'); END IF;
  IF p_transfer_amount IS NULL OR p_transfer_amount < 0 THEN PERFORM app_private.fail('Transfer cannot be negative', 'transferAmount'); END IF;
  IF p_transfer_amount > 0 AND TRIM(COALESCE(p_transfer_reference, '')) = '' THEN
    PERFORM app_private.fail('A transfer reference is required when transfer is greater than zero', 'transferReference');
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_branch::TEXT || p_period, 0));
  IF EXISTS (SELECT 1 FROM public.manager_remittances WHERE branch_id = v_branch AND period = p_period AND status = 'submitted') THEN
    PERFORM app_private.fail('A remittance for this period is already awaiting Owner review');
  END IF;

  -- Rep pay-ins of the branch in the month that reached the manager.
  SELECT COALESCE(pg_catalog.jsonb_agg(p.id), '[]'::JSONB), COALESCE(SUM(p.cash_amount + p.transfer_amount), 0)
    INTO v_payment_ids, v_paid_in
    FROM public.payments p
   WHERE p.tenant_id = v_actor.tenant_id AND p.branch_id = v_branch
     AND p.period = p_period AND p.status IN ('acknowledged', 'confirmed');
  v_own := app_private.rep_total_sales(v_actor.tenant_id, v_actor.id, p_period);
  IF v_paid_in = 0 AND v_own = 0 THEN
    PERFORM app_private.fail('There are no sales rep pay-ins or walk-in sales for this period');
  END IF;
  v_received := v_paid_in + v_own;

  SELECT COALESCE(SUM(e.amount), 0), COALESCE(pg_catalog.jsonb_agg(e.id), '[]'::JSONB) INTO v_expenses, v_expense_ids
    FROM public.expenses e
   WHERE e.tenant_id = v_actor.tenant_id AND e.manager_id = v_actor.id AND e.branch_id = v_branch
     AND e.status = 'recorded' AND pg_catalog.to_char(e.expense_date, 'YYYY-MM') = p_period;

  SELECT COALESCE(SUM(r.cash_amount + r.transfer_amount), 0) INTO v_previous
    FROM public.manager_remittances r
   WHERE r.tenant_id = v_actor.tenant_id AND r.branch_id = v_branch
     AND r.period = p_period AND r.status <> 'declined';

  v_net := v_received - v_expenses - v_previous;
  IF v_net < 0 THEN
    PERFORM app_private.fail('Recorded expenses exceed the eligible payment position for this period');
  END IF;
  v_outstanding := v_net - p_cash_amount - p_transfer_amount;
  IF v_outstanding < 0 THEN
    PERFORM app_private.fail('Cash and transfer cannot exceed net remittance due', 'transferAmount');
  END IF;

  INSERT INTO public.manager_remittances (tenant_id, branch_id, manager_id, period, total_received, expense_amount,
    net_remittance_due, cash_amount, transfer_amount, outstanding_amount, transfer_reference, status, submitted_at,
    note, payment_ids, expense_ids)
  VALUES (v_actor.tenant_id, v_branch, v_actor.id, p_period, v_received, v_expenses, v_net, p_cash_amount,
          p_transfer_amount, v_outstanding, NULLIF(TRIM(p_transfer_reference), ''), 'submitted', pg_catalog.now(),
          NULLIF(TRIM(p_note), ''), v_payment_ids, v_expense_ids)
  RETURNING * INTO v_row;

  PERFORM app_private.audit(v_actor, 'REMITTANCE_SUBMITTED', v_row.period || ' remittance submitted', 'remittance', v_row.id::TEXT,
    pg_catalog.jsonb_build_object('branchId', v_branch, 'managerId', v_actor.id, 'remittanceId', v_row.id, 'period', v_row.period,
      'totalReceived', v_received, 'repPaidIn', v_paid_in, 'expenseAmount', v_expenses, 'netRemittanceDue', v_net,
      'cashAmount', p_cash_amount, 'transferAmount', p_transfer_amount, 'outstandingAmount', v_outstanding,
      'managerWalkInSales', v_own));
  RETURN v_row;
END;
$$;

NOTIFY pgrst, 'reload schema';
