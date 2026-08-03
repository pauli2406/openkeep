import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Filter pill. The one place the design allows a 999px radius.
 * `active` is the selected state used by the filter bars.
 */
const Chip = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }
>(({ className, active = false, type = "button", ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    data-active={active ? "true" : undefined}
    className={cn(
      "inline-flex items-center gap-1.5 whitespace-nowrap rounded-[var(--r-pill)] border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-[13px] [&_svg]:shrink-0",
      active
        ? "border-transparent bg-primary text-primary-foreground"
        : "border-border bg-card text-foreground hover:bg-secondary",
      className,
    )}
    {...props}
  />
));
Chip.displayName = "Chip";

export { Chip };
