import { cn } from "@/lib/utils";

/** The mark and wordmark. `currentColor` carries the wordmark onto any surface. */
export function OpenKeepLogo({
  className,
  markClassName,
  wordmarkClassName,
}: {
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <img
        src="/brand/logo-mark.svg"
        alt=""
        aria-hidden="true"
        className={cn("size-8 shrink-0 rounded-[10px]", markClassName)}
      />
      <span className={cn("text-base font-semibold tracking-tight", wordmarkClassName)}>
        OpenKeep
      </span>
    </span>
  );
}
