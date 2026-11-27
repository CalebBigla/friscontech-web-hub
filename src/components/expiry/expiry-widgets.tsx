import { CalendarClock } from "lucide-react";

import { EmptyState, Panel } from "@/components/shared";
import type { Db } from "@/data/mock-db";
import { daysToExpiry, expiryTier, expiryTierLabel, getExpirySummary, nearestExpiry } from "@/lib/expiry-calculations";
import { formatDate, formatNumber } from "@/lib/format";

const tierTone = { expired: "status-danger", "1m": "status-danger", "3m": "status-warning", "6m": "status-brand" } as const;

export function ExpiryBadge({ db, expiryDate }: { db: Db; expiryDate: string | null | undefined }) {
  if (!expiryDate) return <span className="text-caption text-muted-foreground">—</span>;
  const tier = expiryTier(db, expiryDate);
  const days = daysToExpiry(db, expiryDate);
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className="text-caption">{formatDate(expiryDate)}</span>
      {tier ? <span className={`status whitespace-nowrap ${tierTone[tier]}`}>{tier === "expired" ? "Expired" : `${expiryTierLabel[tier]} · ${days}d`}</span> : <span className="status status-success">OK</span>}
    </span>
  );
}

/** Nearest live batch expiry for a product (optionally in one branch). */
export function NearestExpiryBadge({ db, productId, branchIds, branchId }: { db: Db; productId: string; branchIds: string[] | null; branchId?: string }) {
  return <ExpiryBadge db={db} expiryDate={nearestExpiry(db, productId, branchIds, branchId)?.expiryDate} />;
}

export function ExpiringSoonPanel({ db, branchIds, className = "mt-4" }: { db: Db; branchIds: string[] | null; className?: string }) {
  const s = getExpirySummary(db, branchIds);
  const tiles = [
    { label: "Expired", value: s.expired, tone: "text-destructive" },
    { label: "≤ 1 month", value: s.oneMonth, tone: "text-destructive" },
    { label: "≤ 3 months", value: s.threeMonths, tone: "text-warning" },
    { label: db.tenant.expiryAlertMonths > 3 ? `3–${db.tenant.expiryAlertMonths} months` : "Later", value: s.sixMonths, tone: "text-foreground" },
  ];
  return (
    <Panel title="Expiring soon" subtitle={`Next ${db.tenant.expiryAlertMonths} months and expired`} className={className} action={<CalendarClock className="size-4 text-muted-foreground" />}>
      <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
        {tiles.map((t, index) => (
          <div key={index} className="bg-card px-5 py-4"><dt className="text-caption text-muted-foreground">{t.label}</dt><dd className={`mt-1 text-lg font-semibold tabular-nums ${t.value ? t.tone : "text-foreground"}`}>{formatNumber(t.value)}</dd></div>
        ))}
      </dl>
      {s.alerts.length ? (
        <ul className="divide-y divide-border border-t border-border">
          {s.alerts.slice(0, 6).map((a) => (
            <li key={a.batch.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0"><p className="truncate text-label font-medium">{a.productName}</p><p className="truncate text-caption text-muted-foreground">{a.branchName} · batch {a.batch.batchNumber} · {formatNumber(a.batch.quantityRemaining)} left</p></div>
              <ExpiryBadge db={db} expiryDate={a.batch.expiryDate} />
            </li>
          ))}
        </ul>
      ) : <EmptyState title="Nothing expiring soon" detail="No batches fall inside the alert window." />}
    </Panel>
  );
}
