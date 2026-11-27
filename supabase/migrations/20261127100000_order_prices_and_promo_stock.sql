-- Order prices and promo stock.
--
-- 1. change_order_prices (the Owner, or the manager of the order's branch): set a
--    lower unit price on lines of a rep's customer order, while it waits or after
--    fulfilment. The line's unit_price is rewritten, so to the rep (and on the
--    invoice) it is simply the price; nothing calls it a discount. The list price,
--    old and new price, reason and who changed it go to order_price_changes, which
--    only the Owner and managers can read; the audit entry is hidden from everyone
--    else too. The customer's balance, revenue and the rep's target follow the new
--    line total. A price can go back up, but never above the list price.
-- 2. convert_to_promo (the Owner for any branch, a manager for their own): move
--    units of regular products into promo stock. Each product gets one promo twin
--    ("<name> (Promo)", price 0, promo_source_id = the product), created on first
--    use. The units leave the product (first expiry first, never reserved units)
--    and arrive on the twin in the same batches, as 'promo_conversion' movements.
-- 3. Reps can now put promo items on a customer order when the branch has them
--    available; the storekeeper fulfils them like any line, at ₦0.

-- ----------------------------------------------------------------------------
-- Schema
-- ----------------------------------------------------------------------------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS promo_source_id UUID REFERENCES public.products(id) ON DELETE RESTRICT;
COMMENT ON COLUMN public.products.promo_source_id IS 'On a promo twin made by convert_to_promo: the regular product its stock came from';
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_promo_source ON public.products (promo_source_id) WHERE promo_source_id IS NOT NULL;
-- products has column grants (20261110100000): a new column must be granted by name.
GRANT SELECT (promo_source_id) ON public.products TO authenticated;

ALTER TABLE public.inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_type_check;
ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_type_check
  CHECK (type IN ('stock_added', 'stock_issued', 'sale', 'adjustment', 'promo', 'exchange_return', 'exchange_issue',
                  'order_void', 'promo_conversion'));

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'payment_awaiting_acknowledgement', 'payment_awaiting_confirmation',
    'payment_confirmed', 'payment_declined',
    'onboarding_submitted', 'onboarding_approved', 'onboarding_rejected',
    'guarantor_completed',
    'stock_request_submitted', 'stock_request_approved',
    'stock_request_rejected', 'stock_request_fulfilled',
    'approval_requested', 'approval_approved', 'approval_rejected',
    'report_requested', 'report_approved', 'report_rejected',
    'exchange_requested', 'exchange_approved', 'exchange_rejected', 'exchange_fulfilled',
    'order_submitted', 'order_fulfilled', 'order_cancelled', 'order_voided', 'order_price_changed'
  ));

CREATE TABLE IF NOT EXISTS public.order_price_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES public.customer_orders(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  rep_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  list_price NUMERIC(12,2) NOT NULL CHECK (list_price >= 0),
  old_price NUMERIC(12,2) NOT NULL CHECK (old_price >= 0),
  new_price NUMERIC(12,2) NOT NULL CHECK (new_price > 0 AND new_price <= list_price),
  reason TEXT NOT NULL,
  changed_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);
COMMENT ON TABLE public.order_price_changes IS 'Each price change on an order line: list price, old and new unit price, why and by whom. Owner and managers only; reps see only the new price on the line.';
CREATE INDEX IF NOT EXISTS idx_order_price_changes_sale ON public.order_price_changes (sale_id, created_at);
CREATE INDEX IF NOT EXISTS idx_order_price_changes_order ON public.order_price_changes (order_id);
CREATE INDEX IF NOT EXISTS idx_order_price_changes_tenant_created ON public.order_price_changes (tenant_id, created_at DESC);

ALTER TABLE public.order_price_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_price_changes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.order_price_changes FROM authenticated;
GRANT SELECT ON public.order_price_changes TO authenticated;
DROP POLICY IF EXISTS order_price_changes_select ON public.order_price_changes;
CREATE POLICY order_price_changes_select ON public.order_price_changes AS PERMISSIVE FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.get_user_tenant_id())
    AND ((SELECT public.get_user_role()) = 'owner'
      OR ((SELECT public.get_user_role()) = 'manager' AND branch_id = (SELECT public.get_user_branch_id()))));

-- The audit entry names the old price: only the Owner and managers read it.
DROP POLICY IF EXISTS activities_price_changes_owner_manager ON public.activities;
CREATE POLICY activities_price_changes_owner_manager ON public.activities AS RESTRICTIVE FOR SELECT TO authenticated
  USING (action <> 'Order prices changed' OR (SELECT public.get_user_role()) IN ('owner', 'manager'));

-- ----------------------------------------------------------------------------
-- 1. Change prices on an order
-- ----------------------------------------------------------------------------
-- p_lines: [{ "sale_id": uuid, "unit_price": number }], the new price per unit.
CREATE OR REPLACE FUNCTION public.change_order_prices(p_order_id UUID, p_lines JSONB, p_reason TEXT)
RETURNS public.customer_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
DECLARE
  v_actor public.users := app_private.actor();
  v_order public.customer_orders;
  v_item JSONB;
  v_line public.sales;
  v_name TEXT;
  v_new NUMERIC;
  v_old NUMERIC;
  v_list NUMERIC;
  v_before NUMERIC;
  v_after NUMERIC;
  v_changed INTEGER := 0;
  v_customer TEXT;
  v_rep_lines TEXT := '';
  v_naira TEXT := 'FM999,999,999,990.00';
BEGIN
  IF v_actor.role NOT IN ('owner', 'manager') THEN
    PERFORM app_private.deny('Only the Owner or the branch manager can change prices on an order');
  END IF;
  SELECT * INTO v_order FROM public.customer_orders WHERE id = p_order_id AND tenant_id = v_actor.tenant_id FOR UPDATE;
  IF NOT FOUND THEN PERFORM app_private.fail('Order not found'); END IF;
  IF v_actor.role = 'manager' AND v_actor.branch_id IS DISTINCT FROM v_order.branch_id THEN
    PERFORM app_private.deny('Only the manager of this order''s branch can change its prices');
  END IF;
  IF v_order.status NOT IN ('pending', 'fulfilled', 'acknowledged') THEN
    PERFORM app_private.fail('Prices can''t change on a cancelled or voided order');
  END IF;
  IF TRIM(COALESCE(p_reason, '')) = '' THEN PERFORM app_private.fail('Say why the price is changing', 'reason'); END IF;
  IF p_lines IS NULL OR pg_catalog.jsonb_typeof(p_lines) <> 'array' OR pg_catalog.jsonb_array_length(p_lines) = 0 THEN
    PERFORM app_private.fail('Set a new price for at least one item', 'lines');
  END IF;

  SELECT COALESCE(SUM(line_total), 0) INTO v_before FROM public.sales
   WHERE order_id = v_order.id AND status <> 'voided' AND exchange_id IS NULL;

  FOR v_item IN SELECT * FROM pg_catalog.jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_line FROM public.sales
     WHERE id = NULLIF(v_item ->> 'sale_id', '')::UUID AND order_id = v_order.id AND exchange_id IS NULL FOR UPDATE;
    IF NOT FOUND THEN PERFORM app_private.fail('An item is not on this order', 'lines'); END IF;
    SELECT name INTO v_name FROM public.products WHERE id = v_line.product_id;
    IF v_line.is_promo THEN PERFORM app_private.fail(v_name || ' is a promo item: it is already free', 'lines'); END IF;
    IF v_line.status = 'voided' THEN PERFORM app_private.fail(v_name || ' is no longer on the order', 'lines'); END IF;
    IF v_line.quantity_returned > 0
       OR EXISTS (SELECT 1 FROM public.stock_exchanges e WHERE e.sale_id = v_line.id AND e.status <> 'rejected') THEN
      PERFORM app_private.fail(v_name || ' was exchanged, so its price can''t change', 'lines');
    END IF;
    BEGIN
      v_new := ROUND((v_item ->> 'unit_price')::NUMERIC, 2);
    EXCEPTION WHEN OTHERS THEN
      v_new := NULL;
    END;
    IF v_new IS NULL OR v_new <= 0 THEN PERFORM app_private.fail('Enter a price above zero for ' || v_name, 'lines'); END IF;

    -- The list price is the line's price before its first change.
    SELECT pc.list_price INTO v_list FROM public.order_price_changes pc WHERE pc.sale_id = v_line.id ORDER BY pc.created_at LIMIT 1;
    v_list := COALESCE(v_list, v_line.unit_price);
    IF v_new > v_list THEN
      PERFORM app_private.fail(v_name || ' can''t go above its list price of ₦' || pg_catalog.to_char(v_list, v_naira), 'lines');
    END IF;
    -- What a unit cost the customer before (an older Owner discount counts).
    v_old := ROUND((v_line.quantity * v_line.unit_price - v_line.discount_amount) / v_line.quantity, 2);
    CONTINUE WHEN v_new = v_old AND v_line.discount_amount = 0;

    UPDATE public.sales
       SET unit_price = v_new, discount_type = NULL, discount_value = NULL, discount_amount = 0, updated_at = pg_catalog.now()
     WHERE id = v_line.id;
    INSERT INTO public.order_price_changes (tenant_id, branch_id, order_id, sale_id, product_id, rep_id, quantity,
                                            list_price, old_price, new_price, reason, changed_by)
    VALUES (v_order.tenant_id, v_order.branch_id, v_order.id, v_line.id, v_line.product_id, v_order.rep_id, v_line.quantity,
            v_list, v_old, v_new, TRIM(p_reason), v_actor.id);
    v_changed := v_changed + 1;
    v_rep_lines := v_rep_lines || CASE WHEN v_rep_lines = '' THEN '' ELSE '; ' END
      || v_name || ' ₦' || pg_catalog.to_char(v_new, v_naira) || ' each';
  END LOOP;

  IF v_changed = 0 THEN PERFORM app_private.fail('These are already the prices on the order', 'lines'); END IF;

  SELECT COALESCE(SUM(line_total), 0) INTO v_after FROM public.sales
   WHERE order_id = v_order.id AND status <> 'voided' AND exchange_id IS NULL;
  UPDATE public.customer_orders SET updated_at = pg_catalog.now() WHERE id = v_order.id RETURNING * INTO v_order;
  SELECT name INTO v_customer FROM public.customers WHERE id = v_order.customer_id;

  -- The rep is told the price, not that it was reduced.
  PERFORM app_private.notify(v_order.tenant_id, v_order.rep_id, 'order_price_changed', 'customer_order', v_order.id::TEXT,
    'Prices updated on ' || v_order.code || ' for ' || v_customer || ': ' || v_rep_lines
      || '. Order total ₦' || pg_catalog.to_char(v_after, v_naira) || '.');
  IF v_actor.role = 'manager' THEN
    PERFORM app_private.notify_owners(v_order.tenant_id, 'order_price_changed', 'customer_order', v_order.id::TEXT,
      app_private.full_name(v_actor.id) || ' lowered prices on ' || v_order.code || ' for ' || v_customer || ': ₦'
        || pg_catalog.to_char(v_before, v_naira) || ' → ₦' || pg_catalog.to_char(v_after, v_naira) || '. ' || TRIM(p_reason));
  END IF;
  PERFORM app_private.audit(v_actor, 'Order prices changed',
    v_order.code || ' · ' || v_customer || ' · ₦' || pg_catalog.to_char(v_before, v_naira) || ' → ₦'
      || pg_catalog.to_char(v_after, v_naira) || ' · ' || TRIM(p_reason),
    'order', v_order.id::TEXT, pg_catalog.jsonb_build_object('branchId', v_order.branch_id, 'customerId', v_order.customer_id,
      'salesRepId', v_order.rep_id, 'orderId', v_order.id, 'before', v_before, 'after', v_after));
  RETURN v_order;
END;
$$;
REVOKE ALL ON FUNCTION public.change_order_prices(UUID, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_order_prices(UUID, JSONB, TEXT) TO authenticated;

-- Orders with their lines. list_price (the price before any change) is only filled
-- in for the Owner and managers; everyone else sees the line's price as it is.
CREATE OR REPLACE FUNCTION public.get_customer_orders()
RETURNS TABLE (
  id UUID, code TEXT, branch_id UUID, customer_id UUID, customer_name TEXT, rep_id UUID, status TEXT, note TEXT,
  created_at TIMESTAMPTZ, fulfilled_at TIMESTAMPTZ, fulfilled_by UUID, acknowledged_at TIMESTAMPTZ, acknowledged_by UUID,
  cancelled_at TIMESTAMPTZ, cancelled_by UUID, cancel_reason TEXT, lines JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
DECLARE
  v_actor public.users := app_private.actor();
  v_sees_changes BOOLEAN := v_actor.role IN ('owner', 'manager');
BEGIN
  RETURN QUERY
  SELECT o.id, o.code, o.branch_id, o.customer_id, c.name, o.rep_id, o.status, o.note, o.created_at, o.fulfilled_at,
         o.fulfilled_by, o.acknowledged_at, o.acknowledged_by, o.cancelled_at, o.cancelled_by, o.cancel_reason,
         COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                    'sale_id', s.id, 'product_id', s.product_id, 'quantity', s.quantity, 'unit_price', s.unit_price,
                    'line_total', s.line_total, 'is_promo', s.is_promo, 'status', s.status,
                    'list_price', CASE WHEN v_sees_changes THEN
                      (SELECT pc.list_price FROM public.order_price_changes pc WHERE pc.sale_id = s.id ORDER BY pc.created_at LIMIT 1)
                    END) ORDER BY s.created_at)
                     FROM public.sales s WHERE s.order_id = o.id AND s.exchange_id IS NULL), '[]'::JSONB)
    FROM public.customer_orders o
    JOIN public.customers c ON c.id = o.customer_id
   WHERE o.tenant_id = v_actor.tenant_id
     AND (v_actor.role = 'owner'
       OR (v_actor.role IN ('storekeeper', 'manager') AND o.branch_id = v_actor.branch_id)
       OR (v_actor.role = 'sales_rep' AND o.rep_id = v_actor.id))
   ORDER BY o.created_at DESC
   LIMIT 1000;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Move stock to promo
-- ----------------------------------------------------------------------------
-- p_items: [{ "product_id": uuid, "quantity": int }], regular products.
-- Returns [{ product_id, promo_product_id, quantity }].
CREATE OR REPLACE FUNCTION public.convert_to_promo(p_branch_id UUID, p_items JSONB, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
DECLARE
  v_actor public.users := app_private.actor();
  v_branch public.branches;
  v_item JSONB;
  v_product public.products;
  v_promo public.products;
  v_qty INTEGER;
  v_seen UUID[] := '{}';
  v_sku TEXT;
  v_n INTEGER;
  v_lot RECORD;
  v_lots JSONB;
  v_lotrow JSONB;
  v_left INTEGER;
  v_take INTEGER;
  v_out JSONB := '[]'::JSONB;
  v_units INTEGER := 0;
  v_note TEXT;
BEGIN
  IF v_actor.role NOT IN ('owner', 'manager') THEN
    PERFORM app_private.deny('Only the Owner or a branch manager can move stock to promo');
  END IF;
  SELECT * INTO v_branch FROM public.branches WHERE id = p_branch_id AND tenant_id = v_actor.tenant_id;
  IF NOT FOUND OR v_branch.status <> 'active' THEN PERFORM app_private.fail('Choose an active branch', 'branchId'); END IF;
  IF v_actor.role = 'manager' AND v_actor.branch_id IS DISTINCT FROM v_branch.id THEN
    PERFORM app_private.deny('Managers can move stock to promo in their own branch only');
  END IF;
  IF TRIM(COALESCE(p_reason, '')) = '' THEN PERFORM app_private.fail('Say why this stock becomes promo', 'reason'); END IF;
  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array' OR pg_catalog.jsonb_array_length(p_items) = 0 THEN
    PERFORM app_private.fail('Choose at least one product', 'items');
  END IF;

  -- Product order, so stock rows are locked in the same order as orders lock them.
  FOR v_item IN SELECT e FROM pg_catalog.jsonb_array_elements(p_items) e ORDER BY e ->> 'product_id' LOOP
    SELECT * INTO v_product FROM public.products
     WHERE id = NULLIF(v_item ->> 'product_id', '')::UUID AND tenant_id = v_actor.tenant_id;
    IF NOT FOUND THEN PERFORM app_private.fail('Select a product for every item', 'items'); END IF;
    IF v_product.product_type = 'promo' THEN PERFORM app_private.fail(v_product.name || ' is already a promo item', 'items'); END IF;
    IF v_product.status <> 'active' THEN PERFORM app_private.fail(v_product.name || ' is inactive', 'items'); END IF;
    IF v_product.id = ANY (v_seen) THEN PERFORM app_private.fail(v_product.name || ' is listed twice', 'items'); END IF;
    v_seen := v_seen || v_product.id;
    v_qty := (v_item ->> 'quantity')::INTEGER;
    IF v_qty IS NULL OR v_qty <= 0 OR (v_item ->> 'quantity')::NUMERIC <> v_qty THEN
      PERFORM app_private.fail('Enter a whole quantity above zero for ' || v_product.name, 'items');
    END IF;

    -- The product's promo twin, made on first use.
    SELECT * INTO v_promo FROM public.products WHERE promo_source_id = v_product.id FOR UPDATE;
    IF NOT FOUND THEN
      v_sku := UPPER(v_product.sku) || '-PROMO';
      v_n := 1;
      WHILE EXISTS (SELECT 1 FROM public.products WHERE tenant_id = v_actor.tenant_id AND UPPER(sku) = v_sku) LOOP
        v_n := v_n + 1;
        v_sku := UPPER(v_product.sku) || '-PROMO-' || v_n;
      END LOOP;
      INSERT INTO public.products (tenant_id, name, sku, category, unit, unit_price, unit_cost, low_stock_threshold,
                                   description, status, product_type, promo_source_id)
      VALUES (v_actor.tenant_id, v_product.name || ' (Promo)', v_sku, v_product.category, v_product.unit, 0,
              v_product.unit_cost, 0, 'Promo stock of ' || v_product.name, 'active', 'promo', v_product.id)
      RETURNING * INTO v_promo;
    ELSIF v_promo.status <> 'active' THEN
      UPDATE public.products SET status = 'active', updated_at = pg_catalog.now() WHERE id = v_promo.id RETURNING * INTO v_promo;
    END IF;

    -- The lots the units come from (first expiry first, as apply_stock takes them).
    v_lots := '[]'::JSONB;
    v_left := v_qty;
    FOR v_lot IN
      SELECT batch_number, expiry_date, quantity_remaining FROM public.stock_batches
       WHERE branch_id = v_branch.id AND product_id = v_product.id AND quantity_remaining > 0
       ORDER BY expiry_date, received_at
    LOOP
      EXIT WHEN v_left <= 0;
      v_take := LEAST(v_left, v_lot.quantity_remaining);
      v_lots := v_lots || pg_catalog.jsonb_build_object('batch', v_lot.batch_number, 'expiry', v_lot.expiry_date, 'qty', v_take);
      v_left := v_left - v_take;
    END LOOP;

    v_note := 'Moved to promo: ' || TRIM(p_reason);
    PERFORM app_private.apply_stock(v_actor.tenant_id, v_branch.id, v_product.id, -v_qty,
      'promo_conversion', 'manual', v_promo.id::TEXT, v_actor.id, v_note);
    FOR v_lotrow IN SELECT * FROM pg_catalog.jsonb_array_elements(v_lots) LOOP
      PERFORM app_private.apply_stock(v_actor.tenant_id, v_branch.id, v_promo.id, (v_lotrow ->> 'qty')::INTEGER,
        'promo_conversion', 'manual', v_product.id::TEXT, v_actor.id, 'From ' || v_product.name || ': ' || TRIM(p_reason),
        v_lotrow ->> 'batch', (v_lotrow ->> 'expiry')::DATE);
    END LOOP;
    IF v_left > 0 THEN
      PERFORM app_private.apply_stock(v_actor.tenant_id, v_branch.id, v_promo.id, v_left,
        'promo_conversion', 'manual', v_product.id::TEXT, v_actor.id, 'From ' || v_product.name || ': ' || TRIM(p_reason));
    END IF;

    v_out := v_out || pg_catalog.jsonb_build_object('product_id', v_product.id, 'promo_product_id', v_promo.id, 'quantity', v_qty);
    v_units := v_units + v_qty;
  END LOOP;

  PERFORM app_private.audit(v_actor, 'Stock moved to promo',
    v_branch.name || ' · ' || pg_catalog.jsonb_array_length(v_out) || ' product'
      || CASE WHEN pg_catalog.jsonb_array_length(v_out) > 1 THEN 's' ELSE '' END || ' · ' || v_units || ' units · ' || TRIM(p_reason),
    'inventory', v_branch.id::TEXT, pg_catalog.jsonb_build_object('branchId', v_branch.id, 'items', v_out));
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.convert_to_promo(UUID, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_to_promo(UUID, JSONB, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Reps order promo items
-- ----------------------------------------------------------------------------
-- Promo lines are allowed on an order line waiting for the storekeeper (placed by
-- place_customer_order); discounts and promo on direct sales stay the Owner's.
CREATE OR REPLACE FUNCTION app_private.guard_rep_discount()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
BEGIN
  IF (COALESCE(NEW.discount_amount, 0) > 0
      OR (NEW.is_promo AND NOT (NEW.status = 'pending' AND NEW.order_id IS NOT NULL)))
     AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('sales_rep', 'manager')) THEN
    PERFORM app_private.fail('Only the Owner can give discounts and promo items. Record the sale at list price.', 'items');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.guard_rep_discount() FROM PUBLIC, anon, authenticated;

-- p_items: [{ "product_id": uuid, "quantity": int }]; promo products go on at ₦0.
CREATE OR REPLACE FUNCTION public.place_customer_order(
  p_customer_id UUID, p_items JSONB, p_note TEXT, p_idempotency_key UUID DEFAULT NULL
)
RETURNS public.customer_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
DECLARE
  v_actor public.users := app_private.actor();
  v_prior JSONB := app_private.replay(p_idempotency_key, 'place_customer_order');
  v_branch public.branches;
  v_customer public.customers;
  v_item JSONB;
  v_product public.products;
  v_qty INTEGER;
  v_seen UUID[] := '{}';
  v_stock public.inventory_records;
  v_order public.customer_orders;
  v_count INTEGER;
  v_promo BOOLEAN;
BEGIN
  IF v_prior IS NOT NULL THEN
    RETURN pg_catalog.jsonb_populate_record(NULL::public.customer_orders, v_prior);
  END IF;
  IF v_actor.role <> 'sales_rep' THEN
    PERFORM app_private.deny('Orders are raised by the customer''s sales representative');
  END IF;
  SELECT * INTO v_branch FROM public.branches WHERE id = v_actor.branch_id AND tenant_id = v_actor.tenant_id;
  IF NOT FOUND OR v_branch.status <> 'active' THEN PERFORM app_private.fail('You need an active branch to raise orders'); END IF;
  SELECT * INTO v_customer FROM public.customers WHERE id = p_customer_id AND tenant_id = v_actor.tenant_id;
  IF NOT FOUND OR v_customer.assigned_rep_id IS DISTINCT FROM v_actor.id THEN
    PERFORM app_private.fail('Choose one of your customers', 'customerId');
  END IF;
  IF v_customer.status <> 'active' THEN PERFORM app_private.fail('This customer is inactive', 'customerId'); END IF;
  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array' OR pg_catalog.jsonb_array_length(p_items) = 0 THEN
    PERFORM app_private.fail('Add at least one product', 'items');
  END IF;

  -- Check every line first. Stock rows are locked in product order, so concurrent
  -- orders queue on the same rows instead of both seeing the same free units.
  FOR v_item IN
    SELECT e FROM pg_catalog.jsonb_array_elements(p_items) e ORDER BY e ->> 'product_id'
  LOOP
    SELECT * INTO v_product FROM public.products
     WHERE id = NULLIF(v_item ->> 'product_id', '')::UUID AND tenant_id = v_actor.tenant_id;
    IF NOT FOUND THEN PERFORM app_private.fail('Select a product for every item', 'items'); END IF;
    IF v_product.status <> 'active' THEN PERFORM app_private.fail(v_product.name || ' is inactive', 'items'); END IF;
    IF v_product.id = ANY (v_seen) THEN PERFORM app_private.fail(v_product.name || ' is already in the order', 'items'); END IF;
    v_seen := v_seen || v_product.id;
    v_qty := (v_item ->> 'quantity')::INTEGER;
    IF v_qty IS NULL OR v_qty <= 0 OR (v_item ->> 'quantity')::NUMERIC <> v_qty THEN
      PERFORM app_private.fail('Enter a whole quantity above zero for ' || v_product.name, 'items');
    END IF;
    SELECT * INTO v_stock FROM public.inventory_records
     WHERE branch_id = v_branch.id AND product_id = v_product.id FOR UPDATE;
    IF NOT FOUND OR v_stock.quantity_on_hand - v_stock.quantity_reserved <= 0 THEN
      PERFORM app_private.fail(v_product.name || ' is out of stock', 'items');
    END IF;
    IF v_qty > v_stock.quantity_on_hand - v_stock.quantity_reserved THEN
      PERFORM app_private.fail('Only ' || (v_stock.quantity_on_hand - v_stock.quantity_reserved) || ' of '
        || v_product.name || ' available', 'items');
    END IF;
  END LOOP;

  INSERT INTO public.customer_orders (code, tenant_id, branch_id, customer_id, rep_id, note)
  VALUES ('ORD-' || pg_catalog.nextval('app_private.customer_order_seq'), v_actor.tenant_id, v_branch.id, v_customer.id,
          v_actor.id, NULLIF(TRIM(p_note), ''))
  RETURNING * INTO v_order;

  FOR v_item IN SELECT * FROM pg_catalog.jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE id = (v_item ->> 'product_id')::UUID;
    v_qty := (v_item ->> 'quantity')::INTEGER;
    v_promo := v_product.product_type = 'promo';
    UPDATE public.inventory_records SET quantity_reserved = quantity_reserved + v_qty, last_updated = pg_catalog.now()
     WHERE branch_id = v_branch.id AND product_id = v_product.id;
    INSERT INTO public.sales (tenant_id, code, branch_id, sales_rep_id, product_id, customer_id, order_id, quantity,
                              unit_price, sale_date, status, discount_amount, is_promo)
    VALUES (v_actor.tenant_id, 'SAL-' || gen_random_uuid()::TEXT, v_branch.id, v_actor.id, v_product.id, v_customer.id,
            v_order.id, v_qty, CASE WHEN v_promo THEN 0 ELSE v_product.unit_price END,
            app_private.today(v_actor.tenant_id), 'pending', 0, v_promo);
  END LOOP;

  v_count := pg_catalog.array_length(v_seen, 1);
  INSERT INTO public.notifications (tenant_id, recipient_id, type, entity_type, entity_id, message)
  SELECT v_actor.tenant_id, u.id, 'order_submitted', 'customer_order', v_order.id::TEXT,
         app_private.full_name(v_actor.id) || ' raised ' || v_order.code || ' for ' || v_customer.name || ' · '
         || v_count || ' item' || CASE WHEN v_count > 1 THEN 's' ELSE '' END || ' to fulfil'
    FROM public.users u
   WHERE u.tenant_id = v_actor.tenant_id AND u.branch_id = v_branch.id AND u.role = 'storekeeper' AND u.status = 'active';

  PERFORM app_private.audit(v_actor, 'Order raised',
    v_order.code || ' · ' || v_customer.name || ' · ' || v_count || ' item' || CASE WHEN v_count > 1 THEN 's' ELSE '' END,
    'order', v_order.id::TEXT, pg_catalog.jsonb_build_object('branchId', v_branch.id, 'customerId', v_customer.id,
      'salesRepId', v_actor.id, 'orderId', v_order.id));
  PERFORM app_private.remember(p_idempotency_key, 'place_customer_order', pg_catalog.to_jsonb(v_order));
  RETURN v_order;
END;
$$;

NOTIFY pgrst, 'reload schema';
