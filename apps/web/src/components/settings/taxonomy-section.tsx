import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowUp,
  Check,
  GitMerge,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SearchX,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip } from "@/components/ui/chip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { RetryAlert, RowsSkeleton } from "./shared";
import { isEnterKey } from "@/lib/keyboard";

/** `count` is null until the facets request lands — unknown, not zero. */
type Row = {
  id: string;
  name: string;
  slug: string;
  count: number | null;
  builtin?: boolean;
  categoryName?: string | null;
};
type QuickFilter = "all" | "unused" | "duplicates";
type SortKey = "count" | "name";

/** A row action in progress; `targetId` preselects a suggested merge target. */
type RowDialog =
  | { kind: "rename"; row: Row }
  | { kind: "merge"; row: Row; targetId: string | null }
  | { kind: "delete"; row: Row };

const ROW_HEIGHT = 44;

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
    (a.count ?? 0) !== (b.count ?? 0)
      ? (a.count ?? 0) > (b.count ?? 0)
      : a.name.length < b.name.length;

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
  const [bulkTargetQuery, setBulkTargetQuery] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [createValue, setCreateValue] = useState("");
  const [rowDialog, setRowDialog] = useState<RowDialog | null>(null);
  const [dialogName, setDialogName] = useState("");
  const [dialogTargetId, setDialogTargetId] = useState("");
  const [dialogTargetQuery, setDialogTargetQuery] = useState("");
  const anchorId = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const copy =
    language === "de"
      ? {
          tags: "Tags",
          correspondents: "Korrespondenten",
          types: "Typen",
          categories: "Kategorien",
          builtinBadge: "Standard",
          builtinUndeletable:
            "Standard-Kategorien lassen sich umbenennen, aber nicht löschen — das feste Vokabular hält die automatische Zuordnung stabil.",
          correspondentsCount: "Absender",
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
          actionFailed: "Aktion fehlgeschlagen.",
          countsUnavailable:
            "Dokumentanzahlen konnten nicht geladen werden — „Unbenutzt“ ist deaktiviert.",
          emptyHint: "Lege oben den ersten Eintrag an.",
          noMatches: "Nichts gefunden",
          noMatchesHint: "Ändere den Filter, um mehr Einträge zu sehen.",
          actionsFor: (n: string) => `Aktionen für ${n}`,
          renameEllipsis: "Umbenennen…",
          mergeEllipsis: "Zusammenführen…",
          deleteEllipsis: "Löschen…",
          renameTitle: (n: string) => `„${n}“ umbenennen`,
          renameDescription: "Dokumente behalten ihre Zuordnung.",
          newName: "Neuer Name",
          mergeTitle: (n: string) => `„${n}“ zusammenführen`,
          mergeDescription:
            "Alle Dokumente wandern zum Ziel, danach verschwindet dieser Eintrag.",
          mergeTarget: "Ziel",
          mergePlaceholder: "Ziel wählen…",
          mergeAction: "Zusammenführen",
          deleteTitle: (n: string) => `„${n}“ löschen?`,
          bulkDeleteTitle: (n: number) => `${n} ${n === 1 ? "Eintrag" : "Einträge"} löschen?`,
          // Null while the counts are still loading: never claim nothing uses them.
          bulkDeleteDescription: (count: number | null, categories: boolean) =>
            count === null
              ? "Das lässt sich nicht rückgängig machen."
              : count > 0
                ? categories
                  ? `${count} ${count === 1 ? "Absender verliert" : "Absender verlieren"} diese Zuordnung. Das lässt sich nicht rückgängig machen.`
                  : `${count} ${count === 1 ? "Dokument verliert" : "Dokumente verlieren"} diese Zuordnung. Das lässt sich nicht rückgängig machen.`
                : "Davon wird nichts verwendet. Das lässt sich nicht rückgängig machen.",
          deleteDescription: (count: number | null) =>
            count
              ? `Der Eintrag wird von ${count} Dokumenten entfernt. Das lässt sich nicht rückgängig machen.`
              : "Das lässt sich nicht rückgängig machen.",
          cancel: "Abbrechen",
        }
      : {
          tags: "Tags",
          correspondents: "Correspondents",
          types: "Types",
          categories: "Categories",
          builtinBadge: "Builtin",
          builtinUndeletable:
            "Builtin categories can be renamed but not deleted — the canonical vocabulary keeps automatic assignment stable.",
          correspondentsCount: "Correspondents",
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
          actionFailed: "The action failed.",
          countsUnavailable:
            "Document counts could not be loaded — “Unused” is unavailable.",
          emptyHint: "Add the first entry above.",
          noMatches: "Nothing matches",
          noMatchesHint: "Change the filter to see more entries.",
          actionsFor: (n: string) => `Actions for ${n}`,
          renameEllipsis: "Rename…",
          mergeEllipsis: "Merge…",
          deleteEllipsis: "Delete…",
          renameTitle: (n: string) => `Rename “${n}”`,
          renameDescription: "Documents stay attached to it.",
          newName: "New name",
          mergeTitle: (n: string) => `Merge “${n}”`,
          mergeDescription:
            "Every document moves to the target, then this entry goes away.",
          mergeTarget: "Target",
          mergePlaceholder: "Choose a target…",
          mergeAction: "Merge",
          deleteTitle: (n: string) => `Delete “${n}”?`,
          bulkDeleteTitle: (n: number) => `Delete ${n} ${n === 1 ? "entry" : "entries"}?`,
          // Null while the counts are still loading: never claim nothing uses them.
          bulkDeleteDescription: (count: number | null, categories: boolean) =>
            count === null
              ? "This cannot be undone."
              : count > 0
                ? `${count} ${
                    categories
                      ? count === 1 ? "correspondent loses" : "correspondents lose"
                      : count === 1 ? "document loses" : "documents lose"
                  } this assignment. This cannot be undone.`
                : "Nothing uses any of these. This cannot be undone.",
          deleteDescription: (count: number | null) =>
            count
              ? `It comes off ${count} documents. This can't be undone.`
              : "This can't be undone.",
          cancel: "Cancel",
        };

  const listQuery = useQuery({
    queryKey: ["taxonomies", kind],
    queryFn: () => listTaxonomy(kind, t),
  });

  // Category counts are correspondents, not documents — counted client-side
  // from the correspondents list, which also carries each row's category.
  const correspondentsQuery = useQuery({
    queryKey: ["taxonomies", "correspondents"],
    queryFn: () => listTaxonomy("correspondents", t),
    enabled: kind === "categories",
  });

  const facetsQuery = useQuery({
    queryKey: ["documents", "facets"],
    // Wrapped: fetchExplorerFacets now takes an optional search, and a bare
    // reference would receive TanStack's query context as that argument.
    queryFn: () => fetchExplorerFacets(),
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
      for (const id of ids) {
        await deleteTaxonomy(kind, id, t);
        // A run that stops partway has already deleted these, so a retry must
        // carry on with what is left rather than trip over an entry that is gone.
        setSelectedIds((current) => current.filter((entry) => entry !== id));
        setBulkDeleteIds((current) => current?.filter((entry) => entry !== id) ?? current);
      }
    },
    onSuccess: () => {
      setSelectedIds([]);
      invalidate();
    },
    // The entries before a failure are gone, and the list has to say so.
    onError: invalidate,
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
    if (kind === "categories") {
      const counts = new Map<string, number>();
      for (const entry of correspondentsQuery.data ?? []) {
        const categoryId = (entry as { categoryId?: string | null }).categoryId;
        if (categoryId) counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
      }
      return counts;
    }
    const facets = facetsQuery.data;
    const source =
      kind === "tags"
        ? facets?.tags
        : kind === "correspondents"
          ? facets?.correspondents
          : facets?.documentTypes;
    return new Map((source ?? []).map((entry) => [entry.id, entry.count]));
  }, [facetsQuery.data, correspondentsQuery.data, kind]);

  // Until the facets request succeeds we do not know how many documents use
  // an entry. Reporting that as 0 would make the Unused filter offer to
  // delete the entire taxonomy, attached entries included.
  const countsKnown = kind === "categories" ? correspondentsQuery.isSuccess : facetsQuery.isSuccess;

  const allRows = useMemo<Row[]>(
    () =>
      (listQuery.data ?? []).map((entry) => ({
        id: entry.id,
        name: entry.name,
        slug: entry.slug,
        count: countsKnown ? (facetCounts.get(entry.id) ?? 0) : null,
        builtin: (entry as { builtin?: boolean }).builtin,
        categoryName: (entry as { categoryName?: string | null }).categoryName,
      })),
    [listQuery.data, facetCounts, countsKnown],
  );

  const suggestions = useMemo(
    () => (kind === "categories" ? new Map<string, Row>() : computeSuggestions(allRows)),
    [allRows, kind],
  );

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    let out = allRows;
    if (needle) out = out.filter((row) => row.name.toLowerCase().includes(needle));
    if (quick === "unused") out = out.filter((row) => row.count === 0);

    if (quick === "duplicates") out = out.filter((row) => suggestions.has(row.id));
    return [...out].sort((a, b) => {
      const cmp =
        sortKey === "count"
          ? (a.count ?? 0) - (b.count ?? 0)
          : a.name.localeCompare(b.name);
      return sortAsc ? cmp : -cmp;
    });
  }, [allRows, filter, quick, suggestions, sortKey, sortAsc]);

  const maxCount = Math.max(...allRows.map((row) => row.count ?? 0), 1);
  // Builtin entries cannot be deleted, so the sweep must not count or try them.
  const unusedCount = countsKnown
    ? allRows.filter((row) => row.count === 0 && !row.builtin).length
    : 0;

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
    setRowDialog(null);
  };

  const [bulkDeleteIds, setBulkDeleteIds] = useState<string[] | null>(null);
  const bulkDeleteUsage = countsKnown
    ? (bulkDeleteIds ?? []).reduce(
        (sum, id) => sum + (allRows.find((row) => row.id === id)?.count ?? 0),
        0,
      )
    : null;

  // The menu item that opened a dialog is gone by the time it closes, so focus
  // goes back to that row's menu button instead of falling to the page body.
  const dialogRowId = useRef<string | null>(null);
  const returnFocusToRow = (event: Event) => {
    event.preventDefault();
    if (!dialogRowId.current) return;
    document
      .querySelector<HTMLElement>(`[data-row-menu="${CSS.escape(dialogRowId.current)}"]`)
      ?.focus();
  };

  const openRowDialog = (dialog: RowDialog) => {
    dialogRowId.current = dialog.row.id;
    setDialogName(dialog.kind === "rename" ? dialog.row.name : "");
    setDialogTargetId(dialog.kind === "merge" ? (dialog.targetId ?? "") : "");
    setDialogTargetQuery("");
    setRowDialog(dialog);
  };

  const mutationError =
    mergeMutation.error ??
    deleteMutation.error ??
    renameMutation.error ??
    createMutation.error;

  // From every row, not the visible ones: a filter must not hide a builtin from the check.
  const selectedRows = allRows.filter((row) => selectedIds.includes(row.id));
  const bulkTargetNeedle = bulkTargetQuery.trim().toLowerCase();
  const bulkTargetOptions = allRows
    .filter(
      (row) =>
        !selectedIds.includes(row.id) &&
        (bulkTargetNeedle === "" ||
          row.name.toLowerCase().includes(bulkTargetNeedle)),
    )
    .slice(0, 50);
  const busy =
    mergeMutation.isPending || deleteMutation.isPending || renameMutation.isPending;

  const dialogSourceId = rowDialog?.row.id ?? null;
  const dialogTargetNeedle = dialogTargetQuery.trim().toLowerCase();
  const dialogTargetOptions = allRows
    .filter(
      (row) =>
        row.id !== dialogSourceId &&
        (row.id === dialogTargetId ||
          dialogTargetNeedle === "" ||
          row.name.toLowerCase().includes(dialogTargetNeedle)),
    )
    // The selected target stays first, so the cap can never leave the Select
    // blank while Merge still acts on it.
    .sort((a, b) => Number(b.id === dialogTargetId) - Number(a.id === dialogTargetId))
    .slice(0, 50);

  const sortIcon = (key: SortKey) =>
    sortKey === key ? (
      sortAsc ? (
        <ArrowUp className="size-3" />
      ) : (
        <ArrowDown className="size-3" />
      )
    ) : null;
  const ariaSort = (key: SortKey) =>
    sortKey === key ? (sortAsc ? "ascending" : "descending") : undefined;
  const hasNarrowing = filter.trim() !== "" || quick !== "all";

  const virtualItems = virtualizer.getVirtualItems();
  const paddingTop = virtualItems[0]?.start ?? 0;
  const paddingBottom =
    virtualizer.getTotalSize() - (virtualItems[virtualItems.length - 1]?.end ?? 0);

  return (
    <Tabs
      value={kind}
      onValueChange={(value) => switchKind(value as TaxonomyKind)}
      className="gap-4"
    >
      {/* A scrolling row, so all four kinds stay reachable on a phone. */}
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <TabsList>
          {(
            [
              ["tags", copy.tags],
              ["correspondents", copy.correspondents],
              ["document-types", copy.types],
              ["categories", copy.categories],
            ] as Array<[TaxonomyKind, string]>
          ).map(([value, label]) => (
            <TabsTrigger key={value} value={value} className="px-2.5">
              {label}
              {kind === value ? (
                <span className="num text-xs text-muted-foreground">{allRows.length}</span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <TabsContent value={kind}>
        <Card className="gap-0 py-0 shadow-card">
          {/* Filters + quick add */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 border-b px-4 py-3">
            <InputGroup className="w-full sm:w-44">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={copy.filter}
              />
            </InputGroup>
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  ["all", copy.all],
                  ["unused", copy.unused],
                  ["duplicates", copy.duplicates],
                ] as Array<[QuickFilter, string]>
              ).map(([value, label]) => (
                <Chip
                  key={value}
                  active={quick === value}
                  // "Unused" is derived from document counts; without them every
                  // entry would look unused.
                  disabled={value === "unused" && !countsKnown}
                  onClick={() => setQuick(value)}
                >
                  {label}
                </Chip>
              ))}
            </div>
            {/* Categories are a fixed vocabulary: the API has no create for them. */}
            {kind === "categories" ? null : (
            <div className="flex w-full items-center gap-2 lg:ml-auto lg:w-auto">
              <Input
                value={createValue}
                onChange={(event) => setCreateValue(event.target.value)}
                onKeyDown={(event) => {
                  if (isEnterKey(event) && createValue.trim()) {
                    createMutation.mutate(createValue.trim());
                  }
                }}
                placeholder={copy.newEntry}
                aria-label={copy.newEntry}
                className="min-w-0 flex-1 lg:w-32 lg:flex-none"
              />
              <Button
                variant="outline"
                disabled={!createValue.trim() || createMutation.isPending}
                onClick={() => createMutation.mutate(createValue.trim())}
              >
                {createMutation.isPending ? <Spinner /> : <Plus />}
                {copy.add}
              </Button>
            </div>
            )}
          </div>

          {/* Bulk bar / unused sweep */}
          {selectedIds.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 border-b bg-brand-soft px-4 py-2.5">
              <span className="text-sm text-brand-soft-foreground">
                <span className="num font-semibold">{selectedIds.length}</span>{" "}
                {copy.selected}
              </span>
              {kind !== "categories" ? (
                <>
                  <Select value={bulkTargetId} onValueChange={setBulkTargetId}>
                    <SelectTrigger size="sm" className="w-48 bg-background dark:bg-background">
                      <SelectValue placeholder={copy.bulkMerge} />
                    </SelectTrigger>
                    <SelectContent>
                      {/* Filter the list rather than truncating it: with 1000 entries
                          a flat top-50 makes most merge targets unreachable. */}
                      <div className="p-1">
                        <Input
                          value={bulkTargetQuery}
                          onChange={(event) => setBulkTargetQuery(event.target.value)}
                          onKeyDown={(event) => event.stopPropagation()}
                          placeholder={copy.filter}
                          className="h-7"
                        />
                      </div>
                      {bulkTargetOptions.map((row) => (
                        <SelectItem key={row.id} value={row.id}>
                          {row.name}
                        </SelectItem>
                      ))}
                      {bulkTargetOptions.length === 0 ? (
                        <p className="px-2 py-1.5 text-xs text-muted-foreground">
                          {copy.empty}
                        </p>
                      ) : null}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!bulkTargetId || busy}
                    onClick={async () => {
                      for (const id of selectedIds) {
                        try {
                          await mergeMutation.mutateAsync({ sourceId: id, targetId: bulkTargetId });
                        } catch {
                          // The error shows under the bar; what merged already has
                          // left the selection, so a retry carries on from here.
                          return;
                        }
                        setSelectedIds((current) => current.filter((entry) => entry !== id));
                      }
                      setBulkTargetId("");
                    }}
                  >
                    {busy ? <Spinner /> : <Check />}
                    {copy.bulkMerge}
                  </Button>
                </>
              ) : null}
              {selectedIds.length === 1 ? (
                <>
                  <Input
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    placeholder={selectedRows[0]?.name ?? copy.rename}
                    className="h-7 w-40 bg-background dark:bg-background"
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
                className="text-destructive hover:text-destructive"
                disabled={busy || selectedRows.some((row) => row.builtin)}
                title={
                  selectedRows.some((row) => row.builtin) ? copy.builtinUndeletable : undefined
                }
                onClick={() => setBulkDeleteIds(selectedIds)}
              >
                <Trash2 />
                {copy.del}
              </Button>
              {selectedRows.some((row) => row.builtin) ? (
                <span className="max-w-72 text-xs text-muted-foreground">
                  {copy.builtinUndeletable}
                </span>
              ) : null}
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
            <div className="flex items-center border-b bg-warning-soft px-4 py-2.5">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  setBulkDeleteIds(
                    allRows.filter((row) => row.count === 0 && !row.builtin).map((row) => row.id),
                  )
                }
              >
                <Trash2 />
                {copy.deleteAllUnused(unusedCount)}
              </Button>
            </div>
          ) : null}

          {/* A failed create, rename, merge or delete used to leave no trace at
              all — the list simply did not change. */}
          {mutationError && !rowDialog && !bulkDeleteIds ? (
            <div className="border-b px-4 py-2.5">
              <RetryAlert
                message={
                  mutationError instanceof Error ? mutationError.message : copy.actionFailed
                }
              />
            </div>
          ) : null}
          {!countsKnown && facetsQuery.isError ? (
            <p className="border-b bg-warning-soft px-4 py-2 text-xs text-warning">
              {copy.countsUnavailable}
            </p>
          ) : null}

          {listQuery.isLoading ? (
            <RowsSkeleton rows={6} className="p-4" />
          ) : listQuery.isError ? (
            <div className="p-4">
              <RetryAlert message={copy.loadError} onRetry={() => void listQuery.refetch()} />
            </div>
          ) : rows.length === 0 ? (
            <Empty className="py-14">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  {hasNarrowing ? <SearchX /> : <Tags />}
                </EmptyMedia>
                <EmptyTitle>{hasNarrowing ? copy.noMatches : copy.empty}</EmptyTitle>
                <EmptyDescription>
                  {hasNarrowing ? copy.noMatchesHint : copy.emptyHint}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            /* Virtualised rows — never all 1000 at once. This is a bare table,
               not <Table>, so the header can stick inside this scroller. */
            <div ref={listRef} className="max-h-[32rem] overflow-auto">
              <table data-slot="table" className="w-full table-fixed text-sm">
                <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)]">
                  <TableRow className="border-0 hover:bg-transparent">
                    <TableHead className="w-11 pl-4" />
                    <TableHead aria-sort={ariaSort("name")}>
                      <button
                        type="button"
                        className={cn(
                          "flex items-center gap-1 text-xs hover:text-foreground",
                          sortKey === "name" ? "text-foreground" : "text-muted-foreground",
                        )}
                        onClick={() => {
                          setSortKey("name");
                          setSortAsc(sortKey === "name" ? !sortAsc : true);
                        }}
                      >
                        {copy.name}
                        {sortIcon("name")}
                      </button>
                    </TableHead>
                    <TableHead aria-sort={ariaSort("count")} className="w-24 text-right sm:w-36">
                      <button
                        type="button"
                        className={cn(
                          "ml-auto flex items-center gap-1 text-xs hover:text-foreground",
                          sortKey === "count" ? "text-foreground" : "text-muted-foreground",
                        )}
                        onClick={() => {
                          setSortKey("count");
                          setSortAsc(sortKey === "count" ? !sortAsc : false);
                        }}
                      >
                        {sortIcon("count")}
                        {kind === "categories" ? copy.correspondentsCount : copy.docs}
                      </button>
                    </TableHead>
                    <TableHead className="hidden w-52 text-right text-xs font-medium text-muted-foreground md:table-cell">
                      {copy.suggestion}
                    </TableHead>
                    <TableHead className="w-12 pr-3" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paddingTop > 0 ? (
                    <tr aria-hidden="true" style={{ height: paddingTop }}>
                      <td colSpan={5} />
                    </tr>
                  ) : null}
                  {virtualItems.map((virtualRow) => {
                    const row = rows[virtualRow.index];
                    const target = suggestions.get(row.id);
                    const selected = selectedIds.includes(row.id);
                    return (
                      <TableRow
                        key={row.id}
                        data-state={selected ? "selected" : undefined}
                        style={{ height: ROW_HEIGHT }}
                        className={cn(selected && "bg-brand-soft hover:bg-brand-soft")}
                      >
                        <TableCell className="py-0 pl-4">
                          <Checkbox
                            aria-label={row.name}
                            checked={selected}
                            className="align-middle"
                            onClick={(event) => toggleRow(virtualRow.index, event.shiftKey)}
                          />
                        </TableCell>
                        <TableCell className="py-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-medium">{row.name}</span>
                            {row.builtin ? (
                              <Badge variant="secondary" className="shrink-0">
                                {copy.builtinBadge}
                              </Badge>
                            ) : null}
                            {kind === "correspondents" && row.categoryName ? (
                              <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                                {row.categoryName}
                              </span>
                            ) : null}
                            {target ? (
                              /* The suggestion column gives way on a phone; the
                                 row menu still offers the merge. */
                              <GitMerge
                                aria-hidden="true"
                                className="size-3.5 shrink-0 text-warning md:hidden"
                              />
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="py-0">
                          <div className="flex items-center justify-end gap-2.5">
                            <span
                              aria-hidden="true"
                              className="hidden h-1 w-14 overflow-hidden rounded-full bg-muted sm:block"
                            >
                              <span
                                className="block h-full rounded-full bg-brand"
                                style={{
                                  width: `${((row.count ?? 0) / maxCount) * 100}%`,
                                }}
                              />
                            </span>
                            <span className="num w-8 text-right text-muted-foreground">
                              {row.count ?? "—"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden py-0 text-right md:table-cell">
                          {target ? (
                            confirmMergeId === row.id ? (
                              <Button
                                size="xs"
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
                                className="inline-flex h-5.5 max-w-full items-center rounded-full bg-warning-soft px-2 text-xs font-medium text-warning outline-none hover:brightness-95 focus-visible:ring-3 focus-visible:ring-ring/50"
                              >
                                <span className="truncate">{copy.mergeInto(target.name)}</span>
                              </button>
                            )
                          ) : null}
                        </TableCell>
                        <TableCell className="py-0 pr-3 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                data-row-menu={row.id}
                                aria-label={copy.actionsFor(row.name)}
                                className="text-muted-foreground"
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-44">
                              <DropdownMenuItem
                                onSelect={() => openRowDialog({ kind: "rename", row })}
                              >
                                <Pencil />
                                {copy.renameEllipsis}
                              </DropdownMenuItem>
                              {kind !== "categories" ? (
                                <DropdownMenuItem
                                  onSelect={() =>
                                    openRowDialog({
                                      kind: "merge",
                                      row,
                                      targetId: target?.id ?? null,
                                    })
                                  }
                                >
                                  <GitMerge />
                                  {target ? copy.mergeInto(target.name) : copy.mergeEllipsis}
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={row.builtin}
                                title={row.builtin ? copy.builtinUndeletable : undefined}
                                onSelect={() => openRowDialog({ kind: "delete", row })}
                              >
                                <Trash2 />
                                {copy.deleteEllipsis}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {paddingBottom > 0 ? (
                    <tr aria-hidden="true" style={{ height: paddingBottom }}>
                      <td colSpan={5} />
                    </tr>
                  ) : null}
                </TableBody>
              </table>
            </div>
          )}
        </Card>
      </TabsContent>

      {/* Rename */}
      <Dialog
        open={rowDialog?.kind === "rename"}
        onOpenChange={(open) => {
          if (!open) setRowDialog(null);
        }}
      >
        <DialogContent onCloseAutoFocus={returnFocusToRow}>
          <DialogHeader>
            <DialogTitle>{copy.renameTitle(rowDialog?.row.name ?? "")}</DialogTitle>
            <DialogDescription>{copy.renameDescription}</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              const name = dialogName.trim();
              if (!rowDialog || !name) return;
              renameMutation.mutate(
                { id: rowDialog.row.id, name },
                { onSuccess: () => setRowDialog(null) },
              );
            }}
          >
            <Field>
              <FieldLabel htmlFor="taxonomy-rename">{copy.newName}</FieldLabel>
              <Input
                id="taxonomy-rename"
                value={dialogName}
                onChange={(event) => setDialogName(event.target.value)}
                autoFocus
              />
            </Field>
            {renameMutation.error ? (
              <p className="text-sm text-destructive" role="alert">
                {renameMutation.error instanceof Error
                  ? renameMutation.error.message
                  : copy.actionFailed}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRowDialog(null)}>
                {copy.cancel}
              </Button>
              <Button type="submit" disabled={!dialogName.trim() || busy}>
                {renameMutation.isPending ? <Spinner /> : null}
                {copy.rename}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Merge */}
      <Dialog
        open={rowDialog?.kind === "merge"}
        onOpenChange={(open) => {
          if (!open) setRowDialog(null);
        }}
      >
        <DialogContent onCloseAutoFocus={returnFocusToRow}>
          <DialogHeader>
            <DialogTitle>{copy.mergeTitle(rowDialog?.row.name ?? "")}</DialogTitle>
            <DialogDescription>{copy.mergeDescription}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-5">
            <Field>
              <FieldLabel htmlFor="taxonomy-merge-target">{copy.mergeTarget}</FieldLabel>
              <Select value={dialogTargetId} onValueChange={setDialogTargetId}>
                <SelectTrigger id="taxonomy-merge-target" className="w-full">
                  <SelectValue placeholder={copy.mergePlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  <div className="p-1">
                    <Input
                      value={dialogTargetQuery}
                      onChange={(event) => setDialogTargetQuery(event.target.value)}
                      onKeyDown={(event) => event.stopPropagation()}
                      placeholder={copy.filter}
                      className="h-7"
                    />
                  </div>
                  {dialogTargetOptions.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.name}
                    </SelectItem>
                  ))}
                  {dialogTargetOptions.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">{copy.empty}</p>
                  ) : null}
                </SelectContent>
              </Select>
            </Field>
            {mergeMutation.error ? (
              <p className="text-sm text-destructive" role="alert">
                {mergeMutation.error instanceof Error
                  ? mergeMutation.error.message
                  : copy.actionFailed}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRowDialog(null)}>
              {copy.cancel}
            </Button>
            <Button
              disabled={!dialogTargetId || busy}
              onClick={() => {
                if (!rowDialog) return;
                mergeMutation.mutate(
                  { sourceId: rowDialog.row.id, targetId: dialogTargetId },
                  { onSuccess: () => setRowDialog(null) },
                );
              }}
            >
              {mergeMutation.isPending ? <Spinner /> : <GitMerge />}
              {copy.mergeAction}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete several at once, from the selection or the unused sweep */}
      <AlertDialog
        open={bulkDeleteIds !== null}
        onOpenChange={(open) => {
          if (!open) setBulkDeleteIds(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.bulkDeleteTitle(bulkDeleteIds?.length ?? 0)}</AlertDialogTitle>
            <AlertDialogDescription>
              {copy.bulkDeleteDescription(bulkDeleteUsage, kind === "categories")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteMutation.error ? (
            <p className="text-sm text-destructive" role="alert">
              {deleteMutation.error instanceof Error
                ? deleteMutation.error.message
                : copy.actionFailed}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{copy.cancel}</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (!bulkDeleteIds) return;
                deleteMutation.mutate(bulkDeleteIds, {
                  onSuccess: () => setBulkDeleteIds(null),
                });
              }}
            >
              {deleteMutation.isPending ? <Spinner /> : <Trash2 />}
              {copy.del}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete */}
      <AlertDialog
        open={rowDialog?.kind === "delete"}
        onOpenChange={(open) => {
          if (!open) setRowDialog(null);
        }}
      >
        <AlertDialogContent onCloseAutoFocus={returnFocusToRow}>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.deleteTitle(rowDialog?.row.name ?? "")}</AlertDialogTitle>
            <AlertDialogDescription>
              {copy.deleteDescription(rowDialog?.row.count ?? null)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteMutation.error ? (
            <p className="text-sm text-destructive" role="alert">
              {deleteMutation.error instanceof Error
                ? deleteMutation.error.message
                : copy.actionFailed}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{copy.cancel}</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (!rowDialog) return;
                deleteMutation.mutate([rowDialog.row.id], {
                  onSuccess: () => setRowDialog(null),
                });
              }}
            >
              {deleteMutation.isPending ? <Spinner /> : <Trash2 />}
              {copy.del}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tabs>
  );
}
