import { useQuery } from "@tanstack/react-query";
import { CalendarRange, ChevronDown } from "lucide-react";
import type { DocumentsTimelineResponse } from "@openkeep/types";
import { CategoryDot } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { processingRefetchInterval } from "@/lib/document-processing";
import type { ExplorerSearch } from "@/lib/explorer";
import { colorForValue, fetchFilteredDocuments, formatCurrency } from "@/lib/explorer";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatRowDate } from "./document-table";

type TimelineViewProps = {
  timeline: DocumentsTimelineResponse;
  search: ExplorerSearch;
  expanded: string[];
  onToggleMonth: (monthKey: string) => void;
  onOpenDocument: (documentId: string) => void;
};

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

/** Documents for one month, revealed when its section is opened. */
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
            // The month's count already honours an active date filter, so its
            // documents must too: March 15–20 opens to those days, not all of March.
            // `YYYY-MM-DD` dates compare as strings.
            dateFrom:
              search.dateFrom && search.dateFrom > bounds.start ? search.dateFrom : bounds.start,
            dateTo: search.dateTo && search.dateTo < bounds.end ? search.dateTo : bounds.end,
            page: 1,
            pageSize: 50,
          })
        : Promise.reject(new Error("Invalid month")),
    refetchInterval: (query) =>
      processingRefetchInterval(query.state.data, (data) => data?.items),
  });

  if (documentsQuery.isLoading) {
    return (
      <div
        role="status"
        aria-label={t("timeline.loadingMonth")}
        className="flex flex-col gap-3 border-t px-4 py-4"
      >
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }

  if (documentsQuery.isError) {
    return (
      <div className="flex items-center justify-between gap-3 border-t bg-danger-soft px-4 py-3 text-sm text-danger">
        {t("timeline.monthError")}
        <Button
          variant="outline"
          size="xs"
          className="text-foreground"
          onClick={() => documentsQuery.refetch()}
        >
          {t("dashboard.retry")}
        </Button>
      </div>
    );
  }

  const items = documentsQuery.data?.items ?? [];
  if (items.length === 0) {
    return (
      <p className="border-t px-4 py-3 text-sm text-muted-foreground">
        {t("timeline.emptyMonth")}
      </p>
    );
  }

  return (
    <ul className="divide-y border-t">
      {items.map((document) => {
        const amount =
          document.amount != null
            ? formatCurrency(document.amount, document.currency ?? "EUR")
            : null;
        return (
          <li key={document.id}>
            <button
              type="button"
              onClick={() => onOpenDocument(document.id)}
              className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60"
            >
              <span className="num hidden w-20 shrink-0 text-sm text-muted-foreground sm:block">
                {formatRowDate(document.issueDate ?? document.createdAt)}
              </span>
              <CategoryDot
                color={colorForValue(document.correspondent?.name ?? document.status)}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium group-hover:text-brand">
                {document.title}
              </span>
              <span className="hidden w-44 shrink-0 truncate text-sm text-muted-foreground md:block">
                {document.correspondent?.name ?? t("dashboard.unfiled")}
              </span>
              <span className="num w-20 shrink-0 text-right text-sm">{amount ?? "—"}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function TimelineView({
  timeline,
  search,
  expanded,
  onToggleMonth,
  onOpenDocument,
}: TimelineViewProps) {
  const { t, language } = useI18n();

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
      yearBucket.months
        // guard: an out-of-range month would render an undefined label
        .filter((monthBucket) => monthBucket.month >= 1 && monthBucket.month <= 12)
        .map((monthBucket) => ({
          year: yearBucket.year,
          ...monthBucket,
        })),
    )
    .sort((a, b) => b.year - a.year || b.month - a.month);

  if (rows.length === 0) {
    return (
      <Card className="py-0 shadow-card">
        <Empty className="py-20">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarRange />
            </EmptyMedia>
            <EmptyDescription>{t("timeline.empty")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Card>
    );
  }

  const max = Math.max(...rows.map((row) => row.count), 1);
  const years = [...new Set(rows.map((row) => row.year))];
  const monthFormat = new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-US", {
    month: "short",
    timeZone: "UTC",
  });

  return (
    <div className="flex min-w-0 flex-col gap-7">
      {years.map((year) => {
        const months = rows.filter((row) => row.year === year);
        const yearTotal = months.reduce((sum, row) => sum + row.count, 0);
        return (
          <section key={year}>
            <div className="mb-3 flex items-baseline gap-2.5">
              <h2 className="num text-lg font-semibold tracking-tight">{year}</h2>
              <span className="text-xs text-muted-foreground">
                {yearTotal === 1
                  ? t("explorer.countOne")
                  : t("explorer.countMany").replace("{count}", String(yearTotal))}
              </span>
            </div>

            <ol className="flex flex-col gap-2.5">
              {months.map((row) => {
                const key = `${row.year}-${row.month}`;
                const isExpanded = expanded.includes(key);
                const unpaid = unpaidByMonth.get(key) ?? 0;
                const samples = (row.topTypes.length ? row.topTypes : row.topCorrespondents)
                  .slice(0, 3)
                  .join(", ");
                const monthName = monthFormat.format(Date.UTC(2000, row.month - 1, 15));

                return (
                  <li
                    key={key}
                    // Each month draws the rail down to the next marker, so it
                    // stops at the last one however tall an open month gets.
                    className="relative pl-7 not-last:before:absolute not-last:before:top-6 not-last:before:-bottom-[34px] not-last:before:left-[5.5px] not-last:before:w-px not-last:before:bg-border"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute top-[18px] left-0 z-10 size-3 rounded-full ring-4 ring-background",
                        unpaid > 0 ? "bg-warning" : "bg-primary",
                      )}
                    />
                    <Card className="gap-0 py-0 shadow-card">
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        onClick={() => onToggleMonth(key)}
                        className={cn(
                          "relative flex w-full flex-col gap-2 p-3.5 pr-10 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60 md:flex-row md:items-center md:gap-4",
                          isExpanded && "bg-muted/40",
                        )}
                      >
                        <span className="num shrink-0 text-sm font-medium md:w-24">
                          {monthName} {row.year}
                        </span>

                        <span className="flex min-w-0 flex-1 items-center gap-3">
                          <span
                            aria-hidden="true"
                            className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
                          >
                            <span
                              className="block h-full rounded-full bg-gradient-action"
                              style={{ width: `${Math.max((row.count / max) * 100, 3)}%` }}
                            />
                          </span>
                          <span className="num w-7 shrink-0 text-right text-sm font-medium">
                            {row.count}
                          </span>
                        </span>

                        <span className="flex min-w-0 items-center gap-2 md:w-[38%]">
                          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                            {samples}
                          </span>
                          {unpaid > 0 ? (
                            <Badge variant="warning">
                              <span className="num">{unpaid}</span> {t("timeline.unpaid")}
                            </Badge>
                          ) : null}
                        </span>

                        <ChevronDown
                          aria-hidden="true"
                          className={cn(
                            "absolute top-4 right-3.5 size-4 text-muted-foreground transition-transform md:top-1/2 md:-translate-y-1/2",
                            isExpanded && "rotate-180",
                          )}
                        />
                      </button>

                      {isExpanded ? (
                        <MonthDocuments
                          year={row.year}
                          month={row.month}
                          search={search}
                          onOpenDocument={onOpenDocument}
                        />
                      ) : null}
                    </Card>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}

      <p className="text-xs text-muted-foreground">{t("timeline.caption")}</p>
    </div>
  );
}

/** The timeline's shape while its buckets are on their way. */
export function TimelineSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-2.5">
      <Skeleton className="mb-1 h-6 w-16" />
      {[0, 1, 2, 3, 4].map((row) => (
        <Skeleton key={row} className="h-[52px] w-full rounded-xl" />
      ))}
    </div>
  );
}
