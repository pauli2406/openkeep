import { useNavigation } from "@react-navigation/native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Swipeable } from "react-native-gesture-handler";
import { useAuth } from "../auth";
import { AvatarButton } from "../components/AvatarButton";
import {
  EmptyState,
  ErrorCard,
  Metric,
  Notice,
  Panel,
  Row,
  Screen,
  SectionHeader,
  type RowDot,
} from "../components/ui";
import { documentRowState } from "../document-processing";
import { useDashboardInsights } from "../hooks/useDashboardInsights";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import type { AppStackParamList } from "../../App";
import { createThemedStyles, useColors } from "../theme";
import { text } from "../typography";
import {
  formatCurrency,
  formatShortDate,
  responseToMessage,
  titleForDocument,
  type ArchiveDocument,
  type DashboardInsights,
} from "../lib";

type DeadlineItem = DashboardInsights["upcomingDeadlines"][number];
type Translate = ReturnType<typeof useI18n>["t"];

/** Anything further out than this belongs on Documents, not on Today. */
const THIS_WEEK_DAYS = 7;
const RECENT_LIMIT = 5;

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** `4 T über` / `28.03.` — short enough to sit at the end of a row. */
function dueLabel(item: DeadlineItem, t: Translate) {
  if (item.isOverdue) {
    return `${Math.abs(item.daysUntilDue)}${t("dashboard.tasks.overdueDays")}`;
  }
  if (item.daysUntilDue === 0) {
    return t("today.dueToday");
  }
  if (item.daysUntilDue === 1) {
    return t("today.dueTomorrow");
  }
  return formatShortDate(item.dueDate);
}

/** `06:15` today, `gestern` yesterday, `24.02.` before that. */
function arrivedLabel(iso: string | null | undefined, t: Translate) {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  if (date.getTime() >= startOfToday.getTime()) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (date.getTime() >= startOfYesterday.getTime()) {
    return t("today.yesterday");
  }

  return formatShortDate(iso);
}

function documentMeta(document: ArchiveDocument, t: Translate) {
  const state = documentRowState(document);
  if (state === "failed") {
    return t("state.failed");
  }
  if (state === "processing" || state === "queued") {
    // No metadata has been extracted yet, so there is nothing to show here. The
    // design shows a stage next to this ("wird verarbeitet · OCR") but
    // `ProcessingJobSummary` carries no stage field, so the label stands alone.
    return state === "queued" ? t("state.queued") : t("state.processing");
  }

  const correspondent = document.correspondent?.name ?? t("documents.unfiled");
  const type = document.documentType?.name;
  return type ? `${correspondent} · ${type}` : correspondent;
}

function documentDot(document: ArchiveDocument): RowDot {
  switch (documentRowState(document)) {
    case "failed":
      return "red";
    case "processing":
    case "queued":
      return "faint";
    default:
      return document.reviewStatus === "pending" ? "amber" : "green";
  }
}

// ---------------------------------------------------------------------------
// Number strip
// ---------------------------------------------------------------------------

/**
 * Four numbers, one divided row. Every value comes from the insights payload —
 * `Neu` is the current month's entry in `monthlyActivity`, since there is no
 * "new documents" stat.
 */
function NumberStrip({
  data,
  dueCount,
  onReview,
  onDocuments,
}: {
  data: DashboardInsights;
  /** What the groups below actually show — the payload caps its lists at six. */
  dueCount: number;
  onReview: () => void;
  onDocuments: () => void;
}) {
  const styles = useStyles();
  const { t } = useI18n();

  // `monthlyActivity` is grouped from real document months and is not
  // zero-filled, so the last point can be an earlier month. A month with no
  // arrivals means zero, not "the last month that had some".
  const currentMonth = new Date().toISOString().slice(0, 7);
  const latest = (data.monthlyActivity ?? []).at(-1);
  const newThisMonth = latest?.month === currentMonth ? latest.count : 0;

  return (
    <View style={styles.numberStrip}>
      <Metric
        label={t("today.stat.review")}
        value={data.stats.pendingReview}
        tone={data.stats.pendingReview > 0 ? "amber" : "ink"}
        onPress={onReview}
      />
      <Metric label={t("today.stat.due")} value={dueCount} onPress={onDocuments} />
      <Metric label={t("today.stat.new")} value={newThisMonth} onPress={onDocuments} />
      <Metric
        label={t("today.stat.total")}
        value={data.stats.totalDocuments.toLocaleString()}
        onPress={onDocuments}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// What needs you
// ---------------------------------------------------------------------------

/** Tap opens the document; a swipe left completes the task. */
function TaskRow({
  item,
  onOpen,
  onComplete,
  busy,
}: {
  item: DeadlineItem;
  onOpen: () => void;
  onComplete?: () => void;
  busy: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();

  const row = (
    <Row
      dot={item.isOverdue ? "red" : "amber"}
      accessibilityActions={
        onComplete ? [{ name: "done", label: t("dashboard.tasks.done") }] : undefined
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "done") {
          onComplete?.();
        }
      }}
      title={item.title}
      meta={
        item.documentTypeName
          ? `${item.correspondentName ?? t("dashboard.tasks.unfiled")} · ${item.documentTypeName}`
          : (item.correspondentName ?? t("dashboard.tasks.unfiled"))
      }
      value={formatCurrency(item.amount, item.currency ?? "EUR")}
      valueMeta={dueLabel(item, t)}
      minHeight={66}
      onPress={onOpen}
    />
  );

  if (!onComplete) {
    return row;
  }

  return (
    <Swipeable
      enabled={!busy}
      overshootRight={false}
      renderRightActions={() => (
        <Pressable onPress={onComplete} disabled={busy} style={styles.swipeAction}>
          <MaterialCommunityIcons name="check" size={18} color={colors.accentFillInk} />
          <Text style={styles.swipeActionText}>{t("dashboard.tasks.done")}</Text>
        </Pressable>
      )}
    >
      {row}
    </Swipeable>
  );
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

export function DashboardScreen() {
  const styles = useStyles();
  const colors = useColors();
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const queryClient = useQueryClient();
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const shouldUseCache = offline.shouldUseCache || auth.isOfflineSession;

  const insightsQuery = useDashboardInsights();

  const completeMutation = useMutation({
    mutationFn: async (documentId: string) => {
      setBusyTaskId(documentId);
      const response = await auth.authFetch(`/api/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskCompletedAt: new Date().toISOString() }),
      });
      if (!response.ok) {
        throw new Error(await responseToMessage(response));
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["documents"] }),
      ]);
    },
    onSettled: () => setBusyTaskId(null),
  });

  const data = insightsQuery.data;

  const overdue: DeadlineItem[] = (data?.overdueItems ?? []).map((item) => ({
    ...item,
    isOverdue: true as const,
  }));
  const overdueKeys = new Set(overdue.map((item) => `${item.documentId}:${item.dueDate}`));
  const thisWeek = (data?.upcomingDeadlines ?? []).filter(
    (item) =>
      !overdueKeys.has(`${item.documentId}:${item.dueDate}`) &&
      item.daysUntilDue <= THIS_WEEK_DAYS,
  );

  const openDocument = (documentId: string, title: string) =>
    navigation.navigate("DocumentDetail", { documentId, title });

  const completeTask = shouldUseCache ? undefined : (id: string) => completeMutation.mutate(id);

  const groups: Array<{ label: string; items: DeadlineItem[] }> = [
    { label: t("today.overdue"), items: overdue },
    { label: t("today.thisWeek"), items: thisWeek },
  ].filter((group) => group.items.length > 0);

  return (
    <Screen
      title={t("today.brand")}
      leading={<Image source={require("../../assets/icon.png")} style={styles.logoMark} />}
      right={
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("today.correspondents")}
            onPress={() => navigation.navigate("Correspondents")}
            hitSlop={12}
          >
            <MaterialCommunityIcons
              name="account-multiple-outline"
              size={18}
              color={colors.muted}
            />
          </Pressable>
          <AvatarButton />
        </>
      }
      notice={shouldUseCache ? <Notice label={t("state.offline")} /> : undefined}
      padded={false}
    >
      {insightsQuery.isLoading ? (
        <View style={styles.gutter}>
          <Panel padded>
            <Text style={styles.loadingText}>{t("dashboard.screen.loading")}</Text>
          </Panel>
        </View>
      ) : null}

      {insightsQuery.isError ? (
        <View style={styles.gutter}>
          <ErrorCard
            message={t("dashboard.screen.loadError")}
            onRetry={() => insightsQuery.refetch()}
          />
        </View>
      ) : null}

      {data ? (
        <>
          <NumberStrip
            data={data}
            dueCount={overdue.length + thisWeek.length}
            onReview={() => navigation.navigate("Home", { screen: "Review" } as never)}
            onDocuments={() => navigation.navigate("Home", { screen: "Documents" } as never)}
          />

          {groups.length === 0 ? (
            <EmptyState title={t("today.nothingDue")} />
          ) : (
            groups.map((group) => (
              <View key={group.label}>
                <SectionHeader label={group.label} count={group.items.length} />
                {group.items.map((item) => (
                  <TaskRow
                    key={`${item.documentId}:${item.dueDate}`}
                    item={item}
                    busy={busyTaskId === item.documentId}
                    onOpen={() => openDocument(item.documentId, item.title)}
                    onComplete={completeTask ? () => completeTask(item.documentId) : undefined}
                  />
                ))}
              </View>
            ))
          )}

          {completeMutation.isError ? (
            <View style={styles.gutter}>
              <ErrorCard
                message={
                  completeMutation.error instanceof Error
                    ? completeMutation.error.message
                    : t("dashboard.screen.completeFailed")
                }
              />
            </View>
          ) : null}

          <SectionHeader
            label={t("today.recentlyAdded")}
            right={
              <Pressable
                onPress={() => navigation.navigate("Home", { screen: "Documents" } as never)}
                hitSlop={12}
              >
                <Text style={styles.headerLink}>{t("today.allDocuments")}</Text>
              </Pressable>
            }
          />
          {data.recentDocuments.length === 0 ? (
            <EmptyState
              title={t("dashboard.screen.noDocumentsTitle")}
              body={t("dashboard.screen.noDocumentsBody")}
            />
          ) : (
            data.recentDocuments.slice(0, RECENT_LIMIT).map((document) => {
              const state = documentRowState(document);
              return (
                <Row
                  key={document.id}
                  dot={documentDot(document)}
                  pulse={state === "processing" || state === "queued"}
                  tone={state === "failed" ? "bad" : "default"}
                  title={titleForDocument(document)}
                  meta={documentMeta(document, t)}
                  valueMeta={arrivedLabel(document.createdAt, t)}
                  onPress={() => openDocument(document.id, titleForDocument(document))}
                />
              );
            })
          )}
        </>
      ) : null}
    </Screen>
  );
}

const useStyles = createThemedStyles((c) => ({
  gutter: {
    padding: 16,
  },
  logoMark: {
    width: 19,
    height: 19,
    borderRadius: 4,
  },
  loadingText: {
    ...text.meta,
    color: c.muted,
  },
  numberStrip: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  headerLink: {
    ...text.smallStrong,
    color: c.accent,
  },
  swipeAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    width: 96,
    backgroundColor: c.accentFill,
  },
  swipeActionText: {
    ...text.smallStrong,
    color: c.accentFillInk,
  },
}));
