import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, Check, Loader2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchExplorerFacets } from "@/lib/explorer";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  type TaxonomyKind,
  createTaxonomy,
  deleteTaxonomy,
  listTaxonomy,
  mergeTaxonomy,
  updateTaxonomy,
} from "./taxonomy-api";

type Row = { id: string; name: string; slug: string; count: number };
type QuickFilter = "all" | "unused" | "duplicates";
type SortKey = "count" | "name";

const ROW_HEIGHT = 30;

/**
 * Client-side merge suggestions: case-insensitive matches, singular/plural
 * pairs and common-prefix pairs. The suggested target is the busier entry.
 */
function computeSuggestions(rows: Row[]): Map<string, Row> {
  const byLower = new Map<string, Row[]>();
  for (const row of rows) {
    const key = row.name.trim().toLowerCase();
    byLower.set(key, [...(byLower.get(key) ?? []), row]);
  }
  const suggestions = new Map<string, Row>();
  const suggest = (source: Row, target: Row) => {
    if (source.id === target.id || suggestions.has(source.id)) return;
    suggestions.set(source.id, target);
  };
  const better = (a: Row, b: Row) =>
    a.count !== b.count ? a.count > b.count : a.name.length < b.name.length;

  // exact case-insensitive duplicates
  for (const group of byLower.values()) {
    if (group.length < 2) continue;
    const target = [...group].sort((a, b) => (better(a, b) ? -1 : 1))[0];
    for (const row of group) suggest(row, target);
  }
  // singular/plural pairs
  for (const key of byLower.keys()) {
    for (const plural of [`${key}s`, `${key}es`, `${key}en`]) {
      const a = byLower.get(key)?.[0];
      const b = byLower.get(plural)?.[0];
      if (a && b) (better(a, b) ? suggest(b, a) : suggest(a, b));
    }
  }
  // common-prefix pairs (Energie / Energie-Abschlag)
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
        // the more specific entry merges into the broader one
        suggest(b, a);
      }
    }
  }
  return suggestions;
}

export function TaxonomyManagementSection() {
  const { language, t } = useI18n();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<TaxonomyKind>("tags");
  const [filter, setFilter] = useState("");
  const [quick, setQuick] = useState<QuickFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("count");
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmMergeId, setConfirmMergeId] = useState<string | null>(null);
  const [bulkTargetId, setBulkTargetId] = useState<string>("");
  const [renameValue, setRenameValue] = useState("");
  const [createValue, setCreateValue] = useState("");
  const anchorId = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const copy =
    language === "de"
      ? {
          tags: "Tags",
          correspondents: "Korrespondenten",
          types: "Typen",
          filter: "Filtern…",
          all: "Alle",
          unused: "Unbenutzt",
          duplicates: "Duplikate",
          name: "Name",
          docs: "Dokumente",
          suggestion: "Vorschlag",
          mergeInto: (n: string) => `In „${n}" zusammenführen`,
          confirmMerge: "Bestätigen",
          selected: "ausgewählt",
          bulkMerge: "Zusammenführen",
          rename: "Umbenennen",
          del: "Löschen",
          clear: "Aufheben",
          deleteAllUnused: (n: number) => `Alle ${n} unbenutzten löschen`,
          add: "Hinzufügen",
          newEntry: "Neuer Eintrag…",
          empty: "Keine Einträge.",
          loadError: "Liste konnte nicht geladen werden.",
        }
      : {
          tags: "Tags",
          correspondents: "Correspondents",
          types: "Types",
          filter: "Filter…",
          all: "All",
          unused: "Unused",
          duplicates: "Duplicates",
          name: "Name",
          docs: "Documents",
          suggestion: "Suggestion",
          mergeInto: (n: string) => `merge into ${n}`,
          confirmMerge: "Confirm",
          selected: "selected",
          bulkMerge: "Merge into…",
          rename: "Rename",
          del: "Delete",
          clear: "Clear",
          deleteAllUnused: (n: number) => `Delete all ${n} unused`,
          add: "Add",
          newEntry: "New entry…",
          empty: "No entries.",
          loadError: "Failed to load the list.",
        };

  const listQuery = useQuery({
    queryKey: ["taxonomies", kind],
    queryFn: () => listTaxonomy(kind, t),
  });

  const facetsQuery = useQuery({
    queryKey: ["documents", "facets"],
    queryFn: fetchExplorerFacets,
    staleTime: 60_000,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["taxonomies"] });
    queryClient.invalidateQueries({ queryKey: ["documents", "facets"] });
    queryClient.invalidateQueries({ queryKey: ["documents"] });
  }, [queryClient]);

  const mergeMutation = useMutation({
    mutationFn: async ({ sourceId, targetId }: { sourceId: string; targetId: string }) =>
      mergeTaxonomy(kind, sourceId, targetId, t),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await deleteTaxonomy(kind, id, t);
    },
    onSuccess: () => {
      setSelectedIds([]);
      invalidate();
    },
  });
  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) =>
      updateTaxonomy(kind, id, name, t),
    onSuccess: () => {
      setRenameValue("");
      invalidate();
    },
  });
  const createMutation = useMutation({
    mutationFn: async (name: string) => createTaxonomy(kind, name, t),
    onSuccess: () => {
      setCreateValue("");
      invalidate();
    },
  });

  const facetCounts = useMemo(() => {
    const facets = facetsQuery.data;
    const source =
      kind === "tags"
        ? facets?.tags
        : kind === "correspondents"
          ? facets?.correspondents
          : facets?.documentTypes;
    return new Map((source ?? []).map((entry) => [entry.id, entry.count]));
  }, [facetsQuery.data, kind]);

  const allRows = useMemo<Row[]>(
    () =>
      (listQuery.data ?? []).map((entry) => ({
        id: entry.id,
        name: entry.name,
        slug: entry.slug,
        count: facetCounts.get(entry.id) ?? 0,
      })),
    [listQuery.data, facetCounts],
  );

  const suggestions = useMemo(() => computeSuggestions(allRows), [allRows]);

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    let out = allRows;
    if (needle) out = out.filter((row) => row.name.toLowerCase().includes(needle));
    if (quick === "unused") out = out.filter((row) => row.count === 0);
    if (quick === "duplicates") out = out.filter((row) => suggestions.has(row.id));
    return [...out].sort((a, b) => {
      const cmp =
        sortKey === "count" ? a.count - b.count : a.name.localeCompare(b.name);
      return sortAsc ? cmp : -cmp;
    });
  }, [allRows, filter, quick, suggestions, sortKey, sortAsc]);

  const maxCount = Math.max(...allRows.map((row) => row.count), 1);
  const unusedCount = allRows.filter((row) => row.count === 0).length;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const toggleRow = (index: number, shiftKey: boolean) => {
    const row = rows[index];
    if (!row) return;
    const anchorIndex = anchorId.current
      ? rows.findIndex((entry) => entry.id === anchorId.current)
      : -1;
    if (shiftKey && anchorIndex !== -1) {
      const [from, to] = [anchorIndex, index].sort((a, b) => a - b);
      const range = rows.slice(from, to + 1).map((entry) => entry.id);
      const turningOn = !selectedIds.includes(row.id);
      const next = new Set(selectedIds);
      for (const id of range) (turningOn ? next.add(id) : next.delete(id));
      setSelectedIds([...next]);
      return;
    }
    anchorId.current = row.id;
    setSelectedIds((current) =>
      current.includes(row.id)
        ? current.filter((id) => id !== row.id)
        : [...current, row.id],
    );
  };

  const switchKind = (next: TaxonomyKind) => {
    setKind(next);
    setSelectedIds([]);
    setConfirmMergeId(null);
    setQuick("all");
    setFilter("");
  };

  const selectedRows = rows.filter((row) => selectedIds.includes(row.id));
  const busy =
    mergeMutation.isPending || deleteMutation.isPending || renameMutation.isPending;

  return (
    <div className="rounded-[var(--r-lg)] border bg-card">
      {/* Kind switcher + filters */}
      <div className="flex flex-wrap items-center gap-1.5 border-b bg-[var(--ok-bar)] px-3 py-2">
        {(
          [
            ["tags", copy.tags],
            ["correspondents", copy.correspondents],
            ["document-types", copy.types],
          ] as Array<[TaxonomyKind, string]>
        ).map(([value, label]) => (
          <Chip key={value} active={kind === value} onClick={() => switchKind(value)}>
            {label}
            {kind === value ? <span className="ok-num"> {allRows.length}</span> : null}
          </Chip>
        ))}
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={copy.filter}
          className="ml-2 h-[26px] w-40"
        />
        {(
          [
            ["all", copy.all],
            ["unused", copy.unused],
            ["duplicates", copy.duplicates],
          ] as Array<[QuickFilter, string]>
        ).map(([value, label]) => (
          <Chip key={value} active={quick === value} onClick={() => setQuick(value)}>
            {label}
          </Chip>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          <Input
            value={createValue}
            onChange={(event) => setCreateValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && createValue.trim()) {
                createMutation.mutate(createValue.trim());
              }
            }}
            placeholder={copy.newEntry}
            className="h-[26px] w-36"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!createValue.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate(createValue.trim())}
          >
            <Plus />
            {copy.add}
          </Button>
        </div>
      </div>

      {/* Bulk bar / unused sweep */}
      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b bg-accent px-3 py-1.5">
          <span className="text-sm text-accent-foreground">
            <span className="ok-num font-semibold">{selectedIds.length}</span>{" "}
            {copy.selected}
          </span>
          <Select value={bulkTargetId} onValueChange={setBulkTargetId}>
            <SelectTrigger className="h-[26px] w-52">
              <SelectValue placeholder={copy.bulkMerge} />
            </SelectTrigger>
            <SelectContent>
              {allRows
                .filter((row) => !selectedIds.includes(row.id))
                .slice(0, 50)
                .map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={!bulkTargetId || busy}
            onClick={async () => {
              for (const id of selectedIds) {
                await mergeMutation.mutateAsync({ sourceId: id, targetId: bulkTargetId });
              }
              setSelectedIds([]);
              setBulkTargetId("");
            }}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Check />}
            {copy.bulkMerge}
          </Button>
          {selectedIds.length === 1 ? (
            <>
              <Input
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                placeholder={selectedRows[0]?.name ?? copy.rename}
                className="h-[26px] w-40"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!renameValue.trim() || busy}
                onClick={() =>
                  renameMutation.mutate({ id: selectedIds[0], name: renameValue.trim() })
                }
              >
                {copy.rename}
              </Button>
            </>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="text-[var(--ok-red)]"
            disabled={busy}
            onClick={() => deleteMutation.mutate(selectedIds)}
          >
            <Trash2 />
            {copy.del}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => setSelectedIds([])}
          >
            <X />
            {copy.clear}
          </Button>
        </div>
      ) : quick === "unused" && unusedCount > 0 ? (
        <div className="flex items-center border-b bg-[var(--ok-amber-soft)] px-3 py-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              deleteMutation.mutate(
                allRows.filter((row) => row.count === 0).map((row) => row.id),
              )
            }
          >
            <Trash2 />
            {copy.deleteAllUnused(unusedCount)}
          </Button>
        </div>
      ) : null}

      {/* Column header */}
      <div className="flex h-8 items-center gap-3 border-b bg-[var(--ok-bar)] px-3">
        <span className="w-3 flex-shrink-0" />
        <button
          type="button"
          className={cn(
            "ok-eyebrow inline-flex items-center gap-1 hover:text-foreground",
            sortKey === "name" && "text-foreground",
          )}
          onClick={() => {
            setSortKey("name");
            setSortAsc(sortKey === "name" ? !sortAsc : true);
          }}
        >
          {copy.name}
          {sortKey === "name" ? (
            sortAsc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
          ) : null}
        </button>
        <button
          type="button"
          className={cn(
            "ok-eyebrow ml-auto inline-flex w-20 items-center justify-end gap-1 hover:text-foreground",
            sortKey === "count" && "text-foreground",
          )}
          onClick={() => {
            setSortKey("count");
            setSortAsc(sortKey === "count" ? !sortAsc : false);
          }}
        >
          {copy.docs}
          {sortKey === "count" ? (
            sortAsc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
          ) : null}
        </button>
        <span className="ok-eyebrow w-56 flex-shrink-0 text-right">
          {copy.suggestion}
        </span>
      </div>

      {/* Virtualised rows — never all 1000 at once */}
      {listQuery.isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : listQuery.isError ? (
        <p className="px-3 py-6 text-center text-sm text-[var(--ok-red)]">
          {copy.loadError}
        </p>
      ) : rows.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">
          {copy.empty}
        </p>
      ) : (
        <div ref={listRef} className="overflow-auto" style={{ maxHeight: 420 }}>
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              const target = suggestions.get(row.id);
              const selected = selectedIds.includes(row.id);
              return (
                <div
                  key={row.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: ROW_HEIGHT,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className={cn(
                    "flex items-center gap-3 border-b border-[var(--ok-border-soft)] px-3",
                    selected && "bg-accent",
                  )}
                >
                  <input
                    type="checkbox"
                    aria-label={row.name}
                    checked={selected}
                    onClick={(event) => toggleRow(virtualRow.index, event.shiftKey)}
                    onChange={() => {}}
                    className="h-3 w-3 flex-shrink-0 accent-[var(--ok-accent)]"
                  />
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 flex-shrink-0 rounded-full bg-[var(--ok-accent)]"
                    style={{
                      opacity:
                        row.count === 0 ? 0.15 : 0.3 + 0.7 * (row.count / maxCount),
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
                  <span className="ok-num w-20 flex-shrink-0 text-right text-sm text-muted-foreground">
                    {row.count}
                  </span>
                  <span className="flex w-56 flex-shrink-0 items-center justify-end gap-1">
                    {target ? (
                      confirmMergeId === row.id ? (
                        <Button
                          size="sm"
                          className="h-[22px]"
                          disabled={busy}
                          onClick={() => {
                            mergeMutation.mutate({
                              sourceId: row.id,
                              targetId: target.id,
                            });
                            setConfirmMergeId(null);
                          }}
                        >
                          <Check />
                          {copy.confirmMerge}
                        </Button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmMergeId(row.id)}
                          className="max-w-full truncate rounded-[var(--r-sm)] bg-[var(--ok-amber-soft)] px-[7px] py-px text-[11px] font-semibold text-[var(--ok-amber)] hover:brightness-95"
                        >
                          {copy.mergeInto(target.name)}
                        </button>
                      )
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
