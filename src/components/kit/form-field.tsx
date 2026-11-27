import type { ReactNode } from "react";

import { FieldError } from "@/components/shared";
import { Label } from "@/components/ui/label";

/** Label above the control, required mark, then a hint or the inline error. */
export function FormField({ label, htmlFor, required = false, hint, error, children, className = "" }: {
  label: ReactNode;
  htmlFor?: string | undefined;
  required?: boolean;
  hint?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 space-y-1.5 ${className}`}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-destructive" aria-hidden> *</span>}
        {required && <span className="sr-only"> (required)</span>}
      </Label>
      {children}
      {error ? <FieldError message={error} /> : hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** A titled group of related fields in a form; fields sit in a responsive grid. */
export function FormSection({ title, description, children, columns = 2, className = "" }: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  const grid = columns === 1 ? "grid-cols-1" : columns === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2";
  return (
    <fieldset className={`min-w-0 space-y-3 ${className}`}>
      {title && (
        <legend className="mb-1">
          <span className="text-label font-semibold text-foreground">{title}</span>
          {description && <span className="mt-0.5 block text-caption text-muted-foreground">{description}</span>}
        </legend>
      )}
      <div className={`grid gap-4 ${grid}`}>{children}</div>
    </fieldset>
  );
}
