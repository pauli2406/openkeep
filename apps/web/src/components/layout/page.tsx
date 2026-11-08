import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The scrolling content column every standard screen sits in. Master-detail
 * screens that own their full height (chat, document detail) skip this.
 */
export function Page({
  className,
  width = "default",
  ...props
}: ComponentProps<"div"> & { width?: "default" | "wide" | "narrow" }) {
  return (
    <div
      data-slot="page"
      className={cn(
        "mx-auto flex w-full flex-col gap-6 px-4 py-6 md:px-8 md:py-8",
        width === "default" && "max-w-6xl",
        width === "wide" && "max-w-[1600px]",
        width === "narrow" && "max-w-3xl",
        className,
      )}
      {...props}
    />
  );
}

export function PageHeader({
  title,
  description,
  icon,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      data-slot="page-header"
      className={cn("flex flex-wrap items-start justify-between gap-x-6 gap-y-3", className)}
    >
      <div className="flex min-w-0 items-center gap-3.5">
        {icon ? <IconTile size="lg">{icon}</IconTile> : null}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** A soft blue square that holds an icon: section heads, stats, empty states. */
export function IconTile({
  className,
  size = "default",
  tone = "soft",
  ...props
}: ComponentProps<"span"> & {
  size?: "sm" | "default" | "lg";
  tone?: "soft" | "solid";
}) {
  return (
    <span
      data-slot="icon-tile"
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        size === "sm" && "size-7 rounded-md [&_svg]:size-3.5",
        size === "default" && "size-9 rounded-lg [&_svg]:size-4.5",
        size === "lg" && "size-11 rounded-xl [&_svg]:size-5.5",
        tone === "soft" && "bg-brand-soft text-brand-soft-foreground",
        tone === "solid" && "bg-gradient-brand text-primary-foreground shadow-action",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The signature surface: a full-bleed blue gradient card with a soft highlight.
 * Use it at most once on a screen, for the thing that screen is about.
 */
export function GradientPanel({ className, children, ...props }: ComponentProps<"section">) {
  return (
    <section
      data-slot="gradient-panel"
      className={cn(
        "relative isolate overflow-hidden rounded-2xl bg-gradient-brand text-primary-foreground shadow-raised",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -right-16 -z-10 size-72 rounded-full bg-white/12 blur-3xl"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 left-1/4 -z-10 size-72 rounded-full bg-white/8 blur-3xl"
      />
      {children}
    </section>
  );
}

/** Small round category marker next to a document. */
export function CategoryDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color }}
    />
  );
}
