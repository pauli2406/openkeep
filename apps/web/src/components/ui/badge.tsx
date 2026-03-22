import * as React from "react";
import { cn } from "@/lib/utils";

function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning";
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        {
          "border-transparent bg-primary text-primary-foreground shadow":
            variant === "default",
          "border-transparent bg-secondary text-secondary-foreground":
            variant === "secondary",
          "border-transparent bg-destructive text-white":
            variant === "destructive",
          "text-foreground": variant === "outline",
          "border-transparent bg-emerald-100 text-emerald-800":
            variant === "success",
          "border-transparent bg-amber-100 text-amber-800":
            variant === "warning",
        },
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
