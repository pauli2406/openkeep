import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DeadlineList,
  ErrorBlock,
  ExplorerSectionHeader,
  LoadingBlock,
  MetricRibbon,
} from "@/components/explorer/shared";
import { fetchDashboardInsights, formatCurrency } from "@/lib/explorer";
import type { MonthlyActivityPoint } from "@openkeep/types";

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
      {data.map((point) => {
        const pct = (point.count / max) * 100;
        return (
          <Link
            key={point.month}
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
        );
      })}
    </div>
  );
}

function DashboardPage() {
  const insightsQuery = useQuery({
    queryKey: ["dashboard", "insights"],
    queryFn: fetchDashboardInsights,
  });

  if (insightsQuery.isLoading) {
    return <LoadingBlock label="Loading dashboard atlas" />;
  }

  if (insightsQuery.isError || !insightsQuery.data) {
    return (
      <div className="p-6 md:p-8">
        <ErrorBlock
          label="Failed to load dashboard insights. Please try again."
          action={
            <Button variant="outline" onClick={() => insightsQuery.refetch()}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  const data = insightsQuery.data;

  return (
    <div className="space-y-8 p-6 md:p-8">
      <ExplorerSectionHeader
        eyebrow="Document Atlas"
        title="Dashboard"
        description="A high-level reading room for your archive: who sends documents, what is due next, and how the archive has shifted over the last year."
      />

      <MetricRibbon
        items={[
          {
            label: "Total Documents",
            value: data.stats.totalDocuments.toLocaleString(),
            tone: "neutral",
          },
          {
            label: "Pending Review",
            value: data.stats.pendingReview.toLocaleString(),
            tone: data.stats.pendingReview > 0 ? "rust" : "neutral",
          },
          {
            label: "Document Types",
            value: data.stats.documentTypesCount.toLocaleString(),
            tone: "cobalt",
          },
          {
            label: "Correspondents",
            value: data.stats.correspondentsCount.toLocaleString(),
            tone: "neutral",
          },
        ]}
      />

      <section className="rounded-[2.1rem] border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] p-5">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[color:var(--explorer-muted)]">
              Intake Trend
            </p>
            <h2 className="mt-2 font-[var(--font-display)] text-3xl text-[color:var(--explorer-ink)]">
              12-month rhythm
            </h2>
          </div>
          <Button asChild variant="ghost" className="rounded-full">
            <Link to="/documents" search={{ view: "timeline" }}>
              Open timeline
            </Link>
          </Button>
        </div>
        <HorizontalTimeline data={data.monthlyActivity} />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
        <section className="rounded-[2.1rem] border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] p-5">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[color:var(--explorer-muted)]">
                Correspondents
              </p>
              <h2 className="mt-2 font-[var(--font-display)] text-3xl text-[color:var(--explorer-ink)]">
                Largest clusters
              </h2>
            </div>
            <Button asChild variant="ghost" className="rounded-full">
              <Link to="/documents" search={{ view: "galaxy" }}>
                <Sparkles className="h-4 w-4" />
                Open galaxy view
              </Link>
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {data.topCorrespondents.map((item) => (
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
                <div className="mt-4 flex items-center gap-2">
                  {item.documentTypes.map((type) => (
                    <span
                      key={`${item.id}-${type.name}`}
                      className="inline-flex items-center gap-2 rounded-full bg-[color:var(--explorer-paper-strong)] px-3 py-1 text-xs text-[color:var(--explorer-muted)]"
                    >
                      <span
                        className="h-2 w-2 rounded-full bg-[color:var(--explorer-rust)]"
                      />
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
        </section>

        <section className="rounded-[2.1rem] border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] p-5">
          <div className="mb-5">
            <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[color:var(--explorer-muted)]">
              Deadlines
            </p>
            <h2 className="mt-2 font-[var(--font-display)] text-3xl text-[color:var(--explorer-ink)]">
              Upcoming tasks
            </h2>
          </div>
          <DeadlineList
            items={
              data.overdueItems.length > 0
                ? [...data.overdueItems, ...data.upcomingDeadlines].slice(0, 6)
                : data.upcomingDeadlines
            }
          />
        </section>
      </div>
    </div>
  );
}
