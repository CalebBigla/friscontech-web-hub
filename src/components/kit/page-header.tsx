import type { ReactNode } from "react";

/**
 * Top of every page: title (and a short description) on the left, the page's
 * actions on the right. One primary button at most; the rest secondary or ghost.
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
  className = "",
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** A back link above the title on detail pages. */
  back?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between ${className}`}>
      <div className="min-w-0">
        {back && <div className="mb-2 text-caption text-muted-foreground">{back}</div>}
        <h1 className="text-page text-foreground">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-body text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{actions}</div>}
    </header>
  );
}

/** Groups a page's sections with the standard vertical rhythm. */
export function PageSection({ title, description, actions, children, className = "" }: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mt-8 first:mt-0 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            {title && <h2 className="text-section text-foreground">{title}</h2>}
            {description && <p className="mt-0.5 text-caption text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
