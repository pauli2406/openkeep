import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Download, FolderOpen } from "lucide-react";
import type { TaxYearGroup, TaxYearMembership, TaxYearResponse } from "@openkeep/types";
import { Button } from "@/components/ui/button";
import {
  ErrorBlock,
  ExplorerSectionHeader,
  LoadingBlock,
  MetricRibbon,
} from "@/components/explorer/shared";
import { fetchExplorerFacets, formatCurrency } from "@/lib/explorer";
import { defaultTaxYear, downloadTaxYearExport, fetchTaxYear, parseTaxesSearch } from "@/lib/taxes";
import { useI18n, type TranslationKey } from "@/lib/i18n";

export const Route = createFileRoute("/taxes")({
  validateSearch: parseTaxesSearch,
  component: TaxesPage,
});

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

  if (taxYearQuery.isLoading) {
    return <LoadingBlock label={t("taxes.loading")} />;
  }

  if (taxYearQuery.isError || !taxYearQuery.data) {
    return (
      <div className="p-6 md:p-8">
        <ErrorBlock
          label={t("taxes.error")}
          action={
            <Button variant="outline" onClick={() => taxYearQuery.refetch()}>
              {t("taxes.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  const data = taxYearQuery.data;

  return (
    <div className="space-y-8 p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <ExplorerSectionHeader
          eyebrow={t("taxes.eyebrow")}
          title={t("taxes.title").replace("{year}", String(year))}
          description={t("taxes.description")}
        />
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            disabled={exportState === "running" || data.documentCount === 0}
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
            <Download className="h-4 w-4" />
            {exportState === "running" ? t("taxes.exporting") : t("taxes.export")}
          </Button>
          {exportState === "failed" ? (
            <span className="text-sm text-destructive">{t("taxes.exportFailed")}</span>
          ) : null}
        <label className="flex items-center gap-2 text-sm text-[color:var(--explorer-muted)]">
          {t("taxes.yearPicker")}
          <select
            value={year}
            onChange={(event) =>
              navigate({ search: { year: Number(event.target.value) }, replace: true })
            }
            className="h-9 rounded-[var(--r-md)] border border-input bg-card px-3 text-sm text-[color:var(--explorer-ink)]"
          >
            {availableYears.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        </div>
      </div>

      <MetricRibbon items={buildMetrics(data, t)} />

      {data.documentCount === 0 ? (
        <div className="flex min-h-40 items-center justify-center rounded-[var(--r-lg)] border border-dashed border-[color:var(--explorer-border)] text-sm text-[color:var(--explorer-muted)]">
          {t("taxes.empty").replace("{year}", String(year))}
        </div>
      ) : (
        <div className="space-y-6">
          {data.groups.map((group) => (
            <TaxGroupSection key={group.documentTypeId ?? "unfiled"} group={group} year={year} />
          ))}
        </div>
      )}
    </div>
  );
}

function buildMetrics(
  data: TaxYearResponse,
  t: (key: TranslationKey) => string,
): Array<{ label: string; value: string; tone?: "rust" | "cobalt" | "neutral" }> {
  const items: Array<{ label: string; value: string; tone?: "rust" | "cobalt" | "neutral" }> = [
    {
      label: t("taxes.metricDocuments"),
      value: data.documentCount.toLocaleString(),
    },
  ];

  for (const total of data.totals.slice(0, 2)) {
    items.push({
      label: t("taxes.metricTotal").replace("{currency}", total.currency),
      value: formatCurrency(total.sum, total.currency) ?? `${total.sum} ${total.currency}`,
      tone: "rust",
    });
  }

  items.push({
    label: t("taxes.metricUnsummed"),
    value: data.unsummedCount.toLocaleString(),
    tone: data.unsummedCount > 0 ? "cobalt" : "neutral",
  });

  return items.slice(0, 4);
}

function TaxGroupSection({ group, year }: { group: TaxYearGroup; year: number }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(true);

  const totalsLabel = group.totals
    .map((total) => formatCurrency(total.sum, total.currency) ?? `${total.sum} ${total.currency}`)
    .join(" · ");

  return (
    <section className="rounded-[var(--r-lg)] border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="flex items-center gap-2 text-left"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-[color:var(--explorer-muted)]" />
          ) : (
            <ChevronRight className="h-4 w-4 text-[color:var(--explorer-muted)]" />
          )}
          <span className="text-sm font-semibold text-[color:var(--explorer-ink)]">
            {group.documentType ?? t("taxes.unfiled")}
          </span>
          <span className="ok-num text-xs text-[color:var(--explorer-muted)]">
            {group.count}
          </span>
        </button>
        <div className="flex items-center gap-3">
          {totalsLabel ? (
            <span className="ok-num text-sm text-[color:var(--explorer-ink)]">{totalsLabel}</span>
          ) : null}
          {group.unsummedCount > 0 ? (
            <span className="text-xs text-[color:var(--explorer-muted)]">
              {t("taxes.groupUnsummed").replace("{count}", String(group.unsummedCount))}
            </span>
          ) : null}
          {group.documentTypeId ? (
            <Button asChild variant="ghost" size="sm">
              <Link
                to="/documents"
                search={{
                  year,
                  documentTypeIds: [group.documentTypeId],
                  view: "list",
                }}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {t("taxes.openInExplorer")}
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-[color:var(--explorer-border)]">
          {group.documents.map((document) => (
            <Link
              key={document.id}
              to="/documents/$documentId"
              params={{ documentId: document.id }}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--explorer-border)] px-5 py-3 last:border-b-0 hover:bg-secondary/50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[color:var(--explorer-ink)]">
                  {document.title}
                </p>
                <p className="mt-0.5 text-xs text-[color:var(--explorer-muted)]">
                  {[document.correspondentName, document.issueDate]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <MembershipChip memberVia={document.memberVia} />
                <span className="ok-num text-sm text-[color:var(--explorer-ink)]">
                  {document.amount !== null && document.currency
                    ? formatCurrency(document.amount, document.currency)
                    : t("taxes.noAmount")}
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function MembershipChip({ memberVia }: { memberVia: TaxYearMembership }) {
  const { t } = useI18n();
  const label =
    memberVia === "tag"
      ? t("taxes.viaTag")
      : memberVia === "type"
        ? t("taxes.viaType")
        : t("taxes.viaBoth");
  const hint = memberVia === "type" ? t("taxes.viaTypeHint") : t("taxes.viaTagHint");

  return (
    <span
      title={hint}
      className="rounded-full border border-[color:var(--explorer-border)] bg-card px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] text-[color:var(--explorer-muted)]"
    >
      {label}
    </span>
  );
}
