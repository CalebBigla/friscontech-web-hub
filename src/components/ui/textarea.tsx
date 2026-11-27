import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[72px] w-full rounded-md border border-input bg-card px-3 py-2 text-base shadow-sm transition-[border-color,box-shadow] placeholder:text-muted-foreground hover:border-foreground/25 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 aria-[invalid=true]:border-destructive disabled:cursor-not-allowed disabled:opacity-50 md:text-body",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
