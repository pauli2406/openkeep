import { X } from "lucide-react";
import type { ExplorerFacets, ExplorerSearch } from "@/lib/explorer";
import { useI18n } from "@/lib/i18n";

type Chip = { key: string; label: string; clear: Partial<ExplorerSearch> };

/**
 * Active filters as removable chips above the table. `Clear all` appears
 * once more than one filter is set.
 */
export function ActiveFilters({
  facets,
  search,
  onSearchChange,
}: {
  facets?: ExplorerFacets;
  search: ExplorerSearch;
  onSearchChange: (updates: Partial<ExplorerSearch>) => void;
}) {
  const { t } = useI18n();
  const chips: Chip[] = [];

  const nameFor = (
    list: Array<{ id: string; name: string }> | undefined,
    id: string,
  ) => list?.find((entry) => entry.id === id)?.name ?? id;

  if (search.query) {
    chips.push({
      key: `query`,
      label: `${t("filters.chipSearch")}: ${search.query}`,
      clear: { query: undefined },
    });
  }
  if (search.year) {
    chips.push({
      key: `year`,
      label: String(search.year),
      clear: { year: undefined },
    });
  }
  for (const status of search.statuses ?? []) {
    chips.push({
      key: `status:${status}`,
      label: status,
      clear: { statuses: (search.statuses ?? []).filter((s) => s !== status) },
    });
  }
  for (const id of search.documentTypeIds ?? []) {
    chips.push({
      key: `type:${id}`,
      label: nameFor(facets?.documentTypes, id),
      clear: {
        documentTypeIds: (search.documentTypeIds ?? []).filter((v) => v !== id),
      },
    });
  }
  for (const id of search.categoryIds ?? []) {
    chips.push({
      key: `category:${id}`,
      label: nameFor(facets?.categories, id),
      clear: {
        categoryIds: (search.categoryIds ?? []).filter((v) => v !== id),
      },
    });
  }
  if (search.uncategorized) {
    chips.push({
      key: "uncategorized",
      label: t("filters.uncategorized"),
      clear: { uncategorized: undefined },
    });
  }
  for (const id of search.correspondentIds ?? []) {
    chips.push({
      key: `correspondent:${id}`,
      label: nameFor(facets?.correspondents, id),
      clear: {
        correspondentIds: (search.correspondentIds ?? []).filter((v) => v !== id),
      },
    });
  }
  for (const id of search.tags ?? []) {
    chips.push({
      key: `tag:${id}`,
      label: nameFor(facets?.tags, id),
      clear: { tags: (search.tags ?? []).filter((v) => v !== id) },
    });
  }
  if (search.dateFrom || search.dateTo) {
    chips.push({
      key: "date",
      label: `${search.dateFrom ?? "…"} – ${search.dateTo ?? "…"}`,
      clear: { dateFrom: undefined, dateTo: undefined },
    });
  }
  if (search.amountMin != null || search.amountMax != null) {
    chips.push({
      key: "amount",
      label: `${search.amountMin ?? "…"} – ${search.amountMax ?? "…"}`,
      clear: { amountMin: undefined, amountMax: undefined },
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onSearchChange({ ...chip.clear, page: undefined })}
          className="inline-flex items-center gap-1 rounded-[var(--r-pill)] border bg-card px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-secondary"
        >
          <span className="max-w-[220px] truncate">{chip.label}</span>
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      ))}

      {chips.length > 1 ? (
        <button
          type="button"
          onClick={() =>
            onSearchChange({
              query: undefined,
              year: undefined,
              statuses: undefined,
              documentTypeIds: undefined,
              correspondentIds: undefined,
              categoryIds: undefined,
              uncategorized: undefined,
              tags: undefined,
              dateFrom: undefined,
              dateTo: undefined,
              amountMin: undefined,
              amountMax: undefined,
              page: undefined,
            })
          }
          className="ml-1 text-xs font-semibold text-[var(--ok-accent)] hover:underline"
        >
          {t("filters.clearAll")}
        </button>
      ) : null}
    </div>
  );
}
