import type { ReactNode } from "react";
import { X } from "lucide-react";

import { SearchBox } from "@/components/shared";
import { Button } from "@/components/ui/button";

/**
 * The one place for a page's search, filters and sort, above the content.
 * Shows "Clear filters" while any filter differs from its default.
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
  return (
    <div role="group" aria-label="Filters" className={`mb-4 flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center ${className}`}>
      {search && <SearchBox value={search.value} onChange={search.onChange} placeholder={search.placeholder} className="w-full lg:w-64" />}
      {children && <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:flex sm:flex-wrap sm:items-center">{children}</div>}
      {onClear && active && (
        <Button variant="ghost" size="sm" onClick={onClear} className="self-start lg:self-auto">
          <X />Clear filters
        </Button>
      )}
      {end && <div className="flex flex-wrap items-center gap-2 lg:ml-auto">{end}</div>}
    </div>
  );
}
