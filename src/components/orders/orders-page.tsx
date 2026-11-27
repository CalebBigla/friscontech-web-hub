import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Ban, CheckCheck, ClipboardList, Loader2, PackageCheck, Plus, Tag, X } from "lucide-react";
import { ConfirmDialog } from "@/components/kit/confirm-dialog";
import { FilterBar } from "@/components/kit/filter-bar";
import { Modal } from "@/components/kit/overlays";
import { Pagination } from "@/components/kit/data-table";
import { RowActions } from "@/components/kit/row-actions";
import { FormField } from "@/components/kit/form-field";
import { usePagination } from "@/hooks/use-pagination";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { PlaceOrderDialog } from "@/components/orders/place-order-dialog";
import { PeriodFilter, usePeriodFilter } from "@/components/period-filter";
import { DataGate, EmptyState, FieldError, FilterSelect, Panel, StatTile } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Db } from "@/data/mock-db";
import { useLiveWorkspace } from "@/hooks/use-live-workspace";
import {
  orderStatusView,
  orderTotal,
  useAcknowledgeOrder,
  useCancelOrder,
  useChangeOrderPrices,
  useCustomerOrders,
  useFulfilOrder,
  useVoidOrder,
  type CustomerOrderRecord,
  type OrderLine,
  type OrderStatus,
} from "@/hooks/use-orders";
import { formatDayTime, formatNaira, formatNumber } from "@/lib/format";
import { getAvailableStock } from "@/lib/inventory-calculations";
import { getAccessScope, useCurrentUserId, type AccessScope } from "@/lib/session";
import { fieldErrorsFrom } from "@/lib/supabase-helpers";

const ALL = "all";

/** Customer orders: the rep raises, the branch storekeeper fulfils, the rep acknowledges. */
export function OrdersPage({ initialStatus }: { initialStatus?: OrderStatus | undefined }) {
  const { db, isLoading, error } = useLiveWorkspace();
  const { data: orders = [], isLoading: loadingOrders, error: ordersError } = useCustomerOrders();
  const scope = getAccessScope(db, useCurrentUserId());
  const [status, setStatus] = useState<string>(initialStatus ?? ALL);
  const [creating, setCreating] = useState(false);
  const [rep, setRep] = useState(ALL);
  const [productId, setProductId] = useState(ALL);
  const [query, setQuery] = useState("");
  const today = db.tenant.referenceDate;
  const { state: period, setState: setPeriod, range, label: rangeLabel } = usePeriodFilter(today, "today");
  const role = scope.user.role;
  const userName = (id: string | null) => (id ? (db.users.find((u) => u.id === id)?.name ?? "") : "");
  const productName = (id: string) => db.products.find((p) => p.id === id)?.name ?? "";

  // Choices come from the orders this user can see.
  const reps = useMemo(() => [...new Set(orders.map((o) => o.repId))]
    .map((id) => ({ value: id, label: userName(id) || "Sales rep" })).sort((a, b) => a.label.localeCompare(b.label)),
  [orders, db.users]); // eslint-disable-line react-hooks/exhaustive-deps
  const products = useMemo(() => [...new Set(orders.flatMap((o) => o.lines.map((l) => l.productId)))]
    .map((id) => ({ value: id, label: productName(id) || "Product" })).sort((a, b) => a.label.localeCompare(b.label)),
  [orders, db.products]); // eslint-disable-line react-hooks/exhaustive-deps

  // Raised within the period (by the day it was raised), then rep, product and search.
  const needle = query.trim().toLowerCase();
  const filtered = orders.filter((o) => {
    const day = o.createdAt.slice(0, 10);
    if (day < range.from || day > range.to) return false;
    if (rep !== ALL && o.repId !== rep) return false;
    if (productId !== ALL && !o.lines.some((l) => l.productId === productId)) return false;
    if (!needle) return true;
    const text = [o.code, o.customerName, userName(o.repId), o.note ?? "", ...o.lines.map((l) => productName(l.productId))].join(" ").toLowerCase();
    return text.includes(needle);
  });
  const count = (s: OrderStatus) => filtered.filter((o) => o.status === s).length;
  const list = filtered.filter((o) => status === ALL || o.status === status);
  const filtering = rep !== ALL || productId !== ALL || !!needle || status !== ALL || period.period !== "today";
  const clearFilters = () => {
    setRep(ALL);
    setProductId(ALL);
    setStatus(ALL);
    setQuery("");
    setPeriod({ period: "today" });
  };
  // The work for this role comes first: storekeepers the pending ones, reps those to acknowledge.
  const urgent = (o: CustomerOrderRecord) =>
    (role === "storekeeper" && o.status === "pending") || (role === "sales_rep" && o.status === "fulfilled") ? 0 : 1;
  const sorted = [...list].sort((a, b) => urgent(a) - urgent(b) || (urgent(a) === 0 ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)));
  const paging = usePagination(sorted, 20);

  return (
    <AppShell
      title="Orders"
      subtitle={role === "sales_rep" ? "Raise orders for your customers and confirm delivery."
        : role === "storekeeper" ? "Fulfil orders from your branch's sales reps."
          : "Customer orders from raised to delivered."}
      actions={scope.canRaiseOrders ? <Button onClick={() => setCreating(true)}><Plus />New order</Button> : undefined}
    >
      <FilterBar
        search={{ value: query, onChange: setQuery, placeholder: "Search orders" }}
        active={filtering}
        onClear={clearFilters}
      >
        <PeriodFilter today={today} value={period} onChange={setPeriod} />
        {role !== "sales_rep" && (
          <FilterSelect label="Sales rep" className="w-full sm:w-44" value={rep} onChange={setRep}
            options={[{ value: ALL, label: "All sales reps" }, ...reps]} />
        )}
        <FilterSelect label="Product" className="w-full sm:w-44" value={productId} onChange={setProductId}
          options={[{ value: ALL, label: "All products" }, ...products]} />
        <FilterSelect label="Status" className="w-full sm:w-44" value={status} onChange={setStatus} options={[
          { value: ALL, label: "All statuses" },
          { value: "pending", label: orderStatusView.pending.label },
          { value: "fulfilled", label: orderStatusView.fulfilled.label },
          { value: "acknowledged", label: orderStatusView.acknowledged.label },
          { value: "cancelled", label: orderStatusView.cancelled.label },
          { value: "voided", label: orderStatusView.voided.label },
        ]} />
      </FilterBar>
      <DataGate isLoading={isLoading || loadingOrders} error={error ?? ordersError}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="To fulfil" value={formatNumber(count("pending"))} tone="warning" />
          <StatTile label="To acknowledge" value={formatNumber(count("fulfilled"))} tone="violet" />
          <StatTile label="Completed" value={formatNumber(count("acknowledged"))} tone="success" />
          <StatTile label="Cancelled or voided" value={formatNumber(count("cancelled") + count("voided"))} tone="danger" />
        </div>
        <Panel
          className="mt-4 overflow-hidden"
          title={`${formatNumber(list.length)} order${list.length === 1 ? "" : "s"}`}
          subtitle={`${rangeLabel} · ${formatNaira(list.reduce((sum, o) => sum + orderTotal(o), 0))}`}
        >
          {sorted.length ? (
            <>
              <ul className="divide-y divide-border">{paging.pageItems.map((o) => <OrderRow key={o.id} o={o} db={db} scope={scope} />)}</ul>
              <Pagination page={paging.page} pageCount={paging.pageCount} pageSize={paging.pageSize} total={paging.total} onPage={paging.setPage} />
            </>
          ) : (
            <EmptyState icon={ClipboardList} title={orders.length ? "No orders match" : "No orders yet"}
              detail={orders.length ? "Try a wider period or clear the filters." : scope.canRaiseOrders ? "Raise an order for one of your customers." : "Orders from sales reps appear here."}
              action={orders.length && filtering
                ? <Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>
                : scope.canRaiseOrders ? <Button size="sm" onClick={() => setCreating(true)}><Plus />New order</Button> : undefined} />
          )}
        </Panel>
      </DataGate>
      {scope.canRaiseOrders && <PlaceOrderDialog open={creating} onOpenChange={setCreating} db={db} scope={scope} />}
    </AppShell>
  );
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const view = orderStatusView[status];
  return <span className={`status ${view.tone} whitespace-nowrap`}>{view.label}</span>;
}

export function OrderRow({ o, db, scope }: { o: CustomerOrderRecord; db: Db; scope: AccessScope }) {
  const fulfil = useFulfilOrder();
  const acknowledge = useAcknowledgeOrder();
  const cancel = useCancelOrder();
  const voidOrder = useVoidOrder();
  const changePrices = useChangeOrderPrices();
  // "cancel" before fulfilment; "void" (Owner) after it.
  const [confirming, setConfirming] = useState<false | "cancel" | "void">(false);
  const [error, setError] = useState("");
  const today = db.tenant.referenceDate;
  const product = (id: string) => db.products.find((p) => p.id === id)?.name ?? "Product";
  const person = (id: string | null) => (id ? (db.users.find((u) => u.id === id)?.name ?? "—") : "—");
  const isStorekeeper = scope.canFulfilOrders && (scope.branchIds?.includes(o.branchId) ?? true);
  const isRaiser = scope.user.id === o.repId;
  const canCancel = o.status === "pending" && (isRaiser || isStorekeeper || scope.user.role === "owner");
  const canVoid = scope.user.role === "owner" && (o.status === "fulfilled" || o.status === "acknowledged");
  const lines = o.lines.filter((l) => l.status !== "voided" || o.status === "cancelled");
  // What a unit costs the customer now (an older Owner discount is folded in).
  const priceEach = (l: OrderLine) => (l.quantity > 0 ? l.lineTotal / l.quantity : l.unitPrice);
  const priceable = lines.filter((l) => !l.isPromo && l.status !== "voided");
  const canChangePrices = scope.canChangeOrderPrices && (scope.branchIds?.includes(o.branchId) ?? true)
    && (o.status === "pending" || o.status === "fulfilled" || o.status === "acknowledged") && priceable.length > 0;
  const [pricing, setPricing] = useState(false);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [priceError, setPriceError] = useState("");
  const busy = fulfil.isPending || acknowledge.isPending || cancel.isPending || voidOrder.isPending || changePrices.isPending;

  function openPricing() {
    setPrices(Object.fromEntries(priceable.map((l) => [l.saleId, String(Math.round(priceEach(l) * 100) / 100)])));
    setReason("");
    setPriceError("");
    setPricing(true);
  }
  const newPrice = (l: OrderLine) => Number(prices[l.saleId]);
  const pricingTotal = lines.reduce((sum, l) => {
    if (l.status === "voided") return sum;
    const p = newPrice(l);
    return sum + (!l.isPromo && prices[l.saleId] !== undefined && Number.isFinite(p) ? p * l.quantity : l.lineTotal);
  }, 0);
  async function savePrices() {
    const changed = priceable.filter((l) => Math.abs(newPrice(l) - priceEach(l)) >= 0.005);
    for (const l of priceable) {
      const p = newPrice(l);
      const list = l.listPrice ?? l.unitPrice;
      if (!Number.isFinite(p) || p <= 0) return setPriceError(`Enter a price above zero for ${product(l.productId)}`);
      if (p > list + 0.004) return setPriceError(`${product(l.productId)} can't go above its list price of ${formatNaira(list)}`);
    }
    if (!changed.length) return setPriceError("Change at least one price");
    if (!reason.trim()) return setPriceError("Say why the price is changing");
    setPriceError("");
    try {
      await changePrices.mutateAsync({
        p_order_id: o.id,
        p_lines: changed.map((l) => ({ sale_id: l.saleId, unit_price: Math.round(newPrice(l) * 100) / 100 })),
        p_reason: reason.trim(),
      });
      toast.success(`Prices updated on ${o.code}`, { description: `New total ${formatNaira(pricingTotal)}` });
      setPricing(false);
    } catch (failure) {
      const errors = fieldErrorsFrom(failure, ["reason", "lines"] as const);
      setPriceError(errors.lines ?? errors.reason ?? errors.form ?? "Could not change the prices");
    }
  }

  async function run(label: string, fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
      toast.success(label);
    } catch (failure) {
      const errors = fieldErrorsFrom(failure, ["reason"] as const);
      setError(errors.reason ?? errors.form ?? "Could not update the order");
    }
  }

  const history = [
    o.fulfilledAt && `Fulfilled by ${person(o.fulfilledBy)} · ${formatDayTime(o.fulfilledAt, today)}`,
    o.acknowledgedAt && `Acknowledged by ${person(o.acknowledgedBy)} · ${formatDayTime(o.acknowledgedAt, today)}`,
  ].filter(Boolean) as string[];

  return (
    <li className="px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link to="/customers/$customerId" params={{ customerId: o.customerId }} className="text-body font-medium hover:text-primary">{o.customerName}</Link>
            <span className="font-mono text-caption text-muted-foreground">{o.code}</span>
            <OrderStatusBadge status={o.status} />
          </div>
          <ul className="space-y-0.5 text-label">
            {lines.map((l) => {
              const left = getAvailableStock(db, l.productId, o.branchId);
              return (
                <li key={l.saleId} className="text-muted-foreground">
                  <span className="text-foreground">{formatNumber(l.quantity)} × {product(l.productId)}</span>
                  {l.isPromo ? " · free (promo)" : (
                    <>
                      {" · "}{formatNaira(priceEach(l))} each
                      {/* Only the Owner and managers receive the list price. */}
                      {l.listPrice !== null && Math.abs(l.listPrice - priceEach(l)) >= 0.005 && (
                        <> <span className="line-through">{formatNaira(l.listPrice)}</span></>
                      )}
                    </>
                  )}
                  {isStorekeeper && o.status === "pending" && <> · held ({formatNumber(left)} more available)</>}
                </li>
              );
            })}
          </ul>
          <p className="text-caption text-muted-foreground">
            {person(o.repId)} · {formatDayTime(o.createdAt, today)}
            {history.length > 0 && <> · {history.join(" · ")}</>}
          </p>
          {o.note && <p className="text-caption text-muted-foreground">Note: {o.note}</p>}
          {o.cancelledAt && <p className="text-caption text-destructive">{o.status === "voided" ? "Voided" : "Cancelled"} by {person(o.cancelledBy)} · {formatDayTime(o.cancelledAt, today)}{o.cancelReason ? ` · ${o.cancelReason}` : ""}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
          <span className="text-body font-semibold tabular-nums">{formatNaira(orderTotal(o))}</span>
          <div className="ml-auto flex items-center gap-1.5 sm:ml-0">
            {isStorekeeper && o.status === "pending" && (
              <Button size="sm" disabled={busy} onClick={() => void run(`${o.code} fulfilled`, () => fulfil.mutateAsync({ p_order_id: o.id }))}>
                {fulfil.isPending ? <Loader2 className="animate-spin" /> : <PackageCheck />}Fulfil
              </Button>
            )}
            {isRaiser && scope.canRaiseOrders && o.status === "fulfilled" && (
              <Button size="sm" disabled={busy} onClick={() => void run(`${o.code} acknowledged`, () => acknowledge.mutateAsync({ p_order_id: o.id }))}>
                {acknowledge.isPending ? <Loader2 className="animate-spin" /> : <CheckCheck />}Acknowledge
              </Button>
            )}
            <RowActions
              label={`Actions for ${o.code}`}
              actions={[
                { label: "Change prices", icon: Tag, onSelect: openPricing, hidden: !canChangePrices, disabled: busy },
                { label: "Cancel order", icon: X, onSelect: () => setConfirming("cancel"), hidden: !canCancel, danger: true, disabled: busy },
                { label: "Void order", icon: Ban, onSelect: () => setConfirming("void"), hidden: !canVoid, danger: true, disabled: busy },
              ]}
            />
          </div>
        </div>
      </div>
      <FieldError message={error} />

      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(open) => !open && setConfirming(false)}
        title={confirming === "void" ? `Void ${o.code}?` : `Cancel ${o.code}?`}
        description={confirming === "void"
          ? `Takes ${formatNaira(orderTotal(o))} off ${o.customerName}'s account and ${person(o.repId)}'s sales, and puts the items back in stock. This can't be undone.`
          : "The held items go back to available stock."}
        confirmLabel={confirming === "void" ? "Void order" : "Cancel order"}
        cancelLabel="Keep order"
        reason={{ label: "Reason", placeholder: confirming === "void" ? "Why is the order voided?" : "Why is the order cancelled?", required: true }}
        onConfirm={async (why) => {
          if (confirming === "void") await voidOrder.mutateAsync({ p_order_id: o.id, p_reason: why });
          else await cancel.mutateAsync({ p_order_id: o.id, p_reason: why });
          toast.success(`${o.code} ${confirming === "void" ? "voided" : "cancelled"}`);
        }}
      />

      <Modal
        open={pricing}
        onOpenChange={(open) => !changePrices.isPending && setPricing(open)}
        title={`Change prices · ${o.code}`}
        description="The rep and the invoice show the new price. Only the Owner and managers see the old one."
        footer={
          <>
            <Button variant="secondary" disabled={changePrices.isPending} onClick={() => setPricing(false)}>Cancel</Button>
            <Button disabled={changePrices.isPending} onClick={() => void savePrices()}>
              {changePrices.isPending && <Loader2 className="animate-spin" />}Save prices
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <ul className="divide-y divide-border rounded-lg border border-border">
            {priceable.map((l) => {
              const list = l.listPrice ?? l.unitPrice;
              const p = newPrice(l);
              return (
                <li key={l.saleId} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-label font-medium">{formatNumber(l.quantity)} × {product(l.productId)}</p>
                    <p className="text-caption text-muted-foreground">List {formatNaira(list)} · now {formatNaira(priceEach(l))}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Input aria-label={`New price for ${product(l.productId)}`} type="number" inputMode="decimal" min={0} step="0.01"
                      value={prices[l.saleId] ?? ""} onChange={(e) => setPrices((all) => ({ ...all, [l.saleId]: e.target.value }))}
                      className="w-32 text-right" />
                    <span className="w-28 text-right text-label font-semibold tabular-nums">
                      {Number.isFinite(p) && p > 0 ? formatNaira(p * l.quantity) : "—"}
                      {Number.isFinite(p) && p > 0 && p < list && (
                        <span className="block text-caption font-normal text-success">{Math.round((1 - p / list) * 1000) / 10}% below list</span>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-label">
            <span className="text-muted-foreground">Order total</span>
            <span className="tabular-nums"><span className="text-muted-foreground">{formatNaira(orderTotal(o))} → </span><strong>{formatNaira(pricingTotal)}</strong></span>
          </div>
          <FormField label="Reason" htmlFor={`price-reason-${o.id}`} required error={priceError || undefined}>
            <Input id={`price-reason-${o.id}`} placeholder="Why is the price changing?" value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        </div>
      </Modal>
    </li>
  );
}
