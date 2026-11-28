import type { Db, Expense, ManagerRemittance, Payment, RemittanceStatus } from "@/data/mock-db";
import type { AccessScope } from "@/lib/session";
import { getRepBalance, getRepTotalSales, isValidPaymentPeriod } from "@/lib/payment-calculations";
import type {
  OwnerRemittance,
  OwnerRemittancePaymentMethod,
  OwnerRemittancePayeeType,
} from "@/data/remittances";

export type RemittanceFilters = {
  period?: string;
  branchId?: string;
  status?: RemittanceStatus | "all";
};
export type RemittanceBreakdown = Pick<ManagerRemittance, "cashAmount" | "transferAmount">;
export const expenseCategories = [
  "transport",
  "logistics",
  "office",
  "communication",
  "maintenance",
  "other",
] as const;
export const expenseCategoryLabel: Record<(typeof expenseCategories)[number], string> = {
  transport: "Transport",
  logistics: "Logistics",
  office: "Office",
  communication: "Communication",
  maintenance: "Maintenance",
  other: "Other",
};

/** The branch this manager runs (null when none). */
const managedBranchId = (db: Db, managerId: string) =>
  db.branches.find((b) => b.tenantId === db.tenant.id && b.managerId === managerId && b.status === "active")?.id ?? null;

/**
 * Rep pay-ins of the manager's branch dated in the month that reached the manager
 * (acknowledged or confirmed), as submit_manager_remittance. Matched by branch.
 */
export function getManagerEligiblePayments(db: Db, managerId: string, period: string): Payment[] {
  if (!isValidPaymentPeriod(period)) return [];
  const branchId = managedBranchId(db, managerId);
  return db.payments.filter(
    (payment) =>
      payment.tenantId === db.tenant.id &&
      payment.branchId === branchId &&
      payment.period === period &&
      (payment.status === "acknowledged" || payment.status === "confirmed"),
  );
}

/** What the manager received for the month: rep pay-ins + their own walk-in sales. */
export function getManagerTotalReceived(db: Db, managerId: string, period: string) {
  const paidIn = getManagerEligiblePayments(db, managerId, period).reduce((s, p) => s + p.cashAmount + p.transferAmount, 0);
  return paidIn + getRepTotalSales(db, managerId, period);
}

export function getManagerPaymentBreakdown(db: Db, managerId: string, period: string) {
  const payments = getManagerEligiblePayments(db, managerId, period);
  const branchId = managedBranchId(db, managerId);
  const reps = db.users.filter((u) => u.tenantId === db.tenant.id && u.role === "sales_rep" && u.branchId === branchId);
  return {
    // The manager's own walk-in sales are taken in cash or transfer; counted with cash.
    cash: payments.reduce((sum, payment) => sum + payment.cashAmount, 0) + getRepTotalSales(db, managerId, period),
    transfer: payments.reduce((sum, payment) => sum + payment.transferAmount, 0),
    /** what the branch's reps still have to pay in (all dates) */
    outstanding: Math.max(reps.reduce((sum, rep) => sum + getRepBalance(db, rep.id), 0), 0),
  };
}

export function getManagerExpenses(db: Db, managerId: string, period: string): Expense[] {
  if (!isValidPaymentPeriod(period)) return [];
  return db.expenses.filter((expense) => {
    const branch = expense.branchId
      ? db.branches.find((item) => item.id === expense.branchId)
      : null;
    return (
      expense.tenantId === db.tenant.id &&
      expense.managerId === managerId &&
      expense.status === "recorded" &&
      expense.expenseDate.startsWith(`${period}-`) &&
      branch?.tenantId === db.tenant.id &&
      branch.managerId === managerId
    );
  });
}

export function getExpensesForScope(db: Db, scope: AccessScope, period?: string) {
  if (scope.user.role !== "manager" && scope.user.role !== "owner") return [];
  return db.expenses
    .filter((expense) => {
      if (expense.tenantId !== db.tenant.id || expense.tenantId !== scope.user.tenantId)
        return false;
      const branch = expense.branchId
        ? db.branches.find((item) => item.id === expense.branchId)
        : null;
      if (expense.branchId && (!branch || branch.tenantId !== expense.tenantId)) return false;
      if (
        scope.user.role === "manager" &&
        (expense.managerId !== scope.user.id ||
          !expense.branchId ||
          !scope.branchIds?.includes(expense.branchId))
      )
        return false;
      return !period || expense.expenseDate.startsWith(`${period}-`);
    })
    .sort(
      (a, b) =>
        b.expenseDate.localeCompare(a.expenseDate) || b.createdAt.localeCompare(a.createdAt),
    );
}

export function getExpenseSummary(
  db: Db,
  scope: AccessScope,
  period: string,
  currentPeriod: string,
) {
  const records = getExpensesForScope(db, scope).filter((expense) => expense.status === "recorded");
  const sum = (rows: Expense[]) => rows.reduce((total, expense) => total + expense.amount, 0);
  return {
    total: sum(records),
    monthTotal: sum(
      records.filter((expense) => expense.expenseDate.startsWith(`${currentPeriod}-`)),
    ),
    periodTotal: sum(records.filter((expense) => expense.expenseDate.startsWith(`${period}-`))),
    count: records.length,
  };
}

export type OwnerRemittanceFilters = {
  paymentMethod?: "all" | OwnerRemittancePaymentMethod;
  payeeType?: "all" | OwnerRemittancePayeeType;
  from?: string;
  to?: string;
  search?: string;
};
export function getOwnerRemittances(
  db: Db,
  scope: AccessScope,
  filters: OwnerRemittanceFilters = {},
) {
  if (scope.user.role !== "owner") return [];
  const query = filters.search?.trim().toLowerCase() ?? "";
  return db.ownerRemittances
    .filter(
      (row) =>
        row.tenantId === db.tenant.id &&
        row.tenantId === scope.user.tenantId &&
        row.ownerId === scope.user.id &&
        (!filters.paymentMethod ||
          filters.paymentMethod === "all" ||
          row.paymentMethod === filters.paymentMethod) &&
        (!filters.payeeType ||
          filters.payeeType === "all" ||
          row.payeeType === filters.payeeType) &&
        (!filters.from || row.remittanceDate >= filters.from) &&
        (!filters.to || row.remittanceDate <= filters.to) &&
        (!query ||
          `${row.payeeName} ${row.reference ?? ""} ${row.purpose}`.toLowerCase().includes(query)),
    )
    .sort(
      (a, b) =>
        b.remittanceDate.localeCompare(a.remittanceDate) || b.createdAt.localeCompare(a.createdAt),
    );
}
export function getOwnerRemittanceSummary(rows: OwnerRemittance[], month: string) {
  const sum = (items: OwnerRemittance[]) => items.reduce((total, row) => total + row.amount, 0);
  return {
    total: sum(rows),
    cash: sum(rows.filter((row) => row.paymentMethod === "cash")),
    transfer: sum(rows.filter((row) => row.paymentMethod === "transfer")),
    thisMonth: sum(rows.filter((row) => row.remittanceDate.startsWith(`${month}-`))),
  };
}
export const getTotalOwnerRemitted = (rows: OwnerRemittance[]) =>
  getOwnerRemittanceSummary(rows, "").total;
export const getOwnerCashRemittances = (rows: OwnerRemittance[]) =>
  getOwnerRemittanceSummary(rows, "").cash;
export const getOwnerTransferRemittances = (rows: OwnerRemittance[]) =>
  getOwnerRemittanceSummary(rows, "").transfer;
export const getOwnerRemittancesForPeriod = (rows: OwnerRemittance[], month: string) =>
  rows.filter((row) => row.remittanceDate.startsWith(`${month}-`));

export const getManagerExpenseTotal = (db: Db, managerId: string, period: string) =>
  getManagerExpenses(db, managerId, period).reduce((sum, expense) => sum + expense.amount, 0);

export const getManagerNetRemittanceDue = (db: Db, managerId: string, period: string) => {
  const previous = getManagerRemittanceAmounts(db, managerId, period);
  const previouslyRemitted = previous.cash + previous.transfer;
  return (
    getManagerTotalReceived(db, managerId, period) -
    getManagerExpenseTotal(db, managerId, period) -
    previouslyRemitted
  );
};

export function getManagerExpenseSummary(
  db: Db,
  managerId: string,
  period: string,
  currentPeriod: string,
) {
  const records = db.expenses.filter((expense) => {
    const branch = expense.branchId
      ? db.branches.find((item) => item.id === expense.branchId)
      : null;
    return (
      expense.tenantId === db.tenant.id &&
      expense.managerId === managerId &&
      expense.status === "recorded" &&
      branch?.tenantId === db.tenant.id &&
      branch.managerId === managerId
    );
  });
  const sum = (rows: Expense[]) => rows.reduce((total, expense) => total + expense.amount, 0);
  return {
    total: sum(records),
    monthTotal: sum(
      records.filter((expense) => expense.expenseDate.startsWith(`${currentPeriod}-`)),
    ),
    periodTotal: sum(records.filter((expense) => expense.expenseDate.startsWith(`${period}-`))),
    count: records.length,
  };
}

export function getRemittanceOutstanding(
  netRemittanceDue: number,
  cashAmount: number,
  transferAmount: number,
) {
  return netRemittanceDue - cashAmount - transferAmount;
}

export function validateRemittanceReconciliation(
  netRemittanceDue: number,
  breakdown: RemittanceBreakdown,
) {
  const outstanding = getRemittanceOutstanding(
    netRemittanceDue,
    breakdown.cashAmount,
    breakdown.transferAmount,
  );
  return {
    outstanding,
    balanced:
      Number.isFinite(netRemittanceDue) &&
      netRemittanceDue >= 0 &&
      Number.isFinite(breakdown.cashAmount) &&
      Number.isFinite(breakdown.transferAmount) &&
      breakdown.cashAmount >= 0 &&
      breakdown.transferAmount >= 0 &&
      outstanding >= 0,
  };
}

/** Submitted (or, for drafts, created) within the date range, inclusive. */
export const remittanceInRange = (
  row: Pick<ManagerRemittance, "submittedAt" | "createdAt">,
  range: { from: string; to: string },
) => {
  const day = (row.submittedAt ?? row.createdAt).slice(0, 10);
  return day >= range.from && day <= range.to;
};

export function getManagerRemittances(db: Db, scope: AccessScope, filters: RemittanceFilters = {}) {
  return db.remittances
    .filter((remittance) => {
      if (remittance.tenantId !== db.tenant.id || remittance.tenantId !== scope.user.tenantId)
        return false;
      const branch = db.branches.find((item) => item.id === remittance.branchId);
      if (
        !branch ||
        branch.tenantId !== remittance.tenantId ||
        branch.managerId !== remittance.managerId
      )
        return false;
      if (
        scope.user.role === "manager" &&
        (remittance.managerId !== scope.user.id || !scope.branchIds?.includes(remittance.branchId))
      )
        return false;
      if (scope.user.role !== "manager" && scope.user.role !== "owner") return false;
      return (
        (!filters.period || remittance.period === filters.period) &&
        (!filters.branchId || remittance.branchId === filters.branchId) &&
        (!filters.status || filters.status === "all" || remittance.status === filters.status)
      );
    })
    .sort(
      (a, b) =>
        (b.submittedAt ?? b.createdAt).localeCompare(a.submittedAt ?? a.createdAt) ||
        b.id.localeCompare(a.id),
    );
}

export function getManagerRemittanceAmounts(db: Db, managerId: string, period: string) {
  const records = db.remittances.filter((remittance) => {
    const branch = db.branches.find((item) => item.id === remittance.branchId);
    return (
      remittance.tenantId === db.tenant.id &&
      remittance.period === period &&
      remittance.status !== "declined" &&
      branch?.tenantId === db.tenant.id &&
      branch.managerId === managerId
    );
  });
  const latest = records.sort(
    (a, b) =>
      (b.submittedAt ?? b.createdAt).localeCompare(a.submittedAt ?? a.createdAt) ||
      b.id.localeCompare(a.id),
  )[0];
  return {
    cash: records.reduce((sum, item) => sum + item.cashAmount, 0),
    transfer: records.reduce((sum, item) => sum + item.transferAmount, 0),
    outstanding: latest?.outstandingAmount ?? 0,
    status: latest?.status ?? null,
  };
}
export const getRemittanceCashAmount = (db: Db, managerId: string, period: string) =>
  getManagerRemittanceAmounts(db, managerId, period).cash;
export const getRemittanceTransferAmount = (db: Db, managerId: string, period: string) =>
  getManagerRemittanceAmounts(db, managerId, period).transfer;
export const getRemittanceOutstandingAmount = (db: Db, managerId: string, period: string) =>
  getManagerRemittanceAmounts(db, managerId, period).outstanding;

export function getRemittanceSnapshot(db: Db, remittance: ManagerRemittance) {
  return {
    totalReceived: remittance.totalReceived,
    expenseAmount: remittance.expenseAmount,
    netRemittanceDue: remittance.netRemittanceDue,
    cashAmount: remittance.cashAmount,
    transferAmount: remittance.transferAmount,
    outstandingAmount: remittance.outstandingAmount,
  };
}
