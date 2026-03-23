import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DeadlineList,
  DocumentRows,
  ErrorBlock,
  ExplorerSectionHeader,
  LoadingBlock,
  MetricRibbon,
  MiniSparkline,
} from "@/components/explorer/shared";
import { fetchDashboardInsights, formatCurrency } from "@/lib/explorer";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

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
              <Link to="/explore">
                <Sparkles className="h-4 w-4" />
                Explore galaxy
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

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-[2.1rem] border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] p-5">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[color:var(--explorer-muted)]">
                Recent Activity
              </p>
              <h2 className="mt-2 font-[var(--font-display)] text-3xl text-[color:var(--explorer-ink)]">
                Latest arrivals
              </h2>
            </div>
            <Button asChild variant="ghost" className="rounded-full">
              <Link to="/documents" search={{ view: "list" }}>
                All documents
              </Link>
            </Button>
          </div>
          <DocumentRows documents={data.recentDocuments} />
        </section>

        <section className="rounded-[2.1rem] border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] p-5">
          <div className="mb-4">
            <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[color:var(--explorer-muted)]">
              Intake Trend
            </p>
            <h2 className="mt-2 font-[var(--font-display)] text-3xl text-[color:var(--explorer-ink)]">
              12-month rhythm
            </h2>
            <p className="mt-2 text-sm text-[color:var(--explorer-muted)]">
              Incoming volume by month, useful for spotting tax season, billing spikes, and quiet stretches.
            </p>
          </div>
          <MiniSparkline data={data.monthlyActivity} className="mt-6" />
          <div className="mt-4 grid grid-cols-3 gap-3">
            {data.monthlyActivity.slice(-3).map((point) => (
              <div
                key={point.month}
                className="rounded-[1.25rem] bg-[color:var(--explorer-paper-strong)] px-3 py-3"
              >
                <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--explorer-muted)]">
                  {point.month}
                </p>
                <p className="mt-2 text-lg font-semibold text-[color:var(--explorer-ink)]">
                  {point.count}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
