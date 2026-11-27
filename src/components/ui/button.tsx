import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The app's only button. Four variants, two sizes:
 *   primary    the main action (one per page or section)
 *   secondary  supporting actions
 *   ghost      minor actions, toolbar icons
 *   danger     destructive actions (void, delete, deactivate)
 *   sm (32px) · md (36px), plus square icon sizes.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        secondary: "border border-border bg-card text-foreground shadow-sm hover:bg-muted",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        danger: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        // Older names, kept so nothing breaks: default = primary, outline/soft = secondary.
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        outline: "border border-border bg-card text-foreground shadow-sm hover:bg-muted",
        soft: "border border-border bg-card text-foreground shadow-sm hover:bg-muted",
      },
      size: {
        sm: "h-8 px-3 text-label [&_svg]:size-3.5",
        md: "h-9 px-4 text-body [&_svg]:size-4",
        icon: "size-9 p-0 [&_svg]:size-4",
        "icon-sm": "size-8 p-0 [&_svg]:size-4",
        default: "h-9 px-4 text-body [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariantProps["variant"] | undefined;
  size?: ButtonVariantProps["size"] | undefined;
  asChild?: boolean;
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Component = asChild ? Slot : "button";
    return <Component ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
