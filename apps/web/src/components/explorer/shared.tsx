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
import { DocumentProcessingIndicator } from "@/components/document-processing-indicator";
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
      <p className="ok-eyebrow text-[color:var(--explorer-muted)]">
        {eyebrow}
      </p>
      <div className="space-y-1">
        <h1 className="ok-page-title text-[color:var(--explorer-ink)]">
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
            "rounded-[var(--r-lg)] border px-5 py-4",
            item.tone === "rust" &&
              "border-[color:var(--ok-amber)]/20 bg-[color:var(--ok-amber-soft)]",
            item.tone === "cobalt" &&
              "border-[color:var(--ok-accent)]/20 bg-[color:var(--ok-accent-soft)]",
            (!item.tone || item.tone === "neutral") &&
              "border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)]",
          )}
        >
          <p className="ok-eyebrow text-[color:var(--explorer-muted)]">
            {item.label}
          </p>
          <p className="mt-3 ok-num text-xl text-[color:var(--explorer-ink)]">
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
          "flex h-28 items-center justify-center rounded-[var(--r-lg)] border border-dashed border-[color:var(--explorer-border)] text-sm text-[color:var(--explorer-muted)]",
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
        stroke="var(--ok-accent)"
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
            fill="var(--ok-app)"
            stroke="var(--ok-accent)"
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
      <div className="flex min-h-44 items-center justify-center rounded-[var(--r-lg)] border border-dashed border-[color:var(--explorer-border)] text-sm text-[color:var(--explorer-muted)]">
        No deadlines in view
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const tone = item.isOverdue
          ? "border-[var(--ok-red)]/40 bg-[var(--ok-red-soft)]"
          : item.daysUntilDue <= 7
            ? "border-[var(--ok-amber)]/40 bg-[var(--ok-amber-soft)]"
            : "border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)]";

        return (
          <Link
            key={item.documentId}
            to="/documents/$documentId"
            params={{ documentId: item.documentId }}
            className={cn(
              "flex items-center justify-between gap-4 rounded-[var(--r-lg)] border px-4 py-3 transition hover:-translate-y-0.5",
              tone,
            )}
          >
            <div>
              <p className="text-sm font-semibold text-[color:var(--explorer-ink)]">
                {item.title}
              </p>
              <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[color:var(--explorer-muted)]">
                {item.correspondentName ?? "Unfiled"} · due <span className="ok-num">{format(new Date(item.dueDate), "MMM d")}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium text-[color:var(--explorer-ink)]">
                <span className="ok-num">{formatCurrency(item.amount, item.currency ?? "EUR") ?? "Open"}</span>
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
      <div className="flex min-h-44 items-center justify-center rounded-[var(--r-lg)] border border-dashed border-[color:var(--explorer-border)] text-sm text-[color:var(--explorer-muted)]">
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
            "group relative flex items-start justify-between gap-4 rounded-[var(--r-lg)] border px-4 py-4 transition",
            selectionMode
              ? "border-[color:var(--explorer-border-strong)] bg-[linear-gradient(180deg,rgba(255,251,244,0.96),rgba(248,241,228,0.96))] hover:-translate-y-0.5 hover:border-[color:var(--ok-accent)]/45"
              : "border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] hover:-translate-y-0.5 hover:border-[color:var(--ok-accent)]/40",
            isSelected &&
              "border-[color:var(--ok-accent)] bg-[linear-gradient(180deg,rgba(236,241,255,0.88),rgba(255,251,244,0.98))] shadow-[0_18px_38px_rgba(56,84,165,0.16)]",
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
                      ? "border-[color:var(--ok-accent)] bg-[color:var(--ok-accent)] text-[var(--ok-accent-fill-ink)] shadow-[0_10px_22px_rgba(56,84,165,0.25)]"
                      : "border-[color:var(--explorer-border-strong)] bg-card text-[color:var(--explorer-muted)] hover:border-[color:var(--ok-accent)] hover:text-[color:var(--ok-accent)]",
                  )}
                >
                  <Check className="h-4 w-4" />
                </button>
              ) : null}
              <div className="min-w-0 space-y-2">
            <div
              className={cn(
                "flex items-center gap-2 ok-eyebrow text-[color:var(--explorer-muted)]",
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
                <DocumentProcessingIndicator document={document} />
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
                  <span className="ok-num">{formatCurrency(document.amount, document.currency ?? "EUR")}</span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {document.reviewReasons.includes("classification_ambiguous") ? (
                  <span className="rounded-full bg-[var(--ok-amber-soft)] px-2.5 py-1 ok-eyebrow text-[var(--ok-amber)]">
                    Classification Ambiguous
                  </span>
                ) : null}
                {document.reviewReasons.includes("correspondent_unresolved") ? (
                  <span className="rounded-full bg-[var(--ok-red-soft)] px-2.5 py-1 ok-eyebrow text-[var(--ok-red)]">
                    Correspondent Unresolved
                  </span>
                ) : null}
                {document.metadata.intelligence?.routing?.documentType ? (
                  <span className="rounded-full bg-[color:var(--ok-accent-soft)] px-2.5 py-1 ok-eyebrow text-[color:var(--ok-accent)]">
                    {document.metadata.intelligence.routing.documentType}
                  </span>
                ) : null}
                {(document.metadata.intelligence?.validation?.warnings ?? []).slice(0, 2).map((warning) => (
                  <span
                    key={warning}
                    className="rounded-full border border-[color:var(--explorer-border)] bg-card px-2.5 py-1 ok-eyebrow text-[color:var(--explorer-muted)]"
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
                      "rounded-full px-2.5 py-1 ok-eyebrow",
                      isSelected
                        ? "bg-[color:var(--ok-accent)] text-[var(--ok-accent-fill-ink)]"
                        : "bg-card text-[color:var(--explorer-muted)]",
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
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-[var(--r-lg)] border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)]">
      <div className="h-9 w-9 animate-spin rounded-full border-2 border-[color:var(--explorer-border-strong)] border-t-[color:var(--ok-accent)]" />
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
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-[var(--r-lg)] border border-[var(--ok-red)]/30 bg-[var(--ok-red-soft)] text-center">
      <AlertCircle className="h-8 w-8 text-[color:var(--ok-amber)]" />
      <p className="max-w-md text-sm text-[color:var(--explorer-muted)]">{label}</p>
      {action}
    </div>
  );
}
