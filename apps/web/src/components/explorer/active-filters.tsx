import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ExplorerFacets, ExplorerSearch } from "@/lib/explorer";
import { useI18n } from "@/lib/i18n";
import { statusLabel } from "./shared";

type Chip = { key: string; label: string; clear: Partial<ExplorerSearch> };

/**
 * Active filters as removable badges above the results. `Clear all` appears
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
      label: statusLabel(status, t),
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
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <Badge
          key={chip.key}
          asChild
          variant="brand"
          className="h-7 cursor-pointer gap-1.5 pr-1.5 pl-2.5 outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <button
            type="button"
            aria-label={`${t("filters.remove")}: ${chip.label}`}
            onClick={() => onSearchChange({ ...chip.clear, page: undefined })}
          >
            <span className="max-w-[220px] truncate">{chip.label}</span>
            <X />
          </button>
        </Badge>
      ))}

      {chips.length > 1 ? (
        <Button
          variant="ghost"
          size="xs"
          className="text-brand"
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
        >
          {t("filters.clearAll")}
        </Button>
      ) : null}
    </div>
  );
}
