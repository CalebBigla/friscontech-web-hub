import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { FieldError } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fieldErrorsFrom } from "@/lib/supabase-helpers";

/**
 * Asks before anything destructive or hard to undo (void, cancel, decline,
 * deactivate). Optionally asks for a reason. Shows the server's error and stays
 * open if the action fails; closes on success.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  reason,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** Extra content between the description and the buttons (a summary, a warning). */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  /** Ask for a reason; it is passed to onConfirm. */
  reason?: { label: string; placeholder?: string; required?: boolean } | undefined;
  onConfirm: (reason: string) => unknown;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setText("");
      setError("");
      setBusy(false);
    }
  }, [open]);

  async function confirm() {
    if (reason?.required && !text.trim()) {
      setError(`Enter a ${reason.label.toLowerCase()}`);
      return;
    }
    setError("");
    setBusy(true);
    try {
      await onConfirm(text.trim());
      onOpenChange(false);
    } catch (failure) {
      const errors = fieldErrorsFrom(failure, ["reason"] as const);
      setError(errors.reason ?? errors.form ?? (failure instanceof Error ? failure.message : "Something went wrong"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        {reason && (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-reason">
              {reason.label}{reason.required && <span className="text-destructive"> *</span>}
            </Label>
            <Textarea id="confirm-reason" rows={2} value={text} autoFocus placeholder={reason.placeholder}
              onChange={(e) => setText(e.target.value)} aria-invalid={!!error} />
          </div>
        )}
        <FieldError message={error} />
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>{cancelLabel}</Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} disabled={busy} onClick={() => void confirm()}>
            {busy && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
