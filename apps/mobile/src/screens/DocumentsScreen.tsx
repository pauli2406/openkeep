import { useNavigation } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAuth } from "../auth";
import { Button, EmptyState, ErrorCard, FullScreenModal, Notice, Panel, Pill, Row, Screen, type PillTone, type RowDot } from "../components/ui";
import { SafeAreaView } from "react-native-safe-area-context";
import { documentRowState, processingRefetchInterval } from "../document-processing";
import { useDashboardInsights } from "../hooks/useDashboardInsights";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import { useSelectionMode } from "../selection-mode";
import type { AppStackParamList } from "../../App";
import { createThemedStyles, radii, useColors } from "../theme";
import { text } from "../typography";
import {
  buildDocumentsSearchParams,
  fetchTaxonomy,
  formatCurrency,
  formatShortDate,
  parseArchiveDate,
  responseToMessage,
  taxonomyQueryKey,
  titleForDocument,
  type ArchiveDocument,
  type SearchDocumentsResponse,
} from "../lib";

type Translate = ReturnType<typeof useI18n>["t"];

/**
 * The chip row. `review` uses the review-queue endpoint the Review tab already
 * calls; `year` and `due` use the `year` and `sort` params `/api/documents`
 * already accepts. There is no `reviewStatus` filter and no "has a due date"
 * filter on that endpoint, so `due` orders by due date rather than filtering —
 * and the count strip says which order is in force.
 */
type DocFilter = "all" | "review" | "due" | "year";

const PAGE_SIZE = 30;

function isOverdue(document: ArchiveDocument) {
  // A finished task is never overdue — the deadline queues exclude it too.
  if (!document.dueDate || document.taskCompletedAt) {
    return false;
  }
  const due = parseArchiveDate(document.dueDate);
  if (!due) {
    return false;
  }
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return due.getTime() < startOfToday.getTime();
}

function documentDot(document: ArchiveDocument): RowDot {
  switch (documentRowState(document)) {
    case "failed":
      return "red";
    case "processing":
    case "queued":
      return "faint";
    default:
      if (isOverdue(document)) {
        return "red";
      }
      return document.reviewStatus === "pending" ? "amber" : "green";
  }
}

function documentMeta(document: ArchiveDocument, t: Translate) {
  const state = documentRowState(document);
  if (state === "failed") {
    return t("state.failed");
  }
  if (state === "queued") {
    return t("state.queued");
  }
  if (state === "processing") {
    return t("state.processing");
  }

  const correspondent = document.correspondent?.name ?? t("documents.unfiled");
  const type = document.documentType?.name;
  return type ? `${correspondent} · ${type}` : correspondent;
}

/** At most one pill per row — this is a 62pt row, not a card. */
function documentPill(
  document: ArchiveDocument,
  t: Translate,
): { label: string; tone: PillTone } | null {
  const state = documentRowState(document);
  if (state === "failed") {
    return { label: t("documents.docStatus.failed"), tone: "bad" };
  }
  if (state === "processing" || state === "queued") {
    return { label: t("documents.docStatus.processing"), tone: "outline" };
  }
  if (isOverdue(document)) {
    return { label: t("documents.duePill"), tone: "bad" };
  }
  if (document.reviewStatus === "pending") {
    return { label: t("documents.filter.review"), tone: "warn" };
  }
  return null;
}

export function DocumentsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const queryClient = useQueryClient();
  const shouldUseCache = offline.shouldUseCache || auth.isOfflineSession;

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DocFilter>("all");
  const [oldestFirst, setOldestFirst] = useState(false);
  /**
   * Selection lives in screen state, so it survives scrolling and dies on exit.
   * It holds the documents themselves: the search field and the chips can change
   * what is loaded, and a bulk action has to act on what was picked rather than
   * on whatever the list happens to show when the button is pressed.
   */
  const [selected, setSelected] = useState<Map<string, ArchiveDocument>>(new Map());
  const [tagSheetOpen, setTagSheetOpen] = useState(false);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  /** Server-side only: the offline mirror knows no correspondent categories. */
  const [categoryFilter, setCategoryFilter] = useState<{ id: string; name: string } | null>(null);
  const [tagSearch, setTagSearch] = useState("");
  const selecting = selected.size > 0;

  // The shell hides the scan button while a selection is live; its corner is
  // where the action bar puts `Delete`.
  const selectionMode = useSelectionMode();
  useEffect(() => {
    selectionMode.setSelecting(selecting);
    return () => selectionMode.setSelecting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecting]);

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

  const currentYear = new Date().getFullYear();
  const insights = useDashboardInsights();
  const reviewCount = insights.data?.stats.pendingReview ?? 0;

  const params = useMemo(
    () =>
      buildDocumentsSearchParams({
        query,
        filter,
        oldestFirst,
        currentYear,
        pageSize: PAGE_SIZE,
        // Dropped offline rather than silently misapplied: the cached mirror
        // stores documents, not correspondent categories.
        categoryId: shouldUseCache ? null : categoryFilter?.id ?? null,
      }),
    [query, filter, oldestFirst, currentYear, categoryFilter, shouldUseCache],
  );

  const documentsQuery = useQuery({
    queryKey: [
      "documents",
      auth.apiUrl,
      filter,
      params,
      shouldUseCache,
      offline.cacheSummary.revision,
    ],
    queryFn: async () => {
      if (shouldUseCache) {
        // The same filter, sort, and page the online request would carry.
        return offline.queryCachedDocuments({
          query,
          reviewOnly: filter === "review",
          pageSize: PAGE_SIZE,
          ...(filter === "year" ? { year: currentYear } : {}),
          ...(filter === "due"
            ? { sort: "dueDate" as const, direction: "asc" as const }
            : {
                sort: "createdAt" as const,
                direction: oldestFirst ? ("asc" as const) : ("desc" as const),
              }),
        });
      }

      const path =
        filter === "review"
          ? `/api/documents/review?page=1&pageSize=${PAGE_SIZE}`
          : `/api/documents?${params}`;
      const response = await auth.authFetch(path);
      if (!response.ok) {
        throw new Error(t("documents.loadError"));
      }
      return (await response.json()) as SearchDocumentsResponse;
    },
    refetchInterval: shouldUseCache
      ? false
      : (q) => processingRefetchInterval(q.state.data, (data) => data?.items),
  });

  const tagsQuery = useQuery({
    queryKey: taxonomyQueryKey(auth.apiUrl, "tags"),
    enabled: tagSheetOpen && !shouldUseCache,
    queryFn: () => fetchTaxonomy(auth.authFetch, "tags", t("documents.loadError")),
  });

  const categoriesQuery = useQuery({
    queryKey: taxonomyQueryKey(auth.apiUrl, "categories"),
    enabled: categorySheetOpen && !shouldUseCache,
    queryFn: () => fetchTaxonomy(auth.authFetch, "categories", t("documents.loadError")),
  });

  /**
   * Tagging goes through the bulk endpoint — one request, one audit entry per
   * document, no read-modify-write of each document's tag list. Done and
   * delete stay per-document calls; either way, one failure must not hide the
   * requests that already landed, so failures are reported back.
   */
  const bulkMutation = useMutation({
    mutationFn: async (action: { kind: "tag"; tagId: string } | { kind: "done" } | { kind: "delete" }) => {
      const documents = Array.from(selected.values());

      if (action.kind === "tag") {
        try {
          const response = await auth.authFetch("/api/documents/bulk/tags", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              documentIds: documents.map((document) => document.id),
              tagId: action.tagId,
              action: "add",
            }),
          });
          if (!response.ok) {
            throw new Error(await responseToMessage(response));
          }
          const result = (await response.json()) as {
            failed: Array<{ id: string; reason: string }>;
          };
          return { failed: result.failed.map((entry) => entry.id) };
        } catch {
          return { failed: documents.map((document) => document.id) };
        }
      }

      const failed: string[] = [];
      for (const document of documents) {
        const init: RequestInit =
          action.kind === "delete"
            ? { method: "DELETE" }
            : {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ taskCompletedAt: new Date().toISOString() }),
              };
        try {
          const response = await auth.authFetch(`/api/documents/${document.id}`, init);
          if (!response.ok) {
            throw new Error(await responseToMessage(response));
          }
        } catch {
          failed.push(document.id);
        }
      }
      return { failed };
    },
    onSuccess: async ({ failed }) => {
      // Whatever failed stays selected, so a retry touches only that.
      setSelected((current) => {
        const next = new Map<string, ArchiveDocument>();
        for (const id of failed) {
          const document = current.get(id);
          if (document) {
            next.set(id, document);
          }
        }
        return next;
      });
      if (failed.length === 0) {
        setTagSheetOpen(false);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["documents"] }),
        // A deleted or completed document can be sitting in the review queue,
        // and the Review tab stays mounted once visited.
        queryClient.invalidateQueries({ queryKey: ["review"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["document-facets"] }),
      ]);
    },
  });

  // Selection dies on exit, and leaving the tab is an exit — coming back into an
  // armed selection mode invites a bulk action nobody meant.
  useEffect(
    () =>
      navigation.addListener("blur", () => {
        setSelected(new Map());
        setTagSheetOpen(false);
      }),
    [navigation],
  );

  function confirmDelete() {
    Alert.alert(t("documents.deleteTitle"), t("documents.deleteBody"), [
      { text: t("documents.cancel"), style: "cancel" },
      {
        text: t("documents.deleteSelected"),
        style: "destructive",
        onPress: () => bulkMutation.mutate({ kind: "delete" }),
      },
    ]);
  }

  const reprocessMutation = useMutation({
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
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["documents"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        // Reprocessing can clear a pending review, and the Review tab stays
        // mounted once visited.
        queryClient.invalidateQueries({ queryKey: ["review"] }),
      ]);
    },
  });

  // The offline mirror carries issue and due dates as queryable columns, so
  // every chip means the same thing offline as online.
  // Offline the category filter is inert, and the chip says so by disabling.
  const activeCategory = shouldUseCache ? null : categoryFilter;

  const chips: Array<{ key: DocFilter; label: string; count?: number }> = [
    { key: "all", label: t("documents.filter.all") },
    { key: "review", label: t("documents.filter.review"), count: reviewCount },
    { key: "due", label: t("documents.filter.due") },
    { key: "year", label: String(currentYear) },
  ];

  const orderLabel =
    filter === "due"
      ? t("documents.sortDue")
      : oldestFirst
        ? t("documents.sortOldest")
        : t("documents.sortNewest");

  const isFiltered = filter !== "all" || query.trim().length > 0 || activeCategory !== null;

  /**
   * `/api/documents/review` takes no `query`, so a search while the Review chip
   * is active is applied to the fetched page here rather than silently ignored.
   * The count strip reflects what is on screen, not the queue total.
   */
  const needle = query.trim().toLowerCase();
  const reviewFiltered =
    filter === "review" && needle.length > 0 && !shouldUseCache
      ? (documentsQuery.data?.items ?? []).filter((document) =>
          [titleForDocument(document), document.correspondent?.name, document.documentType?.name]
            .filter(Boolean)
            .some((value) => value!.toLowerCase().includes(needle)),
        )
      : null;
  const visibleItems = reviewFiltered ?? documentsQuery.data?.items ?? [];
  const visibleTotal = reviewFiltered ? reviewFiltered.length : documentsQuery.data?.total ?? 0;

  const failedDocument = visibleItems.find(
    (document) => documentRowState(document) === "failed",
  );

  return (
    <Screen
      title={
        selecting ? `${selected.size} ${t("documents.selected")}` : t("documents.title")
      }
      padded={false}
      notice={shouldUseCache ? <Notice label={t("state.offline")} /> : undefined}
      footer={
        selecting ? (
          <View style={styles.bulkBar}>
            <View style={styles.bulkSlot}>
              <Button
                label={t("documents.addTag")}
                variant="secondary"
                size="sm"
                onPress={() => setTagSheetOpen(true)}
                loading={bulkMutation.isPending}
              />
            </View>
            <View style={styles.bulkSlot}>
              <Button
                label={t("documents.markDone")}
                variant="secondary"
                size="sm"
                disabled={bulkMutation.isPending}
                onPress={() => bulkMutation.mutate({ kind: "done" })}
              />
            </View>
            <View style={styles.bulkSlot}>
              <Button
                label={t("documents.deleteSelected")}
                variant="danger"
                size="sm"
                disabled={bulkMutation.isPending}
                onPress={confirmDelete}
              />
            </View>
          </View>
        ) : undefined
      }
      right={
        selecting ? (
          <Pressable onPress={() => setSelected(new Map())} hitSlop={12}>
            <Text style={styles.barAction}>{t("documents.cancel")}</Text>
          </Pressable>
        ) : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("documents.correspondentsAction")}
            onPress={() => navigation.navigate("Correspondents")}
            hitSlop={12}
          >
            <MaterialCommunityIcons
              name="account-multiple-outline"
              size={18}
              color={colors.muted}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("documents.sortAction")}
            onPress={() => setOldestFirst((current) => !current)}
            hitSlop={12}
            disabled={filter === "due"}
          >
            <MaterialCommunityIcons
              name="arrow-up-down"
              size={18}
              color={filter === "due" ? colors.faint : colors.muted}
            />
          </Pressable>
        </>
        )
      }
    >
      <View style={styles.controls}>
        <View style={styles.searchWrap}>
          <MaterialCommunityIcons name="magnify" size={15} color={colors.dim} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("documents.searchPlaceholder")}
            placeholderTextColor={colors.dim}
            style={styles.searchInput}
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery("")} hitSlop={12}>
              <MaterialCommunityIcons name="close" size={15} color={colors.dim} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {chips.map((chip) => {
            const active = chip.key === filter;
            return (
              <Pressable
                key={chip.key}
                onPress={() => setFilter(chip.key)}
                style={[styles.chip, active ? styles.chipActive : styles.chipIdle]}
              >
                <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                  {chip.count ? `${chip.label} · ${chip.count}` : chip.label}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            accessibilityLabel={t("documents.filter.category")}
            disabled={shouldUseCache}
            onPress={() =>
              activeCategory ? setCategoryFilter(null) : setCategorySheetOpen(true)
            }
            style={[
              styles.chip,
              activeCategory ? styles.chipActive : styles.chipIdle,
              shouldUseCache ? styles.chipDisabled : null,
            ]}
          >
            <Text
              style={[
                styles.chipText,
                activeCategory ? styles.chipTextActive : null,
                shouldUseCache ? styles.chipTextDisabled : null,
              ]}
            >
              {activeCategory
                ? `${activeCategory.name} ×`
                : t("documents.filter.category")}
            </Text>
          </Pressable>
        </ScrollView>
      </View>

      {documentsQuery.data ? (
        <View style={styles.countStrip}>
          <Text style={styles.countText}>
            {`${visibleTotal.toLocaleString()} ${t("documents.count")}${
              activeCategory ? ` · ${activeCategory.name}` : ""
            }`}
          </Text>
          <Text style={styles.orderText}>{orderLabel}</Text>
        </View>
      ) : null}

      {documentsQuery.isLoading ? (
        <View style={styles.gutter}>
          <Panel padded>
            <Text style={styles.helper}>{t("documents.loading")}</Text>
          </Panel>
        </View>
      ) : null}

      {documentsQuery.isError ? (
        <View style={styles.gutter}>
          <ErrorCard message={t("documents.loadError")} onRetry={() => documentsQuery.refetch()} />
        </View>
      ) : null}

      {documentsQuery.data ? (
        visibleItems.length === 0 ? (
          isFiltered ? (
            <EmptyState
              title={query.trim() ? t("state.emptySearch") : t("state.emptyFiltered")}
              action={t("state.showAll")}
              onAction={() => {
                setFilter("all");
                setQuery("");
              }}
            />
          ) : (
            <EmptyState title={t("documents.noneTitle")} body={t("documents.noneBody")} />
          )
        ) : (
          visibleItems.map((document) => {
            const state = documentRowState(document);
            const pill = documentPill(document, t);
            return (
              <Row
                key={document.id}
                minHeight={62}
                selected={selected.has(document.id)}
                onLongPress={shouldUseCache ? undefined : () => toggleSelected(document)}
                leading={
                  selecting ? (
                    <MaterialCommunityIcons
                      name={
                        selected.has(document.id)
                          ? "checkbox-marked-circle"
                          : "checkbox-blank-circle-outline"
                      }
                      size={19}
                      color={selected.has(document.id) ? colors.accent : colors.faint}
                    />
                  ) : undefined
                }
                dot={documentDot(document)}
                pulse={state === "processing" || state === "queued"}
                tone={state === "failed" ? "bad" : "default"}
                title={titleForDocument(document)}
                meta={documentMeta(document, t)}
                value={formatCurrency(document.amount, document.currency ?? "EUR")}
                valueMeta={formatShortDate(document.issueDate ?? document.createdAt)}
                valueTone={isOverdue(document) ? "red" : "ink"}
                accessory={pill ? <Pill label={pill.label} tone={pill.tone} /> : undefined}
                onPress={() =>
                  selecting
                    ? toggleSelected(document)
                    : navigation.navigate("DocumentDetail", {
                        documentId: document.id,
                        title: titleForDocument(document),
                      })
                }
              />
            );
          })
        )
      ) : null}

      {bulkMutation.isError || (bulkMutation.data?.failed.length ?? 0) > 0 ? (
        <View style={styles.gutter}>
          <ErrorCard message={t("documents.bulkFailed")} />
        </View>
      ) : null}

      <FullScreenModal
        visible={categorySheetOpen}
        onRequestClose={() => setCategorySheetOpen(false)}
        style={styles.sheetRoot}
      >
          <View style={styles.sheetBar}>
            <Text style={styles.sheetTitle}>{t("documents.categorySheetTitle")}</Text>
            <Pressable onPress={() => setCategorySheetOpen(false)} hitSlop={10}>
              <Text style={styles.barAction}>{t("documents.cancel")}</Text>
            </Pressable>
          </View>
          <ScrollView>
            {(categoriesQuery.data ?? []).map((category) => (
              <Row
                key={category.id}
                title={category.name}
                chevron
                onPress={() => {
                  setCategoryFilter({ id: category.id, name: category.name });
                  setCategorySheetOpen(false);
                }}
              />
            ))}
            {categoriesQuery.isSuccess && (categoriesQuery.data ?? []).length === 0 ? (
              <EmptyState title={t("documents.noCategories")} />
            ) : null}
          </ScrollView>
      </FullScreenModal>

      <FullScreenModal
        visible={tagSheetOpen}
        onRequestClose={() => setTagSheetOpen(false)}
        style={styles.sheetRoot}
      >
          <View style={styles.sheetBar}>
            <Text style={styles.sheetTitle}>{t("documents.tagSheetTitle")}</Text>
            <Pressable onPress={() => setTagSheetOpen(false)} hitSlop={10}>
              <Text style={styles.barAction}>{t("documents.cancel")}</Text>
            </Pressable>
          </View>
          <View style={styles.controls}>
            <View style={styles.searchWrap}>
              <MaterialCommunityIcons name="magnify" size={15} color={colors.dim} />
              <TextInput
                value={tagSearch}
                onChangeText={setTagSearch}
                placeholder={t("documents.tagSearch")}
                placeholderTextColor={colors.dim}
                style={styles.searchInput}
                autoCorrect={false}
              />
            </View>
          </View>
          <ScrollView>
            {(tagsQuery.data ?? [])
              .filter((tag) =>
                tagSearch.trim()
                  ? tag.name.toLowerCase().includes(tagSearch.trim().toLowerCase())
                  : true,
              )
              .map((tag) => (
                <Row
                  key={tag.id}
                  title={tag.name}
                  chevron
                  onPress={
                    bulkMutation.isPending
                      ? undefined
                      : () => bulkMutation.mutate({ kind: "tag", tagId: tag.id })
                  }
                />
              ))}
            {(tagsQuery.data ?? []).length === 0 ? (
              <EmptyState title={t("documents.noTags")} />
            ) : null}
          </ScrollView>
        </FullScreenModal>

      {/* One action for the list rather than a button on every failed row */}
      {failedDocument && !shouldUseCache ? (
        <View style={styles.gutter}>
          <Button
            label={t("state.reprocess")}
            variant="secondary"
            size="sm"
            loading={reprocessMutation.isPending}
            onPress={() => reprocessMutation.mutate(failedDocument.id)}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const useStyles = createThemedStyles((c) => ({
  gutter: {
    padding: 16,
  },
  helper: {
    ...text.meta,
    color: c.muted,
  },
  controls: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 9,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    gap: 9,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 36,
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: radii.lg,
    backgroundColor: c.panel,
    paddingHorizontal: 10,
  },
  searchInput: {
    ...text.body,
    flex: 1,
    minWidth: 0,
    color: c.ink,
    padding: 0,
  },
  chipDisabled: {
    opacity: 0.4,
  },
  chipTextDisabled: {
    color: c.dim,
  },
  chipRow: {
    flexDirection: "row",
    gap: 6,
  },
  chip: {
    flexShrink: 0,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
    minHeight: 28,
    justifyContent: "center",
  },
  chipIdle: {
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  chipActive: {
    backgroundColor: c.accentFill,
  },
  chipText: {
    ...text.meta,
    color: c.muted,
  },
  chipTextActive: {
    ...text.metaStrong,
    color: c.accentFillInk,
  },
  countStrip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.bar,
  },
  countText: {
    ...text.numeric,
    flex: 1,
    color: c.dim,
  },
  orderText: {
    ...text.numeric,
    color: c.faint,
  },
  barAction: {
    ...text.metaStrong,
    color: c.accent,
  },
  bulkBar: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.bar,
  },
  bulkSlot: {
    flex: 1,
  },
  sheetRoot: {
    flex: 1,
    backgroundColor: c.app,
  },
  sheetBar: {
    flexDirection: "row",
    alignItems: "center",
    height: 46,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.bar,
  },
  sheetTitle: {
    ...text.barTitle,
    flex: 1,
    color: c.ink,
  },
}));
