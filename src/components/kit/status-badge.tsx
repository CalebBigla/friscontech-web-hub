import type { ReactNode } from "react";

export type StatusTone = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

const toneClass: Record<StatusTone, string> = {
  success: "status-success",
  warning: "status-warning",
  danger: "status-danger",
  info: "status-violet",
  brand: "status-brand",
  neutral: "status-muted",
};

/** Coloured status tag with a leading dot. Use the tone for meaning, not decoration. */
export function StatusBadge({ tone, children, className = "" }: { tone: StatusTone; children: ReactNode; className?: string }) {
  return <span className={`status whitespace-nowrap ${toneClass[tone]} ${className}`}>{children}</span>;
}
