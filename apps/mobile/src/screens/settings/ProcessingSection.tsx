import { Pressable, Text, View } from "react-native";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { AppStackParamList } from "../../../App";
import { fetchProcessingStatus, type ProcessingJob } from "../../api/admin";
import { useAuth } from "../../auth";
import { Skeleton } from "../../components/layout";
import { Pill } from "../../components/ui";
import { useI18n, type TranslationKey } from "../../i18n";
import { createThemedStyles, radii, useColors } from "../../theme";
import { tabular, text } from "../../typography";
import { InlineError, SectionCard, StatTile, StatusBadge, SubHeading, TileGrid, errorText, type StatusTone } from "./shared";

const STATUS_TONES: Record<ProcessingJob["status"], StatusTone> = {
  completed: "ok",
  running: "warn",
  queued: "muted",
  failed: "bad",
};
const STATUS_LABELS: Record<ProcessingJob["status"], TranslationKey> = {
  completed: "settings.jobStatusCompleted",
  running: "settings.jobStatusRunning",
  queued: "settings.jobStatusQueued",
  failed: "settings.jobStatusFailed",
};

export function ProcessingSection() {
  const styles = useStyles();
  const colors = useColors();
  const auth = useAuth();
  const { t, language } = useI18n();
  const focused = useIsFocused();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();

  const statusQuery = useQuery({
    queryKey: ["settings", "processing", auth.apiUrl],
    queryFn: () => fetchProcessingStatus(auth.authFetch, t("settings.failedToLoadProcessingStatus")),
    refetchInterval: focused ? 15_000 : false,
  });

  const status = statusQuery.data;
  const total = Object.values(status?.documents.byStatus ?? {}).reduce((sum, count) => sum + count, 0);

  function relativeTime(value: string) {
    const date = new Date(value);
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${Math.max(seconds, 0)}${t("settings.secondsAgo")}`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}${t("settings.minutesAgo")}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}${t("settings.hoursAgo")}`;
    return new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function queueLabel(name: string) {
    if (name === "document.process") return t("settings.queueOcr");
    if (name === "document.embed") return t("settings.queueEmbedding");
    return name;
  }

  return (
    <SectionCard
      icon="pulse"
      title={t("settings.processingActivity")}
      description={t("settings.processingActivityDescription")}
    >
      {statusQuery.isLoading ? (
        <View style={styles.loading}>
          <View style={styles.loadingRow}>
            <Skeleton style={styles.loadingTile} />
            <Skeleton style={styles.loadingTile} />
          </View>
          <View style={styles.loadingRow}>
            <Skeleton style={styles.loadingTile} />
            <Skeleton style={styles.loadingTile} />
          </View>
        </View>
      ) : null}
      {statusQuery.isError ? (
        <InlineError
          message={errorText(statusQuery.error, t("settings.failedToLoadProcessingStatus"))}
          onRetry={() => void statusQuery.refetch()}
        />
      ) : null}
      {status ? (
        <>
          <TileGrid>
            {[
              <StatTile
                key="ocr"
                label={t("settings.ocrQueue")}
                value={status.queues.processing.depth}
                tone={status.queues.processing.depth > 0 ? "brand" : "default"}
              />,
              <StatTile
                key="embed"
                label={t("settings.embedQueue")}
                value={status.queues.embedding.depth}
                tone={status.queues.embedding.depth > 0 ? "brand" : "default"}
              />,
              <StatTile key="total" label={t("settings.totalDocs")} value={total} />,
              <StatTile
                key="review"
                label={t("settings.pendingReview")}
                value={status.documents.pendingReview}
                tone={status.documents.pendingReview > 0 ? "warning" : "default"}
              />,
            ]}
          </TileGrid>

          <View style={styles.block}>
            <SubHeading>{t("settings.documentsByStatus")}</SubHeading>
            <View style={styles.badges}>
              {Object.entries(status.documents.byStatus).map(([name, count]) => {
                const label = name.replace(/_/g, " ");
                return (
                  <Pill
                    key={name}
                    tone="outline"
                    label={`${label.charAt(0).toUpperCase()}${label.slice(1)} ${count}`}
                  />
                );
              })}
            </View>
          </View>

          <View style={styles.block}>
            <SubHeading>{t("settings.recentJobs")}</SubHeading>
            {status.recentJobs.length === 0 ? (
              <Text style={styles.none}>{t("settings.noProcessingJobs")}</Text>
            ) : (
              <View style={styles.jobs}>
                {status.recentJobs.slice(0, 8).map((job, index) => (
                  <Pressable
                    key={job.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${queueLabel(job.queueName)}, ${t(STATUS_LABELS[job.status])}`}
                    onPress={() => navigation.navigate("DocumentDetail", { documentId: job.documentId })}
                    style={({ pressed }) => [
                      styles.job,
                      index > 0 ? styles.jobRule : null,
                      pressed ? styles.jobPressed : null,
                    ]}
                  >
                    <View style={styles.jobHead}>
                      <StatusBadge tone={STATUS_TONES[job.status]} label={t(STATUS_LABELS[job.status])} />
                      <Text style={styles.jobQueue} numberOfLines={1}>
                        {queueLabel(job.queueName)}
                      </Text>
                      <Text style={styles.jobTime}>{relativeTime(job.createdAt)}</Text>
                    </View>
                    <View style={styles.jobLine}>
                      <Text style={styles.jobId} numberOfLines={1}>
                        {job.documentId}
                      </Text>
                      <MaterialCommunityIcons name="chevron-right" size={16} color={colors.dim} />
                    </View>
                    {job.lastError ? <Text style={styles.jobError}>{job.lastError}</Text> : null}
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        </>
      ) : null}
    </SectionCard>
  );
}

const useStyles = createThemedStyles((c) => ({
  loading: {
    gap: 10,
  },
  loadingRow: {
    flexDirection: "row",
    gap: 10,
  },
  loadingTile: {
    flex: 1,
    height: 80,
    borderRadius: radii.xl,
  },
  block: {
    gap: 8,
  },
  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  none: {
    ...text.body,
    color: c.muted,
  },
  jobs: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.lg,
    overflow: "hidden",
  },
  job: {
    minHeight: 44,
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  jobRule: {
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  jobPressed: {
    backgroundColor: c.bar,
  },
  jobHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  jobQueue: {
    ...text.bodyStrong,
    flex: 1,
    minWidth: 0,
    color: c.ink,
  },
  jobTime: {
    ...text.numeric,
    color: c.muted,
    ...tabular,
  },
  jobLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  jobId: {
    ...text.mono,
    flex: 1,
    minWidth: 0,
    color: c.muted,
  },
  jobError: {
    ...text.small,
    color: c.red,
  },
}));
