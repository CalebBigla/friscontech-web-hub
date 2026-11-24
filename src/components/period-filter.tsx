import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterSelect, ALL } from "@/components/shared";
import { getPeriodRange, type DateRange, type PeriodKey } from "@/lib/dates";
import { formatDate, formatShortDate } from "@/lib/format";
import type { Db } from "@/data/mock-db";
import type { AccessScope } from "@/lib/session";
import { getCustomersForScope } from "@/lib/customer-calculations";

/** The periods every screen offers: one day, the last 7 days, this month, or chosen dates. */
export type FilterPeriod = Extract<PeriodKey, "today" | "week" | "month" | "custom">;
export type PeriodState = { period: FilterPeriod; from?: string | undefined; to?: string | undefined };

const choices: { key: FilterPeriod; label: string; hint: string }[] = [
  { key: "today", label: "Day", hint: "Today" },
  { key: "week", label: "Week", hint: "The last 7 days" },
  { key: "month", label: "Month", hint: "This month so far" },
  { key: "custom", label: "Custom", hint: "Choose dates" },
];

export function periodRange(state: PeriodState, today: string): DateRange {
  return getPeriodRange(state.period, today, { from: state.from, to: state.to });
}
export function describeRange(range: DateRange) {
  return range.from === range.to ? formatDate(range.from) : `${formatShortDate(range.from)} – ${formatDate(range.to)}`;
}

/** Local period state for screens that don't keep filters in the URL. */
export function usePeriodFilter(today: string, initial: FilterPeriod = "month") {
  const [state, setState] = useState<PeriodState>({ period: initial });
  const range = periodRange(state, today);
  return { state, setState, range, label: describeRange(range) };
}

/**
 * Day · Week · Month · Custom. Choosing Custom shows From/To dates, starting from
 * the range that was showing. Every change applies straight away.
 */
export function PeriodFilter({
  value,
  onChange,
  today,
  className = "",
}: {
  value: PeriodState;
  onChange: (next: PeriodState) => void;
  today: string;
  className?: string;
}) {
  const range = periodRange(value, today);
  return (
    <div className={`flex flex-col gap-2 sm:flex-row sm:items-center ${className}`}>
      <div role="group" aria-label="Period" className="grid grid-cols-4 rounded-md border border-border bg-card p-1">
        {choices.map((c) => (
          <Button
            key={c.key}
            type="button"
            size="sm"
            title={c.hint}
            aria-pressed={value.period === c.key}
            variant={value.period === c.key ? "default" : "ghost"}
            className="h-7 px-3 text-xs"
            onClick={() =>
              onChange(c.key === "custom" ? { period: "custom", from: range.from, to: range.to } : { period: c.key })
            }
          >
            {c.label}
          </Button>
        ))}
      </div>
      {value.period === "custom" && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label="From date"
            max={today}
            value={range.from}
            onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
            className="h-9 bg-card text-xs"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            aria-label="To date"
            max={today}
            value={range.to}
            onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
            className="h-9 bg-card text-xs"
          />
        </div>
      )}
    </div>
  );
}

/** Customers the caller can see; "all" = no customer filter. */
export function CustomerFilter({
  db,
  scope,
  value,
  onChange,
  className = "w-full sm:w-48",
  allLabel = "All customers",
}: {
  db: Db;
  scope: AccessScope;
  value: string;
  onChange: (v: string) => void;
  className?: string;
  allLabel?: string;
}) {
  return (
    <FilterSelect
      label="Customer"
      value={value}
      onChange={onChange}
      className={className}
      options={[{ value: ALL, label: allLabel }, ...getCustomersForScope(db, scope).map((c) => ({ value: c.id, label: c.name }))]}
    />
  );
}

/** Cash, transfer or both. */
export function MethodFilter({ value, onChange, className = "w-full sm:w-36" }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <FilterSelect
      label="Payment method"
      value={value}
      onChange={onChange}
      className={className}
      options={[
        { value: ALL, label: "Cash & transfer" },
        { value: "cash", label: "Cash" },
        { value: "transfer", label: "Transfer" },
      ]}
    />
  );
}
