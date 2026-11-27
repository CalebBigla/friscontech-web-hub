import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge with the app's type scale (see styles.css), so `text-label`
 * is treated as a font size and is not dropped next to a colour like
 * `text-foreground`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: { text: ["page", "section", "body", "label", "table", "caption", "metric"] },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
