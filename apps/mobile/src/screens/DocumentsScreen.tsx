import { useNavigation } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAuth } from "../auth";
import {
  Button,
  EmptyState,
  ErrorCard,
  Notice,
  Panel,
  Pill,
  Row,
  Screen,
  type PillTone,
  type RowDot,
} from "../components/ui";
import { documentRowState, processingRefetchInterval } from "../document-processing";
import { useDashboardInsights } from "../hooks/useDashboardInsights";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import type { AppStackParamList } from "../../App";
import { createThemedStyles, radii, useColors } from "../theme";
import { text } from "../typography";
import {
  formatCurrency,
  formatShortDate,
  responseToMessage,
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
  if (!document.dueDate) {
    return false;
  }
  const due = new Date(document.dueDate);
  if (Number.isNaN(due.getTime())) {
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

  const currentYear = new Date().getFullYear();
  const insights = useDashboardInsights();
  const reviewCount = insights.data?.stats.pendingReview ?? 0;

  const params = useMemo(() => {
    const search = new URLSearchParams();
    search.set("page", "1");
    search.set("pageSize", String(PAGE_SIZE));
    if (query.trim()) {
      search.set("query", query.trim());
    }
    if (filter === "year") {
      search.set("year", String(currentYear));
    }
    if (filter === "due") {
      search.set("sort", "dueDate");
      search.set("direction", "asc");
    } else {
      search.set("sort", "createdAt");
      search.set("direction", oldestFirst ? "asc" : "desc");
    }
    return search.toString();
  }, [query, filter, oldestFirst, currentYear]);

  const documentsQuery = useQuery({
    queryKey: [
      "documents",
      auth.apiUrl,
      filter,
      params,
      shouldUseCache,
      offline.cacheSummary.updatedAt,
    ],
    queryFn: async () => {
      if (shouldUseCache) {
        return offline.queryCachedDocuments({
          query,
          reviewOnly: filter === "review",
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

  const isFiltered = filter !== "all" || query.trim().length > 0;
  const failedDocument = documentsQuery.data?.items.find(
    (document) => documentRowState(document) === "failed",
  );

  return (
    <Screen
      title={t("documents.title")}
      padded={false}
      notice={shouldUseCache ? <Notice label={t("state.offline")} /> : undefined}
      right={
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
        </ScrollView>
      </View>

      {documentsQuery.data ? (
        <View style={styles.countStrip}>
          <Text style={styles.countText}>
            {`${documentsQuery.data.total.toLocaleString()} ${t("documents.count")}`}
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
        documentsQuery.data.items.length === 0 ? (
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
          documentsQuery.data.items.map((document) => {
            const state = documentRowState(document);
            const pill = documentPill(document, t);
            return (
              <Row
                key={document.id}
                minHeight={62}
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
                  navigation.navigate("DocumentDetail", {
                    documentId: document.id,
                    title: titleForDocument(document),
                  })
                }
              />
            );
          })
        )
      ) : null}

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
}));
