import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Download, Eye, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { CustomerFormDialog } from "@/components/customers/customer-dialogs";
import { DataGate, FilterSelect, StatTile } from "@/components/shared";
import { FilterBar } from "@/components/kit/filter-bar";
import { Pagination, Table, TableCard, TableEmpty, Td, TdActions, Th, THead, Tr } from "@/components/kit/data-table";
import { RowActions } from "@/components/kit/row-actions";
import { StatusBadge } from "@/components/kit/status-badge";
import { usePagination } from "@/hooks/use-pagination";
import { Button } from "@/components/ui/button";
import { balancePosition, getCustomerSummary, getCustomersForScope, needsReassignment } from "@/lib/customer-calculations";
import { formatNaira, formatNumber } from "@/lib/format";
import { getAccessScope, useCurrentUserId } from "@/lib/session";
import { useCustomerAccounts } from "@/hooks/use-customers";
import { useLiveWorkspace } from "@/hooks/use-live-workspace";

export function BalanceBadge({ balance }: { balance: number }) {
  const position = balancePosition(balance);
  if (position === "debt") return <StatusBadge tone="danger">Debt</StatusBadge>;
  if (position === "credit") return <StatusBadge tone="success">In credit</StatusBadge>;
  return <StatusBadge tone="neutral">Settled</StatusBadge>;
}

export function CustomersPage() {
  const { db, isLoading: workspaceLoading, error: workspaceError } = useLiveWorkspace();
  const userId = useCurrentUserId();
  const scope = getAccessScope(db, userId);
  const { accounts, isLoading: accountsLoading, error: accountsError } = useCustomerAccounts(db, scope);
  const isLoading = workspaceLoading || accountsLoading;
  const error = workspaceError ?? accountsError;
  const isOwner = scope.user.role === "owner";
  const [repFilter, setRepFilter] = useState("all");
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("active");
  const [balance, setBalance] = useState("all");
  const [branchId, setBranchId] = useState("all");
  const [addOpen, setAddOpen] = useState(false);

  const all = useMemo(
    () =>
      getCustomersForScope(db, scope).map((c) => ({
        customer: c,
        summary: getCustomerSummary(accounts, c),
        unmanaged: needsReassignment(db, c),
      })),
    [db, accounts, scope],
  );
  const needle = q.trim().toLowerCase();
  const rows = all.filter(
    ({ customer: c, summary: s, unmanaged }) =>
      (repFilter === "all" || (repFilter === "unmanaged" ? unmanaged : c.assignedRepId === repFilter)) &&
      (status === "all" || c.status === status) &&
      (branchId === "all" || c.branchId === branchId) &&
      (balance === "all" || balancePosition(s.balance) === balance) &&
      (!needle ||
        [c.name, c.contactPerson, c.phone, c.email].some((v) => v.toLowerCase().includes(needle))),
  );
  const unmanagedCount = all.filter((r) => r.unmanaged).length;
  const repName = (id: string | null) => db.users.find((u) => u.id === id)?.name ?? "—";
  const totalOwed = all.reduce((sum, r) => sum + r.summary.owed, 0);
  const owing = all.filter((r) => balancePosition(r.summary.balance) === "debt").length;
  const pending = all.reduce((sum, r) => sum + r.summary.pending, 0);
  const branches = db.branches.filter(
    (b) => scope.branchIds === null || scope.branchIds.includes(b.id),
  );
  // Filtered by one rep: what their customers have bought, paid and still owe,
  // over the rows shown (other filters still apply).
  const repTotals = repFilter !== "all" && repFilter !== "unmanaged"
    ? {
        customers: rows.length,
        sold: rows.reduce((sum, r) => sum + r.summary.debits, 0),
        paid: rows.reduce((sum, r) => sum + r.summary.credits, 0),
        owed: rows.reduce((sum, r) => sum + r.summary.owed, 0),
        inCredit: rows.reduce((sum, r) => sum + Math.max(r.summary.balance, 0), 0),
        pending: rows.reduce((sum, r) => sum + r.summary.pending, 0),
      }
    : null;
  // Owner, managers and reps can take the table away as an Excel file (the rows shown, with filters applied).
  const canDownload = isOwner || scope.user.role === "manager" || scope.user.role === "sales_rep";
  const [exporting, setExporting] = useState(false);
  async function downloadExcel() {
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      const data = rows.map(({ customer: c, summary: s }) => ({
        Customer: c.name,
        "Contact person": c.contactPerson,
        Phone: c.phone,
        Email: c.email,
        Address: c.address,
        Branch: branchName(c.branchId),
        "Sales rep": repName(c.assignedRepId),
        Status: c.status === "active" ? "Active" : "Inactive",
        Orders: s.orders,
        "Total sold (NGN)": s.debits,
        "Total paid (NGN)": s.credits,
        "Balance (NGN)": s.balance,
        Position: { debt: "Debt", credit: "In credit", settled: "Settled" }[balancePosition(s.balance)],
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      ws["!cols"] = Object.keys(data[0] ?? { Customer: "" }).map((k) => ({ wch: Math.max(12, k.length + 2) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Customers");
      XLSX.writeFile(wb, `customers-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success(`${rows.length} customer${rows.length === 1 ? "" : "s"} downloaded`);
    } catch (failure) {
      toast.error("Could not create the Excel file", { description: failure instanceof Error ? failure.message : undefined });
    } finally {
      setExporting(false);
    }
  }
  const branchName = (id: string | null) =>
    id ? (db.branches.find((b) => b.id === id)?.name ?? "—") : "All branches";

  const filtering = q.trim() !== "" || status !== "active" || balance !== "all" || branchId !== "all" || repFilter !== "all";
  const clearFilters = () => {
    setQ("");
    setStatus("active");
    setBalance("all");
    setBranchId("all");
    setRepFilter("all");
  };
  const paging = usePagination(rows, 25);
  const open = (id: string) => void navigate({ to: "/customers/$customerId", params: { customerId: id } });
  const columns = 6 + (isOwner ? 1 : 0);

  return (
    <AppShell
      title="Customers"
      subtitle="Customers who buy on account."
      actions={
        <>
          {canDownload && (
            <Button variant="secondary" disabled={exporting || !rows.length} onClick={() => void downloadExcel()}>
              {exporting ? <Loader2 className="animate-spin" /> : <Download />}
              <span className="hidden sm:inline">Export</span>
            </Button>
          )}
          {scope.canManageCustomers && (
            <Button onClick={() => setAddOpen(true)}>
              <Plus />Add customer
            </Button>
          )}
        </>
      }
    >
      <DataGate isLoading={isLoading} error={error}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Active customers" value={formatNumber(all.filter((r) => r.customer.status === "active").length)} detail={`${formatNumber(all.length)} registered`} />
        <StatTile tone="danger" label="Total debt" value={formatNaira(totalOwed)} detail={`${owing} customer${owing === 1 ? "" : "s"}`} />
        <StatTile tone="warning" label="Awaiting confirmation" value={formatNaira(pending)} />
        <StatTile tone="success" label="Paid" value={formatNaira(all.reduce((sum, r) => sum + r.summary.credits, 0))} />
      </div>

      {isOwner && unmanagedCount > 0 && repFilter !== "unmanaged" && (
        <div role="status" className="alert alert-warning mt-4 flex items-center gap-3">
          <AlertTriangle className="size-4 shrink-0" />
          <p className="flex-1 text-label">
            {unmanagedCount} customer{unmanagedCount === 1 ? " has" : "s have"} no active sales rep.
          </p>
          <Button size="sm" variant="secondary" onClick={() => setRepFilter("unmanaged")}>Show</Button>
        </div>
      )}

      <div className="mt-6">
        <FilterBar
          search={{ value: q, onChange: setQ, placeholder: "Search name, phone, email" }}
          active={filtering}
          onClear={clearFilters}
        >
          {scope.branchIds === null && (
            <FilterSelect label="Branch" value={branchId} onChange={setBranchId} className="w-full sm:w-40"
              options={[{ value: "all", label: "All branches" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
          )}
          {(isOwner || scope.user.role === "manager") && (
            <FilterSelect label="Sales rep" value={repFilter} onChange={setRepFilter} className="w-full sm:w-44"
              options={[
                { value: "all", label: "All sales reps" },
                { value: "unmanaged", label: "Needs reassignment" },
                ...db.users
                  .filter((u) => u.role === "sales_rep" && u.status === "active"
                    && (scope.branchIds === null || (!!u.branchId && scope.branchIds.includes(u.branchId))))
                  .map((u) => ({ value: u.id, label: u.name })),
              ]} />
          )}
          <FilterSelect label="Balance" value={balance} onChange={setBalance} className="w-full sm:w-36"
            options={[
              { value: "all", label: "Any balance" },
              { value: "debt", label: "Debt" },
              { value: "credit", label: "In credit" },
              { value: "settled", label: "Settled" },
            ]} />
          <FilterSelect label="Status" value={status} onChange={setStatus} className="w-full sm:w-32"
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
              { value: "all", label: "All statuses" },
            ]} />
        </FilterBar>

        {repTotals && (
          <section aria-label={`Totals for ${repName(repFilter)}`} className="mb-4 rounded-xl border border-border bg-card shadow-panel">
            <p className="border-b border-border px-5 py-3 text-section">{repName(repFilter)} · {repTotals.customers} customer{repTotals.customers === 1 ? "" : "s"}</p>
            <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
              {[
                ["Sold", formatNaira(repTotals.sold), ""],
                ["Paid", formatNaira(repTotals.paid), "text-success"],
                ["Debt", formatNaira(repTotals.owed), repTotals.owed > 0 ? "text-destructive" : ""],
                ["Awaiting confirmation", formatNaira(repTotals.pending), "text-warning"],
              ].map(([label, value, tone]) => (
                <div key={label} className="bg-card px-5 py-3.5">
                  <dt className="text-caption text-muted-foreground">{label}</dt>
                  <dd className={`mt-1 text-lg font-semibold tabular-nums ${tone}`}>{value}</dd>
                </div>
              ))}
            </dl>
            {repTotals.inCredit > 0 && (
              <p className="border-t border-border px-5 py-2.5 text-caption text-muted-foreground">In credit: {formatNaira(repTotals.inCredit)}</p>
            )}
          </section>
        )}

        <TableCard footer={<Pagination page={paging.page} pageCount={paging.pageCount} pageSize={paging.pageSize} total={paging.total} onPage={paging.setPage} />}>
          <Table minWidth={720}>
            <THead>
              <tr>
                <Th>Customer</Th>
                <Th>Phone</Th>
                <Th>Branch</Th>
                {isOwner && <Th>Sales rep</Th>}
                <Th align="right">Orders</Th>
                <Th align="right">Balance</Th>
                <Th>Status</Th>
                <Th srOnly>Actions</Th>
              </tr>
            </THead>
            <tbody>
              {paging.pageItems.map(({ customer: c, summary: s, unmanaged }) => (
                <Tr key={c.id} onClick={() => open(c.id)}>
                  <Td>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-caption text-muted-foreground">{c.contactPerson || c.email || "—"}</p>
                  </Td>
                  <Td className="whitespace-nowrap">{c.phone}</Td>
                  <Td muted>{branchName(c.branchId)}</Td>
                  {isOwner && (
                    <Td>{unmanaged ? <StatusBadge tone="warning">Needs reassignment</StatusBadge> : repName(c.assignedRepId)}</Td>
                  )}
                  <Td numeric>{formatNumber(s.orders)}</Td>
                  <Td numeric className={`font-semibold ${balancePosition(s.balance) === "debt" ? "text-destructive" : ""}`}>{formatNaira(s.balance)}</Td>
                  <Td>{c.status === "inactive" ? <StatusBadge tone="neutral">Inactive</StatusBadge> : <BalanceBadge balance={s.balance} />}</Td>
                  <TdActions>
                    <RowActions label={`Actions for ${c.name}`} actions={[{ label: "View details", icon: Eye, onSelect: () => open(c.id) }]} />
                  </TdActions>
                </Tr>
              ))}
              {rows.length === 0 && (
                <TableEmpty
                  colSpan={columns + 1}
                  title={all.length ? "No customers match" : "No customers yet"}
                  detail={all.length ? "Try other filters." : scope.canManageCustomers ? "Add a customer to sell on account." : undefined}
                  action={all.length
                    ? (filtering ? <Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button> : undefined)
                    : scope.canManageCustomers ? <Button size="sm" onClick={() => setAddOpen(true)}><Plus />Add customer</Button> : undefined}
                />
              )}
            </tbody>
          </Table>
        </TableCard>
      </div>
      </DataGate>
      {scope.canManageCustomers && (
        <CustomerFormDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          actorId={userId}
          onSaved={(c) => navigate({ to: "/customers/$customerId", params: { customerId: c.id } })}
        />
      )}
    </AppShell>
  );
}
