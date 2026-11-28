import type {
  CustomerPayment,
  Db,
  ManagerRemittance,
  Payment,
  PaymentStatus,
} from "@/data/mock-db";
import type { AccessScope } from "@/lib/session";
import { getSalesRevenue, saleTotal } from "@/lib/calculations";
import { daysInMonth } from "@/lib/dates";

export type PaymentBreakdown = Pick<Payment, "cashAmount" | "transferAmount">;
const qualifyingManagerPayments = (rows: ManagerRemittance[]) =>
  rows.filter((row) => row.status !== "declined");
export const getTotalManagerCashPayments = (rows: ManagerRemittance[]) =>
  qualifyingManagerPayments(rows).reduce((sum, row) => sum + row.cashAmount, 0);
export const getTotalManagerTransferPayments = (rows: ManagerRemittance[]) =>
  qualifyingManagerPayments(rows).reduce((sum, row) => sum + row.transferAmount, 0);
export const getTotalManagerPayment = (rows: ManagerRemittance[]) =>
  getTotalManagerCashPayments(rows) + getTotalManagerTransferPayments(rows);
export function getOwnerManagerPaymentSummary(rows: ManagerRemittance[]) {
  const qualifying = qualifyingManagerPayments(rows);
  const latestByManager = new Map<string, ManagerRemittance>();
  for (const row of qualifying) {
    const previous = latestByManager.get(row.managerId);
    if (
      !previous ||
      (row.submittedAt ?? row.createdAt) > (previous.submittedAt ?? previous.createdAt)
    )
      latestByManager.set(row.managerId, row);
  }
  return {
    cash: getTotalManagerCashPayments(rows),
    transfer: getTotalManagerTransferPayments(rows),
    total: getTotalManagerPayment(rows),
    outstanding: [...latestByManager.values()].reduce((sum, row) => sum + row.outstandingAmount, 0),
    submitted: qualifying.filter((row) => row.status === "submitted").length,
    confirmed: qualifying.filter((row) => row.status === "confirmed").length,
    declined: rows.filter((row) => row.status === "declined").length,
  };
}
export type PaymentFilters = {
  period?: string;
  branchId?: string;
  salesRepId?: string;
  status?: PaymentStatus | "all";
};

export function isValidPaymentPeriod(period: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return false;
  const [year, month] = period.split("-").map(Number) as [number, number];
  return year >= 2000 && year <= 9999 && month >= 1 && month <= 12;
}

export function getRepSalesForPeriod(db: Db, repId: string, period: string) {
  if (!isValidPaymentPeriod(period)) return [];
  const from = `${period}-01`;
  const to = `${period}-${String(daysInMonth(period)).padStart(2, "0")}`;
  return db.sales.filter(
    (sale) =>
      sale.tenantId === db.tenant.id &&
      sale.salesRepId === repId &&
      !sale.customerId &&
      !sale.isPromo &&
      sale.status === "completed" &&
      sale.saleDate >= from &&
      sale.saleDate <= to,
  );
}

export const getRepTotalSales = (db: Db, repId: string, period: string) =>
  getRepSalesForPeriod(db, repId, period).reduce((sum, sale) => sum + saleTotal(sale), 0);

/**
 * Customer money a rep collected under the current flow: credited to the customer at
 * once, so confirmed by the rep themselves. Payments the Owner confirmed under the
 * earlier flow had already been handed over through that chain and don't count.
 */
export const isRepCollection = (p: CustomerPayment) => p.status === "confirmed" && p.confirmedBy === p.receivedBy;

/** Customer money a rep collected in a month (YYYY-MM). */
export const getRepCustomerCollections = (db: Db, repId: string, period: string) =>
  db.customerPayments
    .filter((p) => p.tenantId === db.tenant.id && p.receivedBy === repId && isRepCollection(p) && p.paymentDate.startsWith(period))
    .reduce((sum, p) => sum + p.amount, 0);

/** All customer money a rep has collected (app_private.rep_collected). */
export const getRepCollectedTotal = (db: Db, repId: string) =>
  db.customerPayments
    .filter((p) => p.tenantId === db.tenant.id && p.receivedBy === repId && isRepCollection(p))
    .reduce((sum, p) => sum + p.amount, 0);

/** Everything a rep has paid in to their manager, not declined (app_private.rep_paid_in). */
export const getRepPaidInTotal = (db: Db, repId: string) =>
  db.payments
    .filter((p) => p.tenantId === db.tenant.id && p.salesRepId === repId && p.status !== "declined")
    .reduce((sum, p) => sum + p.cashAmount + p.transferAmount, 0);

/**
 * What a rep still has to pay in, whatever the dates (app_private.rep_balance):
 * customer money collected − pay-ins not declined. Reps don't make walk-in sales.
 */
export const getRepBalance = (db: Db, repId: string) => getRepCollectedTotal(db, repId) - getRepPaidInTotal(db, repId);

/** Customer money a rep collected in a month (app_private.rep_amount_due); no walk-ins. */
export const getRepAmountDue = (db: Db, repId: string, period: string) => getRepCustomerCollections(db, repId, period);

export const getPaymentOutstanding = (
  totalSales: number,
  cashAmount: number,
  transferAmount: number,
) => totalSales - cashAmount - transferAmount;
export const getPaymentTotal = (payment: PaymentBreakdown) =>
  payment.cashAmount + payment.transferAmount;
export const getPaymentTotalAccounted = (totalSales: number, payment: PaymentBreakdown) =>
  getPaymentTotal(payment) +
  getPaymentOutstanding(totalSales, payment.cashAmount, payment.transferAmount);
/**
 * A rep's pay-in position. cash / transfer / confirmed: pay-ins dated in `period`
 * (all pay-ins when no period). outstanding: the running balance still to pay in.
 */
export function getRepPaymentSummary(db: Db, repId: string, period?: string) {
  const rows = db.payments.filter(
    (payment) =>
      payment.tenantId === db.tenant.id &&
      payment.salesRepId === repId &&
      (!period || payment.period === period) &&
      payment.status !== "declined",
  );
  const cash = rows.reduce((sum, payment) => sum + payment.cashAmount, 0);
  const transfer = rows.reduce((sum, payment) => sum + payment.transferAmount, 0);
  const confirmed = rows.filter((payment) => payment.status === "confirmed").reduce((sum, payment) => sum + getPaymentTotal(payment), 0);
  const collectedTotal = getRepCollectedTotal(db, repId);
  const paidInTotal = getRepPaidInTotal(db, repId);
  return {
    /** paid in (submitted, acknowledged or confirmed) in the period */
    cash,
    transfer,
    /** of which confirmed */
    confirmed,
    awaitingConfirmation: cash + transfer - confirmed,
    /** customer money collected in the period (all time without a period) */
    customerCollections: period ? getRepCustomerCollections(db, repId, period) : collectedTotal,
    collectedTotal,
    paidInTotal,
    /** still to pay in: collected − paid in, all time */
    outstanding: Math.max(collectedTotal - paidInTotal, 0),
  };
}
export const getPaymentTotalSales = (db: Db, payment: Payment) =>
  getRepAmountDue(db, payment.salesRepId, payment.period);
export function getPaymentCollectedToDate(db: Db, payment: Payment) {
  return db.payments
    .filter(
      (item) =>
        item.tenantId === payment.tenantId &&
        item.salesRepId === payment.salesRepId &&
        item.period === payment.period &&
        item.status !== "declined" &&
        (item.submittedAt < payment.submittedAt ||
          (item.submittedAt === payment.submittedAt && item.id.localeCompare(payment.id) <= 0)),
    )
    .reduce((sum, item) => sum + item.cashAmount + item.transferAmount, 0);
}
export const getPaymentOutstandingAmount = (db: Db, payment: Payment) =>
  Math.max(getRepBalance(db, payment.salesRepId), 0);
export const getPaymentAccountedAmount = (db: Db, payment: Payment) =>
  getPaymentCollectedToDate(db, payment) + getPaymentOutstandingAmount(db, payment);

export function validatePaymentReconciliation(totalSales: number, payment: PaymentBreakdown) {
  const outstanding = getPaymentOutstanding(totalSales, payment.cashAmount, payment.transferAmount);
  return {
    balanced:
      Number.isFinite(totalSales) &&
      totalSales >= 0 &&
      Number.isFinite(payment.cashAmount) &&
      Number.isFinite(payment.transferAmount) &&
      payment.cashAmount >= 0 &&
      payment.transferAmount >= 0 &&
      outstanding >= 0,
    outstanding,
  };
}

export function getPaymentsForScope(db: Db, scope: AccessScope, filters: PaymentFilters = {}) {
  return db.payments
    .filter((payment) => {
      if (payment.tenantId !== scope.user.tenantId || payment.tenantId !== db.tenant.id)
        return false;
      if (scope.user.role === "sales_rep" && payment.salesRepId !== scope.user.id) return false;
      // A manager sees every pay-in of their branch, also those made before they took over.
      if (scope.user.role === "manager" && !scope.branchIds?.includes(payment.branchId)) return false;
      if (scope.user.role === "storekeeper") return false;
      return (
        (!filters.period || payment.period === filters.period) &&
        (!filters.branchId || payment.branchId === filters.branchId) &&
        (!filters.salesRepId || payment.salesRepId === filters.salesRepId) &&
        (!filters.status || filters.status === "all" || payment.status === filters.status)
      );
    })
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

/**
 * Manager dashboard figures for a month. `rows` are the branch's pay-ins for the month.
 *   paid in      confirmed pay-ins dated in the month (cash / transfer), plus those awaiting
 *   collected    customer money the branch's reps collected in the month
 *   outstanding  what the branch's reps still have to pay in, all time (running balance)
 */
export function getManagerPaymentSummary(
  db: Db,
  rows: Payment[],
  managerId: string,
  period: string,
) {
  const manager = db.users.find(
    (user) => user.id === managerId && user.role === "manager" && user.tenantId === db.tenant.id,
  );
  const confirmedRows = rows.filter((payment) => payment.status === "confirmed");
  const cashPayment = confirmedRows.reduce((sum, payment) => sum + payment.cashAmount, 0);
  const transferPayment = confirmedRows.reduce((sum, payment) => sum + payment.transferAmount, 0);
  const awaiting = rows
    .filter((payment) => payment.status === "submitted" || payment.status === "acknowledged")
    .reduce((sum, payment) => sum + getPaymentTotal(payment), 0);
  const reps = manager?.branchId
    ? db.users.filter(
        (user) =>
          user.tenantId === db.tenant.id &&
          user.role === "sales_rep" &&
          user.branchId === manager.branchId,
      )
    : [];
  // Revenue: the branch's completed sales this month.
  const totalSales = manager?.branchId
    ? getSalesRevenue(db, { branchId: manager.branchId, range: { from: `${period}-01`, to: `${period}-31` } })
    : 0;
  const collectedThisMonth = reps.reduce((sum, rep) => sum + getRepCustomerCollections(db, rep.id, period), 0);
  const collected = reps.reduce((sum, rep) => sum + getRepCollectedTotal(db, rep.id), 0);
  const paidIn = reps.reduce((sum, rep) => sum + getRepPaidInTotal(db, rep.id), 0);
  return {
    cashPayment,
    transferPayment,
    awaiting,
    totalSales,
    collectedThisMonth,
    /** all time, the branch's reps: collected − paid in (not declined) */
    collected,
    paidIn,
    outstanding: Math.max(collected - paidIn, 0),
    /** share of everything collected that has been paid in */
    collectionRate: collected ? (Math.min(paidIn, collected) / collected) * 100 : 0,
  };
}

export function getOwnerPaymentSummary(db: Db, rows: Payment[]) {
  const currentRows = rows.filter((payment) => payment.status !== "declined");
  const latestByRep = new Map<string, Payment>();
  for (const payment of currentRows) {
    const previous = latestByRep.get(payment.salesRepId);
    if (!previous || payment.submittedAt > previous.submittedAt)
      latestByRep.set(payment.salesRepId, payment);
  }
  const confirmedRows = currentRows.filter((payment) => payment.status === "confirmed");
  return {
    cash: confirmedRows.reduce((sum, payment) => sum + payment.cashAmount, 0),
    transfer: confirmedRows.reduce((sum, payment) => sum + payment.transferAmount, 0),
    outstanding: [...latestByRep.keys()].reduce((sum, repId) => sum + Math.max(getRepBalance(db, repId), 0), 0),
    submitted: rows.filter((payment) => payment.status === "submitted").length,
    acknowledged: rows.filter((payment) => payment.status === "acknowledged").length,
    pendingConfirmation: rows.filter((payment) => payment.status === "acknowledged").length,
    reconciled: rows.filter((payment) => payment.status === "confirmed").length,
    declined: rows.filter((payment) => payment.status === "declined").length,
  };
}

// ---------- unified payment chain (rep payments + customer payments) ----------
export type PaymentKind = "rep" | "customer";
export type PaymentTrailStep = {
  step: "submitted" | "acknowledged" | "confirmed" | "declined";
  by?: string | undefined;
  at?: string | undefined;
  note?: string | undefined;
};
export type PaymentEntry = {
  kind: PaymentKind;
  id: string;
  date: string;
  period: string;
  branchId: string;
  repId: string;
  managerId: string;
  customerId?: string | undefined;
  amount: number;
  cash: number;
  transfer: number;
  method: "cash" | "transfer" | "cash_and_transfer" | "none";
  reference?: string | undefined;
  proofName?: string | undefined;
  note?: string | undefined;
  status: PaymentStatus;
  /** the last person who acted on the payment */
  handledBy: string;
  declineReason?: string | undefined;
  /** Confirmed, then voided by the owner (stored as declined). */
  voided: boolean;
  /** No transfer part: the branch manager confirms it, not the owner. */
  cashOnly: boolean;
  trail: PaymentTrailStep[];
};
export const paymentStatusLabel: Record<PaymentStatus, string> = {
  submitted: "Awaiting manager",
  acknowledged: "Awaiting owner confirmation",
  confirmed: "Confirmed",
  declined: "Declined",
};
export const paymentMethodLabel: Record<PaymentEntry["method"], string> = {
  cash: "Cash",
  transfer: "Transfer",
  cash_and_transfer: "Cash + transfer",
  none: "—",
};
const methodOf = (cash: number, transfer: number): PaymentEntry["method"] =>
  cash > 0 && transfer > 0
    ? "cash_and_transfer"
    : cash > 0
      ? "cash"
      : transfer > 0
        ? "transfer"
        : "none";

function trailOf(
  row: {
    submittedAt: string;
    acknowledgedAt?: string | undefined;
    acknowledgedBy?: string | undefined;
    confirmedAt?: string | undefined;
    confirmedBy?: string | undefined;
    declinedAt?: string | undefined;
    declinedBy?: string | undefined;
    declineReason?: string | undefined;
  },
  submittedBy: string,
): PaymentTrailStep[] {
  const steps: PaymentTrailStep[] = [{ step: "submitted", by: submittedBy, at: row.submittedAt }];
  if (row.acknowledgedAt)
    steps.push({ step: "acknowledged", by: row.acknowledgedBy, at: row.acknowledgedAt });
  if (row.confirmedAt) steps.push({ step: "confirmed", by: row.confirmedBy, at: row.confirmedAt });
  if (row.declinedAt)
    steps.push({
      step: "declined",
      by: row.declinedBy,
      at: row.declinedAt,
      note: row.declineReason,
    });
  return steps;
}

export function toPaymentEntry(payment: Payment): PaymentEntry {
  const trail = trailOf(payment, payment.salesRepId);
  return {
    kind: "rep",
    id: payment.id,
    date: payment.paymentDate ?? payment.submittedAt.slice(0, 10),
    period: payment.period,
    branchId: payment.branchId,
    repId: payment.salesRepId,
    managerId: payment.managerId,
    amount: getPaymentTotal(payment),
    cash: payment.cashAmount,
    transfer: payment.transferAmount,
    method: methodOf(payment.cashAmount, payment.transferAmount),
    reference: payment.transferReference,
    proofName: payment.proofName,
    note: payment.note,
    status: payment.status,
    handledBy: trail[trail.length - 1]!.by ?? payment.salesRepId,
    declineReason: payment.declineReason,
    voided: payment.status === "declined" && !!payment.confirmedAt,
    cashOnly: payment.transferAmount <= 0,
    trail,
  };
}
export function toCustomerPaymentEntry(payment: CustomerPayment): PaymentEntry {
  const trail = trailOf(payment, payment.receivedBy);
  return {
    kind: "customer",
    id: payment.id,
    date: payment.paymentDate,
    period: payment.paymentDate.slice(0, 7),
    branchId: payment.branchId,
    repId: payment.receivedBy,
    managerId: payment.managerId,
    customerId: payment.customerId,
    amount: payment.amount,
    cash: payment.method === "cash" ? payment.amount : 0,
    transfer: payment.method === "transfer" ? payment.amount : 0,
    method: payment.method,
    reference: payment.reference,
    proofName: payment.proofName,
    note: payment.note,
    status: payment.status,
    handledBy: trail[trail.length - 1]!.by ?? payment.receivedBy,
    declineReason: payment.declineReason,
    voided: payment.status === "declined" && !!payment.confirmedAt,
    cashOnly: payment.method === "cash",
    trail,
  };
}

/**
 * What the caller may do with a payment. Cash: the branch manager confirms or
 * declines it. Transfer: the manager acknowledges (or declines while submitted),
 * the owner confirms or declines. The owner can void any confirmed payment.
 */
export function getPaymentActions(scope: AccessScope, entry: PaymentEntry) {
  const pending = entry.status === "submitted" || entry.status === "acknowledged";
  const isManager = scope.canAcknowledgePayments && entry.managerId === scope.user.id;
  const isOwner = scope.canConfirmPayments;
  const acknowledge = isManager && !entry.cashOnly && entry.status === "submitted";
  const confirm = pending && (entry.cashOnly ? isManager : isOwner);
  const decline = pending && (entry.cashOnly ? isManager : isOwner || acknowledge);
  const voidable = isOwner && entry.status === "confirmed";
  return { acknowledge, confirm, decline, void: voidable };
}

export type PaymentEntryFilters = PaymentFilters & {
  kind?: PaymentKind | "all";
  /** Payment date (customer payments) or submission date (pay-ins), inclusive. */
  range?: { from: string; to: string };
};
function inPaymentScope(
  scope: AccessScope,
  row: { tenantId: string; repId: string; managerId: string; branchId: string },
) {
  if (row.tenantId !== scope.user.tenantId) return false;
  switch (scope.user.role) {
    case "owner":
      return true;
    case "manager":
      return !!scope.branchIds?.includes(row.branchId);
    case "sales_rep":
      return row.repId === scope.user.id;
    default:
      return false;
  }
}
/** Every payment the caller may see, rep and customer, newest first. */
export function getPaymentEntriesForScope(
  db: Db,
  scope: AccessScope,
  filters: PaymentEntryFilters = {},
) {
  const rows = [
    ...db.payments
      .filter(
        (p) => p.tenantId === db.tenant.id && inPaymentScope(scope, { ...p, repId: p.salesRepId }),
      )
      .map(toPaymentEntry),
    ...db.customerPayments
      .filter(
        (p) => p.tenantId === db.tenant.id && inPaymentScope(scope, { ...p, repId: p.receivedBy }),
      )
      .map(toCustomerPaymentEntry),
  ];
  return rows
    .filter(
      (r) =>
        (!filters.period || r.period === filters.period) &&
        (!filters.range || (r.date >= filters.range.from && r.date <= filters.range.to)) &&
        (!filters.branchId || r.branchId === filters.branchId) &&
        (!filters.salesRepId || r.repId === filters.salesRepId) &&
        (!filters.status || filters.status === "all" || r.status === filters.status) &&
        (!filters.kind || filters.kind === "all" || r.kind === filters.kind),
    )
    .sort((a, b) => (b.trail[0]!.at ?? "").localeCompare(a.trail[0]!.at ?? ""));
}

/**
 * Tile figures for a date range. The pay-in tiles count rep pay-ins only: a customer
 * payment is the money the rep then pays in, so counting both would count the same
 * naira twice. Two balances, each adding up on its own:
 *   customers: sold to customers - paid by customers = customers still owe;
 *   reps: collected (walk-in sales + customer payments) - paid in = still to pay in.
 * entries must already be filtered to the same range (getPaymentEntriesForScope).
 */
export function getPaymentOverviewSummary(
  db: Db,
  scope: AccessScope,
  entries: PaymentEntry[],
  range: { from: string; to: string },
  filters: PaymentFilters = {},
) {
  const payIns = entries.filter((e) => e.kind === "rep");
  const sum = (status: PaymentStatus) =>
    payIns.filter((e) => e.status === status).reduce((total, e) => total + e.amount, 0);
  const count = (status: PaymentStatus) => payIns.filter((e) => e.status === status).length;
  const collectedRows = entries.filter((e) => e.kind === "customer" && e.status === "confirmed");
  const reps = db.users.filter(
    (u) =>
      u.tenantId === db.tenant.id &&
      u.role === "sales_rep" &&
      !!u.branchId &&
      (scope.user.role !== "sales_rep" || u.id === scope.user.id) &&
      (scope.branchIds === null || scope.branchIds.includes(u.branchId)) &&
      (!filters.branchId || u.branchId === filters.branchId) &&
      (!filters.salesRepId || u.id === filters.salesRepId),
  );
  const repIds = new Set(reps.map((rep) => rep.id));
  const soldToCustomers = reps.reduce((total, rep) => total + getSalesRevenue(db, { repId: rep.id, saleType: "customer", range }), 0);
  const customerCollections = db.customerPayments
    .filter((p) => p.tenantId === db.tenant.id && repIds.has(p.receivedBy) && isRepCollection(p)
      && p.paymentDate >= range.from && p.paymentDate <= range.to)
    .reduce((total, p) => total + p.amount, 0);
  // Still to pay in: the running balance of these reps (all dates).
  const outstanding = Math.max(reps.reduce((total, rep) => total + getRepBalance(db, rep.id), 0), 0);
  return {
    soldToCustomers,
    customerCollections,
    customersOwe: soldToCustomers - customerCollections,
    paidIn: sum("confirmed") + sum("submitted") + sum("acknowledged"),
    confirmed: sum("confirmed"),
    confirmedCount: count("confirmed"),
    awaitingAcknowledgement: sum("submitted"),
    awaitingAcknowledgementCount: count("submitted"),
    awaitingConfirmation: sum("acknowledged"),
    awaitingConfirmationCount: count("acknowledged"),
    declined: sum("declined"),
    declinedCount: count("declined"),
    collected: collectedRows.reduce((total, e) => total + e.amount, 0),
    collectedCount: collectedRows.length,
    outstanding,
  };
}
