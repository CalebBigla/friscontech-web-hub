import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Ban, CheckCheck, ClipboardList, Loader2, PackageCheck, Plus, Tag, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { PlaceOrderDialog } from "@/components/orders/place-order-dialog";
import { PeriodFilter, usePeriodFilter } from "@/components/period-filter";
import { DataGate, EmptyState, FieldError, FilterSelect, Panel, SearchBox, StatTile } from "@/components/shared";
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
  const filtering = rep !== ALL || productId !== ALL || !!needle;
  // The work for this role comes first: storekeepers the pending ones, reps those to acknowledge.
  const urgent = (o: CustomerOrderRecord) =>
    (role === "storekeeper" && o.status === "pending") || (role === "sales_rep" && o.status === "fulfilled") ? 0 : 1;
  const sorted = [...list].sort((a, b) => urgent(a) - urgent(b) || (urgent(a) === 0 ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)));

  return (
    <AppShell
      title="Orders"
      subtitle="Customer orders and their fulfilment"
      actions={scope.canRaiseOrders ? <Button onClick={() => setCreating(true)}><Plus className="size-4" /><span className="hidden sm:inline">New order</span></Button> : undefined}
    >
      <div className="mb-5">
        <h1 className="text-xl font-bold">Orders</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {role === "sales_rep" ? "Raise an order for your customer; the storekeeper fulfils it, then you acknowledge you have the goods."
            : role === "storekeeper" ? "Orders raised by your branch's sales reps. Fulfil an order to release its items: the stock is already held for it."
              : "Customer orders across your branches, from raised to acknowledged."}
        </p>
      </div>
      <DataGate isLoading={isLoading || loadingOrders} error={error ?? ordersError}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Waiting for fulfilment" value={formatNumber(count("pending"))} tone="warning" />
          <StatTile label="Fulfilled, to acknowledge" value={formatNumber(count("fulfilled"))} />
          <StatTile label="Completed" value={formatNumber(count("acknowledged"))} tone="success" />
          <StatTile label="Cancelled or voided" value={formatNumber(count("cancelled") + count("voided"))} />
        </div>
        <Panel
          className="mt-4 overflow-hidden"
          title="Orders"
          subtitle={`Raised ${rangeLabel} · ${formatNumber(list.length)} shown · ${formatNaira(list.reduce((sum, o) => sum + orderTotal(o), 0))}`}
          action={
            <div className="flex flex-col gap-2 lg:items-end">
              <div className="flex flex-wrap gap-2">
                <PeriodFilter today={today} value={period} onChange={setPeriod} />
                <SearchBox value={query} onChange={setQuery} placeholder="Search order, customer, product" className="w-full sm:w-60" />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                {role !== "sales_rep" && (
                  <FilterSelect label="Sales rep" className="w-full sm:w-44" value={rep} onChange={setRep}
                    options={[{ value: ALL, label: "All sales reps" }, ...reps]} />
                )}
                <FilterSelect label="Product" className="w-full sm:w-48" value={productId} onChange={setProductId}
                  options={[{ value: ALL, label: "All products" }, ...products]} />
                <FilterSelect label="Status" className="w-full sm:w-48" value={status} onChange={setStatus} options={[
                  { value: ALL, label: "All statuses" },
                  { value: "pending", label: orderStatusView.pending.label },
                  { value: "fulfilled", label: orderStatusView.fulfilled.label },
                  { value: "acknowledged", label: orderStatusView.acknowledged.label },
                  { value: "cancelled", label: orderStatusView.cancelled.label },
                  { value: "voided", label: orderStatusView.voided.label },
                ]} />
              </div>
            </div>
          }
        >
          {sorted.length ? (
            <ul className="divide-y divide-border">{sorted.map((o) => <OrderRow key={o.id} o={o} db={db} scope={scope} />)}</ul>
          ) : (
            <EmptyState icon={ClipboardList} title={orders.length ? "No orders match" : "No orders"}
              detail={orders.length
                ? `Nothing raised ${rangeLabel}${filtering || status !== ALL ? " with these filters" : ""}. Try a wider period or clear the filters.`
                : scope.canRaiseOrders ? "Open a customer and raise an order from their order book." : "Orders raised by sales reps appear here."} />
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
  const [cancelling, setCancelling] = useState<false | "cancel" | "void">(false);
  const [reason, setReason] = useState("");
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
  const busy = fulfil.isPending || acknowledge.isPending || cancel.isPending || voidOrder.isPending || changePrices.isPending;

  function openPricing() {
    setPrices(Object.fromEntries(priceable.map((l) => [l.saleId, String(Math.round(priceEach(l) * 100) / 100)])));
    setReason("");
    setError("");
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
      if (!Number.isFinite(p) || p <= 0) return setError(`Enter a price above zero for ${product(l.productId)}`);
      if (p > list + 0.004) return setError(`${product(l.productId)} can't go above its list price of ${formatNaira(list)}`);
    }
    if (!changed.length) return setError("Change at least one price");
    if (!reason.trim()) return setError("Say why the price is changing");
    setError("");
    try {
      await changePrices.mutateAsync({
        p_order_id: o.id,
        p_lines: changed.map((l) => ({ sale_id: l.saleId, unit_price: Math.round(newPrice(l) * 100) / 100 })),
        p_reason: reason.trim(),
      });
      toast.success(`Prices updated on ${o.code}`, { description: `New total ${formatNaira(pricingTotal)}. ${person(o.repId)} sees the new prices.` });
      setPricing(false);
    } catch (failure) {
      const errors = fieldErrorsFrom(failure, ["reason", "lines"] as const);
      setError(errors.lines ?? errors.reason ?? errors.form ?? "Could not change the prices");
    }
  }

  async function run(label: string, fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
      toast.success(label);
      setCancelling(false);
    } catch (failure) {
      const errors = fieldErrorsFrom(failure, ["reason"] as const);
      setError(errors.reason ?? errors.form ?? "Could not update the order");
    }
  }

  return (
    <li className="px-5 py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-bold">{o.code}</span>
            <OrderStatusBadge status={o.status} />
          </div>
          <p className="text-sm font-semibold">
            <Link to="/customers/$customerId" params={{ customerId: o.customerId }} className="hover:text-primary">{o.customerName}</Link>
          </p>
          <ul className="space-y-0.5 text-xs">
            {lines.map((l) => {
              const left = getAvailableStock(db, l.productId, o.branchId);
              return (
                <li key={l.saleId}>
                  <strong>{formatNumber(l.quantity)} × {product(l.productId)}</strong>
                  {l.isPromo ? <span className="text-muted-foreground"> (promo · free)</span> : (
                    <span className="text-muted-foreground"> · {formatNaira(priceEach(l))} each
                      {/* Only the Owner and managers receive the list price. */}
                      {l.listPrice !== null && Math.abs(l.listPrice - priceEach(l)) >= 0.005 && (
                        <> <span className="line-through">{formatNaira(l.listPrice)}</span></>
                      )}
                    </span>
                  )}
                  {isStorekeeper && o.status === "pending" && (
                    <span className="text-muted-foreground"> · held for this order ({formatNumber(left)} more available)</span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-caption text-muted-foreground">
            Raised by {person(o.repId)} · {formatDayTime(o.createdAt, today)} · {formatNaira(orderTotal(o))}
          </p>
          {o.note && <p className="text-caption text-muted-foreground">“{o.note}”</p>}
          {o.fulfilledAt && <p className="text-caption text-muted-foreground">Fulfilled by {person(o.fulfilledBy)} · {formatDayTime(o.fulfilledAt, today)}</p>}
          {o.acknowledgedAt && <p className="text-caption text-muted-foreground">Acknowledged by {person(o.acknowledgedBy)} · {formatDayTime(o.acknowledgedAt, today)}</p>}
          {o.cancelledAt && <p className="text-caption text-destructive">{o.status === "voided" ? "Voided" : "Cancelled"} by {person(o.cancelledBy)} · {formatDayTime(o.cancelledAt, today)}{o.cancelReason ? ` · ${o.cancelReason}` : ""}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canChangePrices && !cancelling && !pricing && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={openPricing}><Tag className="size-3.5" />Change prices</Button>
          )}
          {canCancel && !cancelling && !pricing && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setCancelling("cancel")}><X className="size-3.5" />Cancel order</Button>
          )}
          {canVoid && !cancelling && !pricing && (
            <Button size="sm" variant="secondary" className="text-destructive" disabled={busy} onClick={() => setCancelling("void")}><Ban className="size-3.5" />Void order</Button>
          )}
          {isStorekeeper && o.status === "pending" && !cancelling && (
            <Button size="sm" disabled={busy} onClick={() => void run(`${o.code} fulfilled`, () => fulfil.mutateAsync({ p_order_id: o.id }))}>
              {fulfil.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <PackageCheck className="size-3.5" />}Fulfil order
            </Button>
          )}
          {isRaiser && scope.canRaiseOrders && o.status === "fulfilled" && (
            <Button size="sm" disabled={busy} onClick={() => void run(`${o.code} acknowledged`, () => acknowledge.mutateAsync({ p_order_id: o.id }))}>
              {acknowledge.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />}Acknowledge receipt
            </Button>
          )}
        </div>
      </div>
      {pricing && (
        <div className="mt-3 space-y-3 rounded-md border border-border p-3">
          <p className="text-caption text-muted-foreground">
            Set the new price per unit. {person(o.repId)} and the invoice show it as the price; only the Owner and managers see what it was.
            It can't go above the list price.
          </p>
          <ul className="space-y-2">
            {priceable.map((l) => {
              const list = l.listPrice ?? l.unitPrice;
              const p = newPrice(l);
              return (
                <li key={l.saleId} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 text-xs">
                    <p className="font-semibold">{formatNumber(l.quantity)} × {product(l.productId)}</p>
                    <p className="text-caption text-muted-foreground">List price {formatNaira(list)} · now {formatNaira(priceEach(l))}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input aria-label={`New price for ${product(l.productId)}`} type="number" inputMode="decimal" min={0} step="0.01"
                      value={prices[l.saleId] ?? ""} onChange={(e) => setPrices((all) => ({ ...all, [l.saleId]: e.target.value }))}
                      className="h-9 w-32 text-right" />
                    <span className="w-28 text-right text-xs font-semibold tabular-nums">
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
          <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-xs">
            <span className="text-muted-foreground">Order total</span>
            <span className="tabular-nums"><span className="text-muted-foreground">{formatNaira(orderTotal(o))} → </span><strong>{formatNaira(pricingTotal)}</strong></span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input aria-label="Reason for the price change" placeholder="Why is the price changing?" value={reason}
              onChange={(e) => setReason(e.target.value)} className="h-9 flex-1" />
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setPricing(false); setError(""); }}>Keep prices</Button>
              <Button size="sm" disabled={busy} onClick={() => void savePrices()}>
                {changePrices.isPending && <Loader2 className="size-3.5 animate-spin" />}Save prices
              </Button>
            </div>
          </div>
        </div>
      )}
      {cancelling && (
        <div className="mt-3 space-y-2">
          {cancelling === "void" && (
            <p className="rounded-md bg-destructive/5 px-3 py-2 text-caption text-destructive">
              Voiding takes {formatNaira(orderTotal(o))} off {o.customerName}'s account and {person(o.repId)}'s sales, and puts the items back in stock.
              Only do this if the goods are back on the shelf or never left. It can't be undone.
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input autoFocus aria-label={cancelling === "void" ? "Reason for voiding" : "Reason for cancelling"}
              placeholder={cancelling === "void" ? "Why is the order voided?" : "Why is the order cancelled?"}
              value={reason} onChange={(e) => setReason(e.target.value)} className="h-9 flex-1" />
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setCancelling(false); setError(""); }}>Keep order</Button>
              {cancelling === "void" ? (
                <Button size="sm" variant="secondary" className="text-destructive" disabled={busy}
                  onClick={() => void run(`${o.code} voided`, () => voidOrder.mutateAsync({ p_order_id: o.id, p_reason: reason.trim() }))}>
                  {voidOrder.isPending && <Loader2 className="size-3.5 animate-spin" />}Void order
                </Button>
              ) : (
                <Button size="sm" variant="secondary" className="text-destructive" disabled={busy}
                  onClick={() => void run(`${o.code} cancelled`, () => cancel.mutateAsync({ p_order_id: o.id, p_reason: reason.trim() }))}>
                  {cancel.isPending && <Loader2 className="size-3.5 animate-spin" />}Cancel order
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
      <FieldError message={error} />
    </li>
  );
}
