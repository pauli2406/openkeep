import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Sidebar,
  LayoutGrid,
  Rows3,
  CalendarRange,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type { ExplorerSearch, ExplorerView } from "@/lib/explorer";
import {
  fetchDocumentsTimeline,
  fetchExplorerFacets,
  fetchFilteredDocuments,
  nextExplorerSearch,
} from "@/lib/explorer";
import { processingRefetchInterval } from "@/lib/document-processing";
import { authFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FilterSidebar } from "./filter-sidebar";
import { ActiveFilters } from "./active-filters";
import { GroupsView } from "./groups-view";
import {
  ErrorBlock,
  ExplorerSectionHeader,
  LoadingBlock,
} from "./shared";
import { DocumentTable, type SortField } from "./document-table";
import { TimelineView } from "./timeline-view";

type ExplorerSurfaceProps = {
  title: string;
  eyebrow: string;
  description: string;
  search: ExplorerSearch;
  onSearchChange: (next: ExplorerSearch) => void;
  openDocument: (documentId: string) => void;
  allowViewSwitch?: boolean;
  forcedView?: ExplorerView;
};

const VIEW_OPTIONS: Array<{
  value: ExplorerView;
  label: string;
  icon: typeof Rows3;
}> = [
  { value: "list", label: "List", icon: Rows3 },
  { value: "timeline", label: "Timeline", icon: CalendarRange },
  { value: "groups", label: "Groups", icon: LayoutGrid },
];

export function ExplorerSurface({
  title,
  eyebrow,
  description,
  search,
  onSearchChange,
  openDocument,
  allowViewSwitch = true,
  forcedView,
}: ExplorerSurfaceProps) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [queryDraft, setQueryDraft] = useState(search.query ?? "");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Bulk export = the existing per-document download endpoint, once per
  // selection. There is no archive-export endpoint to call here.
  const exportSelected = async () => {
    for (const documentId of selectedIds) {
      const response = await authFetch(`/api/documents/${documentId}/download`);
      if (!response.ok) continue;
      // Keep the original filename and extension, as the detail page does.
      const disposition = response.headers.get("Content-Disposition");
      const match = disposition?.match(/filename="?([^"]+)"?/);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = match?.[1] ?? documentId;
      link.click();
      URL.revokeObjectURL(url);
    }
  };
  const [reprocessDialogOpen, setReprocessDialogOpen] = useState(false);
  const activeView = forcedView ?? search.view ?? "list";

  useEffect(() => {
    setQueryDraft(search.query ?? "");
  }, [search.query]);

  useEffect(() => {
    if (activeView !== "list") {
      setSelectedIds([]);
    }
  }, [activeView]);

  const facetsQuery = useQuery({
    queryKey: ["documents", "facets"],
    queryFn: fetchExplorerFacets,
  });
  const documentsQuery = useQuery({
    queryKey: ["documents", "explorer", search],
    queryFn: () => fetchFilteredDocuments(search),
    enabled: activeView === "list",
    refetchInterval: (query) => processingRefetchInterval(query.state.data, (data) => data?.items),
  });
  const timelineQuery = useQuery({
    queryKey: ["documents", "timeline", search],
    queryFn: () => fetchDocumentsTimeline(search),
    enabled: activeView === "timeline",
  });
  const visibleDocumentIds = useMemo(
    () => (documentsQuery.data?.items ?? []).map((document) => document.id),
    [documentsQuery.data?.items],
  );

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => visibleDocumentIds.includes(id)));
  }, [visibleDocumentIds]);

  const batchDeleteMutation = useMutation({
    mutationFn: async (documentIds: string[]) => {
      for (const documentId of documentIds) {
        const response = await authFetch(`/api/documents/${documentId}`, {
          method: "DELETE",
        });
        if (!response.ok) {
          throw new Error(`Failed to delete one or more documents`);
        }
      }
    },
    onSuccess: async () => {
      setDeleteDialogOpen(false);
      setSelectedIds([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["documents", "explorer"] }),
        queryClient.invalidateQueries({ queryKey: ["documents", "facets"] }),
        queryClient.invalidateQueries({ queryKey: ["documents", "timeline"] }),
      ]);
    },
  });

  const batchReprocessMutation = useMutation({
    mutationFn: async (documentIds: string[]) => {
      const response = await authFetch("/api/documents/reprocess/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scope: "selected",
          documentIds,
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to reprocess one or more documents");
      }

      return (await response.json()) as {
        queuedCount: number;
        skippedCount: number;
      };
    },
    onSuccess: async () => {
      setReprocessDialogOpen(false);
      setSelectedIds([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["documents", "explorer"] }),
        queryClient.invalidateQueries({ queryKey: ["documents", "facets"] }),
        queryClient.invalidateQueries({ queryKey: ["documents", "timeline"] }),
      ]);
    },
  });




  return (
    <div className="space-y-6 p-6 md:p-8">
      <ExplorerSectionHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
      />

      <div className="flex flex-wrap items-center gap-3">
        <form
          className="flex min-w-[280px] flex-1 items-center gap-2 rounded-full border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] px-4 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            onSearchChange(
              nextExplorerSearch(search, {
                query: queryDraft || undefined,
                page: undefined,
              }),
            );
          }}
        >
          <Search className="h-4 w-4 text-[color:var(--explorer-muted)]" />
          <input
            value={queryDraft}
            onChange={(event) => setQueryDraft(event.target.value)}
            placeholder="Search titles, snippets, or archive terms"
            className="h-10 w-full bg-transparent text-sm text-[color:var(--explorer-ink)] outline-none placeholder:text-[color:var(--explorer-muted)]"
          />
        </form>

        {allowViewSwitch ? (
          <div className="flex items-center gap-2 rounded-full border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] p-1">
            {VIEW_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() =>
                    onSearchChange(
                      nextExplorerSearch(search, {
                        view: option.value,
                        page: undefined,
                      }),
                    )
                  }
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition ${
                    activeView === option.value
                      ? "bg-[color:var(--ok-accent-soft)] text-[color:var(--ok-accent)]"
                      : "text-[color:var(--explorer-muted)]"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {option.label}
                </button>
              );
            })}
          </div>
        ) : null}

        <Button
          variant="outline"
          onClick={() => setSidebarOpen((current) => !current)}
        >
          <Sidebar className="h-4 w-4" />
          {sidebarOpen ? "Hide filters" : "Show filters"}
        </Button>

      </div>

      {activeView === "list" && selectedIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--r-md)] border border-[var(--ok-accent)]/25 bg-accent px-3 py-2">
          <span className="text-sm text-accent-foreground">
            <span className="ok-num font-semibold">{selectedIds.length}</span>{" "}
            {t("documents.selected")}
          </span>
          <div className="ml-2 flex flex-wrap items-center gap-2">
            {/* No bulk tag / set-type endpoint exists; this ticket is
                web-only, so these stay disabled rather than faked. */}
            <Button
              variant="outline"
              size="sm"
              disabled
              title={t("documents.bulkUnavailable")}
            >
              {t("documents.bulkTag")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled
              title={t("documents.bulkUnavailable")}
            >
              {t("documents.bulkSetType")}
            </Button>
            <Button variant="outline" size="sm" onClick={exportSelected}>
              {t("documents.bulkExport")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setReprocessDialogOpen(true)}>
              <RefreshCw />
              {t("documents.reprocess")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDeleteDialogOpen(true)}>
              <Trash2 />
              {t("documents.bulkDelete")}
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setSelectedIds([])}
          >
            <X />
            {t("documents.clearSelection")}
          </Button>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        {sidebarOpen ? (
          <FilterSidebar
            facets={facetsQuery.data}
            search={search}
            onSearchChange={(updates) =>
              onSearchChange(nextExplorerSearch(search, updates))
            }
          />
        ) : null}

        <div className="space-y-5">
          <ActiveFilters
            facets={facetsQuery.data}
            search={search}
            onSearchChange={(updates) =>
              onSearchChange(nextExplorerSearch(search, updates))
            }
          />

          {activeView === "list" ? (
            documentsQuery.isLoading ? (
              <LoadingBlock label="Loading filtered documents" />
            ) : documentsQuery.isError ? (
              <ErrorBlock
                label="Failed to load the filtered archive list."
                action={
                  <Button variant="outline" onClick={() => documentsQuery.refetch()}>
                    Retry
                  </Button>
                }
              />
            ) : (
              <DocumentTable
                documents={documentsQuery.data?.items ?? []}
                emptyLabel="No documents match the current explorer filters."
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                onOpen={openDocument}
                sort={(search.sort as SortField) ?? "createdAt"}
                direction={(search.direction as "asc" | "desc") ?? "desc"}
                onSortChange={(sort, direction) =>
                  onSearchChange(
                    nextExplorerSearch(search, { sort, direction, page: undefined }),
                  )
                }
              />
            )
          ) : null}

          {activeView === "timeline" ? (
            timelineQuery.isLoading ? (
              <LoadingBlock label="Loading timeline map" />
            ) : timelineQuery.isError || !timelineQuery.data ? (
              <ErrorBlock
                label="Failed to load the timeline buckets."
                action={
                  <Button variant="outline" onClick={() => timelineQuery.refetch()}>
                    Retry
                  </Button>
                }
              />
            ) : (
              <TimelineView
                timeline={timelineQuery.data}
                search={search}
                onOpenDocument={openDocument}
                expanded={search.expanded ?? []}
                onToggleMonth={(monthKey) =>
                  onSearchChange(
                    nextExplorerSearch(search, {
                      expanded: search.expanded?.includes(monthKey)
                        ? search.expanded.filter((value) => value !== monthKey)
                        : [...(search.expanded ?? []), monthKey],
                    }),
                  )
                }
              />
            )
          ) : null}

          {activeView === "groups" ? (
            <GroupsView
              facets={facetsQuery.data}
              selectedCorrespondentIds={search.correspondentIds ?? []}
              hasFilters={Boolean(
                search.query ||
                  search.year ||
                  search.statuses?.length ||
                  search.documentTypeIds?.length ||
                  search.tags?.length ||
                  search.dateFrom ||
                  search.dateTo ||
                  search.amountMin != null ||
                  search.amountMax != null,
              )}
              onSelectCorrespondent={(correspondentId) =>
                // A group click opens the list for that correspondent, so it
                // replaces the correspondent filter rather than adding to it.
                onSearchChange(
                  nextExplorerSearch(search, {
                    correspondentIds: [correspondentId],
                    view: "list",
                    page: undefined,
                  }),
                )
              }
            />
          ) : null}
        </div>
      </div>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="border-[color:var(--explorer-border)] bg-card text-[color:var(--explorer-ink)]">
          <DialogHeader>
            <DialogTitle className="ok-page-title">
              Delete {selectedIds.length} document{selectedIds.length === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription className="text-sm text-[color:var(--explorer-muted)]">
              This removes the selected archive records immediately. Use this when you want a clean re-ingest or to clear obvious mistakes in bulk.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-[var(--r-lg)] border border-[color:var(--explorer-border)] bg-card px-4 py-3 text-sm text-[color:var(--explorer-ink)]">
            {selectedIds.length > 0
              ? `${selectedIds.length} selected items will be deleted from the current archive.`
              : "No documents selected."}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={batchDeleteMutation.isPending}
            >
              <X className="h-4 w-4" />
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => batchDeleteMutation.mutate(selectedIds)}
              disabled={selectedIds.length === 0 || batchDeleteMutation.isPending}
            >
              {batchDeleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reprocessDialogOpen} onOpenChange={setReprocessDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Reprocess {selectedIds.length} document{selectedIds.length === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription>
              This will queue the selected documents for OCR and metadata extraction again. Manual
              overrides remain locked.
            </DialogDescription>
          </DialogHeader>

          {batchReprocessMutation.isError ? (
            <p className="text-sm text-destructive">
              {batchReprocessMutation.error instanceof Error
                ? batchReprocessMutation.error.message
                : "Failed to reprocess selected documents."}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setReprocessDialogOpen(false)}
              disabled={batchReprocessMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => batchReprocessMutation.mutate(selectedIds)}
              disabled={selectedIds.length === 0 || batchReprocessMutation.isPending}
            >
              {batchReprocessMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Queueing
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Reprocess
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
