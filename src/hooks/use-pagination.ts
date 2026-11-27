import { useEffect, useState } from "react";

/**
 * Client-side paging for a list that is already filtered. Goes back to page 1
 * when the list's length changes (a new filter), and never points past the end.
 */
export function usePagination<T>(items: readonly T[], pageSize = 25) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  useEffect(() => setPage(1), [items.length]);
  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;
  return {
    page: current,
    setPage,
    pageCount,
    pageSize,
    total: items.length,
    pageItems: items.slice(start, start + pageSize),
  };
}
