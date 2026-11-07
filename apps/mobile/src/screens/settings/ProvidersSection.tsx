import { Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { fetchHealth, fetchProcessingStatus, fetchProviders, type ProcessingJob } from "../../api/admin";
import { useAuth } from "../../auth";
import { Skeleton } from "../../components/layout";
import { EmptyState, ErrorCard, Pill, Panel } from "../../components/ui";
import { useI18n, type TranslationKey } from "../../i18n";
import { createThemedStyles, radii } from "../../theme";
import { text } from "../../typography";
import {
  buildProviderGroups,
  jobDuration,
  jobStats,
  type ProviderGroup,
  type ProviderRow,
  type ProviderTone,
} from "./providers-logic";
import { SectionCard, StatTile, StatusBadge, StatusDot, TileGrid, fill, type StatusTone } from "./shared";

const TONE_DOT: Record<ProviderTone, StatusTone> = {
  active: "brand",
  fallback: "warn",
  available: "ok",
  incomplete: "warn",
  unconfigured: "muted",
};

const GROUP_COPY: Record<ProviderGroup["id"], { title: TranslationKey; sub: TranslationKey; icon: string }> = {
  parsing: { title: "providers.parsing", sub: "providers.parsingSub", icon: "file-search-outline" },
  embeddings: { title: "providers.embeddings", sub: "providers.embeddingsSub", icon: "brain" },
  chat: { title: "providers.chat", sub: "providers.chatSub", icon: "message-text-outline" },
};

const NOTE_COPY: Record<ProviderRow["noteKey"], TranslationKey> = {
  local: "providers.localNote",
  cloud: "providers.cloudNote",
  onlyText: "providers.onlyText",
  keyStored: "providers.keyStored",
  noKey: "providers.noKey",
};

function ProviderCard({ row }: { row: ProviderRow }) {
  const styles = useStyles();
  const { t } = useI18n();
  return (
    <View
      style={[
        styles.provider,
        row.tone === "active" ? styles.providerActive : null,
        row.tone === "unconfigured" ? styles.providerIdle : null,
      ]}
    >
      <View style={styles.providerHead}>
        <View style={styles.providerDot}>
          <StatusDot tone={TONE_DOT[row.tone]} />
        </View>
        <View style={styles.providerText}>
          <Text
            style={[
              styles.providerName,
              row.tone === "active" ? styles.providerNameActive : null,
              row.tone === "unconfigured" ? styles.providerNameIdle : null,
            ]}
            numberOfLines={1}
          >
            {row.name}
          </Text>
          <Text style={styles.providerNote}>{t(NOTE_COPY[row.noteKey])}</Text>
        </View>
      </View>
      <View style={styles.providerFoot}>
        <Text style={styles.providerModel} numberOfLines={1}>
          {row.model ?? "—"}
        </Text>
        {row.tone === "active" ? (
          <View style={styles.activePill}>
            <Text style={styles.activePillText}>{t("providers.active")}</Text>
          </View>
        ) : row.tone === "fallback" ? (
          <Pill tone="warn" label={t("providers.fallback")} />
        ) : row.tone === "incomplete" ? (
          <Pill tone="warn" label={t("providers.incomplete")} />
        ) : row.tone === "unconfigured" ? (
          <Pill tone="outline" label={t("providers.notConfigured")} />
        ) : (
          <Pill tone="ok" label={t("providers.available")} />
        )}
      </View>
    </View>
  );
}

function JobRow({ job, first }: { job: ProcessingJob; first: boolean }) {
  const styles = useStyles();
  const { t } = useI18n();
  const duration = jobDuration(job.startedAt, job.finishedAt);
  const tone: StatusTone =
    job.status === "failed"
      ? "bad"
      : job.status === "completed"
        ? "ok"
        : job.status === "running"
          ? "brand"
          : "muted";
  const label =
    job.status === "failed"
      ? t("providers.failed")
      : job.status === "completed"
        ? t("providers.done")
        : job.status === "running"
          ? t("providers.running")
          : t("providers.queued");
  return (
    <View style={[styles.job, first ? null : styles.jobRule]}>
      <View style={styles.jobText}>
        <Text style={styles.jobId}>{job.documentId.slice(0, 8)}</Text>
        <Text style={styles.jobQueue} numberOfLines={1}>
          {job.queueName}
        </Text>
      </View>
      <Text style={styles.jobDuration}>
        {duration != null ? `${(duration / 1000).toFixed(1)}s` : t("providers.running")}
      </Text>
      <StatusBadge tone={tone} label={label} />
    </View>
  );
}

export function ProvidersSection() {
  const styles = useStyles();
  const auth = useAuth();
  const { t } = useI18n();
  const focused = useIsFocused();
  const loadError = t("providers.loadError");

  const healthQuery = useQuery({
    queryKey: ["settings", "health", auth.apiUrl],
    queryFn: () => fetchHealth(auth.authFetch, loadError),
    refetchInterval: focused ? 30_000 : false,
  });
  const providersQuery = useQuery({
    queryKey: ["settings", "providers", auth.apiUrl],
    queryFn: () => fetchProviders(auth.authFetch, loadError),
    refetchInterval: focused ? 30_000 : false,
  });
  const statusQuery = useQuery({
    queryKey: ["settings", "processing", auth.apiUrl],
    queryFn: () => fetchProcessingStatus(auth.authFetch, loadError),
    refetchInterval: focused ? 15_000 : false,
  });

  if (healthQuery.isLoading || providersQuery.isLoading || statusQuery.isLoading) {
    return (
      <View style={styles.loading}>
        <View style={styles.loadingRow}>
          <Skeleton style={styles.loadingTile} />
          <Skeleton style={styles.loadingTile} />
        </View>
        <View style={styles.loadingRow}>
          <Skeleton style={styles.loadingTile} />
          <Skeleton style={styles.loadingTile} />
        </View>
        <Skeleton style={styles.loadingCard} />
        <Skeleton style={styles.loadingCard} />
      </View>
    );
  }

  const cfg = healthQuery.data?.provider;
  const providers = providersQuery.data;
  const status = statusQuery.data;

  if (!cfg || !providers || !status) {
    return (
      <ErrorCard
        message={loadError}
        onRetry={() => {
          void healthQuery.refetch();
          void providersQuery.refetch();
          void statusQuery.refetch();
        }}
      />
    );
  }

  const { failed, avgSeconds } = jobStats(status.recentJobs);
  const groups = buildProviderGroups(cfg, providers);

  return (
    <>
      <TileGrid>
        {[
          <StatTile key="process" label={t("providers.processingQueue")} value={status.queues.processing.depth} />,
          <StatTile
            key="embed"
            label={t("providers.embeddingQueue")}
            value={status.queues.embedding.depth}
            note={providers.activeEmbeddingProvider}
          />,
          <StatTile
            key="failed"
            label={t("providers.failedRecently")}
            value={failed}
            tone={failed > 0 ? "danger" : "default"}
          />,
          <StatTile
            key="avg"
            label={t("providers.avgPerDoc")}
            value={avgSeconds != null ? `${avgSeconds}s` : "—"}
          />,
        ]}
      </TileGrid>

      {groups.map((group) => {
        const copy = GROUP_COPY[group.id];
        return (
          <SectionCard key={group.id} icon={copy.icon} title={t(copy.title)} description={t(copy.sub)}>
            <Text style={styles.summary} numberOfLines={1}>
              {group.activeName
                ? fill(t("providers.activeSummary"), { name: group.activeName })
                : t("providers.none")}
            </Text>
            <View style={styles.providers}>
              {group.rows.map((row) => (
                <ProviderCard key={row.id} row={row} />
              ))}
            </View>
          </SectionCard>
        );
      })}

      <Panel>
        <View style={styles.jobsHead}>
          <Text style={styles.jobsTitle} accessibilityRole="header">
            {t("providers.recentJobs")}
          </Text>
          <Text style={styles.jobsSub}>{t("providers.recentJobsSub")}</Text>
        </View>
        {status.recentJobs.length === 0 ? (
          <EmptyState icon="format-list-checks" title={t("providers.noJobs")} />
        ) : (
          status.recentJobs
            .slice(0, 8)
            .map((job, index) => <JobRow key={job.id} job={job} first={index === 0} />)
        )}
      </Panel>
    </>
  );
}

const useStyles = createThemedStyles((c) => ({
  loading: {
    gap: 12,
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
  loadingCard: {
    height: 208,
    borderRadius: radii.xl,
  },
  summary: {
    ...text.mono,
    color: c.muted,
  },
  providers: {
    gap: 10,
  },
  provider: {
    gap: 10,
    padding: 14,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: c.border,
  },
  // Solid, as on the web: a soft pill would vanish on the card's soft fill.
  activePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: c.accentFill,
  },
  activePillText: {
    ...text.smallStrong,
    color: c.accentFillInk,
  },
  providerActive: {
    // The web's `ring-2 ring-brand/40`.
    borderWidth: 2,
    padding: 13,
    borderColor: c.accent,
    backgroundColor: c.accentSoft,
  },
  providerIdle: {
    backgroundColor: c.bar,
  },
  providerHead: {
    flexDirection: "row",
    gap: 10,
  },
  providerDot: {
    paddingTop: 6,
  },
  providerText: {
    flex: 1,
    minWidth: 0,
  },
  providerName: {
    ...text.bodyStrong,
    color: c.ink,
  },
  providerNameActive: {
    color: c.accentSoftInk,
  },
  providerNameIdle: {
    color: c.muted,
  },
  providerNote: {
    ...text.small,
    marginTop: 2,
    color: c.muted,
  },
  providerFoot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingLeft: 18,
  },
  providerModel: {
    ...text.mono,
    flex: 1,
    minWidth: 0,
    color: c.muted,
  },
  jobsHead: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  jobsTitle: {
    ...text.bodyStrong,
    color: c.ink,
  },
  jobsSub: {
    ...text.body,
    marginTop: 2,
    color: c.muted,
  },
  job: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  jobRule: {
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  jobText: {
    flex: 1,
    minWidth: 0,
  },
  jobId: {
    ...text.mono,
    color: c.ink,
  },
  jobQueue: {
    ...text.mono,
    color: c.muted,
  },
  jobDuration: {
    ...text.numeric,
    color: c.muted,
  },
}));
