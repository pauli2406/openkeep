import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Orbit } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DocumentRows,
  ErrorBlock,
  ExplorerSectionHeader,
  LoadingBlock,
  MetricRibbon,
  MiniSparkline,
} from "@/components/explorer/shared";
import {
  fetchCorrespondentInsights,
  fetchFilteredDocuments,
  formatCurrency,
} from "@/lib/explorer";

export const Route = createFileRoute("/correspondents/$slug")({
  component: CorrespondentDetailPage,
});

function CorrespondentDetailPage() {
  const { slug } = Route.useParams();
  const navigate = Route.useNavigate();

  const insightsQuery = useQuery({
    queryKey: ["correspondent", slug, "insights"],
    queryFn: () => fetchCorrespondentInsights(slug),
    refetchInterval: (query) =>
      query.state.data?.summaryStatus === "pending" ? 4_000 : false,
  });

  const documentsQuery = useQuery({
    queryKey: ["correspondent", slug, "documents", insightsQuery.data?.correspondent.id],
    queryFn: () =>
      fetchFilteredDocuments({
        correspondentIds: insightsQuery.data?.correspondent.id
          ? [insightsQuery.data.correspondent.id]
          : undefined,
        page: 1,
        pageSize: 20,
        sort: "createdAt",
        direction: "desc",
      }),
    enabled: Boolean(insightsQuery.data?.correspondent.id),
  });

  if (insightsQuery.isLoading) {
    return <LoadingBlock label="Loading correspondent dossier" />;
  }

  if (insightsQuery.isError || !insightsQuery.data) {
    return (
      <div className="p-6 md:p-8">
        <ErrorBlock
          label="Failed to load correspondent insights."
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
      <Button variant="ghost" className="rounded-full" onClick={() => navigate({ to: "/" })}>
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </Button>

      <ExplorerSectionHeader
        eyebrow="Correspondent Dossier"
        title={data.correspondent.name}
        description="A focused view of one relationship: summary, activity cadence, type mix, deadlines, and the underlying document trail."
      />

      <MetricRibbon
        items={[
          {
            label: "Documents",
            value: data.stats.documentCount.toLocaleString(),
          },
          {
            label: "Total Spend",
            value:
              formatCurrency(data.stats.totalAmount, data.stats.currency ?? "EUR") ?? "Mixed",
            tone: "rust",
          },
          {
            label: "Date Range",
            value:
              data.stats.dateRange.from && data.stats.dateRange.to
                ? `${data.stats.dateRange.from.slice(0, 7)} → ${data.stats.dateRange.to.slice(0, 7)}`
                : "Undated",
            tone: "neutral",
          },
          {
            label: "Avg Confidence",
            value:
              data.stats.avgConfidence !== null
                ? `${Math.round(data.stats.avgConfidence * 100)}%`
                : "n/a",
            tone: "cobalt",
          },
        ]}
      />

      <section className="rounded-[2.1rem] border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] p-5">
        <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[color:var(--explorer-muted)]">
          AI Summary
        </p>
        <div className="mt-4 rounded-[1.7rem] bg-[color:var(--explorer-paper-strong)] px-5 py-5">
          {data.summaryStatus === "ready" && data.summary ? (
            <p className="max-w-4xl font-[var(--font-display)] text-2xl leading-relaxed text-[color:var(--explorer-ink)]">
              “{data.summary}”
            </p>
          ) : data.summaryStatus === "pending" ? (
            <p className="text-sm text-[color:var(--explorer-muted)]">
              Summary generation is in progress. This page will refresh automatically when the description is ready.
            </p>
          ) : (
            <p className="text-sm text-[color:var(--explorer-muted)]">
              No LLM provider is configured for cached correspondent summaries.
            </p>
          )}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-[2.1rem] border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] p-5">
          <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[color:var(--explorer-muted)]">
            Type Breakdown
          </p>
          <div className="mt-4 space-y-3">
            {data.documentTypeBreakdown.map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between rounded-[1.35rem] border border-[color:var(--explorer-border)] bg-white/55 px-4 py-3"
              >
                <span className="text-sm font-medium text-[color:var(--explorer-ink)]">
                  {item.name}
                </span>
                <span className="text-sm text-[color:var(--explorer-muted)]">
                  {item.count}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[2.1rem] border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[color:var(--explorer-muted)]">
                Monthly Activity
              </p>
              <h2 className="mt-2 font-[var(--font-display)] text-3xl text-[color:var(--explorer-ink)]">
                Rhythm
              </h2>
            </div>
            <Orbit className="h-5 w-5 text-[color:var(--explorer-muted)]" />
          </div>
          <MiniSparkline data={data.timeline} className="mt-6" />
        </section>
      </div>

      <section className="space-y-5 rounded-[2.1rem] border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[color:var(--explorer-muted)]">
              Documents
            </p>
            <h2 className="mt-2 font-[var(--font-display)] text-3xl text-[color:var(--explorer-ink)]">
              Documents from {data.correspondent.name}
            </h2>
          </div>
          <Button
            asChild
            variant="ghost"
            className="rounded-full"
          >
            <Link
              to="/documents"
              search={{
                correspondentIds: [data.correspondent.id],
                view: "list",
              }}
            >
              Open in explorer
            </Link>
          </Button>
        </div>

        {documentsQuery.isLoading ? (
          <LoadingBlock label="Loading correspondent documents" />
        ) : documentsQuery.isError ? (
          <ErrorBlock
            label="Failed to load the document list for this correspondent."
            action={
              <Button variant="outline" onClick={() => documentsQuery.refetch()}>
                Retry
              </Button>
            }
          />
        ) : (
          <DocumentRows documents={documentsQuery.data?.items ?? []} />
        )}
      </section>
    </div>
  );
}
