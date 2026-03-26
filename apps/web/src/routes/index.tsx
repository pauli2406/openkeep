import { Fragment } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ErrorBlock,
  ExplorerSectionHeader,
  LoadingBlock,
  MetricRibbon,
} from "@/components/explorer/shared";
import { api, getApiErrorMessage } from "@/lib/api";
import { processingRefetchInterval } from "@/lib/document-processing";
import { fetchDashboardInsights, formatCurrency } from "@/lib/explorer";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { DashboardDeadlineItem, MonthlyActivityPoint } from "@openkeep/types";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

function formatMonthLabel(month: string): string {
  const [, m] = month.split("-");
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return labels[Number(m) - 1] ?? m;
}

function HorizontalTimeline({ data }: { data: MonthlyActivityPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-[1.6rem] border border-dashed border-[color:var(--explorer-border)] text-sm text-[color:var(--explorer-muted)]">
        No monthly activity yet
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="flex items-end gap-1.5 overflow-x-auto pb-1">
      {data.map((point, i) => {
        const pct = (point.count / max) * 100;
        const prevYear = i > 0 ? data[i - 1].month.split("-")[0] : null;
        const curYear = point.month.split("-")[0];
        const isYearBoundary = prevYear !== null && prevYear !== curYear;

        return (
          <Fragment key={point.month}>
            {isYearBoundary && (
              <div className="flex flex-col items-center justify-end gap-1.5 px-1 self-stretch">
                <span className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--explorer-muted)]">
                  {curYear}
                </span>
                <div className="w-px flex-1 bg-[color:var(--explorer-border)]" />
              </div>
            )}
            <Link
              to="/documents"
              search={{ view: "timeline" }}
              className="group flex min-w-[3.5rem] flex-1 flex-col items-center gap-1.5"
            >
              <span className="text-[0.65rem] font-semibold tabular-nums text-[color:var(--explorer-muted)] opacity-0 transition-opacity group-hover:opacity-100">
                {point.count}
              </span>
              <div className="relative flex w-full justify-center">
                <div
                  className="w-full max-w-[2.4rem] rounded-t-[0.6rem] bg-[color:var(--explorer-cobalt)]/25 transition-colors group-hover:bg-[color:var(--explorer-cobalt)]/55"
                  style={{ height: `${Math.max(pct, 6)}%`, minHeight: "4px", maxHeight: "5rem" }}
                />
              </div>
              <span className="text-[0.62rem] uppercase tracking-[0.14em] text-[color:var(--explorer-muted)]">
                {formatMonthLabel(point.month)}
              </span>
            </Link>
          </Fragment>
        );
      })}
    </div>
  );
}

function formatTaskDateLabel(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}

function buildTaskDescription(item: DashboardDeadlineItem): string {
  if (item.referenceNumber?.trim()) {
    return `${item.title} (${item.referenceNumber.trim()})`;
  }
  return item.title;
}

function ClusterStrip({
  items,
}: {
  items: Array<{
    id: string;
    slug: string;
    name: string;
    documentCount: number;
    documentTypes: Array<{ name: string; count: number }>;
    latestDocDate: string | null;
    totalAmount: number | null;
    currency: string | null;
  }>;
}) {
  const { t } = useI18n();
  if (items.length === 0) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-[1.6rem] border border-dashed border-[color:var(--explorer-border)] text-sm text-[color:var(--explorer-muted)]">
        No clusters in view
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-4 md:grid-cols-2">
      {items.map((item) => (
        <Link
          key={item.id}
          to="/correspondents/$slug"
          params={{ slug: item.slug }}
          className="group rounded-[1.7rem] border border-[color:var(--explorer-border)] bg-white/60 p-4 transition hover:-translate-y-0.5 hover:border-[color:var(--explorer-cobalt)]/35"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[color:var(--explorer-muted)]">
                {item.documentCount} docs
              </p>
              <h3 className="mt-2 text-xl font-semibold text-[color:var(--explorer-ink)]">
                {item.name}
              </h3>
            </div>
            <ArrowRight className="mt-1 h-4 w-4 text-[color:var(--explorer-muted)] transition group-hover:translate-x-0.5" />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {item.documentTypes.map((type) => (
              <span
                key={`${item.id}-${type.name}`}
                className="inline-flex items-center gap-2 rounded-full bg-[color:var(--explorer-paper-strong)] px-3 py-1 text-xs text-[color:var(--explorer-muted)]"
              >
                <span className="h-2 w-2 rounded-full bg-[color:var(--explorer-rust)]" />
                {type.name} · {type.count}
              </span>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between text-sm text-[color:var(--explorer-muted)]">
            <span>{item.latestDocDate ?? "Undated"}</span>
            <span>{formatCurrency(item.totalAmount, item.currency ?? "EUR") ?? "Mixed"}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

function TaskTable({
  items,
  completingId,
  onComplete,
  error,
}: {
  items: DashboardDeadlineItem[];
  completingId: string | null;
  onComplete: (documentId: string) => void;
  error: string | null;
}) {
  const { t } = useI18n();

  if (items.length === 0) {
    return (
      <div className="flex min-h-44 items-center justify-center rounded-[1.6rem] border border-dashed border-[color:var(--explorer-border)] text-sm text-[color:var(--explorer-muted)]">
        {t("dashboard.noTasksInView")}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[1.7rem] border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)]">
      <div className="grid grid-cols-[1.1fr_2fr_1.1fr_0.9fr_0.9fr_0.8fr] gap-4 border-b border-[color:var(--explorer-border)] bg-[color:var(--explorer-paper-strong)] px-4 py-3 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[color:var(--explorer-muted)]">
        <span>{t("dashboard.correspondent")}</span>
        <span>{t("dashboard.document")}</span>
        <span>{t("dashboard.whatToDo")}</span>
        <span>{t("dashboard.amount")}</span>
        <span>{t("dashboard.deadline")}</span>
        <span>{t("dashboard.action")}</span>
      </div>
      <div className="divide-y divide-[color:var(--explorer-border)]">
        {items.map((item) => {
          const isCompleting = completingId === item.documentId;
          return (
            <div
              key={item.documentId}
              className={cn(
                "grid grid-cols-1 gap-3 px-4 py-4 md:grid-cols-[1.1fr_2fr_1.1fr_0.9fr_0.9fr_0.8fr] md:items-center md:gap-4",
                item.isOverdue && "bg-[#fff6f1]",
              )}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[color:var(--explorer-ink)]">
                  {item.correspondentName ?? t("dashboard.unfiled")}
                </p>
                <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[color:var(--explorer-muted)]">
                  {item.documentTypeName ?? t("dashboard.documentFallback")}
                </p>
              </div>
              <Link
                to="/documents/$documentId"
                params={{ documentId: item.documentId }}
                className="min-w-0 text-sm font-medium text-[color:var(--explorer-ink)] transition hover:text-[color:var(--explorer-cobalt)]"
              >
                {buildTaskDescription(item)}
              </Link>
              <div className="text-sm text-[color:var(--explorer-ink)]">{item.taskLabel}</div>
              <div className="text-sm text-[color:var(--explorer-ink)]">
                {formatCurrency(item.amount, item.currency ?? "EUR") ?? "-"}
              </div>
              <div className="text-sm text-[color:var(--explorer-ink)]">
                <p>{formatTaskDateLabel(item.dueDate)}</p>
                <p className="mt-1 text-xs text-[color:var(--explorer-muted)]">
                    {item.isOverdue
                      ? `${Math.abs(item.daysUntilDue)}${t("dashboard.overdueDays")}`
                      : `${item.daysUntilDue}${t("dashboard.daysLeft")}`}
                </p>
              </div>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onComplete(item.documentId)}
                  disabled={isCompleting}
                  className="w-full rounded-full md:w-auto"
                >
                  <Check className="h-4 w-4" />
                  {isCompleting ? t("dashboard.saving") : t("dashboard.done")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {error ? (
        <div className="border-t border-[color:var(--explorer-border)] px-4 py-3 text-sm text-[#b74817]">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function DashboardPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const insightsQuery = useQuery({
    queryKey: ["dashboard", "insights"],
    queryFn: fetchDashboardInsights,
    refetchInterval: (query) => processingRefetchInterval(query.state.data, (data) => data?.recentDocuments),
  });

  const completeTaskMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const { data, error } = await api.PATCH("/api/documents/{id}", {
        params: { path: { id: documentId } },
        body: { taskCompletedAt: new Date().toISOString() },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("dashboard.failedToCompleteTask")));
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard", "insights"] });
    },
  });

  if (insightsQuery.isLoading) {
    return <LoadingBlock label={t("dashboard.loadingAtlas")} />;
  }

  if (insightsQuery.isError || !insightsQuery.data) {
    return (
      <div className="p-6 md:p-8">
        <ErrorBlock
          label={t("dashboard.failedToLoadInsights")}
          action={
            <Button variant="outline" onClick={() => insightsQuery.refetch()}>
              {t("dashboard.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  const data = insightsQuery.data;
  const taskItems =
    data.overdueItems.length > 0
      ? [...data.overdueItems, ...data.upcomingDeadlines].slice(0, 6)
      : data.upcomingDeadlines;

  return (
    <div className="space-y-8 p-6 md:p-8">
      <ExplorerSectionHeader
        eyebrow={t("dashboard.eyebrow")}
        title="Dashboard"
        description={t("dashboard.description")}
      />

      <MetricRibbon
        items={[
          {
            label: t("dashboard.totalDocuments"),
            value: data.stats.totalDocuments.toLocaleString(),
            tone: "neutral",
          },
          {
            label: t("dashboard.pendingReview"),
            value: data.stats.pendingReview.toLocaleString(),
            tone: data.stats.pendingReview > 0 ? "rust" : "neutral",
          },
          {
            label: t("dashboard.documentTypes"),
            value: data.stats.documentTypesCount.toLocaleString(),
            tone: "cobalt",
          },
          {
            label: t("dashboard.correspondents"),
            value: data.stats.correspondentsCount.toLocaleString(),
            tone: "neutral",
          },
        ]}
      />

      <section className="rounded-[2.1rem] border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] p-5">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[color:var(--explorer-muted)]">
               {t("dashboard.intakeTrend")}
             </p>
             <h2 className="mt-2 font-[var(--font-display)] text-3xl text-[color:var(--explorer-ink)]">
               {t("dashboard.rhythm")}
             </h2>
          </div>
          <Button asChild variant="ghost" className="rounded-full">
            <Link to="/documents" search={{ view: "timeline" }}>
              {t("dashboard.openTimeline")}
            </Link>
          </Button>
        </div>
        <HorizontalTimeline data={data.monthlyActivity} />
      </section>

      <section className="rounded-[2.1rem] border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] p-5">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[color:var(--explorer-muted)]">
               {t("dashboard.correspondents")}
             </p>
             <h2 className="mt-2 font-[var(--font-display)] text-3xl text-[color:var(--explorer-ink)]">
               {t("dashboard.largestClusters")}
             </h2>
          </div>
          <Button asChild variant="ghost" className="rounded-full">
            <Link to="/documents" search={{ view: "galaxy" }}>
              <Sparkles className="h-4 w-4" />
              {t("dashboard.openGalaxyView")}
            </Link>
          </Button>
        </div>

        <ClusterStrip items={data.topCorrespondents.slice(0, 4)} />
      </section>

      <section className="rounded-[2.1rem] border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] p-5">
        <div className="mb-5">
          <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[color:var(--explorer-muted)]">
             {t("dashboard.deadlines")}
           </p>
           <h2 className="mt-2 font-[var(--font-display)] text-3xl text-[color:var(--explorer-ink)]">
             {t("dashboard.upcomingTasks")}
           </h2>
        </div>
        <TaskTable
          items={taskItems}
          completingId={completeTaskMutation.isPending ? completeTaskMutation.variables ?? null : null}
          onComplete={(documentId) => completeTaskMutation.mutate(documentId)}
          error={completeTaskMutation.isError ? completeTaskMutation.error.message : null}
        />
      </section>
    </div>
  );
}
