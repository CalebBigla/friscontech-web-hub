-- Payments: the manager confirms cash, the Owner confirms transfers, and the Owner
-- can void a confirmed payment.
--
-- 1. Cash: a payment with no transfer part (rep pay-in with transfer_amount = 0, or
--    a customer payment with method 'cash') is confirmed or declined by the branch
--    manager. It is never acknowledged and the Owner no longer confirms it.
--    Cash payments already waiting as 'acknowledged' are confirmed by the manager too.
-- 2. Transfer: unchanged chain, submitted → acknowledged (manager) → confirmed (Owner).
--    A pay-in that mixes cash and transfer follows the transfer chain.
-- 3. void_payment / void_customer_payment (Owner only): a confirmed payment becomes
--    'declined' with the reason prefixed "Voided: ". confirmed_at/confirmed_by are kept,
--    so the record shows it was confirmed and then voided. Declined money is not
--    counted anywhere, and the rep can pay the amount in again.

-- True when the payment is cash only.
CREATE OR REPLACE FUNCTION app_private.is_cash_payment(p_transfer NUMERIC)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(p_transfer, 0) <= 0;
$$;

-- ----------------------------------------------------------------------------
-- Customer payments
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acknowledge_customer_payment(
  p_payment_id UUID, p_transfer_reference TEXT, p_proof_name TEXT
)
RETURNS public.customer_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
DECLARE
  v_actor public.users := app_private.actor();
  v_row public.customer_payments;
  v_reference TEXT;
BEGIN
  SELECT * INTO v_row FROM public.customer_payments WHERE id = p_payment_id AND tenant_id = v_actor.tenant_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM app_private.fail('Payment not found'); END IF;
  IF NOT app_private.is_payment_manager(v_actor, v_row.manager_id, v_row.branch_id) THEN
    PERFORM app_private.deny('This payment is outside your branch scope');
  END IF;
  IF v_row.status <> 'submitted' THEN PERFORM app_private.fail('Only submitted payments can be acknowledged'); END IF;
  IF v_row.method = 'cash' THEN PERFORM app_private.fail('Cash payments are confirmed by the manager, not acknowledged'); END IF;
  v_reference := COALESCE(NULLIF(TRIM(p_transfer_reference), ''), v_row.reference);
  IF v_reference IS NULL THEN
    PERFORM app_private.fail('Enter the transfer reference before acknowledging', 'transferReference');
  END IF;
  UPDATE public.customer_payments
     SET reference = v_reference, proof_name = COALESCE(NULLIF(TRIM(p_proof_name), ''), proof_name),
         status = 'acknowledged', acknowledged_at = pg_catalog.now(), acknowledged_by = v_actor.id, updated_at = pg_catalog.now()
   WHERE id = v_row.id RETURNING * INTO v_row;
  PERFORM app_private.notify_owners(v_row.tenant_id, 'payment_awaiting_confirmation', 'customer_payment', v_row.id::TEXT,
    'Customer transfer acknowledged by manager · awaiting your confirmation');
  PERFORM app_private.audit(v_actor, 'Customer payment acknowledged', v_row.id::TEXT, 'payment', v_row.id::TEXT,
    pg_catalog.jsonb_build_object('branchId', v_row.branch_id, 'customerId', v_row.customer_id, 'amount', v_row.amount));
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_customer_payment(p_payment_id UUID)
RETURNS public.customer_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
DECLARE
  v_actor public.users := app_private.actor();
  v_row public.customer_payments;
  v_by TEXT;
BEGIN
  SELECT * INTO v_row FROM public.customer_payments WHERE id = p_payment_id AND tenant_id = v_actor.tenant_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM app_private.fail('Payment not found'); END IF;
  IF v_row.status NOT IN ('submitted', 'acknowledged') THEN PERFORM app_private.fail('Only pending payments can be confirmed'); END IF;
  IF v_row.method = 'cash' THEN
    IF NOT app_private.is_payment_manager(v_actor, v_row.manager_id, v_row.branch_id) THEN
      PERFORM app_private.deny('Cash payments are confirmed by the branch manager');
    END IF;
    v_by := 'your manager';
  ELSE
    IF v_actor.role <> 'owner' THEN PERFORM app_private.deny('Only the business owner can confirm transfers'); END IF;
    v_by := 'the owner';
  END IF;
  UPDATE public.customer_payments
     SET status = 'confirmed', confirmed_at = pg_catalog.now(), confirmed_by = v_actor.id, updated_at = pg_catalog.now()
   WHERE id = v_row.id RETURNING * INTO v_row;
  PERFORM app_private.notify(v_row.tenant_id, v_row.received_by, 'payment_confirmed', 'customer_payment', v_row.id::TEXT,
    'Your customer payment was confirmed by ' || v_by);
  PERFORM app_private.audit(v_actor, 'Customer payment confirmed', v_row.id::TEXT, 'payment', v_row.id::TEXT,
    pg_catalog.jsonb_build_object('branchId', v_row.branch_id, 'customerId', v_row.customer_id, 'amount', v_row.amount,
      'paymentMethod', v_row.method));
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.decline_customer_payment(p_payment_id UUID, p_reason TEXT)
RETURNS public.customer_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
DECLARE
  v_actor public.users := app_private.actor();
  v_row public.customer_payments;
BEGIN
  SELECT * INTO v_row FROM public.customer_payments WHERE id = p_payment_id AND tenant_id = v_actor.tenant_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM app_private.fail('Payment not found'); END IF;
  IF v_row.method = 'cash' THEN
    IF NOT app_private.is_payment_manager(v_actor, v_row.manager_id, v_row.branch_id) THEN
      PERFORM app_private.deny('Cash payments are declined by the branch manager');
    END IF;
    IF v_row.status NOT IN ('submitted', 'acknowledged') THEN PERFORM app_private.fail('Only pending payments can be declined'); END IF;
  ELSIF v_actor.role = 'owner' THEN
    IF v_row.status NOT IN ('submitted', 'acknowledged') THEN
      PERFORM app_private.fail('Only pending payments can be declined by the owner');
    END IF;
  ELSIF app_private.is_payment_manager(v_actor, v_row.manager_id, v_row.branch_id) THEN
    IF v_row.status <> 'submitted' THEN PERFORM app_private.fail('Only submitted payments can be declined by a manager'); END IF;
  ELSE
    PERFORM app_private.deny('You cannot decline this payment');
  END IF;
  IF TRIM(COALESCE(p_reason, '')) = '' THEN PERFORM app_private.fail('A decline reason is required', 'reason'); END IF;
  UPDATE public.customer_payments
     SET status = 'declined', declined_at = pg_catalog.now(), declined_by = v_actor.id,
         decline_reason = TRIM(p_reason), updated_at = pg_catalog.now()
   WHERE id = v_row.id RETURNING * INTO v_row;
  PERFORM app_private.notify(v_row.tenant_id, v_row.received_by, 'payment_declined', 'customer_payment', v_row.id::TEXT,
    'Your customer payment was declined: ' || v_row.decline_reason);
  PERFORM app_private.audit(v_actor, 'Customer payment declined', v_row.decline_reason, 'payment', v_row.id::TEXT,
    pg_catalog.jsonb_build_object('branchId', v_row.branch_id, 'customerId', v_row.customer_id, 'declineReason', v_row.decline_reason));
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_customer_payment(p_payment_id UUID, p_reason TEXT)
RETURNS public.customer_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
DECLARE
  v_actor public.users := app_private.actor();
  v_row public.customer_payments;
BEGIN
  IF v_actor.role <> 'owner' THEN PERFORM app_private.deny('Only the business owner can void a payment'); END IF;
  SELECT * INTO v_row FROM public.customer_payments WHERE id = p_payment_id AND tenant_id = v_actor.tenant_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM app_private.fail('Payment not found'); END IF;
  IF v_row.status <> 'confirmed' THEN PERFORM app_private.fail('Only confirmed payments can be voided'); END IF;
  IF TRIM(COALESCE(p_reason, '')) = '' THEN PERFORM app_private.fail('A reason is required', 'reason'); END IF;
  UPDATE public.customer_payments
     SET status = 'declined', declined_at = pg_catalog.now(), declined_by = v_actor.id,
         decline_reason = 'Voided: ' || TRIM(p_reason), updated_at = pg_catalog.now()
   WHERE id = v_row.id RETURNING * INTO v_row;
  PERFORM app_private.notify(v_row.tenant_id, v_row.received_by, 'payment_declined', 'customer_payment', v_row.id::TEXT,
    'A confirmed customer payment was voided by the owner: ' || TRIM(p_reason));
  PERFORM app_private.audit(v_actor, 'Customer payment voided', TRIM(p_reason), 'payment', v_row.id::TEXT,
    pg_catalog.jsonb_build_object('branchId', v_row.branch_id, 'customerId', v_row.customer_id, 'amount', v_row.amount,
      'reason', TRIM(p_reason)));
  RETURN v_row;
END;
$$;

-- ----------------------------------------------------------------------------
-- Rep payments
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acknowledge_payment(
  p_payment_id TEXT, p_transfer_reference TEXT, p_proof_name TEXT
)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
DECLARE
  v_actor public.users := app_private.actor();
  v_row public.payments;
  v_reference TEXT;
BEGIN
  SELECT * INTO v_row FROM public.payments WHERE id = p_payment_id AND tenant_id = v_actor.tenant_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM app_private.fail('Payment not found'); END IF;
  IF NOT app_private.is_payment_manager(v_actor, v_row.manager_id, v_row.branch_id) THEN
    PERFORM app_private.deny('This payment is outside your branch scope');
  END IF;
  IF v_row.status <> 'submitted' THEN PERFORM app_private.fail('Only submitted payments can be acknowledged'); END IF;
  IF app_private.is_cash_payment(v_row.transfer_amount) THEN
    PERFORM app_private.fail('Cash payments are confirmed by the manager, not acknowledged');
  END IF;
  v_reference := COALESCE(NULLIF(TRIM(p_transfer_reference), ''), v_row.transfer_reference);
  IF v_reference IS NULL THEN
    PERFORM app_private.fail('Enter the transfer reference before acknowledging', 'transferReference');
  END IF;
  UPDATE public.payments
     SET transfer_reference = v_reference, proof_name = COALESCE(NULLIF(TRIM(p_proof_name), ''), proof_name),
         status = 'acknowledged', acknowledged_at = pg_catalog.now(), acknowledged_by = v_actor.id, updated_at = pg_catalog.now()
   WHERE id = v_row.id RETURNING * INTO v_row;
  PERFORM app_private.notify_owners(v_row.tenant_id, 'payment_awaiting_confirmation', 'payment', v_row.id,
    v_row.id || ' acknowledged by manager · transfer awaiting your confirmation');
  PERFORM app_private.audit(v_actor, 'PAYMENT_ACKNOWLEDGED', v_row.id || ' · ' || v_row.period || ' payment acknowledged',
    'payment', v_row.id, pg_catalog.jsonb_build_object('branchId', v_row.branch_id, 'salesRepId', v_row.sales_rep_id, 'period', v_row.period));
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_payment(p_payment_id TEXT)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
DECLARE
  v_actor public.users := app_private.actor();
  v_row public.payments;
  v_by TEXT;
BEGIN
  SELECT * INTO v_row FROM public.payments WHERE id = p_payment_id AND tenant_id = v_actor.tenant_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM app_private.fail('Payment not found'); END IF;
  IF v_row.status NOT IN ('submitted', 'acknowledged') THEN PERFORM app_private.fail('Only pending payments can be confirmed'); END IF;
  IF app_private.is_cash_payment(v_row.transfer_amount) THEN
    IF NOT app_private.is_payment_manager(v_actor, v_row.manager_id, v_row.branch_id) THEN
      PERFORM app_private.deny('Cash payments are confirmed by the branch manager');
    END IF;
    v_by := 'your manager';
  ELSE
    IF v_actor.role <> 'owner' THEN PERFORM app_private.deny('Only the business owner can confirm transfers'); END IF;
    v_by := 'the owner';
  END IF;
  UPDATE public.payments
     SET status = 'confirmed', confirmed_at = pg_catalog.now(), confirmed_by = v_actor.id, updated_at = pg_catalog.now()
   WHERE id = v_row.id RETURNING * INTO v_row;
  PERFORM app_private.notify(v_row.tenant_id, v_row.sales_rep_id, 'payment_confirmed', 'payment', v_row.id,
    v_row.id || ' was confirmed by ' || v_by);
  PERFORM app_private.audit(v_actor, 'PAYMENT_CONFIRMED', v_row.id || ' · payment confirmed by ' || v_actor.role, 'payment', v_row.id,
    pg_catalog.jsonb_build_object('branchId', v_row.branch_id, 'salesRepId', v_row.sales_rep_id, 'period', v_row.period));
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.decline_payment(p_payment_id TEXT, p_reason TEXT)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
DECLARE
  v_actor public.users := app_private.actor();
  v_row public.payments;
BEGIN
  SELECT * INTO v_row FROM public.payments WHERE id = p_payment_id AND tenant_id = v_actor.tenant_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM app_private.fail('Payment not found'); END IF;
  IF app_private.is_cash_payment(v_row.transfer_amount) THEN
    IF NOT app_private.is_payment_manager(v_actor, v_row.manager_id, v_row.branch_id) THEN
      PERFORM app_private.deny('Cash payments are declined by the branch manager');
    END IF;
    IF v_row.status NOT IN ('submitted', 'acknowledged') THEN PERFORM app_private.fail('Only pending payments can be declined'); END IF;
  ELSIF v_actor.role = 'owner' THEN
    IF v_row.status NOT IN ('submitted', 'acknowledged') THEN
      PERFORM app_private.fail('Only pending payments can be declined by the owner');
    END IF;
  ELSIF app_private.is_payment_manager(v_actor, v_row.manager_id, v_row.branch_id) THEN
    IF v_row.status <> 'submitted' THEN PERFORM app_private.fail('Only submitted payments can be declined by a manager'); END IF;
  ELSE
    PERFORM app_private.deny('You cannot decline this payment');
  END IF;
  IF TRIM(COALESCE(p_reason, '')) = '' THEN PERFORM app_private.fail('A decline reason is required', 'reason'); END IF;
  UPDATE public.payments
     SET status = 'declined', declined_at = pg_catalog.now(), declined_by = v_actor.id,
         decline_reason = TRIM(p_reason), updated_at = pg_catalog.now()
   WHERE id = v_row.id RETURNING * INTO v_row;
  PERFORM app_private.notify(v_row.tenant_id, v_row.sales_rep_id, 'payment_declined', 'payment', v_row.id,
    v_row.id || ' was declined: ' || v_row.decline_reason);
  PERFORM app_private.audit(v_actor, 'PAYMENT_DECLINED', v_row.id || ' · ' || v_row.decline_reason, 'payment', v_row.id,
    pg_catalog.jsonb_build_object('branchId', v_row.branch_id, 'salesRepId', v_row.sales_rep_id, 'declineReason', v_row.decline_reason));
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_payment(p_payment_id TEXT, p_reason TEXT)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
DECLARE
  v_actor public.users := app_private.actor();
  v_row public.payments;
BEGIN
  IF v_actor.role <> 'owner' THEN PERFORM app_private.deny('Only the business owner can void a payment'); END IF;
  SELECT * INTO v_row FROM public.payments WHERE id = p_payment_id AND tenant_id = v_actor.tenant_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM app_private.fail('Payment not found'); END IF;
  IF v_row.status <> 'confirmed' THEN PERFORM app_private.fail('Only confirmed payments can be voided'); END IF;
  IF TRIM(COALESCE(p_reason, '')) = '' THEN PERFORM app_private.fail('A reason is required', 'reason'); END IF;
  UPDATE public.payments
     SET status = 'declined', declined_at = pg_catalog.now(), declined_by = v_actor.id,
         decline_reason = 'Voided: ' || TRIM(p_reason), updated_at = pg_catalog.now()
   WHERE id = v_row.id RETURNING * INTO v_row;
  PERFORM app_private.notify(v_row.tenant_id, v_row.sales_rep_id, 'payment_declined', 'payment', v_row.id,
    v_row.id || ' was voided by the owner: ' || TRIM(p_reason));
  PERFORM app_private.audit(v_actor, 'PAYMENT_VOIDED', v_row.id || ' · ' || TRIM(p_reason), 'payment', v_row.id,
    pg_catalog.jsonb_build_object('branchId', v_row.branch_id, 'salesRepId', v_row.sales_rep_id, 'period', v_row.period,
      'cashAmount', v_row.cash_amount, 'transferAmount', v_row.transfer_amount, 'reason', TRIM(p_reason)));
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.void_payment(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_payment(TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.void_customer_payment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_customer_payment(UUID, TEXT) TO authenticated;
