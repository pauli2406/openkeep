import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * `soft` / `warn` / `bad` / `outline` are the redesign's four badge tones.
 * The older shadcn names are kept so no call site has to change; they map
 * onto the same four looks.
 */
type BadgeVariant =
  | "soft"
  | "warn"
  | "bad"
  | "outline"
  | "default"
  | "secondary"
  | "destructive"
  | "success"
  | "warning";

function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: BadgeVariant }) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-[var(--r-sm)] border px-[7px] py-px text-[11px] font-semibold leading-[1.45] transition-colors focus:outline-none focus:ring-1 focus:ring-ring",
        {
          "border-transparent bg-primary text-primary-foreground":
            variant === "default",
          "border-transparent bg-accent text-accent-foreground":
            variant === "soft" || variant === "success",
          "border-transparent bg-secondary text-muted-foreground":
            variant === "secondary",
          "border-transparent bg-[var(--ok-amber-soft)] text-[var(--ok-amber)]":
            variant === "warn" || variant === "warning",
          "border-transparent bg-[var(--ok-red-soft)] text-[var(--ok-red)]":
            variant === "bad" || variant === "destructive",
          "border-border text-muted-foreground": variant === "outline",
        },
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
export type { BadgeVariant };
