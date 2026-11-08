import type { ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Files,
  GitCompareArrows,
  Sparkles,
} from "lucide-react";
import type {
  Category,
  CorrespondentInsightsResponse,
  CorrespondentIntelligence,
  Document,
} from "@openkeep/types";
import { GradientPanel, Page } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { formatRowDate } from "@/components/explorer/document-table";
import {
  DocumentRows,
  ErrorBlock,
  MetricRibbon,
  MiniSparkline,
} from "@/components/explorer/shared";
import {
  fetchCorrespondentInsights,
  fetchFilteredDocuments,
  formatCurrency,
} from "@/lib/explorer";
import { authFetch } from "@/lib/api";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { processingRefetchInterval } from "@/lib/document-processing";

export const Route = createFileRoute("/correspondents/$slug")({
  component: CorrespondentDetailPage,
});

/** A radix Select item cannot carry an empty value, so "no category" needs a name. */
const NO_CATEGORY = "__none__";

function CorrespondentDetailPage() {
  const { slug } = Route.useParams();
  const navigate = Route.useNavigate();
  const { t } = useI18n();
  const queryClient = useQueryClient();

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
        sort: "issueDate",
        direction: "desc",
      }),
    enabled: Boolean(insightsQuery.data?.correspondent.id),
    refetchInterval: (query) => processingRefetchInterval(query.state.data, (data) => data?.items),
  });

  const categoriesQuery = useQuery({
    queryKey: ["taxonomies", "categories"],
    queryFn: async () => {
      const response = await authFetch("/api/taxonomies/categories");
      if (!response.ok) throw new Error("Failed to load categories");
      return (await response.json()) as Category[];
    },
  });

  const setCategoryMutation = useMutation({
    mutationFn: async ({ categoryId }: { categoryId: string | null }) => {
      const correspondent = insightsQuery.data?.correspondent;
      if (!correspondent) throw new Error("No correspondent loaded");
      const response = await authFetch(`/api/taxonomies/correspondents/${correspondent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: correspondent.name, categoryId }),
      });
      if (!response.ok) throw new Error(t("dossier.categoryFailed"));
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["correspondent", slug] }),
        queryClient.invalidateQueries({ queryKey: ["documents", "facets"] }),
        queryClient.invalidateQueries({ queryKey: ["taxonomies"] }),
      ]);
    },
  });

  if (insightsQuery.isLoading) {
    return <DossierSkeleton label={t("dossier.loading")} />;
  }

  if (insightsQuery.isError || !insightsQuery.data) {
    return (
      <Page>
        <ErrorBlock
          label={t("dossier.loadError")}
          action={
            <Button variant="outline" size="sm" onClick={() => insightsQuery.refetch()}>
              {t("dashboard.retry")}
            </Button>
          }
        />
      </Page>
    );
  }

  const data = insightsQuery.data;
  const intelligence = data.intelligence;
  const intelligenceStatus = data.intelligenceStatus;
  const timelineEvents = [...(intelligence?.timeline ?? [])].sort((left, right) =>
    compareIsoDates(right.date, left.date),
  );
  const orderedDocuments = [...(documentsQuery.data?.items ?? [])].sort((left, right) =>
    compareDocumentsNewestFirst(left, right),
  );
  const smartHighlight = buildSmartHighlight(data, intelligence, t);
  const notAvailable = t("dossier.notAvailable");
  const insurance = intelligence?.domainInsights.insurance;
  const categoryId = data.correspondent.categoryId ?? null;
  const categoryName =
    (categoriesQuery.data ?? []).find((category) => category.id === categoryId)?.name ??
    data.correspondent.categoryName ??
    t("dossier.categoryNone");
  const maxTypeCount = Math.max(...data.documentTypeBreakdown.map((item) => item.count), 1);

  return (
    <Page width="wide">
      <Button
        variant="ghost"
        size="sm"
        className="-my-2 -ml-2 self-start text-muted-foreground"
        onClick={() => navigate({ to: "/" })}
      >
        <ArrowLeft />
        {t("dossier.back")}
      </Button>

      <GradientPanel className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 p-5 md:p-6">
        <div className="min-w-0 flex-1 basis-80">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            {data.correspondent.name}
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-white/85">{t("dossier.description")}</p>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor="dossier-category" className="text-xs text-white/85">
              {t("dossier.category")}
            </Label>
            {categoryId ? (
              <span className="text-xs text-white/75">
                {data.correspondent.categorySource === "manual"
                  ? t("dossier.categorySetByYou")
                  : t("dossier.categoryAutomatic")}
              </span>
            ) : null}
          </div>
          <Select
            value={categoryId ?? NO_CATEGORY}
            disabled={setCategoryMutation.isPending}
            onValueChange={(value) =>
              setCategoryMutation.mutate({
                categoryId: value === NO_CATEGORY ? null : value,
              })
            }
          >
            <SelectTrigger
              id="dossier-category"
              className="h-9 w-full min-w-56 border-white/25 bg-white/15 text-white hover:bg-white/25 dark:bg-white/15 dark:hover:bg-white/25 [&_svg]:text-white/80"
            >
              <SelectValue>{categoryName}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_CATEGORY}>{t("dossier.categoryNone")}</SelectItem>
              {(categoriesQuery.data ?? []).map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {setCategoryMutation.isError ? (
            <Badge variant="danger" className="whitespace-normal">
              {t("dossier.categoryFailed")}
            </Badge>
          ) : null}
        </div>
      </GradientPanel>

      <MetricRibbon
        items={[
          {
            label: t("dossier.metricDocuments"),
            value: data.stats.documentCount.toLocaleString(),
            icon: <Files className="text-muted-foreground" />,
          },
          smartHighlight,
          {
            label: t("dossier.metricLastDocument"),
            value: data.stats.dateRange.to
              ? formatRowDate(data.stats.dateRange.to)
              : t("dossier.undated"),
            tone: "neutral",
            icon: <CalendarClock className="text-muted-foreground" />,
          },
          {
            label: t("dossier.metricChanges"),
            value: String(intelligence?.changes.length ?? 0),
            tone: "neutral",
            icon: <GitCompareArrows className="text-muted-foreground" />,
          },
        ]}
      />

      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <Section title={t("dossier.overview")} icon={<Sparkles className="size-4 text-brand" />}>
            <div className="px-4 pb-4 md:px-5 md:pb-5">
              {intelligenceStatus === "ready" && intelligence?.overview ? (
                <div className="flex flex-col gap-3.5">
                  <p className="max-w-4xl leading-relaxed">{intelligence.overview}</p>
                  {intelligence.profile ? (
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="brand">
                        {intelligence.profile.category ?? t("dossier.unknownCategory")}
                      </Badge>
                      {intelligence.profile.subcategory ? (
                        <Badge variant="secondary">{intelligence.profile.subcategory}</Badge>
                      ) : null}
                      {(intelligence.profile.keySignals ?? []).map((signal: string) => (
                        <Badge key={signal} variant="secondary">
                          {signal}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : intelligenceStatus === "pending" ? (
                <p className="flex items-center gap-2.5 text-sm text-muted-foreground">
                  <Spinner className="shrink-0 text-brand" aria-hidden="true" />
                  {t("dossier.generating")}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">{t("dossier.noProvider")}</p>
              )}
            </div>
          </Section>

          <Section title={t("dossier.changes")}>
            {(intelligence?.changes ?? []).length > 0 ? (
              <ul className="divide-y border-t">
                {intelligence!.changes.map((change: CorrespondentIntelligenceChange, index: number) => (
                  <li key={`${change.title}-${index}`} className="px-4 py-3.5 md:px-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <p className="text-sm font-medium">{change.title}</p>
                      <span className="num text-xs text-muted-foreground">
                        {change.effectiveDate ?? t("dossier.undated")}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{change.description}</p>
                    {change.valueBefore || change.valueAfter ? (
                      <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                        <Badge variant="secondary">{change.valueBefore ?? notAvailable}</Badge>
                        <ArrowRight aria-hidden="true" className="size-3 text-muted-foreground" />
                        <Badge variant="brand">{change.valueAfter ?? notAvailable}</Badge>
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyNote label={t("dossier.noChanges")} />
            )}
          </Section>

          {insurance ? (
            <Section title={t("dossier.insurance")}>
              <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2 md:px-5 md:pb-5 xl:grid-cols-4">
                <Fact
                  label={t("dossier.policyReferences")}
                  value={insurance.policyReferences.join(", ") || notAvailable}
                />
                <Fact
                  label={t("dossier.latestPremium")}
                  value={
                    insurance.latestPremiumAmount != null && insurance.latestPremiumCurrency
                      ? formatCurrency(
                          insurance.latestPremiumAmount,
                          insurance.latestPremiumCurrency,
                        ) ?? notAvailable
                      : notAvailable
                  }
                />
                <Fact
                  label={t("dossier.renewal")}
                  value={insurance.renewalDate ?? notAvailable}
                />
                <Fact
                  label={t("dossier.cancellation")}
                  value={insurance.cancellationWindow ?? notAvailable}
                />
              </div>
              {(insurance.coverageHighlights ?? []).length > 0 ? (
                <div className="flex flex-wrap gap-1.5 px-4 pb-4 md:px-5 md:pb-5">
                  {insurance.coverageHighlights.map((item: string) => (
                    <Badge key={item} variant="secondary">
                      {item}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </Section>
          ) : null}

          <Section
            title={t("dossier.documentsFrom").replace("{name}", data.correspondent.name)}
            action={
              <Button asChild variant="outline" size="sm">
                <Link
                  to="/documents"
                  search={{
                    correspondentIds: [data.correspondent.id],
                    view: "list",
                  }}
                >
                  {t("dossier.openInExplorer")}
                </Link>
              </Button>
            }
          >
            <div className="border-t">
              {documentsQuery.isLoading ? (
                <div
                  role="status"
                  aria-label={t("dossier.loadingDocuments")}
                  className="flex flex-col gap-4 p-5"
                >
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-4 w-2/5" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ) : documentsQuery.isError ? (
                <div className="p-4">
                  <ErrorBlock
                    label={t("dossier.documentsError")}
                    action={
                      <Button variant="outline" size="sm" onClick={() => documentsQuery.refetch()}>
                        {t("dashboard.retry")}
                      </Button>
                    }
                  />
                </div>
              ) : (
                <DocumentRows documents={orderedDocuments} />
              )}
            </div>
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Section title={t("dossier.activity")}>
            <div className="px-4 pb-4 md:px-5">
              <MiniSparkline data={data.timeline} />
            </div>
          </Section>

          <Section title={t("dossier.currentState")}>
            {(intelligence?.currentState ?? []).length > 0 ? (
              <dl className="divide-y border-t">
                {intelligence!.currentState.map((fact: CorrespondentIntelligenceFact) => (
                  <div
                    key={`${fact.label}-${fact.value}`}
                    className="flex items-start justify-between gap-3 px-4 py-3 md:px-5"
                  >
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{fact.label}</dt>
                      <dd className="mt-0.5 text-sm font-medium">{fact.value}</dd>
                    </div>
                    <span className="num shrink-0 text-xs text-muted-foreground">
                      {fact.asOf ?? ""}
                    </span>
                  </div>
                ))}
              </dl>
            ) : (
              <EmptyNote label={t("dossier.noCurrentState")} />
            )}
          </Section>

          <Section title={t("dossier.timeline")}>
            {timelineEvents.length > 0 ? (
              <ol className="flex flex-col gap-4 px-4 pb-4 md:px-5 md:pb-5">
                {timelineEvents.map((event: CorrespondentIntelligenceTimelineEvent, index: number) => (
                  <li
                    key={`${event.title}-${index}`}
                    className="relative pl-5 not-last:before:absolute not-last:before:top-2 not-last:before:-bottom-5.5 not-last:before:left-[3.5px] not-last:before:w-px not-last:before:bg-border"
                  >
                    <span
                      aria-hidden="true"
                      className="absolute top-1.5 left-0 z-10 size-2 rounded-full bg-primary ring-4 ring-card"
                    />
                    <span className="num block text-xs text-muted-foreground">
                      {event.date ?? t("dossier.undated")}
                    </span>
                    <p className="mt-0.5 text-sm font-medium">{event.title}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{event.description}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyNote label={t("dossier.noTimeline")} />
            )}
          </Section>

          <Section title={t("dossier.typeBreakdown")}>
            {data.documentTypeBreakdown.length > 0 ? (
              <ul className="flex flex-col gap-3 px-4 pb-4 md:px-5 md:pb-5">
                {data.documentTypeBreakdown.map((item) => (
                  <li key={item.name}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">{item.name}</span>
                      <span className="num shrink-0 font-medium">{item.count}</span>
                    </div>
                    <div
                      aria-hidden="true"
                      className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
                    >
                      <div
                        className="h-full rounded-full bg-gradient-action"
                        style={{ width: `${Math.max((item.count / maxTypeCount) * 100, 3)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyNote label={t("dossier.noTypes")} />
            )}
          </Section>

          <Section title={t("dossier.summary")}>
            <p className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground md:px-5 md:pb-5">
              {data.summary ?? intelligence?.profile?.narrative ?? t("dossier.noSummary")}
            </p>
          </Section>
        </div>
      </div>
    </Page>
  );
}

type CorrespondentIntelligenceChange = CorrespondentIntelligence["changes"][number];
type CorrespondentIntelligenceFact = CorrespondentIntelligence["currentState"][number];
type CorrespondentIntelligenceTimelineEvent = CorrespondentIntelligence["timeline"][number];

function compareDocumentsNewestFirst(left: Document, right: Document): number {
  return compareIsoDates(right.issueDate ?? right.createdAt, left.issueDate ?? left.createdAt);
}

function compareIsoDates(left: string | null | undefined, right: string | null | undefined): number {
  return (left ?? "").localeCompare(right ?? "");
}

function buildSmartHighlight(
  data: CorrespondentInsightsResponse,
  intelligence: CorrespondentIntelligence | null,
  t: (key: TranslationKey) => string,
): { label: string; value: string; tone?: "neutral" | "rust" | "cobalt" } {
  const insurance = intelligence?.domainInsights.insurance;
  if (insurance?.latestPremiumAmount != null && insurance.latestPremiumCurrency) {
    return {
      label: t("dossier.latestPremium"),
      value:
        formatCurrency(insurance.latestPremiumAmount, insurance.latestPremiumCurrency) ??
        t("dossier.notAvailable"),
      tone: "cobalt",
    };
  }

  const latestAmount = findCurrentStateFact(intelligence, "Latest amount");
  if (latestAmount) {
    return {
      label: t("dossier.latestAmount"),
      value: latestAmount,
      tone: "cobalt",
    };
  }

  const latestDocumentType = findCurrentStateFact(intelligence, "Latest document type");
  if (latestDocumentType) {
    return {
      label: t("dossier.latestType"),
      value: latestDocumentType,
      tone: "cobalt",
    };
  }

  return {
    label: t("dossier.topType"),
    value: data.documentTypeBreakdown[0]?.name ?? t("dossier.notAvailable"),
    tone: "cobalt",
  };
}

function findCurrentStateFact(
  intelligence: CorrespondentIntelligence | null,
  label: string,
): string | null {
  return intelligence?.currentState.find((fact) => fact.label.toLowerCase() === label.toLowerCase())?.value ?? null;
}

/** A dossier card: a titled white surface whose body sets its own padding. */
function Section({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="gap-0 py-0 shadow-card">
      <div className="flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 md:px-5">
        <h2 className="flex min-w-0 items-center gap-2 font-medium">
          {icon}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-medium break-words">{value}</div>
    </div>
  );
}

function EmptyNote({ label }: { label: string }) {
  return (
    <Empty className="border-t px-4 py-7">
      <EmptyHeader>
        <EmptyDescription>{label}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function DossierSkeleton({ label }: { label: string }) {
  return (
    <Page width="wide" role="status" aria-label={label}>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-32 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((card) => (
          <Skeleton key={card} className="h-20 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </Page>
  );
}
