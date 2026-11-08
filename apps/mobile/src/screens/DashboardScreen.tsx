import { useNavigation } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Swipeable } from "react-native-gesture-handler";
import { useAuth } from "../auth";
import { GradientPanel, Skeleton } from "../components/layout";
import { EmptyState, ErrorCard, Notice, Panel, Pill, Screen } from "../components/ui";
import { useI18n, type TranslationKey } from "../i18n";
import { processingRefetchInterval } from "../document-processing";
import { useOfflineArchive } from "../offline-archive";
import type { AppStackParamList } from "../../App";
import { createThemedStyles, radii, useColors } from "../theme";
import { fonts, tabular, text } from "../typography";
import {
  formatCurrency,
  responseToMessage,
  titleForDocument,
  type ArchiveDocument,
  type SearchDocumentsResponse,
} from "../lib";

type Translate = ReturnType<typeof useI18n>["t"];
type TaskFilter = "open" | "overdue" | "month" | "invoices";

/** A queue row derived from a document with a due date. */
type Task = {
  document: ArchiveDocument;
  daysUntilDue: number;
  isOverdue: boolean;
  due: Date | null;
  taskLabel: string;
};

/** Parse `YYYY-MM-DD` in local time; `new Date(str)` treats it as UTC. */
function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Mirrors the API's buildTaskLabel, as the web client does. */
function taskLabelKey(typeName: string | null | undefined, isOverdue: boolean): TranslationKey {
  const normalized = typeName?.trim().toLowerCase() ?? "";
  if (normalized.includes("invoice") || normalized.includes("bill")) {
    return isOverdue ? "today.action.payNow" : "today.action.pay";
  }
  if (normalized.includes("contract") || normalized.includes("legal")) {
    return isOverdue ? "today.action.respondNow" : "today.action.respond";
  }
  if (normalized.includes("insurance")) {
    return isOverdue ? "today.action.reviewNow" : "today.action.review";
  }
  return isOverdue ? "today.action.handleNow" : "today.action.handle";
}

function toTask(document: ArchiveDocument, t: Translate): Task {
  const due = parseDateOnly(document.dueDate ?? "");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntilDue = due ? Math.round((due.getTime() - today.getTime()) / 86_400_000) : 0;
  const isOverdue = daysUntilDue < 0;
  return {
    document,
    due,
    daysUntilDue,
    isOverdue,
    taskLabel: t(taskLabelKey(document.documentType?.name, isOverdue)),
  };
}

function greetingKey(hour: number): TranslationKey {
  if (hour < 11) return "today.greeting.morning";
  if (hour < 18) return "today.greeting.afternoon";
  return "today.greeting.evening";
}

/** The summary tile in the hero. It is also the queue's filter. */
function FilterTile({
  label,
  count,
  icon,
  active,
  onPress,
}: {
  label: string;
  count: number;
  icon: string;
  active: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ink = active ? colors.tileActiveInk : colors.onGradient;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.tile, active ? styles.tileActive : null]}
    >
      <View style={styles.tileHead}>
        <Text style={[styles.tileLabel, { color: ink }]} numberOfLines={1}>
          {label}
        </Text>
        <MaterialCommunityIcons name={icon as never} size={15} color={ink} />
      </View>
      <Text style={[styles.tileCount, { color: ink }]}>{count}</Text>
    </Pressable>
  );
}

/** Tap opens the document; a swipe left completes the task. */
function TaskRow({
  task,
  onOpen,
  onComplete,
  busy,
  last,
}: {
  task: Task;
  onOpen: () => void;
  onComplete?: () => void;
  busy: boolean;
  last: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const { document } = task;

  const row = (
    <Pressable
      accessibilityRole="button"
      accessibilityActions={
        onComplete ? [{ name: "done", label: t("dashboard.tasks.done") }] : undefined
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "done") onComplete?.();
      }}
      onPress={onOpen}
      style={({ pressed }) => [
        styles.row,
        last ? null : styles.rowRule,
        pressed ? styles.rowPressed : null,
      ]}
    >
      <View style={styles.dueCell}>
        <Pill
          tone={task.isOverdue ? "bad" : "outline"}
          label={task.isOverdue ? `-${Math.abs(task.daysUntilDue)}d` : `${task.daysUntilDue}d`}
        />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {titleForDocument(document)}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          <Text style={task.isOverdue ? styles.rowOverdue : null}>{task.taskLabel}</Text>
          {" · "}
          {document.correspondent?.name ?? t("documents.unfiled")}
          {document.documentType?.name ? ` · ${document.documentType.name}` : ""}
        </Text>
      </View>
      <Text style={styles.rowAmount} numberOfLines={1}>
        {document.amount != null ? formatCurrency(document.amount, document.currency ?? "EUR") : "—"}
      </Text>
    </Pressable>
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

export function DashboardScreen() {
  const styles = useStyles();
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const queryClient = useQueryClient();
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>("open");
  const shouldUseCache = offline.shouldUseCache || auth.isOfflineSession;

  // The insights endpoint caps deadlines at 6 overdue + 6 upcoming, which is not
  // a queue. Take them from the documents endpoint sorted by due date, as the
  // web client does.
  const queueQuery = useQuery({
    queryKey: ["documents", "deadlines", auth.apiUrl, shouldUseCache],
    queryFn: async () => {
      if (shouldUseCache) {
        // The local copy has no open-task filter, so take all of it and let the
        // filter below do that; a page could otherwise be all completed tasks.
        return offline.queryCachedDocuments({
          query: "",
          reviewOnly: false,
          pageSize: 100_000,
          sort: "dueDate" as const,
          direction: "asc" as const,
        });
      }
      const response = await auth.authFetch(
        // Filtered on the server: otherwise a page of completed deadlines would
        // push every open one past the limit.
        "/api/documents?openTasksOnly=true&sort=dueDate&direction=asc&page=1&pageSize=100",
      );
      if (!response.ok) {
        throw new Error(await responseToMessage(response));
      }
      return (await response.json()) as SearchDocumentsResponse;
    },
    refetchInterval: shouldUseCache
      ? false
      : (query) => processingRefetchInterval(query.state.data, (data) => data?.items),
  });

  const completeMutation = useMutation({
    mutationFn: async (document: ArchiveDocument) => {
      setBusyTaskId(document.id);
      const response = await auth.authFetch(`/api/documents/${document.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskCompletedAt: new Date().toISOString() }),
      });
      if (!response.ok) {
        throw new Error(await responseToMessage(response));
      }
      // Resolve the review too, when there is one to resolve.
      if (document.reviewStatus === "pending") {
        await auth.authFetch(`/api/documents/${document.id}/review/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["documents"] }),
        // Completing a task also resolves its review, and the Review tab stays
        // mounted, so its queue has to hear about it.
        queryClient.invalidateQueries({ queryKey: ["review"] }),
      ]);
    },
    onSettled: () => setBusyTaskId(null),
  });

  const allTasks = useMemo(
    () =>
      (queueQuery.data?.items ?? [])
        .filter((document) => document.dueDate && !document.taskCompletedAt)
        .map((document) => toTask(document, t))
        .sort((a, b) => a.daysUntilDue - b.daysUntilDue),
    [queueQuery.data, t],
  );

  const groups = useMemo(() => {
    // Calendar month, matching the API's current-month semantics.
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      open: allTasks,
      overdue: allTasks.filter((task) => task.isOverdue),
      month: allTasks.filter((task) => task.due !== null && task.due >= start && task.due <= end),
      invoices: allTasks.filter((task) => {
        const name = (task.document.documentType?.name ?? "").toLowerCase();
        return name.includes("invoice") || name.includes("bill") || name.includes("rechnung");
      }),
    } satisfies Record<TaskFilter, Task[]>;
  }, [allTasks]);

  const tasks = groups[filter];
  const overdueCount = groups.overdue.length;
  const firstName = auth.user?.displayName?.split(/\s+/)[0];
  const greeting = t(greetingKey(new Date().getHours()));
  const summary =
    allTasks.length === 0
      ? t("today.summary.allClear")
      : (overdueCount > 0 ? t("today.summary.open") : t("today.summary.openOnly"))
          .replace("{open}", String(allTasks.length))
          .replace("{overdue}", String(overdueCount));

  const complete = shouldUseCache
    ? undefined
    : (document: ArchiveDocument) => completeMutation.mutate(document);

  return (
    <Screen
      title={t("tabs.today")}
      hideHeader
      notice={shouldUseCache ? <Notice label={t("state.offline")} /> : undefined}
    >
      <GradientPanel>
        <Text accessibilityRole="header" style={styles.greeting}>
          {firstName ? `${greeting}, ${firstName}` : greeting}
        </Text>
        <Text style={styles.summary}>{summary}</Text>
        <View style={styles.tiles}>
          <View style={styles.tilesRow}>
            <FilterTile
              label={t("today.openTasks")}
              count={groups.open.length}
              icon="format-list-checks"
              active={filter === "open"}
              onPress={() => setFilter("open")}
            />
            <FilterTile
              label={t("today.overdue")}
              count={groups.overdue.length}
              icon="alert-outline"
              active={filter === "overdue"}
              onPress={() => setFilter("overdue")}
            />
          </View>
          <View style={styles.tilesRow}>
            <FilterTile
              label={t("today.thisMonth")}
              count={groups.month.length}
              icon="calendar-month-outline"
              active={filter === "month"}
              onPress={() => setFilter("month")}
            />
            <FilterTile
              label={t("today.invoices")}
              count={groups.invoices.length}
              icon="receipt-text-outline"
              active={filter === "invoices"}
              onPress={() => setFilter("invoices")}
            />
          </View>
        </View>
      </GradientPanel>

      {queueQuery.isError ? (
        <ErrorCard
          message={t("dashboard.screen.loadError")}
          onRetry={() => queueQuery.refetch()}
        />
      ) : (
        <Panel style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>{t("today.task")}</Text>
            <Text style={styles.cardMeta} numberOfLines={1}>
              {t("today.sorted").replace("{count}", String(tasks.length))}
            </Text>
          </View>
          {queueQuery.isLoading ? (
            <View style={styles.loading}>
              {[0, 1, 2, 3].map((row) => (
                <Skeleton key={row} style={styles.loadingRow} />
              ))}
            </View>
          ) : tasks.length === 0 ? (
            <EmptyState icon="check-circle-outline" title={t("today.nothingDue")} />
          ) : (
            tasks.map((task, index) => (
              <TaskRow
                key={task.document.id}
                task={task}
                last={index === tasks.length - 1}
                busy={busyTaskId === task.document.id}
                onOpen={() =>
                  navigation.navigate("DocumentDetail", {
                    documentId: task.document.id,
                    title: titleForDocument(task.document),
                  })
                }
                onComplete={complete ? () => complete(task.document) : undefined}
              />
            ))
          )}
        </Panel>
      )}

      {completeMutation.isError ? (
        <ErrorCard
          message={
            completeMutation.error instanceof Error
              ? completeMutation.error.message
              : t("dashboard.screen.completeFailed")
          }
        />
      ) : null}
    </Screen>
  );
}

const useStyles = createThemedStyles((c) => ({
  greeting: {
    ...text.screenTitle,
    color: c.onGradient,
  },
  summary: {
    ...text.body,
    marginTop: 4,
    color: c.onGradientMuted,
  },
  tiles: {
    marginTop: 16,
    gap: 10,
  },
  tilesRow: {
    flexDirection: "row",
    gap: 10,
  },
  tile: {
    flex: 1,
    minWidth: 0,
    gap: 12,
    padding: 14,
    borderRadius: radii.lg,
    backgroundColor: c.tile,
  },
  tileActive: {
    backgroundColor: c.tileActive,
  },
  tileHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  tileLabel: {
    ...text.bodyStrong,
    flex: 1,
  },
  tileCount: {
    ...text.statValue,
  },
  card: {
    overflow: "hidden",
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  cardTitle: {
    ...text.bodyStrong,
    color: c.ink,
  },
  cardMeta: {
    ...text.small,
    flexShrink: 1,
    color: c.muted,
  },
  loading: {
    gap: 14,
    padding: 16,
  },
  loadingRow: {
    height: 36,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 60,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: c.panel,
  },
  rowRule: {
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  rowPressed: {
    backgroundColor: c.bar,
  },
  dueCell: {
    width: 50,
    alignItems: "center",
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    ...text.rowTitle,
    color: c.ink,
  },
  rowMeta: {
    ...text.meta,
    color: c.muted,
  },
  rowOverdue: {
    fontFamily: fonts.sans.medium,
    color: c.red,
  },
  rowAmount: {
    ...text.amount,
    ...tabular,
    color: c.ink,
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
