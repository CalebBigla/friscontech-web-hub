import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Clock, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { DataGate, EmptyState, FieldError, FilterSelect, Panel, StatTile } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { CustomerPayment, Db, Payment, PaymentStatus } from "@/data/mock-db";
import { saleTotal } from "@/lib/calculations";
import { orderIdOf } from "@/lib/customer-calculations";
import { formatDate, formatNaira, formatTime } from "@/lib/format";
import { MethodFilter, PeriodFilter, usePeriodFilter } from "@/components/period-filter";
import {
  getPaymentActions,
  getPaymentEntriesForScope,
  getPaymentOverviewSummary,
  getRepPaymentSummary,
  isRepCollection,
  isValidPaymentPeriod,
  paymentMethodLabel,
  paymentStatusLabel,
  validatePaymentReconciliation,
  type PaymentEntry,
  type PaymentKind,
} from "@/lib/payment-calculations";
import { getAccessScope, useCurrentUserId, type AccessScope } from "@/lib/session";
import { useLiveWorkspace } from "@/hooks/use-live-workspace";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { useAcknowledgePayment, useConfirmPayment, useDeclinePayment, useSubmitPayment, useVoidPayment } from "@/hooks/use-payments";
import { useAcknowledgeCustomerPayment, useConfirmCustomerPayment, useDeclineCustomerPayment, useVoidCustomerPayment } from "@/hooks/use-customer-payments";
import {
  runWrite,
  validateAcknowledgePayment,
  validateConfirmPayment,
  validateDeclinePayment,
  validatePaymentSubmission,
  validateVoidPayment,
  type FieldErrors,
} from "@/lib/validation";

const tone: Record<PaymentStatus, string> = {
  submitted: "border-warning/40 bg-warning/10 text-warning",
  acknowledged: "border-primary/30 bg-primary/5 text-primary",
  declined: "border-destructive/30 bg-destructive/5 text-destructive",
  confirmed: "border-success/30 bg-success/5 text-success",
};
export function PaymentStatusBadge({ status, voided = false }: { status: PaymentStatus; voided?: boolean }) {
  return (
    <Badge variant="secondary" className={`whitespace-nowrap font-medium ${tone[status]}`}>
      {voided ? "Voided" : paymentStatusLabel[status]}
    </Badge>
  );
}
const kindLabel: Record<PaymentKind, string> = {
  rep: "Sales payment",
  customer: "Customer payment",
};

const monthLabel = (period: string) =>
  isValidPaymentPeriod(period)
    ? new Intl.DateTimeFormat("en-NG", { month: "long", year: "numeric", timeZone: "UTC" }).format(
        new Date(`${period}-01T00:00:00Z`),
      )
    : period;

export function PaymentPage() {
  const { db, isLoading, error } = useLiveWorkspace();
  const userId = useCurrentUserId();
  const scope = getAccessScope(db, userId);
  const role = scope.user.role;
  const today = db.tenant.referenceDate;
  // Day, week, month (default) or chosen dates.
  const { state: periodState, setState: setPeriodState, range, label: rangeLabel } = usePeriodFilter(today);
  const [method, setMethod] = useState("all");
  const [branchId, setBranchId] = useState("all");
  const [repId, setRepId] = useState("all");
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quickAction, setQuickAction] = useState<QuickAction>(null);
  const quick = (id: string, a: QuickAction) => {
    setSelectedId(id);
    setQuickAction(a);
  };
  const [submitOpen, setSubmitOpen] = useState(false);

  const filters = {
    range,
    ...(branchId !== "all" ? { branchId } : {}),
    ...(repId !== "all" ? { salesRepId: repId } : {}),
  };
  // Payments are pay-ins only: a rep handing money to their manager. Customer
  // payments belong to each customer's ledger (Customers).
  const periodEntries = useMemo(
    () => getPaymentEntriesForScope(db, scope, { ...filters, kind: "rep" }),
    [db, scope, range.from, range.to, branchId, repId], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const rows = periodEntries.filter(
    (e) =>
      (status === "all" || e.status === status) &&
      (method === "all" || (method === "cash" ? e.cash > 0 : e.transfer > 0)),
  );
  // What the rows shown add up to, split by cash and transfer (declined left out).
  const counted = rows.filter((e) => e.status !== "declined");
  const shownTotals = [
    method !== "transfer" && `Cash ${formatNaira(counted.reduce((sum, e) => sum + e.cash, 0))}`,
    method !== "cash" && `Transfer ${formatNaira(counted.reduce((sum, e) => sum + e.transfer, 0))}`,
  ].filter(Boolean).join(" · ");
  const tableSubtitle = `${rangeLabel} · ${rows.length} payment${rows.length === 1 ? "" : "s"} · ${shownTotals}${
    counted.length < rows.length ? " (declined not counted)" : ""
  }`;
  const summary = getPaymentOverviewSummary(db, scope, periodEntries, range, filters);
  const selected = selectedId
    ? (getPaymentEntriesForScope(db, scope).find((e) => e.id === selectedId) ?? null)
    : null;

  const branches = db.branches.filter(
    (b) =>
      b.tenantId === scope.user.tenantId &&
      (scope.branchIds === null || scope.branchIds.includes(b.id)),
  );
  const reps = db.users.filter(
    (u) =>
      u.tenantId === scope.user.tenantId &&
      u.role === "sales_rep" &&
      !!u.branchId &&
      (scope.branchIds === null || scope.branchIds.includes(u.branchId)) &&
      (branchId === "all" || u.branchId === branchId),
  );
  const title = role === "manager" ? "Team Payments" : "Payments";
  const subtitle =
    role === "sales_rep"
      ? "Pay in the customer money you collected to your manager."
      : role === "manager"
        ? "Confirm cash payments from your branch. Acknowledge transfers; the owner confirms them."
        : "Confirm transfers (cash is confirmed by branch managers). Void a confirmed payment if it was wrong. Only confirmed money counts as received.";

  return (
    <AppShell title={title} subtitle={subtitle}>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-bold">{title}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {scope.canConfirmPayments && (
            <Button asChild variant="secondary" size="sm">
              <Link to="/manager-remittances">Manager remittances</Link>
            </Button>
          )}
          {role === "sales_rep" && (
            <Button
              size="sm"
              onClick={() => setSubmitOpen(true)}
            >
              Submit payment
            </Button>
          )}
        </div>
      </div>

      <DataGate isLoading={isLoading} error={error}>
      {/* Pay-ins only. "Not yet paid in" is the running balance: customer money
          collected − everything paid in, whatever the dates. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          tone="success"
          label="Paid in · confirmed"
          value={formatNaira(summary.confirmed)}
          detail={`${summary.confirmedCount} pay-in${summary.confirmedCount === 1 ? "" : "s"} · ${rangeLabel}`}
        />
        <StatTile
          tone="warning"
          label="Paid in · awaiting"
          value={formatNaira(summary.awaitingAcknowledgement + summary.awaitingConfirmation)}
          detail={`${summary.awaitingAcknowledgementCount} with manager · ${summary.awaitingConfirmationCount} with Owner${summary.declinedCount ? ` · ${summary.declinedCount} declined` : ""}`}
        />
        <StatTile
          tone="violet"
          label="Not yet paid in"
          value={formatNaira(summary.outstanding)}
          detail="Customer money collected − paid in, all dates"
        />
      </div>

      <Panel
        title="Payments"
        subtitle={tableSubtitle}
        className="mt-4"
        action={
          <div className="flex flex-wrap gap-2">
            <PeriodFilter today={today} value={periodState} onChange={setPeriodState} />
            {role !== "sales_rep" && branches.length > 1 && (
              <FilterSelect
                label="Branch"
                value={branchId}
                onChange={(v) => {
                  setBranchId(v);
                  setRepId("all");
                }}
                className="w-36"
                options={[
                  { value: "all", label: "All branches" },
                  ...branches.map((b) => ({ value: b.id, label: b.name })),
                ]}
              />
            )}
            {role !== "sales_rep" && (
              <FilterSelect
                label="Sales representative"
                value={repId}
                onChange={setRepId}
                className="w-40"
                options={[
                  { value: "all", label: "All reps" },
                  ...reps.map((r) => ({ value: r.id, label: r.name })),
                ]}
              />
            )}
            <MethodFilter value={method} onChange={setMethod} />
            <FilterSelect
              label="Status"
              value={status}
              onChange={setStatus}
              className="w-44"
              options={[
                { value: "all", label: "All statuses" },
                ...(Object.keys(paymentStatusLabel) as PaymentStatus[]).map((s) => ({
                  value: s,
                  label: paymentStatusLabel[s],
                })),
              ]}
            />
          </div>
        }
      >
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-xs">
              <thead className="border-b border-border bg-muted/40 text-caption uppercase text-muted-foreground">
                <tr>
                  {["Date", "Sales rep", "Amount", "Method", "Status", "Handled by", ...(role === "sales_rep" ? [] : ["Action"])].map(
                    (h) => (
                      <th key={h} className="px-4 py-3 font-semibold">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((e) => (
                  <tr
                    key={e.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setSelectedId(e.id)}
                    tabIndex={0}
                    onKeyDown={(k) => k.key === "Enter" && setSelectedId(e.id)}
                  >
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(e.date)}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{userName(db, e.repId)}</p>
                      <p className="text-caption text-muted-foreground">Pay-in · {e.id}</p>
                    </td>
                    <td className="px-4 py-3 font-bold tabular-nums">{formatNaira(e.amount)}</td>
                    <td className="px-4 py-3">{paymentMethodLabel[e.method]}</td>
                    <td className="px-4 py-3">
                      <PaymentStatusBadge status={e.status} voided={e.voided} />
                      {role === "sales_rep" && <MiniProgress entry={e} />}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{userName(db, e.handledBy)}</td>
                    {role !== "sales_rep" && (
                      <td className="px-4 py-3" onClick={(ev) => ev.stopPropagation()}>
                        {(() => {
                          const can = getPaymentActions(scope, e);
                          if (!can.acknowledge && !can.confirm && !can.decline && !can.void)
                            return <span className="text-muted-foreground">—</span>;
                          return (
                            <div className="flex gap-1.5">
                              {(can.acknowledge || can.confirm) && (
                                <Button size="sm" className="h-7 px-2 text-caption" onClick={() => quick(e.id, can.acknowledge ? "acknowledge" : "confirm")}>
                                  {can.acknowledge ? "Acknowledge" : "Confirm"}
                                </Button>
                              )}
                              {can.decline && (
                                <Button size="sm" variant="secondary" className="h-7 px-2 text-caption text-destructive" onClick={() => quick(e.id, "decline")}>
                                  Decline
                                </Button>
                              )}
                              {can.void && (
                                <Button size="sm" variant="secondary" className="h-7 px-2 text-caption text-destructive" onClick={() => quick(e.id, "void")}>
                                  Void
                                </Button>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No payments for this view."
            detail="Try another period or clear the filters."
          />
        )}
      </Panel>
      </DataGate>

      <PaymentDrawer
        db={db}
        scope={scope}
        entry={selected}
        initialAction={quickAction}
        onClose={() => {
          setSelectedId(null);
          setQuickAction(null);
        }}
      />
      {role === "sales_rep" && (
        <SubmitPaymentDialog
          db={db}
          userId={userId}
          open={submitOpen}
          onOpenChange={setSubmitOpen}
        />
      )}
    </AppShell>
  );
}

const userName = (db: Db, id?: string) =>
  id ? (db.users.find((u) => u.id === id)?.name ?? "—") : "—";
const partyName = (db: Db, e: PaymentEntry) =>
  e.kind === "customer"
    ? (db.customers.find((c) => c.id === e.customerId)?.name ?? "Customer")
    : userName(db, e.repId);

type QuickAction = "acknowledge" | "confirm" | "decline" | "void" | null;
function PaymentDrawer({
  db,
  scope,
  entry,
  initialAction,
  onClose,
}: {
  db: Db;
  scope: AccessScope;
  entry: PaymentEntry | null;
  initialAction?: QuickAction;
  onClose: () => void;
}) {
  const [action, setAction] = useState<QuickAction>(null);
  const [reference, setReference] = useState("");
  const [proofName, setProofName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const acknowledgeRep = useAcknowledgePayment();
  const confirmRep = useConfirmPayment();
  const declineRep = useDeclinePayment();
  const acknowledgeCustomer = useAcknowledgeCustomerPayment();
  const confirmCustomer = useConfirmCustomerPayment();
  const declineCustomer = useDeclineCustomerPayment();
  const voidRep = useVoidPayment();
  const voidCustomer = useVoidCustomerPayment();

  const can = entry ? getPaymentActions(scope, entry) : null;
  const canAck = !!can?.acknowledge;
  const canConfirm = !!can?.confirm;
  const canDecline = !!can?.decline;
  const canVoid = !!can?.void;

  const open = (kind: typeof action) => {
    setAction(kind);
    setReference(entry?.reference ?? "");
    setProofName("");
    setReason("");
    setErrors({});
  };
  useEffect(() => {
    if (entry && initialAction) open(initialAction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id, initialAction]);
  const run = async () => {
    if (!entry || !action) return;
    const payment = entry.kind === "customer"
      ? db.customerPayments.find((p) => p.id === entry.id)
      : db.payments.find((p) => p.id === entry.id);
    if (!payment) return setErrors({ form: "Payment not found" });
    const existingReference = "method" in payment ? payment.reference : payment.transferReference;
    const details = { transferReference: reference, proofName };
    const customer = entry.kind === "customer";
    const ack = { p_payment_id: entry.id, p_transfer_reference: reference.trim() || null, p_proof_name: proofName.trim() || null };
    setBusy(true);
    const result =
      action === "acknowledge"
        ? await runWrite<Payment | CustomerPayment>(validateAcknowledgePayment(db, scope, payment, existingReference, details), () =>
            customer ? acknowledgeCustomer.mutateAsync(ack) : acknowledgeRep.mutateAsync(ack))
        : action === "confirm"
          ? await runWrite<Payment | CustomerPayment>(validateConfirmPayment(db, scope, payment), () =>
              customer ? confirmCustomer.mutateAsync({ p_payment_id: entry.id }) : confirmRep.mutateAsync({ p_payment_id: entry.id }))
          : action === "void"
            ? await runWrite<Payment | CustomerPayment>(validateVoidPayment(db, scope, payment, reason), () =>
                customer
                  ? voidCustomer.mutateAsync({ p_payment_id: entry.id, p_reason: reason.trim() })
                  : voidRep.mutateAsync({ p_payment_id: entry.id, p_reason: reason.trim() }))
            : await runWrite<Payment | CustomerPayment>(validateDeclinePayment(db, scope, payment, reason), () =>
                customer
                  ? declineCustomer.mutateAsync({ p_payment_id: entry.id, p_reason: reason.trim() })
                  : declineRep.mutateAsync({ p_payment_id: entry.id, p_reason: reason.trim() }));
    setBusy(false);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    toast.success(
      action === "acknowledge"
        ? "Payment acknowledged · sent to owner"
        : action === "confirm"
          ? "Payment confirmed"
          : action === "void"
            ? "Payment voided · no longer counted as received"
            : "Payment declined",
    );
    setAction(null);
  };

  // The customer money the rep collected in the pay-in's month.
  const repCollections = entry?.kind === "rep"
    ? db.customerPayments
        .filter((p) => p.tenantId === db.tenant.id && p.receivedBy === entry.repId && isRepCollection(p) && p.paymentDate.startsWith(entry.period))
        .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate))
    : [];
  // The rep's running position (all dates).
  const repPosition = entry?.kind === "rep" ? getRepPaymentSummary(db, entry.repId) : null;
  const customerPayment =
    entry?.kind === "customer" ? db.customerPayments.find((p) => p.id === entry.id) : undefined;
  const linkedOrderLines = customerPayment
    ? db.sales
        .filter(
          (s) =>
            s.customerId === customerPayment.customerId &&
            (!customerPayment.orderId || orderIdOf(s) === customerPayment.orderId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 8)
    : [];
  const product = (id: string) => db.products.find((p) => p.id === id)?.name ?? "Product";
  const needsReference = !!entry && entry.transfer > 0;

  return (
    <Sheet open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {entry && (
          <>
            <SheetHeader className="text-left">
              <SheetTitle>{partyName(db, entry)}</SheetTitle>
              <SheetDescription>
                {kindLabel[entry.kind]} · {entry.id} · {monthLabel(entry.period)}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold tabular-nums">{formatNaira(entry.amount)}</span>
                <PaymentStatusBadge status={entry.status} voided={entry.voided} />
              </div>

              <Section title="Breakdown">
                <Row label="Cash">{formatNaira(entry.cash)}</Row>
                <Row label="Transfer">{formatNaira(entry.transfer)}</Row>
                {repPosition && (
                  <>
                    <Row label="Pay-in date">{formatDate(entry.date)}</Row>
                    <Row label="Rep's collections (all dates)">{formatNaira(repPosition.collectedTotal)}</Row>
                    <Row label="Rep's pay-ins (all dates)">{formatNaira(repPosition.paidInTotal)}</Row>
                    <Row label="Not yet paid in">
                      {formatNaira(repPosition.outstanding)}
                    </Row>
                  </>
                )}
                <Row label="Transfer reference">{entry.reference ?? "—"}</Row>
                <Row label="Proof">{entry.proofName ?? "None attached"}</Row>
                {entry.kind === "customer" && (
                  <Row label="Collected by">{userName(db, entry.repId)}</Row>
                )}
                <Row label="Branch">
                  {db.branches.find((b) => b.id === entry.branchId)?.name ?? "—"}
                </Row>
                {entry.note && <Row label="Note">{entry.note}</Row>}
              </Section>

              {entry.declineReason && (
                <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3">
                  <p className="font-semibold text-destructive">{entry.voided ? "Void reason" : "Decline reason"}</p>
                  <p className="mt-1">{entry.declineReason}</p>
                </div>
              )}

              <Section title="Approval trail">
                <Trail db={db} entry={entry} />
              </Section>

              <Section
                title={
                  entry.kind === "rep"
                    ? `Collected in ${monthLabel(entry.period)} (${repCollections.length})`
                    : "Linked order lines"
                }
              >
                {entry.kind === "rep" && repCollections.slice(0, 8).map((p) => (
                  <Row key={p.id} label={`${formatDate(p.paymentDate)} · ${db.customers.find((c) => c.id === p.customerId)?.name ?? "Customer"}`}>
                    {formatNaira(p.amount)}
                  </Row>
                ))}
                {(entry.kind === "rep" ? [] : linkedOrderLines).map(
                  (s) => (
                    <Row
                      key={s.id}
                      label={`${formatDate(s.saleDate)} · ${product(s.productId)} × ${s.quantity}`}
                    >
                      {formatNaira(saleTotal(s))}
                    </Row>
                  ),
                )}
                {(entry.kind === "rep" ? repCollections.length : linkedOrderLines.length) === 0 && (
                  <p className="text-muted-foreground">{entry.kind === "rep" ? "Nothing collected this month." : "No linked sales."}</p>
                )}
                {entry.kind === "customer" && entry.customerId && scope.canViewCustomers && (
                  <Link
                    to="/customers/$customerId"
                    params={{ customerId: entry.customerId }}
                    className="mt-2 inline-block font-semibold text-primary"
                  >
                    Open customer account
                  </Link>
                )}
              </Section>

              {(canAck || canConfirm || canDecline || canVoid) && (
                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  {canAck && (
                    <Button size="sm" onClick={() => open("acknowledge")}>
                      Acknowledge
                    </Button>
                  )}
                  {canConfirm && (
                    <Button size="sm" onClick={() => open("confirm")}>
                      Confirm
                    </Button>
                  )}
                  {canDecline && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="border-destructive/40 text-destructive hover:bg-destructive/5"
                      onClick={() => open("decline")}
                    >
                      Decline
                    </Button>
                  )}
                  {canVoid && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="border-destructive/40 text-destructive hover:bg-destructive/5"
                      onClick={() => open("void")}
                    >
                      Void payment
                    </Button>
                  )}
                </div>
              )}
              {!canAck && !canConfirm && entry.status === "acknowledged" && (
                <p className="flex items-center gap-1.5 rounded-md bg-muted p-3 text-muted-foreground">
                  <Clock className="size-3.5" />
                  Awaiting owner confirmation. Not yet counted as received.
                </p>
              )}
            </div>
          </>
        )}
        <Dialog open={!!action} onOpenChange={(o) => !o && !busy && setAction(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {action === "acknowledge"
                  ? "Acknowledge payment"
                  : action === "confirm"
                    ? "Confirm payment"
                    : action === "void"
                      ? "Void confirmed payment"
                      : "Decline payment"}
              </DialogTitle>
              <DialogDescription>
                {action === "acknowledge"
                  ? "Confirm you received this transfer. The owner gives final confirmation."
                  : action === "confirm"
                    ? "Confirmed money counts as received in totals and reports."
                    : action === "void"
                      ? "The payment stops counting as received in totals, balances and reports. The record stays in history with your reason."
                      : "Give a reason so the sales representative can correct it."}
              </DialogDescription>
            </DialogHeader>
            {action === "acknowledge" && (
              <div className="space-y-3">
                {needsReference && (
                  <div>
                    <Label className="text-xs">Transfer reference *</Label>
                    <Input
                      className="mt-1.5"
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      aria-label="Transfer reference"
                    />
                    <FieldError message={errors.transferReference} />
                  </div>
                )}
                <div>
                  <Label className="text-xs">Proof of payment (optional)</Label>
                  <Input
                    className="mt-1.5"
                    type="file"
                    accept="image/*,application/pdf"
                    aria-label="Proof of payment"
                    onChange={(e) => setProofName(e.target.files?.[0]?.name ?? "")}
                  />
                </div>
              </div>
            )}
            {(action === "decline" || action === "void") && (
              <div>
                <Label className="text-xs">Reason *</Label>
                <Textarea
                  className="mt-1.5"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  aria-label={action === "void" ? "Void reason" : "Decline reason"}
                />
                <FieldError message={errors.reason} />
              </div>
            )}
            <FieldError message={errors.form} />
            <DialogFooter>
              <Button variant="secondary" disabled={busy} onClick={() => setAction(null)}>
                Cancel
              </Button>
              <Button
                disabled={
                  busy ||
                  ((action === "decline" || action === "void") && !reason.trim()) ||
                  (action === "acknowledge" && needsReference && !reference.trim())
                }
                onClick={run}
              >
                {busy
                  ? "Saving…"
                  : action === "acknowledge"
                    ? "Acknowledge"
                    : action === "confirm"
                      ? "Confirm"
                      : action === "void"
                        ? "Void payment"
                        : "Decline"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-caption font-bold uppercase text-muted-foreground">{title}</h3>
      <div className="divide-y divide-border rounded-md border border-border px-3">{children}</div>
    </section>
  );
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-semibold">{children}</span>
    </div>
  );
}
const stepLabel = {
  submitted: "Submitted",
  acknowledged: "Acknowledged by manager",
  confirmed: "Confirmed",
  declined: "Declined",
};
function MiniProgress({ entry }: { entry: PaymentEntry }) {
  const done = (step: PaymentTrailStepName) => entry.trail.some((s) => s.step === step);
  const declined = entry.status === "declined";
  const ownerDirect = !done("acknowledged") && (done("confirmed") || (declined && entry.trail.some((s) => s.step === "declined" && s.by !== entry.managerId)));
  const steps: { key: PaymentTrailStepName; label: string }[] = entry.cashOnly && !done("acknowledged")
    ? [
        { key: "submitted", label: "Submitted" },
        { key: "confirmed", label: "Manager" },
      ]
    : [
        { key: "submitted", label: "Submitted" },
        ...(ownerDirect ? [] : [{ key: "acknowledged" as const, label: "Manager" }]),
        { key: "confirmed", label: "Owner" },
      ];
  return (
    <div className="mt-1.5 flex items-center gap-1" aria-label="Payment progress">
      {steps.map((s, i) => {
        const isDone = done(s.key);
        const isDeclinedHere = declined && !isDone && (i === 0 || done(steps[i - 1]!.key));
        return (
          <div key={s.key} className="flex items-center gap-1">
            {i > 0 && <span className={`h-px w-3 ${isDone ? "bg-success" : "bg-border"}`} />}
            <span
              className={`rounded-full px-1.5 py-0.5 text-caption font-semibold ${isDone ? "bg-success/10 text-success" : isDeclinedHere ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}
            >
              {isDeclinedHere ? "Declined" : entry.voided && s.key === "confirmed" ? "Voided" : s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
type PaymentTrailStepName = PaymentEntry["trail"][number]["step"];
function Trail({ db, entry }: { db: Db; entry: PaymentEntry }) {
  const steps = [...entry.trail];
  // Still to come: cash goes straight to the manager's confirmation; a transfer is acknowledged first.
  if (entry.status === "submitted" && !entry.cashOnly) steps.push({ step: "acknowledged" });
  if (entry.status === "submitted" || entry.status === "acknowledged")
    steps.push({ step: "confirmed" });
  return (
    <div className="py-1">
      {steps.map((s, i) => (
        <div key={i} className="flex gap-3 py-2">
          <span
            className={`grid size-6 shrink-0 place-items-center rounded-full border ${!s.at ? "border-dashed border-border text-muted-foreground" : s.step === "declined" ? "border-destructive/40 text-destructive" : "border-success/40 text-success"}`}
          >
            {!s.at ? (
              <Clock className="size-3" />
            ) : s.step === "declined" ? (
              <X className="size-3" />
            ) : (
              <Check className="size-3" />
            )}
          </span>
          <div>
            <p className="font-semibold">
              {s.step === "declined" && entry.voided
                ? "Voided"
                : s.step === "confirmed" && !s.at
                  ? entry.cashOnly ? "Confirmed by manager" : "Confirmed by owner"
                  : stepLabel[s.step]}
            </p>
            <p className="text-caption text-muted-foreground">
              {s.at
                ? `${userName(db, s.by)} · ${formatDate(s.at)} at ${formatTime(s.at)}`
                : "Pending"}
            </p>
            {s.note && <p className="mt-1 text-caption">{s.note}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function SubmitPaymentDialog({
  db,
  userId,
  open,
  onOpenChange,
}: {
  db: Db;
  userId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [paymentDate, setPaymentDate] = useState(db.tenant.referenceDate);
  const [cash, setCash] = useState("");
  const [transfer, setTransfer] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const submitPayment = useSubmitPayment();
  const idempotencyKey = useIdempotencyKey(open);
  const position = getRepPaymentSummary(db, userId);
  const cashN = cash === "" ? 0 : Number(cash);
  const transferN = transfer === "" ? 0 : Number(transfer);
  const remaining = position.outstanding;
  const check = validatePaymentReconciliation(remaining, {
    cashAmount: cashN,
    transferAmount: transferN,
  });
  const submit = async () => {
    setBusy(true);
    const input = { paymentDate, cashAmount: cashN, transferAmount: transferN, transferReference: reference, note };
    const result = await runWrite(validatePaymentSubmission(db, getAccessScope(db, userId), input), () =>
      submitPayment.mutateAsync({
        p_payment_date: paymentDate,
        p_cash_amount: cashN,
        p_transfer_amount: transferN,
        p_transfer_reference: reference.trim() || null,
        p_note: note.trim() || null,
        p_idempotency_key: idempotencyKey,
      }),
    );
    setBusy(false);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    toast.success("Payment submitted to your manager");
    setPaymentDate(db.tenant.referenceDate);
    setCash("");
    setTransfer("");
    setReference("");
    setNote("");
    setErrors({});
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Submit payment</DialogTitle>
          <DialogDescription>
            Pay in customer money you collected. Your manager confirms cash; a transfer is acknowledged by your manager and confirmed by the Owner.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="payin-date" className="text-xs">Payment date *</Label>
            <Input
              id="payin-date"
              className="mt-1.5"
              type="date"
              max={db.tenant.referenceDate}
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
            <FieldError message={errors.paymentDate} />
          </div>
          <div>
            <Label htmlFor="payin-balance" className="text-xs">Not yet paid in</Label>
            <Input id="payin-balance" className="mt-1.5" readOnly value={formatNaira(remaining)} />
          </div>
          <div>
            <Label className="text-xs">Cash (₦)</Label>
            <Input
              className="mt-1.5"
              type="number"
              min="0"
              value={cash}
              onChange={(e) => setCash(e.target.value)}
              aria-label="Cash amount"
            />
            <FieldError message={errors.cashAmount} />
          </div>
          <div>
            <Label className="text-xs">Transfer (₦)</Label>
            <Input
              className="mt-1.5"
              type="number"
              min="0"
              value={transfer}
              onChange={(e) => setTransfer(e.target.value)}
              aria-label="Transfer amount"
            />
            <FieldError message={errors.transferAmount} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Transfer reference{transferN > 0 ? " *" : ""}</Label>
            <Input
              className="mt-1.5"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              aria-label="Transfer reference"
            />
            <FieldError message={errors.transferReference} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Note</Label>
            <Textarea
              className="mt-1.5"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="Payment note"
            />
          </div>
        </div>
        <p
          className={`rounded-md bg-muted px-3 py-2 text-xs font-semibold ${check.balanced ? "text-success" : "text-destructive"}`}
        >
          {check.balanced
            ? `Still with you after this: ${formatNaira(check.outstanding)}`
            : "Cash and transfer can't be more than you still hold"}
        </p>
        <FieldError message={errors.form} />
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !check.balanced || cashN + transferN <= 0} onClick={submit}>
            {busy ? "Submitting…" : "Submit payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
