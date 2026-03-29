import { useNavigation } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAuth } from "../auth";
import { DocumentProcessingIndicator } from "../components/DocumentProcessingIndicator";
import { Card, EmptyState, ErrorCard, Metric, Pill, Screen, SectionTitle } from "../components/ui";
import { processingRefetchInterval } from "../document-processing";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import type { AppStackParamList } from "../../App";
import { colors, shadow } from "../theme";
import {
  formatCurrency,
  formatDate,
  formatMonthLabel,
  formatMonthYear,
  formatTaskDateLabel,
  responseToMessage,
  titleForDocument,
  toneForStatus,
  type ArchiveDocument,
  type DashboardInsights,
} from "../lib";

// ---------------------------------------------------------------------------
// Intake Trend — horizontal mini bar chart
// ---------------------------------------------------------------------------

function IntakeTrend({ data }: { data: Array<{ month: string; count: number }> }) {
  const { t } = useI18n();

  if (data.length === 0) {
    return null;
  }

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const BAR_MAX_HEIGHT = 48;

  let previousYear = "";

  return (
    <View style={trendStyles.wrap}>
      <View style={trendStyles.header}>
        <Text style={trendStyles.eyebrow}>{t("dashboard.intakeTrendEyebrow")}</Text>
        <Text style={trendStyles.title}>{t("dashboard.intakeTrendTitle")}</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={trendStyles.chartScroll}
      >
        {data.map((point) => {
          const year = formatMonthYear(point.month);
          const showYear = year !== previousYear;
          previousYear = year;
          const barHeight = Math.max(4, (point.count / maxCount) * BAR_MAX_HEIGHT);

          return (
            <View key={point.month} style={trendStyles.barColumn}>
              {showYear ? (
                <Text style={trendStyles.yearLabel}>{year}</Text>
              ) : (
                <View style={trendStyles.yearPlaceholder} />
              )}
              <View style={trendStyles.barTrack}>
                <View style={[trendStyles.bar, { height: barHeight }]} />
              </View>
              <Text style={trendStyles.monthLabel}>{formatMonthLabel(point.month)}</Text>
              {point.count > 0 ? (
                <Text style={trendStyles.countLabel}>{point.count}</Text>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const trendStyles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    paddingTop: 18,
    paddingBottom: 14,
    gap: 16,
    ...shadow,
  },
  header: {
    paddingHorizontal: 18,
    gap: 4,
  },
  eyebrow: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  chartScroll: {
    paddingHorizontal: 18,
    gap: 0,
  },
  barColumn: {
    alignItems: "center",
    width: 38,
    gap: 4,
  },
  yearLabel: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  yearPlaceholder: {
    height: 13,
  },
  barTrack: {
    height: 48,
    width: 22,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  bar: {
    width: 22,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  monthLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  countLabel: {
    color: colors.textSoft,
    fontSize: 10,
    fontWeight: "700",
  },
});

// ---------------------------------------------------------------------------
// Correspondent Cluster Strip — horizontally scrollable cards
// ---------------------------------------------------------------------------

type Correspondent = DashboardInsights["topCorrespondents"][number];

const DOT_COLORS = ["#b04030", "#af6d11", "#17624f", "#5c6bc0"];

function ClusterStrip({ data, onPress }: { data: Correspondent[]; onPress: (item: Correspondent) => void }) {
  const { t } = useI18n();

  if (data.length === 0) {
    return null;
  }

  return (
    <View style={clusterStyles.wrap}>
      <View style={clusterStyles.header}>
        <Text style={clusterStyles.eyebrow}>{t("dashboard.clusterEyebrow")}</Text>
        <Text style={clusterStyles.title}>{t("dashboard.clusterTitle")}</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={clusterStyles.scroll}
      >
        {data.slice(0, 4).map((item, index) => (
          <Pressable
            key={item.id}
            onPress={() => onPress(item)}
            style={({ pressed }) => [clusterStyles.card, pressed ? clusterStyles.cardPressed : null]}
          >
            <View style={clusterStyles.cardTopRow}>
              <Text style={clusterStyles.docCount}>
                {item.documentCount} {item.documentCount === 1 ? t("dashboard.clusterDoc") : t("dashboard.clusterDocs")}
              </Text>
              <MaterialCommunityIcons name="arrow-right" size={16} color={colors.muted} />
            </View>

            <Text numberOfLines={2} style={clusterStyles.name}>{item.name}</Text>

            {(item.documentTypes ?? []).length > 0 ? (
              <View style={clusterStyles.typePillRow}>
                {(item.documentTypes ?? []).slice(0, 3).map((dt, dtIndex) => (
                  <View key={dt.name} style={clusterStyles.typePill}>
                    <View style={[clusterStyles.typeDot, { backgroundColor: DOT_COLORS[dtIndex % DOT_COLORS.length] }]} />
                    <Text style={clusterStyles.typePillText}>
                      {dt.name} {dt.count > 1 ? `\u00b7 ${dt.count}` : ""}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={clusterStyles.cardFooter}>
              <Text style={clusterStyles.footerDate}>
                {item.latestDocDate ? formatDate(item.latestDocDate) : "-"}
              </Text>
              <Text style={clusterStyles.footerAmount}>
                {formatCurrency(item.totalAmount, item.currency ?? "EUR")}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const clusterStyles = StyleSheet.create({
  wrap: {
    gap: 14,
  },
  header: {
    paddingHorizontal: 0,
    gap: 4,
  },
  eyebrow: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  scroll: {
    gap: 10,
  },
  card: {
    width: 200,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 10,
    ...shadow,
  },
  cardPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.97 }],
  },
  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  docCount: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  name: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 21,
    letterSpacing: -0.2,
  },
  typePillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  typePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  typeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  typePillText: {
    color: colors.textSoft,
    fontSize: 11,
    fontWeight: "700",
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 2,
  },
  footerDate: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  footerAmount: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
});

// ---------------------------------------------------------------------------
// Task Table — vertical card list with Done action
// ---------------------------------------------------------------------------

type DeadlineItem = DashboardInsights["upcomingDeadlines"][number];

function TaskList({
  items,
  onComplete,
  busyId,
}: {
  items: DeadlineItem[];
  onComplete?: (documentId: string) => void;
  busyId: string | null;
}) {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const { t } = useI18n();

  if (items.length === 0) {
    return <EmptyState title={t("dashboard.tasks.emptyTitle")} body={t("dashboard.tasks.emptyBody")} />;
  }

  return (
    <>
      {items.map((item) => {
        const deadlineLabel = item.isOverdue
          ? `${Math.abs(item.daysUntilDue)}${t("dashboard.tasks.overdueDays")}`
          : `${item.daysUntilDue}${t("dashboard.tasks.dueIn")}`;

        return (
          <Pressable
            key={`${item.documentId}-${item.dueDate}`}
            onPress={() => navigation.navigate("DocumentDetail", {
              documentId: item.documentId,
              title: item.title,
            })}
            style={({ pressed }) => [pressed ? taskStyles.pressed : null]}
          >
            <Card style={item.isOverdue ? taskStyles.overdueCard : undefined}>
              <View style={taskStyles.topRow}>
                <View style={taskStyles.correspondentWrap}>
                    <Text numberOfLines={1} style={taskStyles.correspondent}>
                    {item.correspondentName ?? t("dashboard.tasks.unfiled")}
                  </Text>
                  {item.documentTypeName ? (
                    <Text style={taskStyles.docType}>{item.documentTypeName}</Text>
                  ) : null}
                </View>
                <Pill
                  label={item.isOverdue ? t("dashboard.tasks.overdue") : deadlineLabel}
                  tone={item.isOverdue ? "danger" : "warning"}
                />
              </View>

              <Text numberOfLines={2} style={taskStyles.title}>{item.title}</Text>

              <View style={taskStyles.metaRow}>
                <View style={taskStyles.metaChip}>
                  <Text style={taskStyles.metaLabel}>{t("dashboard.tasks.whatToDo")}</Text>
                  <Text style={taskStyles.metaValue}>{item.taskLabel}</Text>
                </View>
                <View style={taskStyles.metaChip}>
                  <Text style={taskStyles.metaLabel}>{t("dashboard.tasks.amount")}</Text>
                  <Text style={taskStyles.metaValue}>
                    {formatCurrency(item.amount, item.currency ?? "EUR")}
                  </Text>
                </View>
              </View>

              <View style={taskStyles.footerRow}>
                <Text style={taskStyles.deadline}>
                  {formatTaskDateLabel(item.dueDate)}
                </Text>
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    onComplete?.(item.documentId);
                  }}
                  disabled={!onComplete || busyId === item.documentId}
                  style={({ pressed }) => [
                    taskStyles.doneButton,
                    pressed ? taskStyles.doneButtonPressed : null,
                    !onComplete || busyId === item.documentId ? taskStyles.doneButtonDisabled : null,
                  ]}
                >
                  <MaterialCommunityIcons name="check" size={14} color={colors.primary} />
                  <Text style={taskStyles.doneText}>{t("dashboard.tasks.done")}</Text>
                </Pressable>
              </View>
            </Card>
          </Pressable>
        );
      })}
    </>
  );
}

const taskStyles = StyleSheet.create({
  pressed: {
    opacity: 0.93,
  },
  overdueCard: {
    backgroundColor: "#fff6f1",
    borderColor: "#f0ddd5",
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
  },
  correspondentWrap: {
    flex: 1,
    gap: 2,
  },
  correspondent: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  docType: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  metaRow: {
    flexDirection: "row",
    gap: 10,
  },
  metaChip: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 3,
  },
  metaLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  metaValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  deadline: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  doneButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  doneButtonPressed: {
    opacity: 0.85,
  },
  doneButtonDisabled: {
    opacity: 0.5,
  },
  doneText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "800",
  },
});

// ---------------------------------------------------------------------------
// Document Card — for recent documents
// ---------------------------------------------------------------------------

function DocumentCard({ document, onOpen }: { document: ArchiveDocument; onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [pressed ? docStyles.pressed : null]}>
      <Card style={docStyles.card}>
        <View style={docStyles.topRow}>
          <Text style={docStyles.meta}>{document.documentType?.name ?? t("dashboard.documentCard.document")}</Text>
          <Pill label={formatDashboardDocumentStatus(t, document.status)} tone={toneForStatus(document.status)} />
        </View>
        <Text numberOfLines={2} style={docStyles.title}>{titleForDocument(document)}</Text>
        <DocumentProcessingIndicator document={document} />
        <Text style={docStyles.helper}>{document.correspondent?.name ?? t("dashboard.documentCard.unfiled")}</Text>
        <View style={docStyles.footerRow}>
          <Text style={docStyles.detail}>
            {formatDate(document.issueDate)} {"\u00b7"} {formatCurrency(document.amount, document.currency ?? "EUR")}
          </Text>
          {document.reviewStatus === "pending" ? (
            <Pill label={t("dashboard.documentCard.review")} tone="warning" />
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}

function formatDashboardDocumentStatus(
  t: ReturnType<typeof useI18n>["t"],
  status: string,
) {
  switch (status) {
    case "pending":
      return t("documentDetail.status.pending");
    case "processing":
      return t("documentDetail.status.processing");
    case "ready":
      return t("documentDetail.status.ready");
    case "failed":
      return t("documentDetail.status.failed");
    default:
      return status;
  }
}

const docStyles = StyleSheet.create({
  pressed: {
    opacity: 0.93,
  },
  card: {
    gap: 10,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  meta: {
    flex: 1,
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  title: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
    lineHeight: 23,
    letterSpacing: -0.2,
  },
  helper: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  detail: {
    color: colors.textSoft,
    fontSize: 13,
    lineHeight: 18,
  },
});

// ---------------------------------------------------------------------------
// Dashboard Screen
// ---------------------------------------------------------------------------

export function DashboardScreen() {
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const queryClient = useQueryClient();
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const insightsQuery = useQuery({
    queryKey: ["dashboard", auth.apiUrl, offline.shouldUseOffline, offline.summary?.lastSyncedAt],
    queryFn: async () => {
      if (offline.shouldUseOffline) {
        const cached = await offline.loadDashboard();
        if (!cached) {
          throw new Error(t("dashboard.screen.noSnapshot"));
        }
        return cached;
      }

      const response = await auth.authFetch("/api/dashboard/insights");
      if (!response.ok) {
        throw new Error(t("dashboard.screen.loadInsights"));
      }
      return (await response.json()) as DashboardInsights;
    },
    refetchInterval: offline.shouldUseOffline
      ? false
      : (query) => processingRefetchInterval(query.state.data, (data) => data?.recentDocuments),
  });

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

  // Build task list: overdue first, then upcoming, capped at 6
  const taskItems: DeadlineItem[] = [];
  if (data) {
    const overdue = data.overdueItems.map((item) => ({ ...item, isOverdue: true as const }));
    taskItems.push(...overdue);
    for (const item of data.upcomingDeadlines) {
      if (!taskItems.some((t) => t.documentId === item.documentId && t.dueDate === item.dueDate)) {
        taskItems.push(item);
      }
    }
    taskItems.splice(6);
  }

  return (
    <Screen
      title={t("dashboard.screen.title")}
      subtitle={t("dashboard.screen.subtitle")}
      contentContainerStyle={styles.content}
    >
      {insightsQuery.isLoading ? (
        <Card>
          <Text style={styles.loadingText}>{t("dashboard.screen.loading")}</Text>
        </Card>
      ) : null}

      {insightsQuery.isError ? (
        <ErrorCard
          message={t("dashboard.screen.loadError")}
          onRetry={() => insightsQuery.refetch()}
        />
      ) : null}

      {data ? (
        <>
          {/* ── Metric ribbon ── */}
          <View style={styles.metricGrid}>
            <Metric label={t("dashboard.screen.totalDocuments")} value={data.stats.totalDocuments} />
            <Metric
              label={t("dashboard.screen.pendingReview")}
              value={data.stats.pendingReview}
              onPress={() => navigation.navigate("Review")}
            />
          </View>
          <View style={styles.metricGrid}>
            <Metric label={t("dashboard.screen.documentTypes")} value={data.stats.documentTypesCount} />
            <Metric
              label={t("dashboard.screen.correspondents")}
              value={data.stats.correspondentsCount}
              onPress={() => navigation.navigate("Correspondents")}
            />
          </View>

          {/* ── Intake trend ── */}
          {(data.monthlyActivity ?? []).length > 0 ? (
            <IntakeTrend data={data.monthlyActivity!} />
          ) : null}

          {/* ── Correspondent clusters ── */}
          {data.topCorrespondents.length > 0 ? (
            <ClusterStrip
              data={data.topCorrespondents}
              onPress={(item) =>
                navigation.navigate("CorrespondentDossier", {
                  slug: item.slug,
                  name: item.name,
                })
              }
            />
          ) : null}

          {/* ── Deadline / task list ── */}
          <View style={styles.sectionWrap}>
            <View style={styles.sectionHeader}>
                <Text style={styles.sectionEyebrow}>{t("dashboard.screen.deadlines")}</Text>
                <Text style={styles.sectionTitle}>{t("dashboard.screen.upcomingTasks")}</Text>
            </View>
            <TaskList
              items={taskItems}
              onComplete={offline.shouldUseOffline ? undefined : (id) => completeMutation.mutate(id)}
              busyId={busyTaskId}
            />
            {completeMutation.isError ? (
              <ErrorCard
                message={
                  completeMutation.error instanceof Error
                    ? completeMutation.error.message
                    : t("dashboard.screen.completeFailed")
                }
              />
            ) : null}
          </View>

          {/* ── Recent documents ── */}
          <View style={styles.sectionWrap}>
            <SectionTitle
                title={t("dashboard.screen.recentDocuments")}
                hint={t("dashboard.screen.recentHint")}
              />
            {data.recentDocuments.length === 0 ? (
              <EmptyState
                title={t("dashboard.screen.noDocumentsTitle")}
                body={t("dashboard.screen.noDocumentsBody")}
              />
            ) : (
              data.recentDocuments.slice(0, 5).map((document) => (
                <DocumentCard
                  key={document.id}
                  document={document}
                  onOpen={() =>
                    navigation.navigate("DocumentDetail", {
                      documentId: document.id,
                      title: titleForDocument(document),
                    })
                  }
                />
              ))
            )}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
  },
  loadingText: {
    color: colors.muted,
    lineHeight: 20,
  },
  metricGrid: {
    flexDirection: "row",
    gap: 12,
  },
  sectionWrap: {
    gap: 14,
  },
  sectionHeader: {
    gap: 4,
  },
  sectionEyebrow: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
});
