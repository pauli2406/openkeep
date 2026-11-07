import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  createTaxonomyEntry,
  deleteTaxonomyEntry,
  fetchFacets,
  fetchTaxonomyEntries,
  mergeTaxonomyEntry,
  renameTaxonomyEntry,
  type TaxonomyKind,
} from "../../api/admin";
import { useAuth } from "../../auth";
import { BottomSheet, Chip, Skeleton } from "../../components/layout";
import { Button, EmptyState, Pill } from "../../components/ui";
import { useI18n } from "../../i18n";
import { taxonomyQueryKey } from "../../lib";
import { createThemedStyles, radii, useColors } from "../../theme";
import { tabular, text } from "../../typography";
import { FormField, InlineError, SettingsHeading, errorText, fill } from "./shared";
import {
  MERGE_TARGET_LIMIT,
  affectedCount,
  buildRows,
  canCreate,
  canMerge,
  computeSuggestions,
  countsFor,
  describeDeletion,
  mergeTargetOptions,
  selectionHasBuiltin,
  unusedSweepIds,
  visibleRows,
  type QuickFilter,
  type SortKey,
  type TaxonomyRow,
} from "./taxonomy-logic";

type SheetState =
  | { kind: "actions"; row: TaxonomyRow }
  | { kind: "rename"; row: TaxonomyRow }
  | { kind: "merge"; ids: string[]; title: string; description: string }
  | { kind: "delete"; row: TaxonomyRow }
  | { kind: "bulkDelete"; ids: string[] };

const KINDS: Array<{ value: TaxonomyKind; label: "taxonomy.tags" | "taxonomy.correspondents" | "taxonomy.types" | "taxonomy.categories" }> = [
  { value: "tags", label: "taxonomy.tags" },
  { value: "correspondents", label: "taxonomy.correspondents" },
  { value: "document-types", label: "taxonomy.types" },
  { value: "categories", label: "taxonomy.categories" },
];

const Row = memo(function Row({
  row,
  selected,
  selecting,
  maxCount,
  suggested,
  showCategory,
  onToggle,
  onOpen,
}: {
  row: TaxonomyRow;
  selected: boolean;
  selecting: boolean;
  maxCount: number;
  suggested: boolean;
  showCategory: boolean;
  onToggle: (id: string) => void;
  onOpen: (row: TaxonomyRow) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  return (
    <View style={[styles.rowFrame, selected ? styles.rowSelected : null]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={fill(t("taxonomy.select"), { name: row.name })}
        accessibilityState={{ checked: selected }}
        onPress={() => onToggle(row.id)}
        style={styles.checkHit}
      >
        <View style={[styles.check, selected ? styles.checkOn : null]}>
          {selected ? (
            <MaterialCommunityIcons name="check" size={13} color={colors.accentFillInk} />
          ) : null}
        </View>
      </Pressable>
      {/* While selecting, a tap on the row selects, as in a list of photos. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={selecting ? undefined : fill(t("taxonomy.actionsFor"), { name: row.name })}
        onPress={() => (selecting ? onToggle(row.id) : onOpen(row))}
        onLongPress={() => onToggle(row.id)}
        delayLongPress={350}
        style={styles.rowMain}
      >
        <View style={styles.rowText}>
          <View style={styles.rowTitleLine}>
            <Text style={styles.rowName} numberOfLines={1}>
              {row.name}
            </Text>
            {suggested ? (
              <MaterialCommunityIcons
                accessibilityLabel={t("taxonomy.mergeHint")}
                name="source-merge"
                size={14}
                color={colors.amber}
              />
            ) : null}
          </View>
          {row.builtin || (showCategory && row.categoryName) ? (
            <View style={styles.rowMetaLine}>
              {row.builtin ? <Pill tone="soft" label={t("taxonomy.builtinBadge")} /> : null}
              {showCategory && row.categoryName ? (
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {row.categoryName}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
        <View style={styles.usage}>
          <View style={styles.bar}>
            <View
              style={[styles.barFill, { width: `${((row.count ?? 0) / maxCount) * 100}%` }]}
            />
          </View>
          <Text style={styles.count}>{row.count ?? "—"}</Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={fill(t("taxonomy.actionsFor"), { name: row.name })}
        onPress={() => onOpen(row)}
        style={styles.menuHit}
      >
        <MaterialCommunityIcons name="dots-horizontal" size={18} color={colors.muted} />
      </Pressable>
    </View>
  );
});

/**
 * Tags, correspondents, types and categories. A list of up to a thousand entries,
 * so the screen is a virtualised list and everything above it is the list's
 * header. Confirmations happen in the sheet: a native alert raised while a modal
 * is on its way out can be dropped on iOS, and these are the destructive ones.
 */
export function TaxonomySection({ header }: { header: ReactNode }) {
  const styles = useStyles();
  const colors = useColors();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();

  const [kind, setKind] = useState<TaxonomyKind>("tags");
  const [filter, setFilter] = useState("");
  const [quick, setQuick] = useState<QuickFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("count");
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [createValue, setCreateValue] = useState("");
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [targetQuery, setTargetQuery] = useState("");

  const fallback = t("taxonomy.actionFailed");

  const listQuery = useQuery({
    queryKey: taxonomyQueryKey(auth.apiUrl, kind),
    queryFn: () => fetchTaxonomyEntries(auth.authFetch, kind, t("taxonomy.loadError")),
  });
  const correspondentsQuery = useQuery({
    queryKey: taxonomyQueryKey(auth.apiUrl, "correspondents"),
    queryFn: () => fetchTaxonomyEntries(auth.authFetch, "correspondents", t("taxonomy.loadError")),
    enabled: kind === "categories",
  });
  const facetsQuery = useQuery({
    queryKey: ["settings", "taxonomy-facets", auth.apiUrl],
    queryFn: () => fetchFacets(auth.authFetch, t("taxonomy.countsUnavailable")),
    staleTime: 60_000,
    enabled: kind !== "categories",
  });

  const counts = useMemo(
    () => countsFor(kind, facetsQuery.data, correspondentsQuery.data),
    [kind, facetsQuery.data, correspondentsQuery.data],
  );
  const countsKnown = counts !== null;
  const allRows = useMemo(() => buildRows(listQuery.data ?? [], counts), [listQuery.data, counts]);
  const suggestions = useMemo(
    () => (canMerge(kind) ? computeSuggestions(allRows) : new Map<string, TaxonomyRow>()),
    [allRows, kind],
  );
  const rows = useMemo(
    () => visibleRows(allRows, { filter, quick, suggestions, sortKey, sortAsc }),
    [allRows, filter, quick, suggestions, sortKey, sortAsc],
  );
  const maxCount = useMemo(() => Math.max(...allRows.map((row) => row.count ?? 0), 1), [allRows]);
  const sweepIds = useMemo(() => (countsKnown ? unusedSweepIds(allRows) : []), [allRows, countsKnown]);

  // A partly failed bulk action leaves ids behind that no longer exist.
  useEffect(() => {
    if (!listQuery.data) return;
    const known = new Set(listQuery.data.map((entry) => entry.id));
    setSelectedIds((current) => {
      const next = current.filter((id) => known.has(id));
      return next.length === current.length ? current : next;
    });
  }, [listQuery.data]);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["taxonomies"] });
    void queryClient.invalidateQueries({ queryKey: ["settings", "taxonomy-facets"] });
    void queryClient.invalidateQueries({ queryKey: ["document-facets"] });
    void queryClient.invalidateQueries({ queryKey: ["documents"] });
  }, [queryClient]);

  // `onSettled`, not `onSuccess`: the entries before the one that failed are gone,
  // and the list has to say so.
  const createMutation = useMutation({
    mutationFn: (name: string) => createTaxonomyEntry(auth.authFetch, kind, name, fallback),
    onSuccess: () => setCreateValue(""),
    onSettled: invalidate,
  });
  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameTaxonomyEntry(auth.authFetch, kind, id, name, fallback),
    onSuccess: () => setSheet(null),
    onSettled: invalidate,
  });
  const mergeMutation = useMutation({
    mutationFn: async ({ ids, target }: { ids: string[]; target: string }) => {
      for (const id of ids) await mergeTaxonomyEntry(auth.authFetch, kind, id, target, fallback);
    },
    onSuccess: (_data, { ids }) => {
      setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
      setSheet(null);
    },
    onSettled: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await deleteTaxonomyEntry(auth.authFetch, kind, id, fallback);
    },
    onSuccess: (_data, ids) => {
      setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
      setSheet(null);
    },
    onSettled: invalidate,
  });
  const busy = mergeMutation.isPending || deleteMutation.isPending || renameMutation.isPending;

  function resetSheetErrors() {
    renameMutation.reset();
    mergeMutation.reset();
    deleteMutation.reset();
  }

  function openSheet(next: SheetState) {
    resetSheetErrors();
    setSheet(next);
  }

  function openMerge(ids: string[], title: string, description: string, suggested: string | null) {
    setTargetId(suggested);
    setTargetQuery("");
    openSheet({ kind: "merge", ids, title, description });
  }

  function openRename(row: TaxonomyRow) {
    setNameDraft(row.name);
    openSheet({ kind: "rename", row });
  }

  const onToggle = useCallback((id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }, []);
  const onOpen = useCallback(
    (row: TaxonomyRow) => {
      resetSheetErrors();
      setSheet({ kind: "actions", row });
    },
    // The mutation `reset` functions are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function switchKind(next: TaxonomyKind) {
    setKind(next);
    setSelectedIds([]);
    setQuick("all");
    setFilter("");
    setCreateValue("");
    setSheet(null);
    createMutation.reset();
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((current) => !current);
    } else {
      setSortKey(key);
      // Names read from A, counts from the busiest.
      setSortAsc(key === "name");
    }
  }

  const selecting = selectedIds.length > 0;
  const hasBuiltinSelected = selectionHasBuiltin(allRows, selectedIds);
  const narrowing = filter.trim() !== "" || quick !== "all";
  const sheetSources =
    sheet?.kind === "merge" ? sheet.ids : [];
  const targets = useMemo(
    () =>
      mergeTargetOptions(allRows, {
        sourceIds: sheetSources,
        selectedId: targetId,
        query: targetQuery,
      }),
    // `sheetSources` is a fresh array only when the sheet changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allRows, sheet, targetId, targetQuery],
  );

  function submitCreate() {
    const name = createValue.trim();
    if (name) createMutation.mutate(name);
  }

  const sortIcon = (key: SortKey) =>
    sortKey === key ? (
      <MaterialCommunityIcons
        name={sortAsc ? "arrow-up" : "arrow-down"}
        size={12}
        color={colors.ink}
      />
    ) : null;

  const listHeader = (
    <View>
      {header}
      <View style={styles.intro}>
        <SettingsHeading
          title={t("settingsNav.taxonomy")}
          description={t("settingsNav.taxonomyDescription")}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kinds}>
          {KINDS.map((option) => {
            const active = option.value === kind;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => switchKind(option.value)}
                style={[styles.kind, active ? styles.kindActive : null]}
              >
                <Text style={[styles.kindText, active ? styles.kindTextActive : null]} numberOfLines={1}>
                  {t(option.label)}
                </Text>
                {active ? <Text style={styles.kindCount}>{allRows.length}</Text> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.cardTop}>
        <View style={styles.filters}>
          <View style={styles.search}>
            <MaterialCommunityIcons name="magnify" size={16} color={colors.muted} />
            <TextInput
              accessibilityLabel={t("taxonomy.filter")}
              value={filter}
              onChangeText={setFilter}
              placeholder={t("taxonomy.filter")}
              placeholderTextColor={colors.dim}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              style={styles.searchInput}
            />
          </View>
          <View style={styles.chips}>
            <Chip label={t("taxonomy.all")} active={quick === "all"} onPress={() => setQuick("all")} />
            <Chip
              label={t("taxonomy.unused")}
              active={quick === "unused"}
              // Derived from document counts; without them every entry would look unused.
              disabled={!countsKnown}
              onPress={() => setQuick("unused")}
            />
            <Chip
              label={t("taxonomy.duplicates")}
              active={quick === "duplicates"}
              onPress={() => setQuick("duplicates")}
            />
          </View>
          {canCreate(kind) ? (
            <View style={styles.quickAdd}>
              <TextInput
                accessibilityLabel={t("taxonomy.newEntry")}
                value={createValue}
                onChangeText={setCreateValue}
                onSubmitEditing={submitCreate}
                placeholder={t("taxonomy.newEntry")}
                placeholderTextColor={colors.dim}
                returnKeyType="done"
                style={styles.quickInput}
              />
              <Button
                variant="secondary"
                icon="plus"
                label={t("taxonomy.add")}
                disabled={!createValue.trim()}
                loading={createMutation.isPending}
                onPress={submitCreate}
              />
            </View>
          ) : null}
        </View>

        {createMutation.isError ? (
          <View style={styles.bandPad}>
            <InlineError message={errorText(createMutation.error, fallback)} />
          </View>
        ) : null}
        {!selecting && quick === "unused" && sweepIds.length > 0 ? (
          <View style={styles.sweep}>
            <Button
              size="sm"
              variant="secondary"
              icon="trash-can-outline"
              label={fill(t("taxonomy.deleteAllUnused"), { count: sweepIds.length })}
              disabled={busy}
              onPress={() => openSheet({ kind: "bulkDelete", ids: sweepIds })}
            />
          </View>
        ) : null}
        {!countsKnown && (kind === "categories" ? correspondentsQuery.isError : facetsQuery.isError) ? (
          <Text style={styles.countsWarning}>{t("taxonomy.countsUnavailable")}</Text>
        ) : null}

        {rows.length > 0 ? (
          <View style={styles.columns}>
            <Pressable
              accessibilityRole="button"
              onPress={() => toggleSort("name")}
              style={styles.columnName}
            >
              <Text style={[styles.columnText, sortKey === "name" ? styles.columnActive : null]}>
                {t("taxonomy.name")}
              </Text>
              {sortIcon("name")}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => toggleSort("count")}
              style={styles.columnCount}
            >
              {sortIcon("count")}
              <Text style={[styles.columnText, sortKey === "count" ? styles.columnActive : null]}>
                {kind === "categories" ? t("taxonomy.correspondentsCount") : t("taxonomy.docs")}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );

  const listEmpty = listQuery.isLoading ? (
    <View style={styles.emptyFrame}>
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} style={styles.rowSkeleton} />
      ))}
    </View>
  ) : listQuery.isError ? (
    <View style={styles.emptyFrame}>
      <InlineError message={t("taxonomy.loadError")} onRetry={() => void listQuery.refetch()} />
    </View>
  ) : (
    <View style={styles.emptyPlain}>
      <EmptyState
        icon={narrowing ? "magnify-close" : "tag-multiple-outline"}
        title={narrowing ? t("taxonomy.noMatches") : t("taxonomy.empty")}
        body={narrowing ? t("taxonomy.noMatchesHint") : canCreate(kind) ? t("taxonomy.emptyHint") : undefined}
      />
    </View>
  );

  const renderSheet = () => {
    if (!sheet) return null;
    switch (sheet.kind) {
      case "actions": {
        const { row } = sheet;
        const target = suggestions.get(row.id);
        return (
          <View style={styles.sheetActions}>
            <SheetAction
              icon="pencil-outline"
              label={t("taxonomy.renameEllipsis")}
              onPress={() => openRename(row)}
            />
            {canMerge(kind) ? (
              <SheetAction
                icon="source-merge"
                label={
                  target
                    ? fill(t("taxonomy.mergeInto"), { name: target.name })
                    : t("taxonomy.mergeEllipsis")
                }
                onPress={() =>
                  openMerge(
                    [row.id],
                    fill(t("taxonomy.mergeTitle"), { name: row.name }),
                    t("taxonomy.mergeDescription"),
                    target?.id ?? null,
                  )
                }
              />
            ) : null}
            <SheetAction
              icon="trash-can-outline"
              label={t("taxonomy.deleteEllipsis")}
              destructive
              disabled={row.builtin}
              onPress={() => openSheet({ kind: "delete", row })}
            />
            {row.builtin ? <Text style={styles.sheetNote}>{t("taxonomy.builtinUndeletable")}</Text> : null}
          </View>
        );
      }
      case "rename":
        return (
          <>
            <Text style={styles.sheetBody}>{t("taxonomy.renameDescription")}</Text>
            <FormField
              label={t("taxonomy.newName")}
              value={nameDraft}
              onChangeText={setNameDraft}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => {
                const name = nameDraft.trim();
                if (name) renameMutation.mutate({ id: sheet.row.id, name });
              }}
            />
            {renameMutation.isError ? (
              <InlineError message={errorText(renameMutation.error, fallback)} />
            ) : null}
          </>
        );
      case "merge":
        return (
          <>
            <Text style={styles.sheetBody}>{sheet.description}</Text>
            <FormField
              label={t("taxonomy.mergeTarget")}
              value={targetQuery}
              onChangeText={setTargetQuery}
              placeholder={t("taxonomy.filter")}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {targets.items.length === 0 ? (
              <Text style={styles.sheetBody}>{t("taxonomy.empty")}</Text>
            ) : (
              <View style={styles.targets}>
                {targets.items.map((row, index) => {
                  const active = row.id === targetId;
                  return (
                    <Pressable
                      key={row.id}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      onPress={() => setTargetId(row.id)}
                      style={[
                        styles.target,
                        index > 0 ? styles.targetRule : null,
                        active ? styles.targetActive : null,
                      ]}
                    >
                      <Text
                        style={[styles.targetName, active ? styles.targetNameActive : null]}
                        numberOfLines={1}
                      >
                        {row.name}
                      </Text>
                      <Text style={styles.count}>{row.count ?? "—"}</Text>
                      {active ? (
                        <MaterialCommunityIcons name="check" size={16} color={colors.accentSoftInk} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            )}
            {targets.truncated ? (
              <Text style={styles.sheetNote}>
                {fill(t("taxonomy.targetSearchHint"), { count: MERGE_TARGET_LIMIT })}
              </Text>
            ) : null}
            {mergeMutation.isError ? (
              <InlineError message={errorText(mergeMutation.error, fallback)} />
            ) : null}
          </>
        );
      case "delete":
      case "bulkDelete": {
        const ids = sheet.kind === "delete" ? [sheet.row.id] : sheet.ids;
        const message = describeDeletion(kind, affectedCount(allRows, ids), sheet.kind === "delete");
        return (
          <>
            <Text style={styles.sheetBody}>{fill(t(message.key), { count: message.count })}</Text>
            {deleteMutation.isError ? (
              <InlineError message={errorText(deleteMutation.error, fallback)} />
            ) : null}
          </>
        );
      }
    }
  };

  const sheetTitle = (() => {
    if (!sheet) return undefined;
    switch (sheet.kind) {
      case "actions":
        return sheet.row.name;
      case "rename":
        return fill(t("taxonomy.renameTitle"), { name: sheet.row.name });
      case "merge":
        return sheet.title;
      case "delete":
        return fill(t("taxonomy.deleteTitle"), { name: sheet.row.name });
      case "bulkDelete":
        return sheet.ids.length === 1
          ? t("taxonomy.bulkDeleteTitleOne")
          : fill(t("taxonomy.bulkDeleteTitle"), { count: sheet.ids.length });
    }
  })();

  const sheetFooter = (() => {
    if (!sheet || sheet.kind === "actions") return undefined;
    const cancel = (
      <View style={styles.sheetButton}>
        <Button variant="secondary" label={t("settings.cancel")} onPress={() => setSheet(null)} />
      </View>
    );
    if (sheet.kind === "rename") {
      return (
        <>
          {cancel}
          <View style={styles.sheetButton}>
            <Button
              label={t("taxonomy.rename")}
              disabled={!nameDraft.trim() || busy}
              loading={renameMutation.isPending}
              onPress={() => renameMutation.mutate({ id: sheet.row.id, name: nameDraft.trim() })}
            />
          </View>
        </>
      );
    }
    if (sheet.kind === "merge") {
      return (
        <>
          {cancel}
          <View style={styles.sheetButton}>
            <Button
              icon="source-merge"
              label={t("taxonomy.mergeAction")}
              disabled={!targetId || busy}
              loading={mergeMutation.isPending}
              onPress={() => {
                if (targetId) mergeMutation.mutate({ ids: sheet.ids, target: targetId });
              }}
            />
          </View>
        </>
      );
    }
    const ids = sheet.kind === "delete" ? [sheet.row.id] : sheet.ids;
    return (
      <>
        {cancel}
        <View style={styles.sheetButton}>
          <Button
            variant="danger"
            icon="trash-can-outline"
            label={t("taxonomy.del")}
            disabled={busy}
            loading={deleteMutation.isPending}
            onPress={() => deleteMutation.mutate(ids)}
          />
        </View>
      </>
    );
  })();

  return (
    <>
      <FlatList
        data={listQuery.isError ? [] : rows}
        keyExtractor={(row) => row.id}
        extraData={selectedIds}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        initialNumToRender={18}
        windowSize={9}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        ListFooterComponent={<View style={styles.cardBottom} />}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <Row
            row={item}
            selected={selectedIds.includes(item.id)}
            selecting={selecting}
            maxCount={maxCount}
            suggested={suggestions.has(item.id)}
            showCategory={kind === "correspondents"}
            onToggle={onToggle}
            onOpen={onOpen}
          />
        )}
      />

      {selecting ? (
        <View style={[styles.bulkBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <View style={styles.bulkHead}>
            <Text style={styles.bulkCount}>
              <Text style={styles.bulkNumber}>{selectedIds.length}</Text> {t("taxonomy.selected")}
            </Text>
            <Button
              size="sm"
              variant="ghost"
              icon="close"
              label={t("taxonomy.clear")}
              onPress={() => setSelectedIds([])}
            />
          </View>
          <View style={styles.bulkActions}>
            {canMerge(kind) && allRows.length > selectedIds.length ? (
              <Button
                size="sm"
                variant="secondary"
                icon="source-merge"
                label={t("taxonomy.bulkMerge")}
                disabled={busy}
                onPress={() =>
                  openMerge(
                    selectedIds,
                    fill(t("taxonomy.bulkMergeTitle"), { count: selectedIds.length }),
                    t("taxonomy.bulkMergeDescription"),
                    null,
                  )
                }
              />
            ) : null}
            {selectedIds.length === 1 ? (
              <Button
                size="sm"
                variant="secondary"
                icon="pencil-outline"
                label={t("taxonomy.rename")}
                disabled={busy}
                onPress={() => {
                  const row = allRows.find((entry) => entry.id === selectedIds[0]);
                  if (row) openRename(row);
                }}
              />
            ) : null}
            <Button
              size="sm"
              variant="danger"
              icon="trash-can-outline"
              label={t("taxonomy.del")}
              disabled={busy || hasBuiltinSelected}
              onPress={() => openSheet({ kind: "bulkDelete", ids: selectedIds })}
            />
          </View>
          {hasBuiltinSelected ? (
            <Text style={styles.bulkNote}>{t("taxonomy.builtinUndeletable")}</Text>
          ) : null}
        </View>
      ) : null}

      <BottomSheet
        visible={sheet !== null}
        onClose={() => setSheet(null)}
        title={sheetTitle}
        footer={sheetFooter}
      >
        {renderSheet()}
      </BottomSheet>
    </>
  );
}

function SheetAction({
  icon,
  label,
  onPress,
  destructive = false,
  disabled = false,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  const tint = disabled ? colors.dim : destructive ? colors.red : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.sheetAction, pressed ? styles.sheetActionPressed : null]}
    >
      <MaterialCommunityIcons name={icon as never} size={18} color={tint} />
      <Text style={[styles.sheetActionText, { color: tint }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const useStyles = createThemedStyles((c) => ({
  listContent: {
    paddingBottom: 24,
  },
  intro: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  kinds: {
    flexDirection: "row",
    gap: 2,
    padding: 3,
    borderRadius: radii.lg,
    backgroundColor: c.bar,
  },
  kind: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 38,
    paddingHorizontal: 10,
    borderRadius: radii.sm,
  },
  kindActive: {
    backgroundColor: c.app,
    shadowColor: c.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  kindText: {
    ...text.body,
    color: c.muted,
  },
  kindTextActive: {
    ...text.bodyStrong,
    color: c.ink,
  },
  kindCount: {
    ...text.numeric,
    color: c.muted,
  },
  cardTop: {
    marginTop: 12,
    marginHorizontal: 16,
    backgroundColor: c.panel,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: c.border,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    overflow: "hidden",
  },
  cardBottom: {
    height: 12,
    marginHorizontal: 16,
    backgroundColor: c.panel,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: c.border,
    borderBottomLeftRadius: radii.xl,
    borderBottomRightRadius: radii.xl,
  },
  filters: {
    gap: 10,
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.borderStrong,
    backgroundColor: c.panel,
  },
  searchInput: {
    ...text.body,
    flex: 1,
    minWidth: 0,
    padding: 0,
    color: c.ink,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  quickAdd: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  quickInput: {
    ...text.body,
    flex: 1,
    minWidth: 0,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.borderStrong,
    backgroundColor: c.panel,
    color: c.ink,
  },
  bandPad: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  sweep: {
    flexDirection: "row",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.amberSoft,
  },
  countsWarning: {
    ...text.small,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.amberSoft,
    color: c.amber,
  },
  columns: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 44,
    paddingRight: 44,
    minHeight: 44,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  columnName: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 44,
  },
  columnCount: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 44,
  },
  columnText: {
    ...text.metaStrong,
    color: c.muted,
  },
  columnActive: {
    color: c.ink,
  },
  rowFrame: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 52,
    marginHorizontal: 16,
    backgroundColor: c.panel,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftColor: c.border,
    borderRightColor: c.border,
    borderBottomColor: c.border,
  },
  rowSelected: {
    backgroundColor: c.accentSoft,
  },
  checkHit: {
    width: 44,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
  },
  check: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: c.borderStrong,
    backgroundColor: c.panel,
  },
  checkOn: {
    borderColor: c.accentFill,
    backgroundColor: c.accentFill,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rowName: {
    ...text.rowTitle,
    flexShrink: 1,
    color: c.ink,
  },
  rowMetaLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rowMeta: {
    ...text.meta,
    flexShrink: 1,
    color: c.muted,
  },
  usage: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  bar: {
    width: 36,
    height: 4,
    overflow: "hidden",
    borderRadius: radii.pill,
    backgroundColor: c.bar,
  },
  barFill: {
    height: "100%",
    borderRadius: radii.pill,
    backgroundColor: c.accent,
  },
  count: {
    ...text.numeric,
    minWidth: 24,
    textAlign: "right",
    color: c.muted,
    ...tabular,
  },
  menuHit: {
    width: 44,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyFrame: {
    gap: 10,
    padding: 14,
    marginHorizontal: 16,
    backgroundColor: c.panel,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: c.border,
  },
  emptyPlain: {
    marginHorizontal: 16,
    backgroundColor: c.panel,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: c.border,
  },
  rowSkeleton: {
    height: 40,
    borderRadius: radii.lg,
  },
  bulkBar: {
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.accentSoft,
  },
  bulkHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  bulkCount: {
    ...text.body,
    color: c.accentSoftInk,
  },
  bulkNumber: {
    ...text.numericStrong,
    fontSize: 14,
    color: c.accentSoftInk,
  },
  bulkActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  bulkNote: {
    ...text.small,
    color: c.muted,
  },
  sheetActions: {
    marginHorizontal: -4,
  },
  sheetAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 8,
    borderRadius: radii.md,
  },
  sheetActionPressed: {
    backgroundColor: c.bar,
  },
  sheetActionText: {
    ...text.bodyStrong,
    flex: 1,
  },
  sheetNote: {
    ...text.small,
    paddingHorizontal: 4,
    color: c.muted,
  },
  sheetBody: {
    ...text.body,
    color: c.muted,
  },
  sheetButton: {
    flex: 1,
  },
  targets: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.lg,
    overflow: "hidden",
  },
  target: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  targetRule: {
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  targetActive: {
    backgroundColor: c.accentSoft,
  },
  targetName: {
    ...text.body,
    flex: 1,
    color: c.ink,
  },
  targetNameActive: {
    ...text.bodyStrong,
    color: c.accentSoftInk,
  },
}));
