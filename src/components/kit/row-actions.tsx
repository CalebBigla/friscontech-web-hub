import type { LucideIcon } from "lucide-react";
import { MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type RowAction = {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  /** Destructive actions are shown last, in red, after a divider. */
  danger?: boolean;
  disabled?: boolean;
  /** Leave the action out (e.g. not allowed for this role or status). */
  hidden?: boolean;
};

/** The "⋯" menu at the right end of a table row or card. Renders nothing when no action applies. */
export function RowActions({ label, actions, align = "end" }: { label: string; actions: RowAction[]; align?: "start" | "end" }) {
  const shown = actions.filter((a) => !a.hidden);
  if (!shown.length) return null;
  const normal = shown.filter((a) => !a.danger);
  const danger = shown.filter((a) => a.danger);
  const item = ({ label: text, icon: Icon, onSelect, disabled, danger: isDanger }: RowAction) => (
    <DropdownMenuItem
      key={text}
      disabled={!!disabled}
      onSelect={() => onSelect()}
      className={isDanger ? "text-destructive focus:bg-danger-soft focus:text-destructive" : ""}
    >
      {Icon && <Icon className="size-4" />}
      {text}
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-48" onClick={(e) => e.stopPropagation()}>
        {normal.map(item)}
        {normal.length > 0 && danger.length > 0 && <DropdownMenuSeparator />}
        {danger.map(item)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
