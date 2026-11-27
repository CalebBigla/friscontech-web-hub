import type { KeyboardEvent, ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";

/**
 * Table building blocks. Every table uses the same shell:
 *   <TableCard toolbar={…} footer={<Pagination … />}>
 *     <Table><THead><tr><Th>…</Th><Th align="right">…</Th></tr></THead>
 *     <tbody><Tr onClick={…}><Td>…</Td><Td numeric>…</Td></Tr></tbody></Table>
 *   </TableCard>
 * Text is left-aligned, numbers right-aligned; the header sticks while the
 * table scrolls; narrow screens scroll sideways instead of squashing columns.
 */
export function TableCard({ toolbar, footer, children, className = "", scroll = true }: {
  toolbar?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Long tables scroll inside the card so the header stays visible. */
  scroll?: boolean;
}) {
  return (
    <div className={`overflow-hidden rounded-xl border border-border bg-card shadow-panel ${className}`}>
      {toolbar && <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">{toolbar}</div>}
      <div className={`overflow-x-auto ${scroll ? "max-h-[min(72vh,52rem)] overflow-y-auto" : ""}`}>{children}</div>
      {footer}
    </div>
  );
}

export function Table({ children, minWidth = 640, className = "" }: { children: ReactNode; minWidth?: number; className?: string }) {
  return (
    <table className={`w-full border-separate border-spacing-0 text-left text-table ${className}`} style={{ minWidth }}>
      {children}
    </table>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="sticky top-0 z-10">{children}</thead>;
}

type Align = "left" | "right" | "center";
const alignClass: Record<Align, string> = { left: "text-left", right: "text-right", center: "text-center" };

export function Th({ children, align = "left", className = "", srOnly = false }: { children?: ReactNode; align?: Align; className?: string; srOnly?: boolean }) {
  return (
    <th scope="col" className={`border-b border-border px-4 py-2.5 ${alignClass[align]} ${className}`}>
      {srOnly ? <span className="sr-only">{children}</span> : children}
    </th>
  );
}

/** A row; with onClick the whole row opens the record (also with Enter). */
export function Tr({ children, onClick, className = "", selected = false }: { children: ReactNode; onClick?: (() => void) | undefined; className?: string; selected?: boolean }) {
  const onKeyDown = onClick
    ? (e: KeyboardEvent<HTMLTableRowElement>) => {
        if (e.key === "Enter" && e.target === e.currentTarget) onClick();
      }
    : undefined;
  return (
    <tr
      onClick={onClick}
      onKeyDown={onKeyDown}
      tabIndex={onClick ? 0 : undefined}
      className={`group [&>td]:border-b [&>td]:border-border last:[&>td]:border-b-0 ${onClick ? "cursor-pointer focus-visible:outline-none focus-visible:[&>td]:bg-muted" : ""} ${selected ? "[&>td]:bg-brand-soft" : ""} ${className}`}
    >
      {children}
    </tr>
  );
}

/** Cells stay on one line (narrow screens scroll sideways); pass `wrap` for long text. */
export function Td({ children, align, numeric = false, className = "", muted = false, wrap = false }: { children?: ReactNode; align?: Align; numeric?: boolean; className?: string; muted?: boolean; wrap?: boolean }) {
  const a = align ?? (numeric ? "right" : "left");
  return (
    <td className={`px-4 py-3 align-middle ${alignClass[a]} ${numeric ? "tabular-nums" : ""} ${wrap ? "" : "whitespace-nowrap"} ${muted ? "text-muted-foreground" : ""} ${className}`}>
      {children}
    </td>
  );
}

/** The last cell of a row: holds the row's "⋯" menu, and doesn't open the row. */
export function TdActions({ children }: { children: ReactNode }) {
  return (
    <td className="w-12 px-2 py-2 text-right align-middle" onClick={(e) => e.stopPropagation()}>
      {children}
    </td>
  );
}

export function TableEmpty({ colSpan, title, detail, action }: { colSpan: number; title: string; detail?: string | undefined; action?: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan}>
        <EmptyState title={title} detail={detail} action={action} />
      </td>
    </tr>
  );
}

/** Placeholder rows while a table loads. */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div role="status" aria-label="Loading" className="overflow-hidden rounded-xl border border-border bg-card shadow-panel">
      <div className="h-10 border-b border-border bg-muted" />
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-6 border-b border-border px-4 py-3.5 last:border-0">
          {Array.from({ length: cols }, (_, c) => (
            <div key={c} className={`h-3 animate-pulse rounded bg-muted ${c === 0 ? "w-40" : "flex-1"}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** "1–25 of 120" with Previous / Next, under a table. Hidden when everything fits on one page. */
export function Pagination({ page, pageCount, pageSize, total, onPage }: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-caption text-muted-foreground">
      <span className="tabular-nums">{formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}</span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft /><span className="hidden sm:inline">Previous</span>
        </Button>
        <span className="px-1 tabular-nums">{page} / {pageCount}</span>
        <Button variant="ghost" size="sm" disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="Next page">
          <span className="hidden sm:inline">Next</span><ChevronRight />
        </Button>
      </div>
    </nav>
  );
}
