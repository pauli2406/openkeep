import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Sidebar,
  Sparkles,
  Rows3,
  CalendarRange,
  CheckCheck,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type { ExplorerSearch, ExplorerView } from "@/lib/explorer";
import {
  fetchDocumentsProjection,
  fetchDocumentsTimeline,
  fetchExplorerFacets,
  fetchFilteredDocuments,
  nextExplorerSearch,
} from "@/lib/explorer";
import { authFetch } from "@/lib/api";
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
import { GalaxyCanvas } from "./galaxy-canvas";
import {
  DocumentRows,
  ErrorBlock,
  ExplorerSectionHeader,
  LoadingBlock,
} from "./shared";
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
  { value: "galaxy", label: "Galaxy", icon: Sparkles },
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [queryDraft, setQueryDraft] = useState(search.query ?? "");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [reprocessDialogOpen, setReprocessDialogOpen] = useState(false);
  const activeView = forcedView ?? search.view ?? "list";

  useEffect(() => {
    setQueryDraft(search.query ?? "");
  }, [search.query]);

  useEffect(() => {
    if (activeView !== "list") {
      setSelectionMode(false);
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
  });
  const timelineQuery = useQuery({
    queryKey: ["documents", "timeline", search],
    queryFn: () => fetchDocumentsTimeline(search),
    enabled: activeView === "timeline",
  });
  const projectionQuery = useQuery({
    queryKey: ["documents", "projection", search],
    queryFn: () => fetchDocumentsProjection(search),
    enabled: activeView === "galaxy",
  });
  const visibleDocumentIds = useMemo(
    () => (documentsQuery.data?.items ?? []).map((document) => document.id),
    [documentsQuery.data?.items],
  );
  const selectedVisibleCount = visibleDocumentIds.filter((id) => selectedIds.includes(id)).length;

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
      setSelectionMode(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["documents", "explorer"] }),
        queryClient.invalidateQueries({ queryKey: ["documents", "facets"] }),
        queryClient.invalidateQueries({ queryKey: ["documents", "timeline"] }),
        queryClient.invalidateQueries({ queryKey: ["documents", "projection"] }),
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
      setSelectionMode(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["documents", "explorer"] }),
        queryClient.invalidateQueries({ queryKey: ["documents", "facets"] }),
        queryClient.invalidateQueries({ queryKey: ["documents", "timeline"] }),
        queryClient.invalidateQueries({ queryKey: ["documents", "projection"] }),
      ]);
    },
  });

  const toggleSelect = (documentId: string) => {
    setSelectedIds((current) =>
      current.includes(documentId)
        ? current.filter((id) => id !== documentId)
        : [...current, documentId],
    );
  };

  const selectVisible = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const documentId of visibleDocumentIds) {
        next.add(documentId);
      }
      return [...next];
    });
  };

  const clearVisible = () => {
    setSelectedIds((current) => current.filter((id) => !visibleDocumentIds.includes(id)));
  };

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
                      ? "bg-[color:var(--explorer-cobalt-soft)] text-[color:var(--explorer-cobalt)]"
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
          className="rounded-full"
          onClick={() => setSidebarOpen((current) => !current)}
        >
          <Sidebar className="h-4 w-4" />
          {sidebarOpen ? "Hide filters" : "Show filters"}
        </Button>

        {activeView === "list" ? (
          <Button
            variant={selectionMode ? "default" : "outline"}
            className={`rounded-full ${
              selectionMode
                ? "border-[color:var(--explorer-cobalt)] bg-[color:var(--explorer-cobalt)] text-white hover:bg-[color:var(--explorer-cobalt)]/90"
                : ""
            }`}
            onClick={() => {
              setSelectionMode((current) => {
                if (current) {
                  setSelectedIds([]);
                }
                return !current;
              });
            }}
          >
            <CheckCheck className="h-4 w-4" />
            {selectionMode ? "Exit selection" : "Select multiple"}
          </Button>
        ) : null}
      </div>

      {activeView === "list" && selectionMode ? (
        <div className="sticky top-4 z-20 flex flex-wrap items-center justify-between gap-4 rounded-[1.8rem] border border-[color:var(--explorer-cobalt)]/20 bg-[linear-gradient(135deg,rgba(244,238,225,0.94),rgba(231,239,255,0.98))] px-5 py-4 shadow-[0_24px_50px_rgba(56,84,165,0.16)] backdrop-blur">
          <div className="space-y-1">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-[color:var(--explorer-cobalt)]">
              Archive Curation Mode
            </p>
            <p className="text-sm text-[color:var(--explorer-ink)]">
              {selectedIds.length > 0
                ? `${selectedIds.length} selected across the current list`
                : "Choose documents to act on them as a group."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                selectedVisibleCount === visibleDocumentIds.length && visibleDocumentIds.length > 0
                  ? clearVisible()
                  : selectVisible()
              }
              className="rounded-full border border-[color:var(--explorer-border)] bg-white/75 px-3 py-2 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--explorer-ink)] transition hover:border-[color:var(--explorer-cobalt)]/40 hover:text-[color:var(--explorer-cobalt)]"
            >
              {selectedVisibleCount === visibleDocumentIds.length && visibleDocumentIds.length > 0
                ? "Clear visible"
                : "Select visible"}
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="rounded-full border border-[color:var(--explorer-border)] bg-white/75 px-3 py-2 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--explorer-muted)] transition hover:text-[color:var(--explorer-ink)]"
            >
              Reset
            </button>
            <Button
              variant="outline"
              className="rounded-full"
              disabled={selectedIds.length === 0}
              onClick={() => setReprocessDialogOpen(true)}
            >
              <RefreshCw className="h-4 w-4" />
              Reprocess selected
            </Button>
            <Button
              variant="destructive"
              className="rounded-full"
              disabled={selectedIds.length === 0}
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
              Delete selected
            </Button>
          </div>
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
              <DocumentRows
                documents={documentsQuery.data?.items ?? []}
                emptyLabel="No documents match the current explorer filters."
                selectedIds={selectedIds}
                selectionMode={selectionMode}
                onToggleSelect={toggleSelect}
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

          {activeView === "galaxy" ? (
            projectionQuery.isLoading ? (
              <LoadingBlock label="Computing semantic projection" />
            ) : projectionQuery.isError || !projectionQuery.data ? (
              <ErrorBlock
                label="Failed to compute the semantic galaxy view."
                action={
                  <Button variant="outline" onClick={() => projectionQuery.refetch()}>
                    Retry
                  </Button>
                }
              />
            ) : (
              <GalaxyCanvas
                projection={projectionQuery.data}
                colorBy={search.colorBy ?? "correspondent"}
                onColorByChange={(value) =>
                  onSearchChange(nextExplorerSearch(search, { colorBy: value }))
                }
                onOpenDocument={openDocument}
              />
            )
          ) : null}
        </div>
      </div>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="border-[color:var(--explorer-border)] bg-[linear-gradient(180deg,#fffaf1,#f8f0df)] text-[color:var(--explorer-ink)] sm:rounded-[1.6rem]">
          <DialogHeader>
            <DialogTitle className="font-[var(--font-display)] text-3xl">
              Delete {selectedIds.length} document{selectedIds.length === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription className="text-sm text-[color:var(--explorer-muted)]">
              This removes the selected archive records immediately. Use this when you want a clean re-ingest or to clear obvious mistakes in bulk.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-[1.25rem] border border-[color:var(--explorer-border)] bg-white/70 px-4 py-3 text-sm text-[color:var(--explorer-ink)]">
            {selectedIds.length > 0
              ? `${selectedIds.length} selected items will be deleted from the current archive.`
              : "No documents selected."}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={batchDeleteMutation.isPending}
            >
              <X className="h-4 w-4" />
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-full"
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
