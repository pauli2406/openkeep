import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Orbit } from "lucide-react";
import type {
  CorrespondentInsightsResponse,
  CorrespondentIntelligence,
} from "@openkeep/types";
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
    refetchInterval: (query) => {
      const current = query.state.data;
      return current?.summaryStatus === "pending" || current?.intelligenceStatus === "pending"
        ? 4_000
        : false;
    },
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
  const intelligence = data.intelligence;
  const intelligenceStatus = data.intelligenceStatus;

  return (
    <div className="space-y-8 p-6 md:p-8">
      <Button variant="ghost" className="rounded-full" onClick={() => navigate({ to: "/" })}>
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </Button>

      <ExplorerSectionHeader
        eyebrow="Correspondent Dossier"
        title={data.correspondent.name}
        description="A living dossier for one relationship: overview, detected changes, milestones, domain-specific signals, and the underlying document trail."
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
            label: "Detected Changes",
            value: String(intelligence?.changes.length ?? 0),
            tone: "cobalt",
          },
        ]}
      />

      <section className="rounded-[2.1rem] border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] p-5">
        <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[color:var(--explorer-muted)]">
          Relationship Overview
        </p>
        <div className="mt-4 rounded-[1.7rem] bg-[color:var(--explorer-paper-strong)] px-5 py-5">
          {intelligenceStatus === "ready" && intelligence?.overview ? (
            <div className="space-y-4">
              <p className="max-w-4xl font-[var(--font-display)] text-2xl leading-relaxed text-[color:var(--explorer-ink)]">
                {intelligence.overview}
              </p>
              {intelligence.profile ? (
                <div className="flex flex-wrap gap-2">
                  <Chip>{intelligence.profile.category ?? "Unknown category"}</Chip>
                  {intelligence.profile.subcategory ? (
                    <Chip>{intelligence.profile.subcategory}</Chip>
                  ) : null}
                  {(intelligence.profile.keySignals ?? []).map((signal: string) => (
                    <Chip key={signal}>{signal}</Chip>
                  ))}
                </div>
              ) : null}
            </div>
          ) : intelligenceStatus === "pending" ? (
            <p className="text-sm text-[color:var(--explorer-muted)]">
              Intelligence generation is in progress. This page will refresh automatically when the dossier is ready.
            </p>
          ) : (
            <p className="text-sm text-[color:var(--explorer-muted)]">
              No LLM provider is configured for correspondent intelligence yet.
            </p>
          )}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-[2.1rem] border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] p-5">
          <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[color:var(--explorer-muted)]">
            Key Changes
          </p>
          <div className="mt-4 space-y-3">
            {(intelligence?.changes ?? []).length > 0 ? (
              intelligence!.changes.map((change: CorrespondentIntelligenceChange, index: number) => (
                <div
                  key={`${change.title}-${index}`}
                  className="rounded-[1.4rem] border border-[color:var(--explorer-border)] bg-white/60 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[color:var(--explorer-ink)]">
                      {change.title}
                    </p>
                    <span className="text-xs uppercase tracking-[0.18em] text-[color:var(--explorer-muted)]">
                      {change.effectiveDate ?? "Undated"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-[color:var(--explorer-muted)]">{change.description}</p>
                  {(change.valueBefore || change.valueAfter) && (
                    <p className="mt-2 text-xs text-[color:var(--explorer-muted)]">
                      {change.valueBefore ?? "n/a"} → {change.valueAfter ?? "n/a"}
                    </p>
                  )}
                </div>
              ))
            ) : (
              <EmptyCard label="No major changes detected yet." />
            )}
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

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-[2.1rem] border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] p-5">
          <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[color:var(--explorer-muted)]">
            Current State
          </p>
          <div className="mt-4 space-y-3">
            {(intelligence?.currentState ?? []).length > 0 ? (
              intelligence!.currentState.map((fact: CorrespondentIntelligenceFact) => (
                <div
                  key={`${fact.label}-${fact.value}`}
                  className="flex items-start justify-between gap-3 rounded-[1.35rem] border border-[color:var(--explorer-border)] bg-white/55 px-4 py-3"
                >
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--explorer-muted)]">
                      {fact.label}
                    </p>
                    <p className="mt-1 text-sm font-medium text-[color:var(--explorer-ink)]">
                      {fact.value}
                    </p>
                  </div>
                  <span className="text-xs text-[color:var(--explorer-muted)]">{fact.asOf ?? ""}</span>
                </div>
              ))
            ) : (
              <EmptyCard label="No current-state facts available yet." />
            )}
          </div>
        </section>

        <section className="rounded-[2.1rem] border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] p-5">
          <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[color:var(--explorer-muted)]">
            Timeline Highlights
          </p>
          <div className="mt-4 space-y-3">
            {(intelligence?.timeline ?? []).length > 0 ? (
              intelligence!.timeline.map((event: CorrespondentIntelligenceTimelineEvent, index: number) => (
                <div
                  key={`${event.title}-${index}`}
                  className="rounded-[1.4rem] border border-[color:var(--explorer-border)] bg-white/55 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm font-semibold text-[color:var(--explorer-ink)]">{event.title}</p>
                    <span className="text-xs uppercase tracking-[0.18em] text-[color:var(--explorer-muted)]">
                      {event.date ?? "Undated"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-[color:var(--explorer-muted)]">{event.description}</p>
                </div>
              ))
            ) : (
              <EmptyCard label="No timeline highlights available yet." />
            )}
          </div>
        </section>
      </div>

      {intelligence?.domainInsights.insurance ? (
        <section className="rounded-[2.1rem] border border-[color:var(--explorer-border)] bg-[linear-gradient(135deg,rgba(255,255,255,0.78),rgba(236,241,255,0.68))] p-5">
          <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[color:var(--explorer-muted)]">
            Insurance Lens
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <FactPanel
              label="Policy References"
              value={intelligence.domainInsights.insurance.policyReferences.join(", ") || "n/a"}
            />
            <FactPanel
              label="Latest Premium"
              value={
                intelligence.domainInsights.insurance.latestPremiumAmount != null &&
                intelligence.domainInsights.insurance.latestPremiumCurrency
                  ? formatCurrency(
                      intelligence.domainInsights.insurance.latestPremiumAmount,
                      intelligence.domainInsights.insurance.latestPremiumCurrency,
                    ) ?? "n/a"
                  : "n/a"
              }
            />
            <FactPanel
              label="Renewal"
              value={intelligence.domainInsights.insurance.renewalDate ?? "n/a"}
            />
            <FactPanel
              label="Cancellation"
              value={intelligence.domainInsights.insurance.cancellationWindow ?? "n/a"}
            />
          </div>
          {(intelligence.domainInsights.insurance.coverageHighlights ?? []).length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {intelligence.domainInsights.insurance.coverageHighlights.map((item: string) => (
                <Chip key={item}>{item}</Chip>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

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
                <span className="text-sm font-medium text-[color:var(--explorer-ink)]">{item.name}</span>
                <span className="text-sm text-[color:var(--explorer-muted)]">{item.count}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[2.1rem] border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] p-5">
          <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[color:var(--explorer-muted)]">
            Legacy Summary
          </p>
          <div className="mt-4 rounded-[1.6rem] border border-[color:var(--explorer-border)] bg-white/55 px-4 py-4">
            <p className="text-sm leading-relaxed text-[color:var(--explorer-muted)]">
              {data.summary ?? intelligence?.profile?.narrative ?? "No summary available yet."}
            </p>
          </div>
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
          <Button asChild variant="ghost" className="rounded-full">
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

type CorrespondentIntelligenceChange = CorrespondentIntelligence["changes"][number];
type CorrespondentIntelligenceFact = CorrespondentIntelligence["currentState"][number];
type CorrespondentIntelligenceTimelineEvent = CorrespondentIntelligence["timeline"][number];

function FactPanel({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.45rem] border border-[color:var(--explorer-border)] bg-white/65 px-4 py-4">
      <p className="text-[0.72rem] uppercase tracking-[0.18em] text-[color:var(--explorer-muted)]">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium text-[color:var(--explorer-ink)]">{value}</p>
    </div>
  );
}

function Chip({ children }: { children: string }) {
  return (
    <span className="rounded-full border border-[color:var(--explorer-border)] bg-white/70 px-3 py-1.5 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--explorer-ink)]">
      {children}
    </span>
  );
}

function EmptyCard({ label }: { label: string }) {
  return (
    <div className="flex min-h-28 items-center justify-center rounded-[1.5rem] border border-dashed border-[color:var(--explorer-border)] text-sm text-[color:var(--explorer-muted)]">
      {label}
    </div>
  );
}
