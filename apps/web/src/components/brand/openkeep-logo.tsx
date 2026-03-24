import { cn } from "@/lib/utils";

type OpenKeepLogoProps = {
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
  stacked?: boolean;
};

export function OpenKeepLogo({
  className,
  markClassName,
  wordmarkClassName,
  stacked = false,
}: OpenKeepLogoProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center text-[color:var(--explorer-ink)]",
        stacked ? "flex-col gap-3" : "gap-3",
        className,
      )}
    >
      <img
        src="/brand/logo-mark.svg"
        alt=""
        aria-hidden="true"
        className={cn("h-8 w-8 shrink-0", markClassName)}
      />
      <img
        src="/brand/logo-wordmark.svg"
        alt="OpenKeep"
        className={cn("h-7 w-auto", wordmarkClassName)}
      />
    </span>
  );
}
