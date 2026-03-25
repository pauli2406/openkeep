import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, FolderClock } from "lucide-react";
import { processingRefetchInterval } from "@/lib/document-processing";
import type { ExplorerSearch } from "@/lib/explorer";
import { fetchFilteredDocuments } from "@/lib/explorer";
import type { DocumentsTimelineResponse } from "@openkeep/types";
import { DocumentRows, LoadingBlock } from "./shared";

type TimelineViewProps = {
  timeline: DocumentsTimelineResponse;
  search: ExplorerSearch;
  expanded: string[];
  onToggleMonth: (monthKey: string) => void;
};

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function isValidTimelineMonth(month: number) {
  return Number.isInteger(month) && month >= 1 && month <= 12;
}

function getMonthLabel(month: number) {
  return MONTH_LABELS[month - 1] ?? "Unknown month";
}

function monthBounds(year: number, month: number) {
  if (!Number.isInteger(year) || !isValidTimelineMonth(month)) {
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

function MonthDocuments({
  year,
  month,
  search,
}: {
  year: number;
  month: number;
  search: ExplorerSearch;
}) {
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
            pageSize: 8,
          })
        : Promise.reject(new Error("Invalid timeline month")),
    refetchInterval: (query) => processingRefetchInterval(query.state.data, (data) => data?.items),
  });

  if (!bounds) {
    return (
      <div className="rounded-[1.4rem] border border-[#d8b7a8] bg-[#fff5f0] px-4 py-3 text-sm text-[color:var(--explorer-muted)]">
        This timeline bucket has an invalid month value and cannot be expanded.
      </div>
    );
  }

  if (documentsQuery.isLoading) {
    return <LoadingBlock label="Loading month documents" />;
  }

  if (documentsQuery.isError) {
    return (
      <div className="rounded-[1.4rem] border border-[#d8b7a8] bg-[#fff5f0] px-4 py-3 text-sm text-[color:var(--explorer-muted)]">
        Failed to load documents for this month.
      </div>
    );
  }

  return <DocumentRows documents={documentsQuery.data?.items ?? []} />;
}

export function TimelineView({
  timeline,
  search,
  expanded,
  onToggleMonth,
}: TimelineViewProps) {
  if (timeline.years.length === 0) {
    return (
      <div className="flex min-h-72 items-center justify-center rounded-[1.8rem] border border-dashed border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] text-sm text-[color:var(--explorer-muted)]">
        No dated documents match the current filters.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {timeline.years.map((yearBucket) => (
        <section key={yearBucket.year} className="rounded-[2rem] border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] p-5">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[color:var(--explorer-muted)]">
                Archive Year
              </p>
              <h2 className="font-[var(--font-display)] text-4xl text-[color:var(--explorer-ink)]">
                {yearBucket.year}
              </h2>
            </div>
            <p className="text-sm text-[color:var(--explorer-muted)]">
              {yearBucket.count} documents
            </p>
          </div>

          <div className="space-y-4">
            {yearBucket.months.map((monthBucket) => {
              const monthKey = `${yearBucket.year}-${String(monthBucket.month).padStart(2, "0")}`;
              const isExpanded = expanded.includes(monthKey);
              return (
                <div
                  key={monthKey}
                  className="rounded-[1.6rem] border border-[color:var(--explorer-border)] bg-white/55"
                >
                  <button
                    type="button"
                    onClick={() => onToggleMonth(monthKey)}
                    className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left"
                  >
                    <div className="flex items-center gap-3">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-[color:var(--explorer-muted)]" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-[color:var(--explorer-muted)]" />
                      )}
                      <div>
                        <p className="text-base font-semibold text-[color:var(--explorer-ink)]">
                          {getMonthLabel(monthBucket.month)}
                        </p>
                        <p className="mt-1 flex flex-wrap gap-3 text-xs uppercase tracking-[0.18em] text-[color:var(--explorer-muted)]">
                          <span>{monthBucket.count} docs</span>
                          {monthBucket.topCorrespondents.length > 0 ? (
                            <span>{monthBucket.topCorrespondents.join(" · ")}</span>
                          ) : null}
                        </p>
                      </div>
                    </div>
                    <FolderClock className="h-5 w-5 text-[color:var(--explorer-muted)]" />
                  </button>
                  {isExpanded ? (
                    <div className="border-t border-[color:var(--explorer-border)] px-4 py-4">
                      <MonthDocuments
                        year={yearBucket.year}
                        month={monthBucket.month}
                        search={search}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
