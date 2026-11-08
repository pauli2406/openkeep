import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  FolderOpen,
  Landmark,
  ReceiptText,
} from "lucide-react";
import type { TaxYearGroup, TaxYearMembership, TaxYearResponse } from "@openkeep/types";
import { GradientPanel, IconTile, Page, PageHeader } from "@/components/layout/page";
import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchExplorerFacets, formatCurrency } from "@/lib/explorer";
import { defaultTaxYear, downloadTaxYearExport, fetchTaxYear, parseTaxesSearch } from "@/lib/taxes";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/taxes")({
  validateSearch: parseTaxesSearch,
  component: TaxesPage,
});

function money(total: { sum: number; currency: string }): string {
  return formatCurrency(total.sum, total.currency) ?? `${total.sum} ${total.currency}`;
}

/** Issue dates are date-only; `new Date(str)` would read them as UTC and can shift the day. */
function formatIssueDate(value: string | null | undefined, language: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!match) return value ?? null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString(
    language === "de" ? "de-DE" : "en-GB",
    { day: "2-digit", month: "2-digit", year: "numeric" },
  );
}

function TaxesPage() {
  const { t } = useI18n();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const year = search.year ?? defaultTaxYear();
  const [exportState, setExportState] = useState<"idle" | "running" | "failed">("idle");

  const taxYearQuery = useQuery({
    queryKey: ["taxes", year],
    queryFn: () => fetchTaxYear(year),
  });

  // Only offer years that actually hold documents, plus the one in view.
  const facetsQuery = useQuery({
    queryKey: ["explorer-facets", "all"],
    queryFn: () => fetchExplorerFacets(),
  });

  const availableYears = useMemo(() => {
    const years = new Set<number>([year, defaultTaxYear()]);
    for (const entry of facetsQuery.data?.years ?? []) {
      years.add(entry.year);
    }
    return [...years].sort((a, b) => b - a);
  }, [facetsQuery.data, year]);

  const data = taxYearQuery.data;

  return (
    <Page>
      <PageHeader
        icon={<Landmark />}
        title={t("taxes.title").replace("{year}", String(year))}
        actions={
          <>
            {exportState === "failed" ? (
              <span role="alert" className="text-sm text-destructive">
                {t("taxes.exportFailed")}
              </span>
            ) : null}
            <Button
              variant="outline"
              disabled={exportState === "running" || !data || data.documentCount === 0}
              onClick={async () => {
                setExportState("running");
                try {
                  await downloadTaxYearExport(year);
                  setExportState("idle");
                } catch {
                  setExportState("failed");
                }
              }}
            >
              <Download />
              {exportState === "running" ? t("taxes.exporting") : t("taxes.export")}
            </Button>
            {/* Native on purpose: a year list is short and the OS picker is at its best on a phone. */}
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              {t("taxes.yearPicker")}
              <span className="relative">
                <select
                  value={year}
                  onChange={(event) =>
                    navigate({ search: { year: Number(event.target.value) }, replace: true })
                  }
                  className="num h-8 appearance-none rounded-lg border border-input bg-transparent pr-8 pl-2.5 text-sm font-medium text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50"
                >
                  {availableYears.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
                />
              </span>
            </label>
          </>
        }
      />
      <p className="-mt-3 max-w-3xl text-sm text-muted-foreground">{t("taxes.description")}</p>

      {taxYearQuery.isLoading ? (
        <TaxesSkeleton label={t("taxes.loading")} />
      ) : taxYearQuery.isError || !data ? (
        <Alert variant="destructive" className="min-h-12 content-center">
          <AlertTriangle />
          <AlertTitle>{t("taxes.error")}</AlertTitle>
          <AlertAction>
            <Button
              variant="outline"
              size="sm"
              className="text-foreground"
              onClick={() => taxYearQuery.refetch()}
            >
              {t("taxes.retry")}
            </Button>
          </AlertAction>
        </Alert>
      ) : data.documentCount === 0 ? (
        <Empty className="flex-none rounded-2xl bg-gradient-wash px-6 py-16">
          <EmptyHeader className="max-w-md">
            <EmptyMedia>
              <IconTile size="lg" tone="solid">
                <ReceiptText />
              </IconTile>
            </EmptyMedia>
            <EmptyDescription>
              {t("taxes.empty").replace("{year}", String(year))}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <YearSummary data={data} />
          <section className="flex flex-col gap-3">
            <h2 className="font-medium">{t("taxes.groupsHeading")}</h2>
            {data.groups.map((group) => (
              <TaxGroupSection key={group.documentTypeId ?? "unfiled"} group={group} year={year} />
            ))}
          </section>
        </>
      )}
    </Page>
  );
}

function TaxesSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-6">
      <Skeleton className="h-40 w-full rounded-2xl" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-36 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    </div>
  );
}

/** The year at a glance: the sum first, then what it does and doesn't include. */
function YearSummary({ data }: { data: TaxYearResponse }) {
  const { t } = useI18n();
  const [lead, ...otherTotals] = data.totals;
  const documents = data.documentCount.toLocaleString();

  return (
    <GradientPanel className="flex flex-col gap-6 p-5 md:flex-row md:items-end md:justify-between md:p-7">
      <div className="min-w-0">
        <p className="text-sm text-white/85">
          {lead
            ? t("taxes.metricTotal").replace("{currency}", lead.currency)
            : t("taxes.metricDocuments")}
        </p>
        <p className="num mt-1 text-4xl font-semibold tracking-tight md:text-5xl">
          {lead ? money(lead) : documents}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2.5 md:flex md:shrink-0">
        {otherTotals.map((total) => (
          <SummaryTile
            key={total.currency}
            label={t("taxes.metricTotal").replace("{currency}", total.currency)}
            value={money(total)}
          />
        ))}
        {lead ? <SummaryTile label={t("taxes.metricDocuments")} value={documents} /> : null}
        <SummaryTile
          label={t("taxes.metricUnsummed")}
          value={data.unsummedCount.toLocaleString()}
        />
      </dl>
    </GradientPanel>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/12 px-3.5 py-3 md:min-w-32">
      <dt className="truncate text-sm text-white/85">{label}</dt>
      <dd className="num mt-1 text-2xl font-semibold tracking-tight">{value}</dd>
    </div>
  );
}

function TaxGroupSection({ group, year }: { group: TaxYearGroup; year: number }) {
  const { t, language } = useI18n();
  const [expanded, setExpanded] = useState(true);

  const totalsLabel = group.totals.map(money).join(" · ");

  return (
    <Card className="gap-0 py-0 shadow-card">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
          <CollapsibleTrigger className="-ml-1 flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <ChevronRight
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                expanded && "rotate-90",
              )}
            />
            <span className="truncate font-medium">
              {group.documentType ?? t("taxes.unfiled")}
            </span>
            <Badge variant="secondary" className="num">
              {group.count}
            </Badge>
          </CollapsibleTrigger>
          {group.unsummedCount > 0 ? (
            <span className="text-xs text-warning">
              {t("taxes.groupUnsummed").replace("{count}", String(group.unsummedCount))}
            </span>
          ) : null}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
            {group.documentTypeId ? (
              <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
                <Link
                  to="/documents"
                  search={{
                    year,
                    documentTypeIds: [group.documentTypeId],
                    view: "list",
                  }}
                >
                  <FolderOpen />
                  {t("taxes.openInExplorer")}
                </Link>
              </Button>
            ) : null}
            {totalsLabel ? (
              <span className="num text-sm font-semibold">{totalsLabel}</span>
            ) : null}
          </div>
        </div>

        <CollapsibleContent>
          <ul className="divide-y border-t">
            {group.documents.map((document) => (
              <li key={document.id}>
                <Link
                  to="/documents/$documentId"
                  params={{ documentId: document.id }}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 transition-colors outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:grid-cols-[minmax(0,1fr)_auto_7rem]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{document.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[document.correspondentName, formatIssueDate(document.issueDate, language)]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {/* Under the title on a phone, its own column from sm up. */}
                  <MembershipChip
                    memberVia={document.memberVia}
                    className="col-start-1 row-start-2 sm:col-start-2 sm:row-start-1"
                  />
                  <span
                    className={cn(
                      "col-start-2 row-start-1 text-right text-sm sm:col-start-3",
                      document.amount !== null && document.currency
                        ? "num font-medium"
                        : "text-muted-foreground",
                    )}
                  >
                    {document.amount !== null && document.currency
                      ? formatCurrency(document.amount, document.currency)
                      : t("taxes.noAmount")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function MembershipChip({
  memberVia,
  className,
}: {
  memberVia: TaxYearMembership;
  className?: string;
}) {
  const { t } = useI18n();
  const label =
    memberVia === "tag"
      ? t("taxes.viaTag")
      : memberVia === "type"
        ? t("taxes.viaType")
        : t("taxes.viaBoth");
  const hint = memberVia === "type" ? t("taxes.viaTypeHint") : t("taxes.viaTagHint");

  return (
    <Badge variant="outline" title={hint} className={cn("text-muted-foreground", className)}>
      {label}
    </Badge>
  );
}
