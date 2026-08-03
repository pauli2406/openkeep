import { useQuery } from "@tanstack/react-query";
import type { DocumentsTimelineResponse } from "@openkeep/types";
import { processingRefetchInterval } from "@/lib/document-processing";
import type { ExplorerSearch } from "@/lib/explorer";
import { fetchFilteredDocuments } from "@/lib/explorer";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { LoadingBlock } from "./shared";

type TimelineViewProps = {
  timeline: DocumentsTimelineResponse;
  search: ExplorerSearch;
  expanded: string[];
  onToggleMonth: (monthKey: string) => void;
  onOpenDocument: (documentId: string) => void;
};

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function monthBounds(year: number, month: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const endDate = new Date(Date.UTC(nextYear, nextMonth - 1, 0));
  return {
    start,
    end: `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, "0")}-${String(endDate.getUTCDate()).padStart(2, "0")}`,
  };
}

/** Documents for one month, revealed when its bar is clicked. */
function MonthDocuments({
  year,
  month,
  search,
  onOpenDocument,
}: {
  year: number;
  month: number;
  search: ExplorerSearch;
  onOpenDocument: (documentId: string) => void;
}) {
  const { t } = useI18n();
  const bounds = monthBounds(year, month);
  const documentsQuery = useQuery({
    queryKey: ["documents", "timeline-month", year, month, search],
    enabled: bounds !== null,
    queryFn: () =>
      bounds
        ? fetchFilteredDocuments({
            ...search,
            dateFrom: bounds.start,
            dateTo: bounds.end,
            page: 1,
            pageSize: 50,
          })
        : Promise.reject(new Error("Invalid month")),
    refetchInterval: (query) =>
      processingRefetchInterval(query.state.data, (data) => data?.items),
  });

  if (documentsQuery.isLoading) {
    return <LoadingBlock label={t("timeline.loadingMonth")} />;
  }

  if (documentsQuery.isError) {
    return (
      <div className="flex items-center gap-3 py-3 pl-[104px] text-sm text-[var(--ok-red)]">
        {t("timeline.monthError")}
        <button
          type="button"
          onClick={() => documentsQuery.refetch()}
          className="font-semibold text-[var(--ok-accent)] hover:underline"
        >
          {t("dashboard.retry")}
        </button>
      </div>
    );
  }

  const items = documentsQuery.data?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="py-3 pl-[104px] text-sm text-muted-foreground">
        {t("timeline.emptyMonth")}
      </div>
    );
  }

  return (
    <div className="border-y bg-[var(--ok-bar)]">
      {items.map((document) => (
        <button
          key={document.id}
          type="button"
          onClick={() => onOpenDocument(document.id)}
          className="ok-row w-full gap-3 pl-[104px] pr-4 text-left"
        >
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
            {document.title}
          </span>
          <span className="hidden w-44 truncate text-sm text-muted-foreground md:block">
            {document.correspondent?.name ?? t("dashboard.unfiled")}
          </span>
        </button>
      ))}
    </div>
  );
}

export function TimelineView({
  timeline,
  search,
  expanded,
  onToggleMonth,
  onOpenDocument,
}: TimelineViewProps) {
  const { t } = useI18n();

  // The timeline response carries no deadline data. Derive the unpaid
  // markers from the same filtered document set the rows describe, rather
  // than the dashboard preview, which is global and capped at six.
  const deadlinesQuery = useQuery({
    queryKey: ["documents", "timeline-deadlines", search],
    queryFn: () =>
      fetchFilteredDocuments({
        ...search,
        sort: "dueDate",
        direction: "asc",
        page: 1,
        pageSize: 100,
      }),
    staleTime: 60_000,
  });

  const unpaidByMonth = new Map<string, number>();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  for (const document of deadlinesQuery.data?.items ?? []) {
    if (!document.dueDate || document.taskCompletedAt) continue;
    // Parse the date parts directly: `new Date("2026-03-01")` is UTC
    // midnight and shifts into the previous month west of UTC.
    const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(document.dueDate);
    if (!parts) continue;
    const due = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
    if (due >= todayStart) continue;
    const key = `${Number(parts[1])}-${Number(parts[2])}`;
    unpaidByMonth.set(key, (unpaidByMonth.get(key) ?? 0) + 1);
  }

  // Newest first, flattened so a year of months reads as one column.
  const rows = timeline.years
    .flatMap((yearBucket) =>
      yearBucket.months.map((monthBucket) => ({
        year: yearBucket.year,
        ...monthBucket,
      })),
    )
    .sort((a, b) => b.year - a.year || b.month - a.month);

  if (rows.length === 0) {
    return (
      <div className="flex min-h-44 items-center justify-center border-t text-sm text-muted-foreground">
        {t("timeline.empty")}
      </div>
    );
  }

  const max = Math.max(...rows.map((row) => row.count), 1);

  return (
    <div className="min-w-0">
      {rows.map((row) => {
        const key = `${row.year}-${row.month}`;
        const isExpanded = expanded.includes(key);
        const unpaid = unpaidByMonth.get(key) ?? 0;
        const samples = (row.topTypes.length ? row.topTypes : row.topCorrespondents)
          .slice(0, 3)
          .join(", ");

        return (
          <div key={key}>
            <button
              type="button"
              onClick={() => onToggleMonth(key)}
              className={cn(
                "ok-row w-full gap-3 px-4 text-left",
                isExpanded && "bg-accent",
              )}
            >
              <span className="ok-num w-[76px] flex-shrink-0 text-sm text-muted-foreground">
                {MONTH_LABELS[row.month - 1]} {row.year}
              </span>

              {/* Fixed track so the count and sample types line up; the bar
                  inside it is scaled to the document count. */}
              <span className="w-[34%] flex-shrink-0">
                <span
                  className="block h-1.5 rounded-[var(--r-pill)] bg-[var(--ok-accent)]/60"
                  style={{ width: `${Math.max((row.count / max) * 100, 1)}%` }}
                />
              </span>
              <span className="ok-num w-8 flex-shrink-0 text-right text-sm text-muted-foreground">
                {row.count}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                {samples}
              </span>

              {unpaid > 0 ? (
                <span className="flex-shrink-0 rounded-[var(--r-sm)] bg-[var(--ok-amber-soft)] px-[7px] py-px text-[11px] font-semibold text-[var(--ok-amber)]">
                  <span className="ok-num">{unpaid}</span> {t("timeline.unpaid")}
                </span>
              ) : null}
            </button>

            {isExpanded ? (
              <MonthDocuments
                year={row.year}
                month={row.month}
                search={search}
                onOpenDocument={onOpenDocument}
              />
            ) : null}
          </div>
        );
      })}

      <p className="px-4 py-3 text-xs text-muted-foreground">{t("timeline.caption")}</p>
    </div>
  );
}
