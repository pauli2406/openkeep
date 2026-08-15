import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ExplorerFacets, ExplorerSearch } from "@/lib/explorer";

type FilterSidebarProps = {
  facets?: ExplorerFacets;
  search: ExplorerSearch;
  onSearchChange: (updates: Partial<ExplorerSearch>) => void;
  className?: string;
};

/** Above this many entries a section gets its own filter box and virtualises. */
const SEARCHABLE_THRESHOLD = 8;
const ROW_HEIGHT = 28;
const MAX_LIST_HEIGHT = 280;

type FacetEntry = { id: string; label: string; count: number };

function toggleArrayValue(values: string[] | undefined, value: string) {
  if (!values || values.length === 0) return [value];
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
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
  style?: React.CSSProperties;
}) {
  return (
    <label
      style={style}
      className="flex cursor-pointer items-center gap-2 rounded-[var(--r-sm)] px-1.5 text-sm transition-colors hover:bg-secondary"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="h-3 w-3 flex-shrink-0 accent-[var(--ok-accent)]"
      />
      <span className="min-w-0 flex-1 truncate text-foreground">{entry.label}</span>
      <span className="ok-num flex-shrink-0 text-xs text-muted-foreground">
        {entry.count}
      </span>
    </label>
  );
}

/** One collapsible facet section; searches and virtualises past the threshold. */
function FacetSection({
  title,
  entries,
  selectedIds,
  onToggle,
}: {
  title: string;
  entries: FacetEntry[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState("");
  const parentRef = useRef<HTMLDivElement>(null);

  const searchable = entries.length > SEARCHABLE_THRESHOLD;
  const visible = useMemo(() => {
    if (!filter.trim()) return entries;
    const needle = filter.trim().toLowerCase();
    return entries.filter((entry) => entry.label.toLowerCase().includes(needle));
  }, [entries, filter]);

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  if (entries.length === 0) return null;

  const listHeight = Math.min(visible.length * ROW_HEIGHT, MAX_LIST_HEIGHT);

  return (
    <section className="border-b py-2.5">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="mb-1 flex w-full items-center gap-1 px-1.5 text-sm font-semibold text-foreground"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        {title}
        {selectedIds.length > 0 ? (
          <span className="ok-num ml-auto text-xs text-[var(--ok-accent)]">
            {selectedIds.length}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          {searchable ? (
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t("filters.searchPlaceholder")}
              className="mb-1 h-[26px]"
            />
          ) : null}

          {visible.length === 0 ? (
            <p className="px-1.5 py-1 text-xs text-muted-foreground">
              {t("filters.noMatches")}
            </p>
          ) : searchable ? (
            // Virtualised: only the rows in view are mounted.
            <div ref={parentRef} style={{ height: listHeight }} className="overflow-auto">
              <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                {virtualizer.getVirtualItems().map((row) => {
                  const entry = visible[row.index];
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
          ) : (
            <div>
              {visible.map((entry) => (
                <FacetRow
                  key={entry.id}
                  entry={entry}
                  checked={selectedIds.includes(entry.id)}
                  onToggle={() => onToggle(entry.id)}
                  style={{ height: ROW_HEIGHT }}
                />
              ))}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

export function FilterSidebar({
  facets,
  search,
  onSearchChange,
  className,
}: FilterSidebarProps) {
  const { t } = useI18n();

  const activeCount = [
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

  return (
    <aside className={cn("min-w-0 border-r", className)}>
      <div className="flex h-8 items-center justify-between border-b bg-[var(--ok-bar)] px-3">
        <span className="ok-eyebrow">{t("filters.title")}</span>
        {activeCount > 0 ? (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs font-semibold text-[var(--ok-accent)] hover:underline"
          >
            {t("filters.clear")}
          </button>
        ) : null}
      </div>

      <div className="px-1.5">
        <FacetSection
          title={t("filters.status")}
          entries={(facets?.statuses ?? []).map((entry) => ({
            id: entry.status,
            label: entry.status,
            count: entry.count,
          }))}
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
        <section className="border-b py-2.5">
          <p className="mb-1 px-1.5 text-sm font-semibold text-foreground">
            {t("filters.date")}
          </p>
          <div className="flex items-center gap-1.5 px-1.5">
            <Input
              type="date"
              aria-label={t("filters.dateFrom")}
              value={search.dateFrom ?? ""}
              onChange={(event) =>
                onSearchChange({
                  dateFrom: event.target.value || undefined,
                  page: undefined,
                })
              }
              className="h-[26px]"
            />
            <Input
              type="date"
              aria-label={t("filters.dateTo")}
              value={search.dateTo ?? ""}
              onChange={(event) =>
                onSearchChange({
                  dateTo: event.target.value || undefined,
                  page: undefined,
                })
              }
              className="h-[26px]"
            />
          </div>
        </section>

        <section className="py-2.5">
          <p className="mb-1 px-1.5 text-sm font-semibold text-foreground">
            {t("filters.amount")}
          </p>
          <div className="flex items-center gap-1.5 px-1.5">
            <Input
              type="number"
              inputMode="decimal"
              placeholder={t("filters.min")}
              value={search.amountMin ?? ""}
              onChange={(event) =>
                onSearchChange({
                  amountMin: event.target.value ? Number(event.target.value) : undefined,
                  page: undefined,
                })
              }
              className="ok-num h-[26px]"
            />
            <Input
              type="number"
              inputMode="decimal"
              placeholder={t("filters.max")}
              value={search.amountMax ?? ""}
              onChange={(event) =>
                onSearchChange({
                  amountMax: event.target.value ? Number(event.target.value) : undefined,
                  page: undefined,
                })
              }
              className="ok-num h-[26px]"
            />
          </div>
        </section>
      </div>
    </aside>
  );
}
