/**
 * The Tags & taxonomy screen's decisions, apart from its rendering: what counts
 * as unused, which entries look like duplicates, what may be deleted, and what a
 * deletion has to tell you before it happens.
 */
import type { TaxonomyEntry, TaxonomyKind } from "../../api/admin";
import type { TranslationKey } from "../../i18n";
import type { FacetsResponse } from "../../lib";

export type QuickFilter = "all" | "unused" | "duplicates";
export type SortKey = "count" | "name";

/** `count` is null until the counts are in: unknown, not zero. */
export type TaxonomyRow = {
  id: string;
  name: string;
  slug: string;
  count: number | null;
  builtin: boolean;
  categoryName: string | null;
};

/** Categories have no create or merge: their vocabulary is fixed on purpose. */
export function canCreate(kind: TaxonomyKind) {
  return kind !== "categories";
}
export function canMerge(kind: TaxonomyKind) {
  return kind !== "categories";
}

/**
 * Document counts per entry. A category's count is correspondents, not documents,
 * and comes from the correspondents list, which carries each row's category.
 */
export function countsFor(
  kind: TaxonomyKind,
  facets: FacetsResponse | undefined,
  correspondents: TaxonomyEntry[] | undefined,
): Map<string, number> | null {
  if (kind === "categories") {
    if (!correspondents) return null;
    const counts = new Map<string, number>();
    for (const entry of correspondents) {
      if (entry.categoryId) counts.set(entry.categoryId, (counts.get(entry.categoryId) ?? 0) + 1);
    }
    return counts;
  }
  if (!facets) return null;
  const source =
    kind === "tags"
      ? facets.tags
      : kind === "correspondents"
        ? facets.correspondents
        : facets.documentTypes;
  return new Map(source.map((entry) => [entry.id, entry.count]));
}

export function buildRows(
  entries: TaxonomyEntry[],
  counts: Map<string, number> | null,
): TaxonomyRow[] {
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    slug: entry.slug,
    // Reporting an unknown as 0 would make the Unused filter offer to delete the
    // entire taxonomy, attached entries included.
    count: counts ? (counts.get(entry.id) ?? 0) : null,
    builtin: Boolean(entry.builtin),
    categoryName: entry.categoryName ?? null,
  }));
}

/**
 * Merge suggestions: case-insensitive matches, singular/plural pairs and
 * common-prefix pairs. The suggested target is the busier entry.
 */
export function computeSuggestions(rows: TaxonomyRow[]): Map<string, TaxonomyRow> {
  const byLower = new Map<string, TaxonomyRow[]>();
  for (const row of rows) {
    const key = row.name.trim().toLowerCase();
    byLower.set(key, [...(byLower.get(key) ?? []), row]);
  }
  const suggestions = new Map<string, TaxonomyRow>();
  const suggest = (source: TaxonomyRow, target: TaxonomyRow) => {
    if (source.id === target.id || suggestions.has(source.id)) return;
    suggestions.set(source.id, target);
  };
  const better = (a: TaxonomyRow, b: TaxonomyRow) =>
    (a.count ?? 0) !== (b.count ?? 0)
      ? (a.count ?? 0) > (b.count ?? 0)
      : a.name.length < b.name.length;

  for (const group of byLower.values()) {
    if (group.length < 2) continue;
    const target = [...group].sort((a, b) => (better(a, b) ? -1 : 1))[0];
    for (const row of group) suggest(row, target);
  }
  for (const key of byLower.keys()) {
    for (const plural of [`${key}s`, `${key}es`, `${key}en`]) {
      const a = byLower.get(key)?.[0];
      const b = byLower.get(plural)?.[0];
      if (a && b) {
        if (better(a, b)) suggest(b, a);
        else suggest(a, b);
      }
    }
  }
  for (const a of rows) {
    const prefix = a.name.trim().toLowerCase();
    for (const b of rows) {
      if (a.id === b.id) continue;
      const name = b.name.trim().toLowerCase();
      if (
        name.length > prefix.length + 1 &&
        name.startsWith(prefix) &&
        ["-", " ", "_", "/"].includes(name[prefix.length])
      ) {
        // The more specific entry merges into the broader one.
        suggest(b, a);
      }
    }
  }
  return suggestions;
}

export function visibleRows(
  rows: TaxonomyRow[],
  options: {
    filter: string;
    quick: QuickFilter;
    suggestions: Map<string, TaxonomyRow>;
    sortKey: SortKey;
    sortAsc: boolean;
  },
): TaxonomyRow[] {
  const needle = options.filter.trim().toLowerCase();
  let out = rows;
  if (needle) out = out.filter((row) => row.name.toLowerCase().includes(needle));
  if (options.quick === "unused") out = out.filter((row) => row.count === 0);
  if (options.quick === "duplicates") out = out.filter((row) => options.suggestions.has(row.id));
  return [...out].sort((a, b) => {
    const cmp =
      options.sortKey === "count" ? (a.count ?? 0) - (b.count ?? 0) : a.name.localeCompare(b.name);
    return options.sortAsc ? cmp : -cmp;
  });
}

/**
 * What "delete all unused" may sweep. A builtin category can sit unused and still
 * refuse to be deleted, so it stays out: left in, the loop would stop at the
 * first one with half the sweep done.
 */
export function unusedSweepIds(rows: TaxonomyRow[]): string[] {
  return rows.filter((row) => row.count === 0 && !row.builtin).map((row) => row.id);
}

/** Selection can outlive a filter, so this reads every row, not the visible ones. */
export function selectionHasBuiltin(rows: TaxonomyRow[], selectedIds: string[]) {
  const selected = new Set(selectedIds);
  return rows.some((row) => row.builtin && selected.has(row.id));
}

/** Who loses what when these go. `null` when the counts are not in. */
export function affectedCount(rows: TaxonomyRow[], ids: string[]): number | null {
  const selected = new Set(ids);
  let total = 0;
  for (const row of rows) {
    if (!selected.has(row.id)) continue;
    if (row.count === null) return null;
    total += row.count;
  }
  return total;
}

/** Target choices: never one of the sources, always the chosen one, capped for a phone. */
export const MERGE_TARGET_LIMIT = 50;
export function mergeTargetOptions(
  rows: TaxonomyRow[],
  options: { sourceIds: string[]; selectedId: string | null; query: string },
): { items: TaxonomyRow[]; truncated: boolean } {
  const needle = options.query.trim().toLowerCase();
  const sources = new Set(options.sourceIds);
  const matches = rows
    .filter(
      (row) =>
        !sources.has(row.id) &&
        (row.id === options.selectedId ||
          needle === "" ||
          row.name.toLowerCase().includes(needle)),
    )
    // The chosen target stays first, so the cap can never hide what Merge acts on.
    .sort((a, b) => Number(b.id === options.selectedId) - Number(a.id === options.selectedId));
  return { items: matches.slice(0, MERGE_TARGET_LIMIT), truncated: matches.length > MERGE_TARGET_LIMIT };
}

/**
 * What a deletion says before it happens. Categories count correspondents, and
 * calling those documents would be wrong; an unknown count must not read as zero.
 */
export function describeDeletion(
  kind: TaxonomyKind,
  affected: number | null,
  single: boolean,
): { key: TranslationKey; count: number } {
  if (affected === null) return { key: "taxonomy.deleteUnknownCount", count: 0 };
  if (kind === "categories") {
    if (affected === 0) return { key: "taxonomy.bulkDeleteNoCorrespondents", count: 0 };
    if (affected === 1) return { key: "taxonomy.bulkDeleteOneCorrespondent", count: 1 };
    return { key: "taxonomy.bulkDeleteCorrespondents", count: affected };
  }
  if (single) {
    if (affected === 0) return { key: "taxonomy.deleteNone", count: 0 };
    if (affected === 1) return { key: "taxonomy.deleteOneDoc", count: 1 };
    return { key: "taxonomy.deleteOne", count: affected };
  }
  if (affected === 0) return { key: "taxonomy.bulkDeleteNone", count: 0 };
  if (affected === 1) return { key: "taxonomy.bulkDeleteOneDoc", count: 1 };
  return { key: "taxonomy.bulkDeleteMany", count: affected };
}
