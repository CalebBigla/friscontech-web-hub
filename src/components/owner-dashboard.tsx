import { ExpiringSoonPanel } from "@/components/expiry/expiry-widgets";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, CircleDollarSign, FileText, Landmark, Target, Users } from "lucide-react";
import { toast } from "sonner";

import { AppShell, RestrictedNotice } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { EmptyState, MetricCard, Panel } from "@/components/shared";
import { FilterBar } from "@/components/kit/filter-bar";
import { StatusBadge } from "@/components/kit/status-badge";
import { OrderStatusBadge } from "@/components/orders/orders-page";
import { orderTotal, useCustomerOrders } from "@/hooks/use-orders";
import { useLiveWorkspace } from "@/hooks/use-live-workspace";
import { DataGate } from "@/components/shared";
import {
  getInventorySummary,
} from "@/lib/inventory-calculations";
import { getAccessScope, useCurrentUserId } from "@/lib/session";
import { getAuditLogs } from "@/lib/audit";
import { describeApproval, getApprovals } from "@/lib/approvals";
import {
  getBranchInventoryHealth,
  getDeadStockValue,
  getSalesRevenue,
  getTargetForRange,
  percentChange,
} from "@/lib/calculations";
import { isoWeek, monthOf, previousRange } from "@/lib/dates";
import { PeriodFilter, usePeriodFilter } from "@/components/period-filter";
import { formatCompactNaira, formatDate, formatNaira, formatNumber, formatPercent, formatTime } from "@/lib/format";
import { getManagerRemittances } from "@/lib/remittance-calculations";
import { canReviewApproval } from "@/lib/approvals";
import { OnboardingReviewDialog } from "@/components/team/onboarding-review";
import { BranchTargetsPanel } from "@/components/targets/branch-targets-panel";
import { EditTargetDialog, SetTargetDialog } from "@/components/targets/target-dialogs";
import type { Target as SalesTarget } from "@/data/mock-db";
import { usePendingOnboardings } from "@/hooks/use-onboardings";
import { fullName } from "@/lib/onboarding";

/** Waits for Supabase data (real loading and error states), then renders the screen. */
export function OwnerDashboard() {
  const { isLoading, error } = useLiveWorkspace({ activities: true, batches: true });
  if (isLoading || error)
    return (
      <AppShell title="Dashboard">
        <DataGate isLoading={isLoading} error={error}>{null}</DataGate>
      </AppShell>
    );
  return <OwnerDashboardContent />;
}

function OwnerDashboardContent() {
  const { db } = useLiveWorkspace({ activities: true, batches: true });
  const userId = useCurrentUserId();
  const scope = getAccessScope(db, userId);
  const ordersQuery = useCustomerOrders();
  const today = db.tenant.referenceDate;
  // Day (default), week, month or chosen dates: revenue, targets and orders follow it.
  const { state: period, setState: setPeriod, range, label: rangeLabel } = usePeriodFilter(today, "today");
  const pendingRemittances = getManagerRemittances(db, scope, { status: "submitted" });
  const pendingApprovals = getApprovals(db, scope).filter(
    (item) => item.status === "pending" && canReviewApproval(db, userId, item),
  );
  // Staff onboardings submitted and waiting for the owner (reviewed in a modal).
  const { data: pendingOnboardings = [] } = usePendingOnboardings(scope.user.tenantId);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [settingTarget, setSettingTarget] = useState<string | null>(null);
  const [editingTarget, setEditingTarget] = useState<SalesTarget | null>(null);
  const approvalCount = pendingApprovals.length + pendingRemittances.length + pendingOnboardings.length;
  const approvalTarget = pendingRemittances.length ? "/remittance" : pendingApprovals.length || !pendingOnboardings.length ? "/approvals" : "/team";

  const data = useMemo(() => {
    const active = db.branches.filter((b) => b.status === "active");
    const activeIds = active.map((b) => b.id);
    const revenue = getSalesRevenue(db, { range });
    const prevRevenue = getSalesRevenue(db, { range: previousRange(range) });
    const target = getTargetForRange(db, range, {});
    const attainment = target ? (revenue / target) * 100 : 0;
    const team = db.users.filter(
      (x) =>
        x.status === "active" && x.role !== "owner" && x.branchId && activeIds.includes(x.branchId),
    );
    const prevTarget = getTargetForRange(db, previousRange(range), {});
    const prevAttainment = prevTarget ? (prevRevenue / prevTarget) * 100 : 0;
    const change = percentChange(revenue, prevRevenue);
    const metrics = [
      {
        label: "Total revenue",
        value: formatCompactNaira(revenue),
        detail: `${formatCompactNaira(prevRevenue)} previous period`,
        change: `${change >= 0 ? "+" : ""}${change.toFixed(0)}%`,
        tone: change >= 0 ? "success" : "warning",
      },
      {
        label: "Team members",
        value: String(team.length),
        detail: `Across ${active.length} branches`,
        change: `${db.users.filter((x) => x.role === "sales_rep" && team.includes(x)).length} reps`,
        tone: "brand",
      },
      {
        label: "Target attainment",
        value: formatPercent(attainment, 0),
        detail: `${formatCompactNaira(Math.max(target - revenue, 0))} remaining`,
        change: `${attainment - prevAttainment >= 0 ? "+" : ""}${(attainment - prevAttainment).toFixed(0)}%`,
        tone: "warning",
      },
    ];
    const inv = getBranchInventoryHealth(db, undefined, activeIds);
    const inventorySummary = getInventorySummary(db, { branchIds: activeIds });
    return {
      metrics,
      inv,
      inventorySummary,
      dead: getDeadStockValue(db, activeIds),
    };
  }, [db, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const tenantBranchIds = db.branches
    .filter((branch) => branch.tenantId === scope.user.tenantId)
    .map((branch) => branch.id);
  const visibleBranches = scope.branchIds ?? tenantBranchIds;
  const orders = (ordersQuery.data ?? []).filter((order) => {
    const day = order.createdAt.slice(0, 10);
    return visibleBranches.includes(order.branchId) && day >= range.from && day <= range.to;
  });
  const pending = orders.filter((order) => order.status === "pending").length;
  const toAcknowledge = orders.filter((order) => order.status === "fulfilled").length;
  const nameOf = (id: string) => db.branches.find((b) => b.id === id)?.name ?? "—";
  const productOf = (id: string) => db.products.find((p) => p.id === id)?.name ?? "—";

  if (scope.user.role !== "owner") {
    return (
      <AppShell title="Dashboard">
        <RestrictedNotice message="The business-wide dashboard is for Owners. Use Branches or Sales for your location." />
      </AppShell>
    );
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const [revenueMetric, teamMetric, attainmentMetric] = data.metrics;

  return (
    <AppShell
      title="Dashboard"
      subtitle={`${greeting}, ${(scope.user.name ?? "").split(" ")[0]} · Week ${isoWeek(today)}`}
      actions={
        <Button
          variant="secondary"
          onClick={() =>
            toast.success("Report export queued", {
              description: "You'll be notified when the file is ready.",
            })
          }
        >
          <FileText />
          <span className="hidden sm:inline">Export report</span>
        </Button>
      }
    >
      <FilterBar>
        <PeriodFilter today={today} value={period} onChange={setPeriod} />
      </FilterBar>

      {/* Key figures first. */}
      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {revenueMetric && (
          <MetricCard icon={CircleDollarSign} tone={revenueMetric.tone as "success" | "warning"} label="Revenue"
            value={revenueMetric.value} badge={revenueMetric.change} detail={`vs ${revenueMetric.detail.replace(" previous period", "")}`} />
        )}
        {attainmentMetric && (
          <MetricCard icon={Target} tone="warning" label="Target attainment" value={attainmentMetric.value}
            detail={attainmentMetric.detail} />
        )}
        <Link to={approvalTarget} className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <MetricCard icon={Landmark} tone={approvalCount ? "warning" : "success"} label="Approvals" value={formatNumber(approvalCount)}
            badge={approvalCount ? "Action" : undefined} detail={approvalCount ? "Waiting for you" : "All clear"} />
        </Link>
        {teamMetric && (
          <MetricCard icon={Users} tone="brand" label="Team" value={teamMetric.value} detail={`${teamMetric.change} · ${teamMetric.detail.toLowerCase()}`} />
        )}
      </section>

      {/* Work waiting on the Owner. */}
      <section className="mt-6 grid gap-4 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Customer orders"
          subtitle={`${rangeLabel} · ${pending} to fulfil · ${toAcknowledge} to acknowledge`}
          action={<Button variant="ghost" size="sm" asChild><Link to="/orders">View all</Link></Button>}
        >
          {orders.length ? (
            <ul className="divide-y divide-border">
              {orders.slice(0, 5).map((order) => {
                const rep = db.users.find((user) => user.id === order.repId);
                return (
                  <li key={order.id} className="flex items-start justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-label">
                        <span className="font-medium">{order.customerName}</span>
                        <span className="text-muted-foreground"> · {order.code}</span>
                      </p>
                      <p className="mt-0.5 truncate text-caption text-muted-foreground">
                        {order.lines.map((l) => `${productOf(l.productId)} × ${l.quantity}`).join(", ")}
                      </p>
                      <p className="mt-0.5 truncate text-caption text-muted-foreground">
                        {rep?.name ?? "Sales rep"} · {nameOf(order.branchId)} · {formatTime(order.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className="text-label font-semibold tabular-nums">{formatNaira(orderTotal(order))}</span>
                      <OrderStatusBadge status={order.status} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="No orders in this period" detail="Choose a wider period." />
          )}
        </Panel>

        <Panel title="Approvals" subtitle={approvalCount ? `${approvalCount} waiting` : "Nothing waiting"}>
          {approvalCount ? (
            <ul className="divide-y divide-border">
              {pendingOnboardings.map((o) => (
                <li key={o.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-label font-medium">{fullName(o.data) || o.employeeId}</p>
                    <p className="mt-0.5 truncate text-caption text-muted-foreground">
                      New staff · {o.jobTitle || o.employeeId} · {o.submittedAt ? formatDate(o.submittedAt.slice(0, 10)) : "—"}
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setReviewing(o.id)}>Review</Button>
                </li>
              ))}
              {pendingRemittances.map((remittance) => (
                <li key={remittance.id}>
                  <Link to="/remittance" className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/60">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-label font-medium">
                        {db.users.find((user) => user.id === remittance.managerId)?.name ?? "Manager"}
                      </p>
                      <p className="mt-0.5 truncate text-caption text-muted-foreground">
                        Remittance · {nameOf(remittance.branchId)} · {formatDate((remittance.submittedAt ?? remittance.createdAt).slice(0, 10))}
                      </p>
                    </div>
                    <span className="text-label font-semibold tabular-nums">{formatCompactNaira(remittance.netRemittanceDue)}</span>
                  </Link>
                </li>
              ))}
              {pendingApprovals.map((approval) => (
                <li key={approval.id}>
                  <Link to="/approvals" className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-muted/60">
                    <span className="min-w-0 truncate text-label font-medium">{describeApproval(db, approval).title}</span>
                    <StatusBadge tone="brand">Request</StatusBadge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Check} title="You're all caught up" />
          )}
        </Panel>
      </section>

      <BranchTargetsPanel className="mt-4 overflow-hidden" db={db} scope={scope} month={monthOf(today)}
        onSet={(branchId) => setSettingTarget(branchId)} onEdit={setEditingTarget} />

      {/* Supporting detail. */}
      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel
          title="Inventory"
          subtitle={`${data.inv.status} · dead stock ${formatCompactNaira(data.dead)}`}
          action={<Button variant="ghost" size="sm" asChild><Link to="/inventory">View all</Link></Button>}
        >
          <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3">
            {[
              { label: "Products", value: formatNumber(data.inventorySummary.products) },
              { label: "Units on hand", value: formatNumber(data.inventorySummary.units) },
              { label: "Stock value", value: formatCompactNaira(data.inventorySummary.value) },
              { label: "Low stock", value: formatNumber(data.inventorySummary.low), tone: data.inventorySummary.low ? "text-warning" : "" },
              { label: "Out of stock", value: formatNumber(data.inventorySummary.out), tone: data.inventorySummary.out ? "text-destructive" : "" },
            ].map((item) => (
              <div key={item.label} className="bg-card px-5 py-4">
                <dt className="text-caption text-muted-foreground">{item.label}</dt>
                <dd className={`mt-1 text-lg font-semibold tabular-nums ${item.tone ?? ""}`}>{item.value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <ExpiringSoonPanel db={db} branchIds={scope.branchIds} className="" />
      </section>

      <Panel
        className="mt-4"
        title="Recent activity"
        action={<Button variant="ghost" size="sm" asChild><Link to="/audit-log">View all</Link></Button>}
      >
        <ul className="divide-y divide-border">
          {getAuditLogs(db, scope)
            .slice(0, 5)
            .map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-5 py-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                  <Check className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-label font-medium">{item.action}</p>
                  <p className="truncate text-caption text-muted-foreground">{item.subject}</p>
                </div>
                <span className="shrink-0 text-caption text-muted-foreground tabular-nums">{formatTime(item.createdAt)}</span>
              </li>
            ))}
        </ul>
      </Panel>

      <OnboardingReviewDialog onboardingId={reviewing} onClose={() => setReviewing(null)} scope={scope} />
      <SetTargetDialog open={!!settingTarget} onOpenChange={(o) => !o && setSettingTarget(null)} scope={scope} db={db}
        defaultMonth={monthOf(today)} defaultKind="branch" defaultBranchId={settingTarget ?? ""} onEditExisting={setEditingTarget} />
      <EditTargetDialog target={editingTarget} onClose={() => setEditingTarget(null)} actorId={userId} db={db} />
    </AppShell>
  );
}
