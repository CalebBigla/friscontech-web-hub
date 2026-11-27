import type { ReactNode } from "react";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const modalWidth = { sm: "sm:max-w-md", md: "sm:max-w-lg", lg: "sm:max-w-2xl" } as const;

/**
 * Create / edit forms and short flows. The body scrolls; the header and the
 * Save / Cancel footer stay in place.
 */
export function Modal({ open, onOpenChange, title, description, children, footer, size = "md" }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof modalWidth;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`flex max-h-[90vh] flex-col gap-0 p-0 ${modalWidth[size]}`}>
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <DialogFooter className="border-t border-border px-6 py-4">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

/** Details of one record beside the list, without leaving the page. Full screen on phones. */
export function SidePanel({ open, onOpenChange, title, description, children, footer, width = "md" }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: "md" | "lg";
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={`flex w-full flex-col gap-0 p-0 ${width === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg"}`}>
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-2 border-t border-border px-6 py-4 sm:flex-row sm:justify-end">{footer}</div>}
      </SheetContent>
    </Sheet>
  );
}
