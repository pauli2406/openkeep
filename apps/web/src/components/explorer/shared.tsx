import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  Check,
  CircleDot,
  FileText,
} from "lucide-react";
import type {
  DashboardDeadlineItem,
  Document,
  MonthlyActivityPoint,
} from "@openkeep/types";
import { cn } from "@/lib/utils";
import { colorForValue, formatCurrency } from "@/lib/explorer";

function formatSignal(signal: string): string {
  return signal
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function ExplorerSectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-[color:var(--explorer-muted)]">
        {eyebrow}
      </p>
      <div className="space-y-1">
        <h1 className="font-[var(--font-display)] text-4xl leading-none text-[color:var(--explorer-ink)] md:text-5xl">
          {title}
        </h1>
        {description ? (
          <p className="max-w-3xl text-sm text-[color:var(--explorer-muted)] md:text-base">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function MetricRibbon({
  items,
}: {
  items: Array<{ label: string; value: string; tone?: "rust" | "cobalt" | "neutral" }>;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className={cn(
            "rounded-[1.75rem] border px-5 py-4",
            item.tone === "rust" &&
              "border-[color:var(--explorer-rust)]/20 bg-[color:var(--explorer-rust-soft)]",
            item.tone === "cobalt" &&
              "border-[color:var(--explorer-cobalt)]/20 bg-[color:var(--explorer-cobalt-soft)]",
            (!item.tone || item.tone === "neutral") &&
              "border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)]",
          )}
        >
          <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[color:var(--explorer-muted)]">
            {item.label}
          </p>
          <p className="mt-3 font-[var(--font-display)] text-4xl text-[color:var(--explorer-ink)]">
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

export function MiniSparkline({
  data,
  className,
}: {
  data: MonthlyActivityPoint[];
  className?: string;
}) {
  if (data.length === 0) {
    return (
      <div
        className={cn(
          "flex h-28 items-center justify-center rounded-[1.5rem] border border-dashed border-[color:var(--explorer-border)] text-sm text-[color:var(--explorer-muted)]",
          className,
        )}
      >
        No monthly activity yet
      </div>
    );
  }

  const width = 320;
  const height = 110;
  const values = data.map((item) => item.count);
  const max = Math.max(...values, 1);
  const points = data.map((item, index) => {
    const x = data.length === 1 ? width / 2 : (index / (data.length - 1)) * width;
    const y = height - (item.count / max) * (height - 16) - 8;
    return `${x},${y}`;
  });
  const areaPoints = [`0,${height}`, ...points, `${width},${height}`].join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn("h-28 w-full overflow-visible", className)}
      aria-label="Monthly activity sparkline"
    >
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(56,84,165,0.35)" />
          <stop offset="100%" stopColor="rgba(56,84,165,0)" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill="url(#spark-fill)" />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="var(--explorer-cobalt)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((point, index) => {
        const [x, y] = point.split(",").map(Number);
        return (
          <circle
            key={`${data[index]?.month}-${point}`}
            cx={x}
            cy={y}
            r="3.5"
            fill="var(--explorer-paper)"
            stroke="var(--explorer-cobalt)"
            strokeWidth="2"
          />
        );
      })}
    </svg>
  );
}

export function DeadlineList({
  items,
}: {
  items: DashboardDeadlineItem[];
}) {
  if (items.length === 0) {
    return (
      <div className="flex min-h-44 items-center justify-center rounded-[1.6rem] border border-dashed border-[color:var(--explorer-border)] text-sm text-[color:var(--explorer-muted)]">
        No deadlines in view
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const tone = item.isOverdue
          ? "border-[#c45134] bg-[#fff0ea]"
          : item.daysUntilDue <= 7
            ? "border-[#cf9f47] bg-[#fff6e5]"
            : "border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)]";

        return (
          <Link
            key={item.documentId}
            to="/documents/$documentId"
            params={{ documentId: item.documentId }}
            className={cn(
              "flex items-center justify-between gap-4 rounded-[1.35rem] border px-4 py-3 transition hover:-translate-y-0.5",
              tone,
            )}
          >
            <div>
              <p className="text-sm font-semibold text-[color:var(--explorer-ink)]">
                {item.title}
              </p>
              <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[color:var(--explorer-muted)]">
                {item.correspondentName ?? "Unfiled"} · due {format(new Date(item.dueDate), "MMM d")}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium text-[color:var(--explorer-ink)]">
                {formatCurrency(item.amount, item.currency ?? "EUR") ?? "Open"}
              </p>
              <p className="text-xs text-[color:var(--explorer-muted)]">
                {item.isOverdue
                  ? `${Math.abs(item.daysUntilDue)}d overdue`
                  : `${item.daysUntilDue}d left`}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export function DocumentRows({
  documents,
  emptyLabel = "No documents found for the current selection.",
  selectedIds = [],
  selectionMode = false,
  onToggleSelect,
}: {
  documents: Document[];
  emptyLabel?: string;
  selectedIds?: string[];
  selectionMode?: boolean;
  onToggleSelect?: (documentId: string) => void;
}) {
  if (documents.length === 0) {
    return (
      <div className="flex min-h-44 items-center justify-center rounded-[1.6rem] border border-dashed border-[color:var(--explorer-border)] text-sm text-[color:var(--explorer-muted)]">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {documents.map((document) => (
        (() => {
          const isSelected = selectedIds.includes(document.id);
          const cardClassName = cn(
            "group relative flex items-start justify-between gap-4 rounded-[1.5rem] border px-4 py-4 transition",
            selectionMode
              ? "border-[color:var(--explorer-border-strong)] bg-[linear-gradient(180deg,rgba(255,251,244,0.96),rgba(248,241,228,0.96))] hover:-translate-y-0.5 hover:border-[color:var(--explorer-cobalt)]/45"
              : "border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] hover:-translate-y-0.5 hover:border-[color:var(--explorer-cobalt)]/40",
            isSelected &&
              "border-[color:var(--explorer-cobalt)] bg-[linear-gradient(180deg,rgba(236,241,255,0.88),rgba(255,251,244,0.98))] shadow-[0_18px_38px_rgba(56,84,165,0.16)]",
          );

          const content = (
            <>
              {selectionMode ? (
                <button
                  type="button"
                  aria-label={isSelected ? `Deselect ${document.title}` : `Select ${document.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleSelect?.(document.id);
                  }}
                  className={cn(
                    "absolute left-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border transition",
                    isSelected
                      ? "border-[color:var(--explorer-cobalt)] bg-[color:var(--explorer-cobalt)] text-white shadow-[0_10px_22px_rgba(56,84,165,0.25)]"
                      : "border-[color:var(--explorer-border-strong)] bg-white/85 text-[color:var(--explorer-muted)] hover:border-[color:var(--explorer-cobalt)] hover:text-[color:var(--explorer-cobalt)]",
                  )}
                >
                  <Check className="h-4 w-4" />
                </button>
              ) : null}
              <div className="min-w-0 space-y-2">
            <div
              className={cn(
                "flex items-center gap-2 text-[0.72rem] uppercase tracking-[0.2em] text-[color:var(--explorer-muted)]",
                selectionMode && "pl-11",
              )}
            >
              <CircleDot
                className="h-3.5 w-3.5"
                style={{
                  color: colorForValue(document.correspondent?.name ?? document.status),
                }}
              />
              {document.documentType?.name ?? "Document"}
            </div>
            <div className="space-y-1">
              <p className="text-base font-semibold text-[color:var(--explorer-ink)]">
                {document.title}
              </p>
              <div className="flex flex-wrap items-center gap-4 text-sm text-[color:var(--explorer-muted)]">
                <span className="inline-flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  {document.correspondent?.name ?? "Unfiled"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {format(
                    new Date(document.issueDate ?? document.createdAt),
                    "MMM d, yyyy",
                  )}
                </span>
                {document.amount !== null ? (
                  <span>{formatCurrency(document.amount, document.currency ?? "EUR")}</span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {document.reviewReasons.includes("classification_ambiguous") ? (
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-amber-800">
                    Classification Ambiguous
                  </span>
                ) : null}
                {document.reviewReasons.includes("correspondent_unresolved") ? (
                  <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-rose-800">
                    Correspondent Unresolved
                  </span>
                ) : null}
                {document.metadata.intelligence?.routing?.documentType ? (
                  <span className="rounded-full bg-[color:var(--explorer-cobalt-soft)] px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--explorer-cobalt)]">
                    {document.metadata.intelligence.routing.documentType}
                  </span>
                ) : null}
                {(document.metadata.intelligence?.validation?.warnings ?? []).slice(0, 2).map((warning) => (
                  <span
                    key={warning}
                    className="rounded-full border border-[color:var(--explorer-border)] bg-white/80 px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[color:var(--explorer-muted)]"
                  >
                    {formatSignal(warning)}
                  </span>
                ))}
              </div>
            </div>
            {document.snippets && document.snippets.length > 0 ? (
              <p
                className="line-clamp-2 text-sm text-[color:var(--explorer-muted)]"
                dangerouslySetInnerHTML={{ __html: document.snippets[0] ?? "" }}
              />
            ) : document.metadata.intelligence?.summary?.value ? (
              <p className="line-clamp-2 text-sm text-[color:var(--explorer-muted)]">
                {document.metadata.intelligence.summary.value}
              </p>
            ) : null}
          </div>
              <div className="mt-1 flex shrink-0 items-center gap-2">
                {selectionMode ? (
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em]",
                      isSelected
                        ? "bg-[color:var(--explorer-cobalt)] text-white"
                        : "bg-white/80 text-[color:var(--explorer-muted)]",
                    )}
                  >
                    {isSelected ? "Selected" : "Select"}
                  </span>
                ) : null}
                <ArrowRight className="h-4 w-4 text-[color:var(--explorer-muted)] transition group-hover:translate-x-0.5" />
              </div>
            </>
          );

          if (selectionMode) {
            return (
              <div
                key={document.id}
                role="button"
                tabIndex={0}
                onClick={() => onToggleSelect?.(document.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onToggleSelect?.(document.id);
                  }
                }}
                className={cardClassName}
              >
                {content}
              </div>
            );
          }

          return (
            <Link
              key={document.id}
              to="/documents/$documentId"
              params={{ documentId: document.id }}
              className={cardClassName}
            >
              {content}
            </Link>
          );
        })()
      ))}
    </div>
  );
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-[1.8rem] border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)]">
      <div className="h-9 w-9 animate-spin rounded-full border-2 border-[color:var(--explorer-border-strong)] border-t-[color:var(--explorer-cobalt)]" />
      <p className="text-sm text-[color:var(--explorer-muted)]">{label}</p>
    </div>
  );
}

export function ErrorBlock({
  label,
  action,
}: {
  label: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-[1.8rem] border border-[#d8b7a8] bg-[#fff5f0] text-center">
      <AlertCircle className="h-8 w-8 text-[color:var(--explorer-rust)]" />
      <p className="max-w-md text-sm text-[color:var(--explorer-muted)]">{label}</p>
      {action}
    </div>
  );
}
