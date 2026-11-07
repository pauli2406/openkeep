import { useNavigation, useRoute } from "@react-navigation/native";
import {
  keepPreviousData,
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as Sharing from "expo-sharing";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AppStackParamList } from "../../App";
import {
  bulkDelete,
  bulkMarkDone,
  bulkReprocess,
  bulkSetTag,
  bulkSetType,
  buildFilterChips,
  clearFacetFilters,
  countActiveFilters,
  DEFAULT_SORT,
  exportDocuments,
  fetchDocumentsPage,
  fetchFacets,
  fetchTimeline,
  flattenDocumentPages,
  nextDocumentsPage,
  queryOfflineDocuments,
  withoutServerOnlyFilters,
  type BulkResult,
  type DocumentSort,
  type FilterChip,
} from "../api/documents";
import { useAuth } from "../auth";
import { Segmented, Skeleton } from "../components/layout";
import { Button, EmptyState, ErrorCard, Notice, Panel, Screen } from "../components/ui";
import { documentRowState, processingRefetchInterval } from "../document-processing";
import { useI18n } from "../i18n";
import {
  fetchTaxonomy,
  responseToMessage,
  saveDownloadToFile,
  taxonomyQueryKey,
  titleForDocument,
  type ArchiveDocument,
  type DocumentFilters,
  type SearchDocumentsResponse,
} from "../lib";
import { useOfflineArchive } from "../offline-archive";
import { useSelectionMode } from "../selection-mode";
import { cardShadow, createThemedStyles, radii, useColors } from "../theme";
import { tabular, text } from "../typography";
import { FilterSheet, statusLabel } from "./documents/FilterSheet";
import { GroupsView, type GroupBy } from "./documents/GroupsView";
import { CardList, CheckMark, DocumentRow, SearchField } from "./documents/parts";
import { BulkTagSheet, BulkTypeSheet, SORT_LABELS, SortSheet } from "./documents/PickerSheets";
import { TimelineSkeleton, TimelineView } from "./documents/TimelineView";

const PAGE_SIZE = 30;
const SEARCH_DEBOUNCE_MS = 300;

type ExplorerView = "list" | "timeline" | "groups";

/**
 * What another screen can ask this one to show: the dossier's "open in
 * documents". Consumed once, so asking again after the filter was removed works.
 */
export type DocumentsRouteParams = { applyFilters?: DocumentFilters };

/** Active filters as removable chips above the results. */
function ActiveFilters({
  chips,
  onRemove,
  onClearAll,
}: {
  chips: FilterChip[];
  onRemove: (chip: FilterChip) => void;
  onClearAll: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  if (chips.length === 0) return null;

  return (
    <View style={styles.chips}>
      {chips.map((chip) => (
        <Pressable
          key={chip.key}
          accessibilityRole="button"
          accessibilityLabel={`${t("filters.remove")}: ${chip.label}`}
          onPress={() => onRemove(chip)}
          hitSlop={{ top: 8, bottom: 8 }}
          style={({ pressed }) => [styles.chip, pressed ? styles.chipPressed : null]}
        >
          <Text style={styles.chipText} numberOfLines={1}>
            {chip.label}
          </Text>
          <MaterialCommunityIcons name="close" size={14} color={colors.accentSoftInk} />
        </Pressable>
      ))}
      {chips.length > 1 ? (
        <Pressable
          accessibilityRole="button"
          onPress={onClearAll}
          hitSlop={{ top: 8, bottom: 8 }}
          style={styles.clearAll}
        >
          <Text style={styles.clearAllText}>{t("filters.clearAll")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ListSkeleton() {
  const styles = useStyles();
  return (
    <Panel style={styles.listCard}>
      <View style={styles.listHead} />
      {[0, 1, 2, 3, 4, 5, 6].map((row) => (
        <View key={row} style={styles.skeletonRow}>
          <Skeleton style={styles.skeletonDot} />
          <View style={styles.skeletonBody}>
            <Skeleton style={[styles.skeletonTitle, row % 2 === 0 ? styles.wide : styles.narrow]} />
            <Skeleton style={styles.skeletonMeta} />
          </View>
          <Skeleton style={styles.skeletonAmount} />
        </View>
      ))}
    </Panel>
  );
}

export function DocumentsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const route = useRoute();
  const queryClient = useQueryClient();
  const shouldUseCache = offline.shouldUseCache || auth.isOfflineSession;

  const [view, setView] = useState<ExplorerView>("list");
  const [groupBy, setGroupBy] = useState<GroupBy>("correspondents");
  const [filters, setFilters] = useState<DocumentFilters>({});
  const [queryDraft, setQueryDraft] = useState("");
  const [sort, setSort] = useState<DocumentSort>(DEFAULT_SORT);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [tagSheetOpen, setTagSheetOpen] = useState(false);
  const [typeSheetOpen, setTypeSheetOpen] = useState(false);
  /**
   * Selection lives in screen state, so it survives scrolling and dies on exit.
   * It holds the documents themselves: a filter can change what is loaded, and a
   * bulk action has to act on what was picked rather than on whatever the list
   * happens to show when the button is pressed.
   */
  const [selected, setSelected] = useState<Map<string, ArchiveDocument>>(new Map());
  /** What the last bulk action left unfinished. Cleared when the next one starts. */
  const [bulkFailure, setBulkFailure] = useState<string | null>(null);
  const selecting = selected.size > 0;

  // Offline these are dropped rather than silently misapplied: the cached mirror
  // stores documents, not correspondent categories.
  const activeFilters = useMemo(
    () => (shouldUseCache ? withoutServerOnlyFilters(filters) : filters),
    [filters, shouldUseCache],
  );

  // The shell reads this while a selection is live.
  const selectionMode = useSelectionMode();
  useEffect(() => {
    selectionMode.setSelecting(selecting);
    return () => selectionMode.setSelecting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecting]);

  // Losing the server mid-selection takes the bulk bar and its sheets with it:
  // everything in them writes.
  useEffect(() => {
    if (!shouldUseCache) return;
    setSelected(new Map());
    setTagSheetOpen(false);
    setTypeSheetOpen(false);
  }, [shouldUseCache]);

  // Typing narrows the list once it pauses, not on every key.
  useEffect(() => {
    const timer = setTimeout(() => commitQuery(queryDraft), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [queryDraft]);

  function commitQuery(value: string) {
    const query = value.trim() || undefined;
    setFilters((current) => (current.query === query ? current : { ...current, query }));
  }

  function changeFilters(updates: Partial<DocumentFilters>) {
    setFilters((current) => ({ ...current, ...updates }));
  }

  function clearAllFilters() {
    setQueryDraft("");
    setFilters({});
  }

  function changeView(next: ExplorerView) {
    setView(next);
    if (next !== "list") setSelected(new Map());
  }

  // The dossier's "open in documents" replaces the whole search, as the web's link does.
  const incoming = (route.params as DocumentsRouteParams | undefined)?.applyFilters;
  useEffect(() => {
    if (!incoming) return;
    setFilters(incoming);
    setQueryDraft(incoming.query ?? "");
    setView("list");
    setSelected(new Map());
    navigation.setParams({ applyFilters: undefined } as never);
  }, [incoming, navigation]);

  // Selection dies on exit, and leaving the tab is an exit: coming back into an
  // armed selection mode invites a bulk action nobody meant.
  useEffect(
    () =>
      navigation.addListener("blur", () => {
        setSelected(new Map());
        setTagSheetOpen(false);
        setTypeSheetOpen(false);
        setFilterSheetOpen(false);
        setSortSheetOpen(false);
      }),
    [navigation],
  );

  const documentsQuery = useInfiniteQuery<
    SearchDocumentsResponse,
    Error,
    InfiniteData<SearchDocumentsResponse>,
    readonly unknown[],
    number
  >({
    queryKey: [
      "documents",
      "explorer",
      auth.apiUrl,
      activeFilters,
      sort,
      shouldUseCache,
      offline.cacheSummary.revision,
    ],
    enabled: view === "list",
    initialPageParam: 1,
    getNextPageParam: (_last, pages) => nextDocumentsPage(pages),
    // Every keystroke's search is a new key. Holding the last page keeps the list
    // on screen instead of flashing a skeleton while the next one arrives.
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) => {
      const input = { filters: activeFilters, sort, page: pageParam, pageSize: PAGE_SIZE };
      return shouldUseCache
        ? queryOfflineDocuments(offline.queryCachedDocuments, input)
        : fetchDocumentsPage(auth.authFetch, input);
    },
    refetchInterval: shouldUseCache
      ? false
      : (query) =>
          processingRefetchInterval(query.state.data, (data) =>
            data?.pages.flatMap((page) => page.items),
          ),
  });

  const documents = useMemo(
    () => flattenDocumentPages(documentsQuery.data?.pages ?? []),
    [documentsQuery.data],
  );
  const total = documentsQuery.data?.pages.at(-1)?.total ?? 0;

  const facetsQuery = useQuery({
    queryKey: [
      "document-facets",
      auth.apiUrl,
      "explorer",
      activeFilters,
      shouldUseCache,
      offline.cacheSummary.revision,
    ],
    queryFn: () =>
      shouldUseCache ? offline.loadCachedFacets() : fetchFacets(auth.authFetch, activeFilters),
    // Every filter change is a new key. Holding the last counts keeps the sheet
    // mounted, so the field being typed in does not lose focus to a skeleton.
    placeholderData: keepPreviousData,
  });

  const timelineQuery = useQuery({
    queryKey: ["documents", "timeline", auth.apiUrl, activeFilters],
    enabled: view === "timeline" && !shouldUseCache,
    queryFn: () => fetchTimeline(auth.authFetch, activeFilters),
  });

  const tagsQuery = useQuery({
    queryKey: taxonomyQueryKey(auth.apiUrl, "tags"),
    enabled: tagSheetOpen && !shouldUseCache,
    queryFn: () => fetchTaxonomy(auth.authFetch, "tags", t("documents.pickerLoadError")),
  });

  const typesQuery = useQuery({
    queryKey: taxonomyQueryKey(auth.apiUrl, "document-types"),
    enabled: typeSheetOpen && !shouldUseCache,
    queryFn: () => fetchTaxonomy(auth.authFetch, "document-types", t("documents.pickerLoadError")),
  });

  async function invalidateAfterWrite() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["documents"] }),
      // A deleted or completed document can be sitting in the review queue, and
      // the Review tab stays mounted once visited.
      queryClient.invalidateQueries({ queryKey: ["review"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["document-facets"] }),
    ]);
  }

  /**
   * Whatever failed stays selected, so a retry touches only that, and what landed
   * is reported rather than hidden by the failure.
   */
  async function settleBulk({ failed }: BulkResult, onComplete?: () => void) {
    setSelected((current) => {
      const next = new Map<string, ArchiveDocument>();
      for (const id of failed) {
        const document = current.get(id);
        if (document) next.set(id, document);
      }
      return next;
    });
    if (failed.length === 0) {
      onComplete?.();
    } else {
      setBulkFailure(t("documents.bulkPartialFailure").replace("{count}", String(failed.length)));
    }
    await invalidateAfterWrite();
  }

  const selectedIds = () => Array.from(selected.keys());

  const tagMutation = useMutation({
    mutationFn: (input: { tagId: string; action: "add" | "remove" }) =>
      bulkSetTag(auth.authFetch, selectedIds(), input.tagId, input.action),
    onMutate: () => setBulkFailure(null),
    onSuccess: (result) => settleBulk(result, () => setTagSheetOpen(false)),
  });

  const typeMutation = useMutation({
    mutationFn: (documentTypeId: string | null) =>
      bulkSetType(auth.authFetch, selectedIds(), documentTypeId),
    onMutate: () => setBulkFailure(null),
    onSuccess: (result) => settleBulk(result, () => setTypeSheetOpen(false)),
  });

  const doneMutation = useMutation({
    mutationFn: () => bulkMarkDone(auth.authFetch, selectedIds()),
    onMutate: () => setBulkFailure(null),
    onSuccess: (result) => settleBulk(result),
  });

  const deleteMutation = useMutation({
    mutationFn: () => bulkDelete(auth.authFetch, selectedIds()),
    onMutate: () => setBulkFailure(null),
    onSuccess: (result) => settleBulk(result),
  });

  const reprocessMutation = useMutation({
    mutationFn: () => bulkReprocess(auth.authFetch, selectedIds()),
    onMutate: () => setBulkFailure(null),
    onSuccess: () => settleBulk({ failed: [] }),
    onError: () => setBulkFailure(t("documents.reprocessFailed")),
  });

  /** Nothing changes on the server, so the selection stays as it was. */
  const exportMutation = useMutation({
    mutationFn: () =>
      exportDocuments(auth.authFetch, Array.from(selected.values()), async (response, filename) => {
        const file = await saveDownloadToFile(response, filename);
        await Sharing.shareAsync(file);
      }),
    onMutate: () => setBulkFailure(null),
    onSuccess: ({ failed }) => {
      if (failed.length > 0) {
        setBulkFailure(t("documents.bulkExportFailed").replace("{count}", String(failed.length)));
      }
    },
  });

  const reprocessFailedMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const response = await auth.authFetch(`/api/documents/${documentId}/reprocess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      if (!response.ok) {
        throw new Error(await responseToMessage(response));
      }
    },
    onSuccess: invalidateAfterWrite,
  });

  const bulkBusy =
    tagMutation.isPending ||
    typeMutation.isPending ||
    doneMutation.isPending ||
    deleteMutation.isPending ||
    reprocessMutation.isPending ||
    exportMutation.isPending;

  function confirmDelete() {
    Alert.alert(
      selected.size === 1
        ? t("documents.deleteTitleOne")
        : t("documents.deleteTitleMany").replace("{count}", String(selected.size)),
      t("documents.deleteBody"),
      [
        { text: t("documents.bulkCancel"), style: "cancel" },
        {
          text: t("documents.deleteNow"),
          style: "destructive",
          onPress: () => deleteMutation.mutate(),
        },
      ],
    );
  }

  function confirmReprocess() {
    Alert.alert(
      selected.size === 1
        ? t("documents.reprocessTitleOne")
        : t("documents.reprocessTitleMany").replace("{count}", String(selected.size)),
      t("documents.reprocessDescription"),
      [
        { text: t("documents.bulkCancel"), style: "cancel" },
        { text: t("documents.reprocess"), onPress: () => reprocessMutation.mutate() },
      ],
    );
  }

  const toggleSelected = (document: ArchiveDocument) =>
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(document.id)) {
        next.delete(document.id);
      } else {
        next.set(document.id, document);
      }
      return next;
    });

  const loadedSelected = documents.filter((document) => selected.has(document.id)).length;
  const allSelected = documents.length > 0 && loadedSelected === documents.length;

  function toggleSelectAll() {
    setSelected((current) => {
      const next = new Map(current);
      for (const document of documents) {
        if (allSelected) {
          next.delete(document.id);
        } else {
          next.set(document.id, document);
        }
      }
      return next;
    });
  }

  function openDocument(document: ArchiveDocument) {
    navigation.navigate("DocumentDetail", {
      documentId: document.id,
      title: titleForDocument(document),
    });
  }

  const activeFilterCount = countActiveFilters(activeFilters);
  const isFiltered = activeFilterCount > 0 || Boolean(activeFilters.query);
  const chips = buildFilterChips(activeFilters, facetsQuery.data, {
    search: t("filters.chipSearch"),
    uncategorized: t("filters.uncategorized"),
    status: (status) => statusLabel(status, t),
  });

  const documentCount = (count: number) =>
    count === 1
      ? t("explorer.countOne")
      : t("explorer.countMany").replace("{count}", count.toLocaleString());

  // What the heading counts follows the view: documents, or the groups on show.
  // A non-breaking space holds the line, so the count does not shift the page.
  let countLabel = " ";
  if (view === "list" && documentsQuery.data) {
    countLabel = documentCount(total);
  } else if (view === "timeline" && timelineQuery.data) {
    countLabel = documentCount(timelineQuery.data.years.reduce((sum, year) => sum + year.count, 0));
  } else if (view === "groups" && !shouldUseCache && facetsQuery.data) {
    const count =
      groupBy === "categories"
        ? (facetsQuery.data.categories?.length ?? 0)
        : facetsQuery.data.correspondents.length;
    countLabel =
      groupBy === "categories"
        ? count === 1
          ? t("explorer.countCategoriesOne")
          : t("explorer.countCategories").replace("{count}", String(count))
        : count === 1
          ? t("explorer.countCorrespondentsOne")
          : t("explorer.countCorrespondents").replace("{count}", String(count));
  }

  const failedDocument = documents.find((document) => documentRowState(document) === "failed");

  const onlineOnly = (body: string) => (
    <Panel>
      <EmptyState
        icon="cloud-off-outline"
        title={t("explorer.onlineOnlyTitle")}
        body={body}
        action={t("explorer.showList")}
        onAction={() => changeView("list")}
      />
    </Panel>
  );

  return (
    <Screen
      title={t("documents.title")}
      titleMeta={countLabel}
      padded={false}
      notice={shouldUseCache ? <Notice label={t("state.offline")} /> : undefined}
      right={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("documents.correspondentsAction")}
          onPress={() => navigation.navigate("Correspondents")}
          style={({ pressed }) => [styles.iconButton, pressed ? styles.iconButtonPressed : null]}
        >
          <MaterialCommunityIcons name="account-multiple-outline" size={20} color={colors.ink} />
        </Pressable>
      }
      footer={
        selecting ? (
          <View style={[styles.bulkBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <View style={styles.bulkHead}>
              <Text style={styles.bulkCount} accessibilityLiveRegion="polite">
                {`${selected.size} ${t("documents.selected")}`}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("documents.clearSelection")}
                onPress={() => {
                  setSelected(new Map());
                  setBulkFailure(null);
                }}
                hitSlop={10}
                style={styles.bulkClose}
              >
                <MaterialCommunityIcons name="close" size={18} color={colors.accentSoftInk} />
              </Pressable>
            </View>
            {bulkFailure ? <Text style={styles.bulkFailure}>{bulkFailure}</Text> : null}
            <View style={styles.bulkActions}>
              <Button
                label={t("documents.bulkTag")}
                icon="tag-outline"
                variant="secondary"
                size="sm"
                disabled={bulkBusy}
                onPress={() => {
                  setBulkFailure(null);
                  setTagSheetOpen(true);
                }}
              />
              <Button
                label={t("documents.bulkSetType")}
                icon="file-document-edit-outline"
                variant="secondary"
                size="sm"
                disabled={bulkBusy}
                onPress={() => {
                  setBulkFailure(null);
                  setTypeSheetOpen(true);
                }}
              />
              <Button
                label={t("documents.bulkExport")}
                icon="export-variant"
                variant="secondary"
                size="sm"
                disabled={bulkBusy}
                loading={exportMutation.isPending}
                onPress={() => exportMutation.mutate()}
              />
              <Button
                label={t("documents.reprocess")}
                icon="refresh"
                variant="secondary"
                size="sm"
                disabled={bulkBusy}
                loading={reprocessMutation.isPending}
                onPress={confirmReprocess}
              />
              <Button
                label={t("documents.markDone")}
                icon="check"
                variant="secondary"
                size="sm"
                disabled={bulkBusy}
                loading={doneMutation.isPending}
                onPress={() => doneMutation.mutate()}
              />
              <Button
                label={t("documents.bulkDelete")}
                icon="trash-can-outline"
                variant="danger"
                size="sm"
                disabled={bulkBusy}
                loading={deleteMutation.isPending}
                onPress={confirmDelete}
              />
            </View>
          </View>
        ) : undefined
      }
    >
      <View style={styles.body}>
        <SearchField
          value={queryDraft}
          onChangeText={setQueryDraft}
          onSubmit={() => commitQuery(queryDraft)}
          placeholder={t("explorer.searchPlaceholder")}
        />

        <View style={styles.toolbar}>
          <View style={styles.segmented}>
            <Segmented
              value={view}
              onChange={changeView}
              options={[
                { value: "list", label: t("explorer.viewList"), icon: "view-list-outline" },
                { value: "timeline", label: t("explorer.viewTimeline"), icon: "calendar-range" },
                { value: "groups", label: t("explorer.viewGroups"), icon: "view-grid-outline" },
              ]}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              activeFilterCount > 0
                ? `${t("filters.show")}, ${activeFilterCount}`
                : t("filters.show")
            }
            onPress={() => setFilterSheetOpen(true)}
            style={({ pressed }) => [
              styles.filterButton,
              pressed ? styles.iconButtonPressed : null,
            ]}
          >
            <MaterialCommunityIcons name="filter-variant" size={18} color={colors.ink} />
            {activeFilterCount > 0 ? (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        <ActiveFilters
          chips={chips}
          onRemove={(chip) => {
            changeFilters(chip.clear);
            if (chip.key === "query") setQueryDraft("");
          }}
          onClearAll={clearAllFilters}
        />

        {view === "list" ? (
          documentsQuery.isLoading ? (
            <ListSkeleton />
          ) : documentsQuery.isError && !documentsQuery.data ? (
            <ErrorCard message={t("explorer.loadError")} onRetry={() => documentsQuery.refetch()} />
          ) : documents.length === 0 ? (
            <Panel>
              {isFiltered ? (
                <EmptyState
                  icon="file-search-outline"
                  title={t("explorer.emptyTitle")}
                  body={t("explorer.empty")}
                  action={t("filters.clearAll")}
                  onAction={clearAllFilters}
                />
              ) : (
                <EmptyState
                  icon="file-search-outline"
                  title={t("explorer.emptyTitle")}
                  body={t("explorer.noneBody")}
                />
              )}
            </Panel>
          ) : (
            <Panel style={styles.listCard}>
              <View style={styles.listHead}>
                {shouldUseCache ? (
                  <View style={styles.flexFill} />
                ) : (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{
                      checked: allSelected ? true : loadedSelected > 0 ? "mixed" : false,
                    }}
                    accessibilityLabel={t("documents.selectAll")}
                    onPress={toggleSelectAll}
                    style={styles.selectAll}
                  >
                    <CheckMark state={allSelected ? "on" : loadedSelected > 0 ? "mixed" : "off"} />
                    <Text style={styles.listHeadText} numberOfLines={1}>
                      {t("documents.selectAll")}
                    </Text>
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t("explorer.sortBy")}: ${t(SORT_LABELS[sort.field])}, ${t(
                    sort.direction === "desc" ? "explorer.sortDesc" : "explorer.sortAsc",
                  )}`}
                  onPress={() => setSortSheetOpen(true)}
                  style={styles.sortButton}
                >
                  <Text style={styles.listHeadText} numberOfLines={1}>
                    {t(SORT_LABELS[sort.field])}
                  </Text>
                  <MaterialCommunityIcons
                    name={sort.direction === "desc" ? "arrow-down" : "arrow-up"}
                    size={15}
                    color={colors.muted}
                  />
                </Pressable>
              </View>

              <CardList>
                {documents.map((document) => (
                  <DocumentRow
                    key={document.id}
                    document={document}
                    selecting={selecting}
                    selected={selected.has(document.id)}
                    onPress={() =>
                      selecting ? toggleSelected(document) : openDocument(document)
                    }
                    // Writing to the server is what selection is for.
                    onLongPress={shouldUseCache ? undefined : () => toggleSelected(document)}
                  />
                ))}
              </CardList>

              {total > documents.length ? (
                <View style={styles.listFoot}>
                  <Text style={styles.showing}>
                    {t("explorer.showing")
                      .replace("{shown}", documents.length.toLocaleString())
                      .replace("{total}", total.toLocaleString())}
                  </Text>
                  <Button
                    label={t("explorer.loadMore")}
                    variant="secondary"
                    size="sm"
                    loading={documentsQuery.isFetchingNextPage}
                    onPress={() => documentsQuery.fetchNextPage()}
                  />
                </View>
              ) : null}
            </Panel>
          )
        ) : null}

        {view === "list" && documentsQuery.isFetchNextPageError ? (
          <ErrorCard message={t("explorer.loadError")} onRetry={() => documentsQuery.fetchNextPage()} />
        ) : null}

        {/* One action for the list rather than a button on every failed row. */}
        {view === "list" && failedDocument && !shouldUseCache && !selecting ? (
          <Button
            label={t("state.reprocess")}
            variant="secondary"
            size="sm"
            icon="refresh"
            loading={reprocessFailedMutation.isPending}
            onPress={() => reprocessFailedMutation.mutate(failedDocument.id)}
          />
        ) : null}

        {view === "timeline" ? (
          shouldUseCache ? (
            onlineOnly(t("explorer.onlineOnlyTimeline"))
          ) : timelineQuery.isLoading ? (
            <TimelineSkeleton />
          ) : timelineQuery.isError || !timelineQuery.data ? (
            <ErrorCard
              message={t("explorer.timelineError")}
              onRetry={() => timelineQuery.refetch()}
            />
          ) : (
            <TimelineView
              authFetch={auth.authFetch}
              apiUrl={auth.apiUrl ?? ""}
              timeline={timelineQuery.data}
              filters={activeFilters}
              onOpenDocument={openDocument}
            />
          )
        ) : null}

        {view === "groups" ? (
          shouldUseCache ? (
            onlineOnly(t("explorer.onlineOnlyGroups"))
          ) : facetsQuery.isError && !facetsQuery.data ? (
            <ErrorCard message={t("groups.loadError")} onRetry={() => facetsQuery.refetch()} />
          ) : (
            <GroupsView
              facets={facetsQuery.data}
              loading={facetsQuery.isLoading}
              selectedCorrespondentIds={activeFilters.correspondentIds ?? []}
              groupBy={groupBy}
              onGroupByChange={setGroupBy}
              // A card opens the list for that group, so it replaces the filter
              // of its own dimension rather than adding to it.
              onSelectCorrespondent={(id) => {
                changeFilters({ correspondentIds: [id] });
                setView("list");
              }}
              onSelectCategory={(id) => {
                changeFilters({ categoryIds: [id], uncategorized: undefined });
                setView("list");
              }}
              onSelectUncategorized={() => {
                changeFilters({ uncategorized: true, categoryIds: undefined });
                setView("list");
              }}
              onOpenDossier={(correspondent) =>
                navigation.navigate("CorrespondentDossier", correspondent)
              }
            />
          )
        ) : null}
      </View>

      <FilterSheet
        visible={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        facets={facetsQuery.data}
        loading={facetsQuery.isLoading}
        error={facetsQuery.isError}
        onRetry={() => facetsQuery.refetch()}
        filters={activeFilters}
        onChange={changeFilters}
        onClear={() => setFilters(clearFacetFilters(filters))}
      />

      <SortSheet
        visible={sortSheetOpen}
        onClose={() => setSortSheetOpen(false)}
        sort={sort}
        onChange={setSort}
      />

      <BulkTagSheet
        visible={tagSheetOpen}
        onClose={() => setTagSheetOpen(false)}
        count={selected.size}
        tags={tagsQuery.data}
        loading={tagsQuery.isLoading}
        error={tagsQuery.isError}
        busy={tagMutation.isPending}
        failureMessage={bulkFailure}
        onApply={(tagId, action) => tagMutation.mutate({ tagId, action })}
        onRetry={() => tagsQuery.refetch()}
      />

      <BulkTypeSheet
        visible={typeSheetOpen}
        onClose={() => setTypeSheetOpen(false)}
        count={selected.size}
        types={typesQuery.data}
        loading={typesQuery.isLoading}
        error={typesQuery.isError}
        busy={typeMutation.isPending}
        failureMessage={bulkFailure}
        onApply={(documentTypeId) => typeMutation.mutate(documentTypeId)}
        onRetry={() => typesQuery.refetch()}
      />
    </Screen>
  );
}

const useStyles = createThemedStyles((c) => ({
  flexFill: {
    flex: 1,
  },
  body: {
    gap: 12,
    paddingHorizontal: 16,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.lg,
    backgroundColor: c.panel,
    ...cardShadow(c),
  },
  iconButtonPressed: {
    opacity: 0.7,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  segmented: {
    flex: 1,
    minWidth: 0,
  },
  filterButton: {
    alignItems: "center",
    justifyContent: "center",
    width: 44,
    height: 44,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.lg,
    backgroundColor: c.panel,
  },
  // On the corner, so applying a filter does not squeeze the view switch.
  filterBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
    borderRadius: radii.pill,
    backgroundColor: c.accentFill,
  },
  filterBadgeText: {
    ...text.smallStrong,
    ...tabular,
    color: c.accentFillInk,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "100%",
    height: 28,
    paddingLeft: 10,
    paddingRight: 8,
    borderRadius: radii.pill,
    backgroundColor: c.accentSoft,
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipText: {
    ...text.smallStrong,
    flexShrink: 1,
    color: c.accentSoftInk,
  },
  clearAll: {
    height: 28,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  clearAllText: {
    ...text.smallStrong,
    color: c.accent,
  },
  listCard: {
    overflow: "hidden",
  },
  listHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingLeft: 16,
    paddingRight: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.bar,
  },
  listHeadText: {
    ...text.metaStrong,
    flexShrink: 1,
    color: c.muted,
  },
  selectAll: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 44,
  },
  sortButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 44,
    paddingHorizontal: 4,
  },
  listFoot: {
    gap: 10,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  showing: {
    ...text.small,
    color: c.muted,
    textAlign: "center",
  },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 60,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  skeletonDot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
  },
  skeletonBody: {
    flex: 1,
    gap: 6,
  },
  skeletonTitle: {
    height: 14,
  },
  wide: {
    width: "70%",
  },
  narrow: {
    width: "48%",
  },
  skeletonMeta: {
    width: "36%",
    height: 12,
  },
  skeletonAmount: {
    width: 56,
    height: 14,
  },
  bulkBar: {
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.accentSoft,
  },
  bulkHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  bulkCount: {
    ...text.bodyStrong,
    ...tabular,
    color: c.accentSoftInk,
  },
  bulkClose: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  bulkFailure: {
    ...text.meta,
    color: c.red,
  },
  bulkActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
}));
