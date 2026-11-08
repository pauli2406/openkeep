import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ExplorerFacets, ExplorerSearch } from "@/lib/explorer";
import { statusLabel } from "./shared";

type FilterSidebarProps = {
  facets?: ExplorerFacets;
  search: ExplorerSearch;
  onSearchChange: (updates: Partial<ExplorerSearch>) => void;
  /** Facets are still on their way: rows would flash in, so show their shape. */
  loading?: boolean;
  /** Facets failed: filters already in the URL still apply, so only say so. */
  error?: boolean;
  onRetry?: () => void;
  /** `card` is the inline panel; `plain` is the same content inside a sheet. */
  surface?: "card" | "plain";
  className?: string;
};

/** Above this many entries a section gets its own filter box and virtualises. */
const SEARCHABLE_THRESHOLD = 8;
const ROW_HEIGHT = 32;
const MAX_LIST_HEIGHT = 288;

type FacetEntry = { id: string; label: string; count: number };

function toggleArrayValue(values: string[] | undefined, value: string) {
  if (!values || values.length === 0) return [value];
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

/** How many filter dimensions are set; the toolbar's badge shares this number. */
export function countActiveFilters(search: ExplorerSearch): number {
  return [
    search.year != null,
    Boolean(search.correspondentIds?.length),
    Boolean(search.documentTypeIds?.length),
    Boolean(search.statuses?.length),
    Boolean(search.tags?.length),
    Boolean(search.categoryIds?.length),
    Boolean(search.uncategorized),
    // != null, not truthiness: an amountMin of 0 is a real filter
    search.amountMin != null || search.amountMax != null,
    Boolean(search.dateFrom || search.dateTo),
  ].filter(Boolean).length;
}

function FacetRow({
  entry,
  checked,
  onToggle,
  style,
}: {
  entry: FacetEntry;
  checked: boolean;
  onToggle: () => void;
  style?: CSSProperties;
}) {
  return (
    <label
      style={style}
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm transition-colors hover:bg-muted"
    >
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
      <span className="num shrink-0 text-xs text-muted-foreground">{entry.count}</span>
    </label>
  );
}

/**
 * Owns the virtualizer so it is created with its scroll element: the collapsible
 * mounts this subtree after its parent's layout pass, which a virtualizer held
 * by the section would miss.
 */
function VirtualFacetList({
  entries,
  selectedIds,
  onToggle,
}: {
  entries: FacetEntry[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });
  const listHeight = Math.min(entries.length * ROW_HEIGHT, MAX_LIST_HEIGHT);

  return (
    <div ref={parentRef} style={{ height: listHeight }} className="overflow-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((row) => {
          const entry = entries[row.index];
          return (
            <FacetRow
              key={entry.id}
              entry={entry}
              checked={selectedIds.includes(entry.id)}
              onToggle={() => onToggle(entry.id)}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: ROW_HEIGHT,
                transform: `translateY(${row.start}px)`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function FilterSection({
  title,
  activeCount = 0,
  defaultOpen = true,
  children,
}: {
  title: string;
  activeCount?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen || activeCount > 0} className="group/section border-b last:border-b-0">
      <CollapsibleTrigger className="flex h-10 w-full items-center gap-2 px-4 text-sm font-medium transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60">
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-data-[state=open]/section:rotate-90" />
        {title}
        {activeCount > 0 ? (
          <Badge variant="brand" className="num ml-auto">
            {activeCount}
          </Badge>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-2 pb-2.5">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** One collapsible facet section; searches and virtualises past the threshold. */
function FacetSection({
  title,
  entries,
  selectedIds,
  onToggle,
  defaultOpen,
  formatLabel,
}: {
  title: string;
  entries: FacetEntry[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  defaultOpen?: boolean;
  formatLabel?: (entry: FacetEntry) => string;
}) {
  const { t } = useI18n();
  const [filter, setFilter] = useState("");

  const searchable = entries.length > SEARCHABLE_THRESHOLD;
  const visible = useMemo(() => {
    const labelled = formatLabel
      ? entries.map((entry) => ({ ...entry, label: formatLabel(entry) }))
      : entries;
    if (!filter.trim()) return labelled;
    const needle = filter.trim().toLowerCase();
    return labelled.filter((entry) => entry.label.toLowerCase().includes(needle));
  }, [entries, filter, formatLabel]);

  if (entries.length === 0) return null;

  return (
    <FilterSection title={title} activeCount={selectedIds.length} defaultOpen={defaultOpen}>
      {searchable ? (
        <div className="px-2 pb-1.5">
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t("filters.searchPlaceholder")}
            aria-label={`${title}: ${t("filters.searchPlaceholder")}`}
          />
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">{t("filters.noMatches")}</p>
      ) : searchable ? (
        // Virtualised: only the rows in view are mounted.
        <VirtualFacetList entries={visible} selectedIds={selectedIds} onToggle={onToggle} />
      ) : (
        visible.map((entry) => (
          <FacetRow
            key={entry.id}
            entry={entry}
            checked={selectedIds.includes(entry.id)}
            onToggle={() => onToggle(entry.id)}
            style={{ height: ROW_HEIGHT }}
          />
        ))
      )}
    </FilterSection>
  );
}

function FacetsSkeleton() {
  return (
    <div className="flex flex-col gap-2.5 p-4">
      {[0, 1, 2].map((group) => (
        <div key={group} className="flex flex-col gap-2.5 pb-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export function FilterSidebar({
  facets,
  search,
  onSearchChange,
  loading = false,
  error = false,
  onRetry,
  surface = "card",
  className,
}: FilterSidebarProps) {
  const { t } = useI18n();

  const activeCount = countActiveFilters(search);

  const clearAll = () =>
    onSearchChange({
      year: undefined,
      correspondentIds: undefined,
      documentTypeIds: undefined,
      statuses: undefined,
      tags: undefined,
      categoryIds: undefined,
      uncategorized: undefined,
      amountMin: undefined,
      amountMax: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      page: undefined,
    });

  const clearButton =
    activeCount > 0 ? (
      <Button variant="ghost" size="xs" className="text-brand" onClick={clearAll}>
        {t("filters.clear")}
      </Button>
    ) : null;

  const sections = loading ? (
    <FacetsSkeleton />
  ) : (
    <>
      {error ? (
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3 text-xs text-danger">
          {t("filters.loadError")}
          {onRetry ? (
            <Button variant="outline" size="xs" onClick={onRetry}>
              {t("dashboard.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <FacetSection
        title={t("filters.status")}
        entries={(facets?.statuses ?? []).map((entry) => ({
          id: entry.status,
          label: entry.status,
          count: entry.count,
        }))}
        formatLabel={(entry) => statusLabel(entry.id, t)}
        selectedIds={search.statuses ?? []}
        onToggle={(id) =>
          onSearchChange({
            statuses: toggleArrayValue(search.statuses, id),
            page: undefined,
          })
        }
      />

      <FacetSection
        title={t("filters.year")}
        entries={(facets?.years ?? []).map((entry) => ({
          id: String(entry.year),
          label: String(entry.year),
          count: entry.count,
        }))}
        selectedIds={search.year ? [String(search.year)] : []}
        onToggle={(id) =>
          onSearchChange({
            year: search.year === Number(id) ? undefined : Number(id),
            page: undefined,
          })
        }
      />

      <FacetSection
        title={t("filters.type")}
        entries={(facets?.documentTypes ?? []).map((entry) => ({
          id: entry.id,
          label: entry.name,
          count: entry.count,
        }))}
        selectedIds={search.documentTypeIds ?? []}
        onToggle={(id) =>
          onSearchChange({
            documentTypeIds: toggleArrayValue(search.documentTypeIds, id),
            page: undefined,
          })
        }
      />

      <FacetSection
        title={t("filters.correspondent")}
        entries={(facets?.correspondents ?? []).map((entry) => ({
          id: entry.id,
          label: entry.name,
          count: entry.count,
        }))}
        selectedIds={search.correspondentIds ?? []}
        onToggle={(id) =>
          onSearchChange({
            correspondentIds: toggleArrayValue(search.correspondentIds, id),
            page: undefined,
          })
        }
      />

      <FacetSection
        title={t("filters.category")}
        defaultOpen={false}
        entries={[
          ...(facets?.categories ?? []).map((entry) => ({
            id: entry.id,
            label: entry.name,
            count: entry.count,
          })),
          ...((facets?.uncategorizedCount ?? 0) > 0
            ? [
                {
                  id: "__uncategorized__",
                  label: t("filters.uncategorized"),
                  count: facets?.uncategorizedCount ?? 0,
                },
              ]
            : []),
        ]}
        selectedIds={[
          ...(search.categoryIds ?? []),
          ...(search.uncategorized ? ["__uncategorized__"] : []),
        ]}
        onToggle={(id) =>
          id === "__uncategorized__"
            ? onSearchChange({
                uncategorized: search.uncategorized ? undefined : true,
                page: undefined,
              })
            : onSearchChange({
                categoryIds: toggleArrayValue(search.categoryIds, id),
                page: undefined,
              })
        }
      />

      <FacetSection
        title={t("filters.tag")}
        defaultOpen={false}
        entries={(facets?.tags ?? []).map((entry) => ({
          id: entry.id,
          label: entry.name,
          count: entry.count,
        }))}
        selectedIds={search.tags ?? []}
        onToggle={(id) =>
          onSearchChange({
            tags: toggleArrayValue(search.tags, id),
            page: undefined,
          })
        }
      />

      {/* Date and Amount are ranges, not facet lists. */}
      <FilterSection
        title={t("filters.date")}
        defaultOpen={false}
        activeCount={search.dateFrom || search.dateTo ? 1 : 0}
      >
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-2 pt-0.5">
          <Label htmlFor="filter-date-from" className="text-xs text-muted-foreground">
            {t("filters.dateFrom")}
          </Label>
          <Input
            id="filter-date-from"
            type="date"
            value={search.dateFrom ?? ""}
            onChange={(event) =>
              onSearchChange({
                dateFrom: event.target.value || undefined,
                page: undefined,
              })
            }
          />
          <Label htmlFor="filter-date-to" className="text-xs text-muted-foreground">
            {t("filters.dateTo")}
          </Label>
          <Input
            id="filter-date-to"
            type="date"
            value={search.dateTo ?? ""}
            onChange={(event) =>
              onSearchChange({
                dateTo: event.target.value || undefined,
                page: undefined,
              })
            }
          />
        </div>
      </FilterSection>

      <FilterSection
        title={t("filters.amount")}
        defaultOpen={false}
        activeCount={search.amountMin != null || search.amountMax != null ? 1 : 0}
      >
        <div className="grid grid-cols-2 gap-2 px-2 pt-0.5">
          <Input
            type="number"
            inputMode="decimal"
            aria-label={t("filters.min")}
            placeholder={t("filters.min")}
            value={search.amountMin ?? ""}
            onChange={(event) =>
              onSearchChange({
                amountMin: event.target.value ? Number(event.target.value) : undefined,
                page: undefined,
              })
            }
            className="num"
          />
          <Input
            type="number"
            inputMode="decimal"
            aria-label={t("filters.max")}
            placeholder={t("filters.max")}
            value={search.amountMax ?? ""}
            onChange={(event) =>
              onSearchChange({
                amountMax: event.target.value ? Number(event.target.value) : undefined,
                page: undefined,
              })
            }
            className="num"
          />
        </div>
      </FilterSection>
    </>
  );

  if (surface === "plain") {
    return (
      <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
        {clearButton ? <div className="flex justify-end px-3 pb-1">{clearButton}</div> : null}
        <div className="min-h-0 flex-1 overflow-y-auto border-t">{sections}</div>
      </div>
    );
  }

  return (
    <Card
      className={cn(
        "gap-0 py-0 shadow-card xl:sticky xl:top-6 xl:max-h-[calc(100svh-8rem)] xl:self-start",
        className,
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
        <h2 className="font-medium">{t("filters.title")}</h2>
        {clearButton}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{sections}</div>
    </Card>
  );
}
