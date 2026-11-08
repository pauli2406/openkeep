import { useId, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { AlertCircle, ArrowRight, Check, FileSearch } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  DashboardDeadlineItem,
  Document,
  MonthlyActivityPoint,
} from "@openkeep/types";
import { DocumentProcessingIndicator } from "@/components/document-processing-indicator";
import { CategoryDot } from "@/components/layout/page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { colorForValue, formatCurrency } from "@/lib/explorer";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function formatSignal(signal: string): string {
  return signal
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const STATUS_LABELS: Record<string, TranslationKey> = {
  ready: "documents.statusReady",
  pending: "documents.statusPending",
  processing: "documents.statusProcessing",
  failed: "documents.statusFailed",
};

/** A document status for people; an unknown status falls through as written. */
export function statusLabel(status: string, t: (key: TranslationKey) => string): string {
  const key = STATUS_LABELS[status];
  return key ? t(key) : status;
}

/** A small segmented switch: exactly one option is always active. */
export function SegmentedControl<TValue extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: TValue;
  onChange: (value: TValue) => void;
  options: Array<{ value: TValue; label: string; icon?: LucideIcon }>;
  className?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      spacing={1}
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        // Radix reports "" when the active item is pressed again; a view switch
        // always has a view, so that press is a no-op.
        if (next) onChange(next as TValue);
      }}
      className={cn("h-9 rounded-lg bg-muted p-[3px]", className)}
    >
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            className="h-full gap-1.5 rounded-md px-2.5 text-muted-foreground hover:bg-transparent data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-xs dark:data-[state=on]:bg-accent"
          >
            {Icon ? <Icon /> : null}
            {option.label}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
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
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{eyebrow}</p>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? (
        <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

export function MetricRibbon({
  items,
}: {
  items: Array<{
    label: string;
    value: string;
    tone?: "rust" | "cobalt" | "neutral";
    icon?: ReactNode;
  }>;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
        <Card
          key={item.label}
          className={cn(
            "gap-2 px-4 py-3.5 shadow-card",
            item.tone === "rust" && "bg-warning-soft ring-warning/20",
            item.tone === "cobalt" && "bg-brand-soft ring-brand/15",
          )}
        >
          <p className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
            <span className="min-w-0 truncate">{item.label}</span>
            {item.icon ? (
              <span className="shrink-0 [&_svg]:size-4">{item.icon}</span>
            ) : null}
          </p>
          <p
            title={item.value}
            className={cn(
              "num truncate text-xl font-semibold tracking-tight",
              item.tone === "rust" && "text-warning",
              item.tone === "cobalt" && "text-brand",
            )}
          >
            {item.value}
          </p>
        </Card>
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
  const { t } = useI18n();
  const fillId = useId();

  if (data.length === 0) {
    return (
      <div
        className={cn(
          "flex h-28 items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground",
          className,
        )}
      >
        {t("shared.noActivity")}
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
      role="img"
      aria-label={t("shared.sparklineLabel")}
    >
      <defs>
        <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#${fillId})`} />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="var(--chart-1)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {points.map((point, index) => {
        const [x, y] = point.split(",").map(Number);
        return (
          <circle
            key={`${data[index]?.month}-${point}`}
            cx={x}
            cy={y}
            r="3"
            fill="var(--card)"
            stroke="var(--chart-1)"
            strokeWidth="2"
          />
        );
      })}
    </svg>
  );
}

function QuietEmpty({ label }: { label: string }) {
  return (
    <Empty className="py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileSearch />
        </EmptyMedia>
        <EmptyDescription>{label}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function DeadlineList({
  items,
}: {
  items: DashboardDeadlineItem[];
}) {
  const { t } = useI18n();

  if (items.length === 0) {
    return <QuietEmpty label={t("shared.noDeadlines")} />;
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => {
        const soon = !item.isOverdue && item.daysUntilDue <= 7;

        return (
          <Link
            key={item.documentId}
            to="/documents/$documentId"
            params={{ documentId: item.documentId }}
            className={cn(
              "flex items-center justify-between gap-4 rounded-lg px-4 py-3 ring-1 ring-foreground/10 transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
              item.isOverdue && "bg-danger-soft ring-danger/20 hover:bg-danger-soft",
              soon && "bg-warning-soft ring-warning/20 hover:bg-warning-soft",
            )}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{item.title}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {item.correspondentName ?? t("dashboard.unfiled")} · {t("shared.due")}{" "}
                <span className="num">{format(new Date(item.dueDate), "MMM d")}</span>
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="num text-sm font-medium">
                {formatCurrency(item.amount, item.currency ?? "EUR") ?? t("shared.open")}
              </p>
              <p
                className={cn(
                  "text-xs text-muted-foreground",
                  item.isOverdue && "text-danger",
                  soon && "text-warning",
                )}
              >
                {item.isOverdue
                  ? t("shared.daysOverdue").replace("{days}", String(Math.abs(item.daysUntilDue)))
                  : t("shared.daysLeft").replace("{days}", String(item.daysUntilDue))}
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
  emptyLabel,
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
  const { t } = useI18n();

  if (documents.length === 0) {
    return <QuietEmpty label={emptyLabel ?? t("shared.noDocuments")} />;
  }

  return (
    <div className="divide-y">
      {documents.map((document) => {
        const isSelected = selectedIds.includes(document.id);
        const warnings = (document.metadata.intelligence?.validation?.warnings ?? []).slice(0, 2);
        const routedType = document.metadata.intelligence?.routing?.documentType;
        const ambiguous = document.reviewReasons.includes("classification_ambiguous");
        const unresolved = document.reviewReasons.includes("correspondent_unresolved");
        const hasSignals = ambiguous || unresolved || Boolean(routedType) || warnings.length > 0;
        const summary = document.metadata.intelligence?.summary?.value;
        const amount =
          document.amount !== null
            ? formatCurrency(document.amount, document.currency ?? "EUR")
            : null;

        const rowClassName = cn(
          "group flex items-start gap-3 px-4 py-3.5 transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60 md:px-5",
          selectionMode && "cursor-pointer",
          isSelected && "bg-brand-soft hover:bg-brand-soft",
        );

        const content = (
          <>
            {selectionMode ? (
              <button
                type="button"
                aria-label={(isSelected ? t("shared.deselectDocument") : t("shared.selectDocument")).replace(
                  "{title}",
                  document.title,
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleSelect?.(document.id);
                }}
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[5px] border border-input transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-3.5",
                  isSelected && "border-primary bg-primary text-primary-foreground",
                )}
              >
                {isSelected ? <Check /> : null}
              </button>
            ) : (
              <CategoryDot
                className="mt-[7px]"
                color={colorForValue(document.correspondent?.name ?? document.status)}
              />
            )}

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="min-w-0 truncate text-sm font-medium">{document.title}</p>
                <DocumentProcessingIndicator document={document} />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {document.documentType?.name ?? t("shared.document")} ·{" "}
                {document.correspondent?.name ?? t("dashboard.unfiled")} ·{" "}
                <span className="num whitespace-nowrap">
                  {format(new Date(document.issueDate ?? document.createdAt), "MMM d, yyyy")}
                </span>
              </p>
              {document.snippets && document.snippets.length > 0 ? (
                <p
                  className="mt-1.5 line-clamp-2 text-sm text-muted-foreground"
                  dangerouslySetInnerHTML={{ __html: document.snippets[0] ?? "" }}
                />
              ) : summary ? (
                <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{summary}</p>
              ) : null}
              {hasSignals ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {ambiguous ? (
                    <Badge variant="warning">{t("shared.classificationAmbiguous")}</Badge>
                  ) : null}
                  {unresolved ? (
                    <Badge variant="danger">{t("shared.correspondentUnresolved")}</Badge>
                  ) : null}
                  {routedType ? <Badge variant="brand">{routedType}</Badge> : null}
                  {warnings.map((warning) => (
                    <Badge key={warning} variant="outline">
                      {formatSignal(warning)}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {amount ? <span className="num text-sm font-medium">{amount}</span> : null}
              {selectionMode ? (
                <Badge variant={isSelected ? "default" : "secondary"}>
                  {isSelected ? t("shared.selected") : t("shared.select")}
                </Badge>
              ) : (
                <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-visible:opacity-100" />
              )}
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
              className={rowClassName}
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
            className={rowClassName}
          >
            {content}
          </Link>
        );
      })}
    </div>
  );
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-muted-foreground">
      <Spinner className="size-6 text-brand" />
      <p className="text-sm">{label}</p>
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
    <Alert
      variant="destructive"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-danger/25 bg-danger-soft px-4 py-3.5 text-danger"
    >
      <AlertCircle className="size-5 shrink-0 translate-y-0" />
      <AlertDescription className="min-w-48 flex-1 text-danger">{label}</AlertDescription>
      {action ? <div className="shrink-0 text-foreground">{action}</div> : null}
    </Alert>
  );
}
