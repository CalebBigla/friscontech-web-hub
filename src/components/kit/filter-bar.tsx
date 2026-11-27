import { useId, useState, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";

import { SearchBox } from "@/components/shared";
import { Button } from "@/components/ui/button";

/**
 * The one place for a page's search, filters and sort, above the content.
 * Shows "Clear filters" while any filter differs from its default. On phones the
 * filters fold behind a "Filters" button so the content starts higher up.
 */
export function FilterBar({
  search,
  children,
  onClear,
  active = false,
  end,
  className = "",
}: {
  search?: { value: string; onChange: (value: string) => void; placeholder: string } | undefined;
  /** Filter controls (FilterSelect, PeriodFilter, …). */
  children?: ReactNode;
  /** Resets every filter on the page; the button shows while `active`. */
  onClear?: (() => void) | undefined;
  active?: boolean;
  /** Controls pinned to the right, such as sort or view options. */
  end?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div role="group" aria-label="Filters" className={`mb-4 flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center ${className}`}>
      {(search || children) && (
        <div className="flex gap-2 lg:contents">
          {search && <SearchBox value={search.value} onChange={search.onChange} placeholder={search.placeholder} className="w-full min-w-0 flex-1 lg:w-64 lg:flex-none" />}
          {children && (
            <Button
              variant="secondary"
              className={`sm:hidden ${search ? "" : "w-full"}`}
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen((o) => !o)}
            >
              <SlidersHorizontal />
              Filters
              {active && <span className="size-1.5 rounded-full bg-primary" aria-label="(active)" />}
            </Button>
          )}
        </div>
      )}
      {children && (
        <div id={panelId} className={`${open ? "grid" : "hidden"} grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center`}>
          {children}
        </div>
      )}
      {onClear && active && (
        <Button variant="ghost" size="sm" onClick={onClear} className="self-start lg:self-auto">
          <X />Clear filters
        </Button>
      )}
      {end && <div className="flex flex-wrap items-center gap-2 lg:ml-auto">{end}</div>}
    </div>
  );
}
