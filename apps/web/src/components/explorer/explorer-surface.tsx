import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  CalendarRange,
  Download,
  FileType2,
  Files,
  LayoutGrid,
  ListFilter,
  RefreshCw,
  Rows3,
  Search,
  Tag as TagIcon,
  Trash2,
  X,
} from "lucide-react";
import type { BulkDocumentsResponse, DocumentType, Tag } from "@openkeep/types";
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
import { cn } from "@/lib/utils";
import { Page, PageHeader } from "@/components/layout/page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { countActiveFilters, FilterSidebar } from "./filter-sidebar";
import { ActiveFilters } from "./active-filters";
import { GroupsView } from "./groups-view";
import { ErrorBlock, SegmentedControl } from "./shared";
import { DocumentTable, DocumentTableSkeleton, type SortField } from "./document-table";
import { TimelineSkeleton, TimelineView } from "./timeline-view";

type ExplorerSurfaceProps = {
  title: string;
  search: ExplorerSearch;
  onSearchChange: (next: ExplorerSearch) => void;
  openDocument: (documentId: string) => void;
  allowViewSwitch?: boolean;
  forcedView?: ExplorerView;
};

/** A radix Select item cannot carry an empty value, so "no type" needs a name. */
const NO_TYPE = "__none__";

export function ExplorerSurface({
  title,
  search,
  onSearchChange,
  openDocument,
  allowViewSwitch = true,
  forcedView,
}: ExplorerSurfaceProps) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [queryDraft, setQueryDraft] = useState(search.query ?? "");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [bulkTagId, setBulkTagId] = useState<string>("");
  const [bulkTagAction, setBulkTagAction] = useState<"add" | "remove">("add");
  const [bulkTypeId, setBulkTypeId] = useState<string>("");
  const [bulkFailureCount, setBulkFailureCount] = useState(0);

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
    // The search is part of the key: counts now depend on it, and the
    // unfiltered callers (omnibar, taxonomy) keep the bare key so the two
    // do not overwrite each other in the cache.
    queryKey: ["documents", "facets", search],
    queryFn: () => fetchExplorerFacets(search),
    // Every filter change is a new key. Holding the last counts keeps the sidebar
    // mounted, so the input being typed in does not lose focus to a skeleton.
    placeholderData: keepPreviousData,
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

  const tagsQuery = useQuery({
    queryKey: ["taxonomies", "tags"],
    queryFn: async () => {
      const response = await authFetch("/api/taxonomies/tags");
      if (!response.ok) throw new Error("Failed to load tags");
      return (await response.json()) as Tag[];
    },
    enabled: tagDialogOpen,
  });

  const documentTypesQuery = useQuery({
    queryKey: ["taxonomies", "document-types"],
    queryFn: async () => {
      const response = await authFetch("/api/taxonomies/document-types");
      if (!response.ok) throw new Error("Failed to load document types");
      return (await response.json()) as DocumentType[];
    },
    enabled: typeDialogOpen,
  });

  // Mirrors mobile's partial-failure pattern: what failed stays selected, so
  // a retry touches only that.
  async function applyBulkResult(result: BulkDocumentsResponse, close: () => void) {
    setBulkFailureCount(result.failed.length);
    setSelectedIds(result.failed.map((entry) => entry.id));
    if (result.failed.length === 0) close();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["documents", "explorer"] }),
      queryClient.invalidateQueries({ queryKey: ["documents", "facets"] }),
      queryClient.invalidateQueries({ queryKey: ["documents", "timeline"] }),
    ]);
  }

  const bulkTagMutation = useMutation({
    mutationFn: async () => {
      const response = await authFetch("/api/documents/bulk/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentIds: selectedIds,
          tagId: bulkTagId,
          action: bulkTagAction,
        }),
      });
      if (!response.ok) throw new Error("Bulk tagging failed");
      return (await response.json()) as BulkDocumentsResponse;
    },
    onSuccess: (result) => applyBulkResult(result, () => setTagDialogOpen(false)),
  });

  const bulkTypeMutation = useMutation({
    mutationFn: async () => {
      const response = await authFetch("/api/documents/bulk/type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentIds: selectedIds,
          documentTypeId: bulkTypeId === "" ? null : bulkTypeId,
        }),
      });
      if (!response.ok) throw new Error("Bulk type assignment failed");
      return (await response.json()) as BulkDocumentsResponse;
    },
    onSuccess: (result) => applyBulkResult(result, () => setTypeDialogOpen(false)),
  });

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

  const activeFilterCount = countActiveFilters(search);
  const filterCountBadge =
    activeFilterCount > 0 ? (
      <Badge variant="brand" className="num">
        {activeFilterCount}
      </Badge>
    ) : null;

  const documentCountLabel = (count: number) =>
    count === 1
      ? t("explorer.countOne")
      : t("explorer.countMany").replace("{count}", count.toLocaleString());

  // What the header counts follows the view: documents, or the groups on show.
  let countLabel: string | null = null;
  if (activeView === "list" && documentsQuery.data) {
    countLabel = documentCountLabel(documentsQuery.data.total);
  } else if (activeView === "timeline" && timelineQuery.data) {
    countLabel = documentCountLabel(
      timelineQuery.data.years.reduce((sum, year) => sum + year.count, 0),
    );
  } else if (activeView === "groups" && facetsQuery.data) {
    countLabel =
      search.groupBy === "categories"
        ? t("explorer.countCategories").replace(
            "{count}",
            String(facetsQuery.data.categories?.length ?? 0),
          )
        : t("explorer.countCorrespondents").replace(
            "{count}",
            String(facetsQuery.data.correspondents.length),
          );
  }

  return (
    <Page width="wide">
      {/* A non-breaking space holds the line, so the count does not shift the page. */}
      <PageHeader icon={<Files />} title={title} description={countLabel ?? "\u00A0"} />

      <div className="flex flex-wrap items-center gap-2.5">
        <form
          role="search"
          className="min-w-full flex-1 sm:min-w-64"
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
          <InputGroup className="h-9 bg-card shadow-xs">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              value={queryDraft}
              onChange={(event) => setQueryDraft(event.target.value)}
              placeholder={t("explorer.searchPlaceholder")}
              aria-label={t("explorer.searchPlaceholder")}
            />
          </InputGroup>
        </form>

        {allowViewSwitch ? (
          <SegmentedControl
            label={t("explorer.viewLabel")}
            value={activeView}
            onChange={(view) =>
              onSearchChange(nextExplorerSearch(search, { view, page: undefined }))
            }
            options={[
              { value: "list", label: t("explorer.viewList"), icon: Rows3 },
              { value: "timeline", label: t("explorer.viewTimeline"), icon: CalendarRange },
              { value: "groups", label: t("explorer.viewGroups"), icon: LayoutGrid },
            ]}
          />
        ) : null}

        {/* Beside the results from xl up; a sheet below, where there is no room. */}
        <Button
          variant="outline"
          className="hidden xl:inline-flex"
          onClick={() => setSidebarOpen((current) => !current)}
        >
          <ListFilter />
          {sidebarOpen ? t("filters.hide") : t("filters.show")}
          {filterCountBadge}
        </Button>
        <Button
          variant="outline"
          className="ml-auto sm:ml-0 xl:hidden"
          aria-haspopup="dialog"
          aria-label={t("filters.show")}
          onClick={() => setFilterSheetOpen(true)}
        >
          <ListFilter />
          <span className="hidden sm:inline">{t("filters.show")}</span>
          {filterCountBadge}
        </Button>
      </div>

      <Sheet open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
        <SheetContent className="gap-0 data-[side=right]:w-[22rem] data-[side=right]:max-w-[90vw]">
          <SheetHeader className="pb-2">
            <SheetTitle>{t("filters.title")}</SheetTitle>
            <SheetDescription>{t("filters.sheetDescription")}</SheetDescription>
          </SheetHeader>
          <FilterSidebar
            surface="plain"
            facets={facetsQuery.data}
            loading={facetsQuery.isLoading}
            error={facetsQuery.isError}
            onRetry={() => facetsQuery.refetch()}
            search={search}
            onSearchChange={(updates) =>
              onSearchChange(nextExplorerSearch(search, updates))
            }
          />
          <SheetFooter className="mt-0 border-t">
            <Button onClick={() => setFilterSheetOpen(false)}>{t("filters.done")}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <div
        className={cn(
          "grid min-w-0 gap-5",
          sidebarOpen && "xl:grid-cols-[17rem_minmax(0,1fr)]",
        )}
      >
        {sidebarOpen ? (
          <FilterSidebar
            className="hidden xl:flex"
            facets={facetsQuery.data}
            loading={facetsQuery.isLoading}
            error={facetsQuery.isError}
            onRetry={() => facetsQuery.refetch()}
            search={search}
            onSearchChange={(updates) =>
              onSearchChange(nextExplorerSearch(search, updates))
            }
          />
        ) : null}

        <div className="flex min-w-0 flex-col gap-3.5">
          <ActiveFilters
            facets={facetsQuery.data}
            search={search}
            onSearchChange={(updates) =>
              onSearchChange(nextExplorerSearch(search, updates))
            }
          />

          {activeView === "list" && selectedIds.length > 0 ? (
            <div className="z-20 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-brand-soft px-3.5 py-2.5 shadow-card ring-1 ring-brand/20 sm:sticky sm:top-3">
              <span className="text-sm font-medium text-brand-soft-foreground">
                <span className="num font-semibold">{selectedIds.length}</span>{" "}
                {t("documents.selected")}
              </span>
              <div className="order-3 flex w-full flex-wrap items-center gap-1.5 sm:order-2 sm:w-auto">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setBulkFailureCount(0);
                    setTagDialogOpen(true);
                  }}
                >
                  <TagIcon />
                  {t("documents.bulkTag")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setBulkFailureCount(0);
                    setTypeDialogOpen(true);
                  }}
                >
                  <FileType2 />
                  {t("documents.bulkSetType")}
                </Button>
                <Button variant="outline" size="sm" onClick={exportSelected}>
                  <Download />
                  {t("documents.bulkExport")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setReprocessDialogOpen(true)}>
                  <RefreshCw />
                  {t("documents.reprocess")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-danger hover:text-danger"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 />
                  {t("documents.bulkDelete")}
                </Button>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="order-2 ml-auto sm:order-3"
                aria-label={t("documents.clearSelection")}
                onClick={() => setSelectedIds([])}
              >
                <X />
              </Button>
            </div>
          ) : null}

          {activeView === "list" ? (
            documentsQuery.isLoading ? (
              <DocumentTableSkeleton label={t("explorer.loadingDocuments")} />
            ) : documentsQuery.isError ? (
              <ErrorBlock
                label={`${t("explorer.loadError")}${
                  documentsQuery.error instanceof Error
                    ? ` (${documentsQuery.error.message})`
                    : ""
                }`}
                action={
                  <Button variant="outline" size="sm" onClick={() => documentsQuery.refetch()}>
                    {t("dashboard.retry")}
                  </Button>
                }
              />
            ) : (
              <DocumentTable
                documents={documentsQuery.data?.items ?? []}
                total={documentsQuery.data?.total}
                emptyLabel={t("explorer.empty")}
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
              <TimelineSkeleton label={t("explorer.loadingTimeline")} />
            ) : timelineQuery.isError || !timelineQuery.data ? (
              <ErrorBlock
                label={t("explorer.timelineError")}
                action={
                  <Button variant="outline" size="sm" onClick={() => timelineQuery.refetch()}>
                    {t("dashboard.retry")}
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
            facetsQuery.isError ? (
              <ErrorBlock
                label={t("groups.loadError")}
                action={
                  <Button variant="outline" size="sm" onClick={() => facetsQuery.refetch()}>
                    {t("dashboard.retry")}
                  </Button>
                }
              />
            ) : (
              <GroupsView
                facets={facetsQuery.data}
                loading={facetsQuery.isLoading}
                selectedCorrespondentIds={search.correspondentIds ?? []}
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
                groupBy={search.groupBy ?? "correspondents"}
                onGroupByChange={(groupBy) =>
                  onSearchChange(nextExplorerSearch(search, { groupBy }))
                }
                onSelectCategory={(categoryId) =>
                  onSearchChange(
                    nextExplorerSearch(search, {
                      categoryIds: [categoryId],
                      uncategorized: undefined,
                      view: "list",
                      page: undefined,
                    }),
                  )
                }
                onSelectUncategorized={() =>
                  onSearchChange(
                    nextExplorerSearch(search, {
                      uncategorized: true,
                      categoryIds: undefined,
                      view: "list",
                      page: undefined,
                    }),
                  )
                }
              />
            )
          ) : null}
        </div>
      </div>

      <Dialog open={tagDialogOpen} onOpenChange={setTagDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("documents.bulkTagTitle").replace("{count}", String(selectedIds.length))}</DialogTitle>
            <DialogDescription>{t("documents.bulkTagDescription")}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <SegmentedControl
              label={t("documents.bulkTag")}
              value={bulkTagAction}
              onChange={setBulkTagAction}
              options={[
                { value: "add", label: t("documents.bulkTagAdd") },
                { value: "remove", label: t("documents.bulkTagRemove") },
              ]}
            />
            <Select value={bulkTagId} onValueChange={setBulkTagId}>
              <SelectTrigger className="h-9 w-full" aria-label={t("documents.bulkPickTag")}>
                <SelectValue placeholder={t("documents.bulkPickTag")} />
              </SelectTrigger>
              <SelectContent>
                {(tagsQuery.data ?? []).map((tag) => (
                  <SelectItem key={tag.id} value={tag.id}>
                    {tag.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {bulkFailureCount > 0 ? (
              <DialogError
                label={t("documents.bulkPartialFailure").replace("{count}", String(bulkFailureCount))}
              />
            ) : bulkTagMutation.isError ? (
              <DialogError label={t("documents.bulkFailed")} />
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTagDialogOpen(false)}
              disabled={bulkTagMutation.isPending}
            >
              {t("documents.bulkCancel")}
            </Button>
            <Button
              onClick={() => bulkTagMutation.mutate()}
              disabled={!bulkTagId || selectedIds.length === 0 || bulkTagMutation.isPending}
            >
              {bulkTagMutation.isPending ? <Spinner /> : <TagIcon />}
              {t("documents.bulkApply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={typeDialogOpen} onOpenChange={setTypeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("documents.bulkTypeTitle").replace("{count}", String(selectedIds.length))}</DialogTitle>
            <DialogDescription>{t("documents.bulkTypeDescription")}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bulk-document-type" className="text-xs text-muted-foreground">
                {t("today.documentType")}
              </Label>
              <Select
                value={bulkTypeId === "" ? NO_TYPE : bulkTypeId}
                onValueChange={(value) => setBulkTypeId(value === NO_TYPE ? "" : value)}
              >
                <SelectTrigger id="bulk-document-type" className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TYPE}>{t("documents.bulkTypeNone")}</SelectItem>
                  {(documentTypesQuery.data ?? []).map((documentType) => (
                    <SelectItem key={documentType.id} value={documentType.id}>
                      {documentType.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {bulkFailureCount > 0 ? (
              <DialogError
                label={t("documents.bulkPartialFailure").replace("{count}", String(bulkFailureCount))}
              />
            ) : bulkTypeMutation.isError ? (
              <DialogError label={t("documents.bulkFailed")} />
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTypeDialogOpen(false)}
              disabled={bulkTypeMutation.isPending}
            >
              {t("documents.bulkCancel")}
            </Button>
            <Button
              onClick={() => bulkTypeMutation.mutate()}
              disabled={selectedIds.length === 0 || bulkTypeMutation.isPending}
            >
              {bulkTypeMutation.isPending ? <Spinner /> : null}
              {t("documents.bulkApply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedIds.length === 1
                ? t("documents.deleteTitleOne")
                : t("documents.deleteTitleMany").replace("{count}", String(selectedIds.length))}
            </DialogTitle>
            <DialogDescription>{t("documents.deleteDescription")}</DialogDescription>
          </DialogHeader>

          {batchDeleteMutation.isError ? (
            <DialogError label={t("documents.deleteFailed")} />
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={batchDeleteMutation.isPending}
            >
              {t("documents.bulkCancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => batchDeleteMutation.mutate(selectedIds)}
              disabled={selectedIds.length === 0 || batchDeleteMutation.isPending}
            >
              {batchDeleteMutation.isPending ? <Spinner /> : <Trash2 />}
              {t("documents.deleteNow")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reprocessDialogOpen} onOpenChange={setReprocessDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedIds.length === 1
                ? t("documents.reprocessTitleOne")
                : t("documents.reprocessTitleMany").replace("{count}", String(selectedIds.length))}
            </DialogTitle>
            <DialogDescription>{t("documents.reprocessDescription")}</DialogDescription>
          </DialogHeader>

          {batchReprocessMutation.isError ? (
            <DialogError label={t("documents.reprocessFailed")} />
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReprocessDialogOpen(false)}
              disabled={batchReprocessMutation.isPending}
            >
              {t("documents.bulkCancel")}
            </Button>
            <Button
              onClick={() => batchReprocessMutation.mutate(selectedIds)}
              disabled={selectedIds.length === 0 || batchReprocessMutation.isPending}
            >
              {batchReprocessMutation.isPending ? (
                <>
                  <Spinner />
                  {t("documents.reprocessQueueing")}
                </>
              ) : (
                <>
                  <RefreshCw />
                  {t("documents.reprocess")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function DialogError({ label }: { label: string }) {
  return (
    <Alert variant="destructive" className="border-danger/25 bg-danger-soft text-danger">
      <AlertDescription className="text-danger">{label}</AlertDescription>
    </Alert>
  );
}
