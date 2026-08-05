import { useNavigation, useRoute } from "@react-navigation/native";
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { useAuth } from "../auth";
import { EmptyState, ErrorCard, Notice, Panel, Row, Screen, SectionHeader } from "../components/ui";
import { documentRowState, processingRefetchInterval } from "../document-processing";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import type { AppStackParamList } from "../../App";
import { createThemedStyles, radii } from "../theme";
import { text } from "../typography";
import {
  formatCurrency,
  formatMonthLabel,
  formatShortDate,
  titleForDocument,
  type ArchiveDocument,
  type CorrespondentInsightsResponse,
  type CorrespondentIntelligenceChange,
  type CorrespondentTimelinePoint,
  type SearchDocumentsResponse,
} from "../lib";

type Props = NativeStackScreenProps<AppStackParamList, "CorrespondentDossier">;
type Translate = ReturnType<typeof useI18n>["t"];

// ---------------------------------------------------------------------------
// Monthly activity — a thin 12-bar sparkline, current month in accent
// ---------------------------------------------------------------------------

function ActivitySparkline({ points }: { points: CorrespondentTimelinePoint[] }) {
  const styles = useStyles();
  const recent = points.slice(-12);
  const peak = Math.max(1, ...recent.map((point) => point.count));

  return (
    <View style={styles.sparkline}>
      {recent.map((point, index) => {
        const isCurrent = index === recent.length - 1;
        return (
          <View key={point.month} style={styles.sparkColumn}>
            <View style={styles.sparkTrack}>
              <View
                style={[
                  styles.sparkBar,
                  isCurrent ? styles.sparkBarCurrent : null,
                  { height: Math.max(4, Math.round((point.count / peak) * 56)) },
                ]}
              />
            </View>
            <Text style={styles.sparkLabel} numberOfLines={1}>
              {formatMonthLabel(point.month).slice(0, 1)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Key changes — the section that explains why an amount moved
// ---------------------------------------------------------------------------

function ChangeRow({ change }: { change: CorrespondentIntelligenceChange }) {
  const styles = useStyles();
  const dropped = change.direction === "decrease";

  return (
    <View style={styles.changeRow}>
      <View style={styles.changeTop}>
        <Text style={styles.changeTitle} numberOfLines={1}>
          {change.title}
        </Text>
        <Text style={styles.changeDate}>
          {change.effectiveDate ? formatShortDate(change.effectiveDate) : ""}
        </Text>
      </View>
      {change.valueBefore || change.valueAfter ? (
        <View style={styles.changeValues}>
          {change.valueBefore ? (
            <Text style={styles.changeBefore}>{change.valueBefore}</Text>
          ) : null}
          <Text style={styles.changeArrow}>{"→"}</Text>
          <Text style={[styles.changeAfter, dropped ? styles.changeAfterDown : null]}>
            {change.valueAfter ?? "-"}
          </Text>
        </View>
      ) : (
        <Text style={styles.changeDescription} numberOfLines={2}>
          {change.description}
        </Text>
      )}
    </View>
  );
}

function documentMeta(document: ArchiveDocument, t: Translate) {
  const state = documentRowState(document);
  if (state === "failed") {
    return t("state.failed");
  }
  if (state === "processing" || state === "queued") {
    return t("state.processing");
  }
  return document.documentType?.name ?? t("documents.document");
}

// ---------------------------------------------------------------------------
// Dossier
// ---------------------------------------------------------------------------

export function CorrespondentDossierScreen() {
  const styles = useStyles();
  const route = useRoute<Props["route"]>();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();
  const shouldUseCache = offline.shouldUseCache || auth.isOfflineSession;

  const { slug, name } = route.params;

  const insightsQuery = useQuery({
    queryKey: ["correspondent", slug, "insights", auth.apiUrl, shouldUseCache],
    enabled: !shouldUseCache,
    queryFn: async () => {
      const response = await auth.authFetch(
        `/api/correspondents/${encodeURIComponent(slug)}/insights`,
      );
      if (!response.ok) {
        throw new Error(t("correspondent.screen.loadInsights"));
      }
      return (await response.json()) as CorrespondentInsightsResponse;
    },
    refetchInterval: (query) => {
      const current = query.state.data;
      return current?.summaryStatus === "pending" || current?.intelligenceStatus === "pending"
        ? 4_000
        : false;
    },
  });

  const correspondentId = insightsQuery.data?.correspondent.id;
  const documentsQuery = useQuery({
    queryKey: [
      "correspondent",
      slug,
      "documents",
      correspondentId,
      auth.apiUrl,
      shouldUseCache,
      offline.cacheSummary.updatedAt,
    ],
    queryFn: async () => {
      if (shouldUseCache) {
        return offline.queryCachedDocuments({ correspondentSlug: slug });
      }

      const params = new URLSearchParams({
        correspondentIds: correspondentId!,
        page: "1",
        pageSize: "20",
        sort: "issueDate",
        direction: "desc",
      });
      const response = await auth.authFetch(`/api/documents?${params.toString()}`);
      if (!response.ok) {
        throw new Error(t("correspondent.screen.loadDocumentsFailed"));
      }
      return (await response.json()) as SearchDocumentsResponse;
    },
    enabled: shouldUseCache || Boolean(correspondentId),
    refetchInterval: shouldUseCache
      ? false
      : (query) => processingRefetchInterval(query.state.data, (data) => data?.items),
  });

  const data = insightsQuery.data ?? null;
  const intelligence = data?.intelligence ?? null;
  const insurance = intelligence?.domainInsights.insurance;
  const documents = documentsQuery.data?.items ?? [];

  const stats = [
    {
      label: t("correspondents.documents"),
      value: String(data?.stats.documentCount ?? documents.length),
    },
    {
      label: t("correspondent.lastDocument"),
      value: data?.stats.dateRange.to ? formatShortDate(data.stats.dateRange.to) : "-",
    },
    { label: t("correspondent.changes"), value: String(intelligence?.changes.length ?? 0) },
  ];

  return (
    <Screen
      title={name}
      onBack={() => navigation.goBack()}
      padded={false}
      notice={shouldUseCache ? <Notice label={t("state.offline")} /> : undefined}
    >
      {!shouldUseCache && insightsQuery.isLoading ? (
        <View style={styles.gutter}>
          <Panel padded>
            <Text style={styles.hint}>{t("correspondent.screen.loadDossier")}</Text>
          </Panel>
        </View>
      ) : null}

      {!shouldUseCache && insightsQuery.isError ? (
        <View style={styles.gutter}>
          <ErrorCard
            message={t("correspondent.screen.loadInsights")}
            onRetry={() => insightsQuery.refetch()}
          />
        </View>
      ) : null}

      {/* Three numbers, all real */}
      <View style={styles.statStrip}>
        {stats.map((stat, index) => (
          <View
            key={stat.label}
            style={[styles.statCell, index < stats.length - 1 ? styles.statCellDivided : null]}
          >
            <Text style={styles.statValue} numberOfLines={1}>
              {stat.value}
            </Text>
            <Text style={styles.statLabel} numberOfLines={1}>
              {stat.label}
            </Text>
          </View>
        ))}
      </View>

      {(data?.timeline.length ?? 0) > 0 ? (
        <>
          <SectionHeader label={t("correspondent.monthlyActivity")} />
          <ActivitySparkline points={data!.timeline} />
        </>
      ) : null}

      {/* Why an amount moved */}
      {(intelligence?.changes.length ?? 0) > 0 ? (
        <>
          <SectionHeader
            label={t("correspondent.keyChanges")}
            count={intelligence!.changes.length}
          />
          {intelligence!.changes.map((change, index) => (
            <ChangeRow key={`${change.title}-${index}`} change={change} />
          ))}
        </>
      ) : null}

      {/* Each group collapses when empty rather than rendering an empty card */}
      {intelligence?.profile?.category || intelligence?.overview ? (
        <>
          <SectionHeader label={t("correspondent.relationship")} />
          <View style={styles.prose}>
            {intelligence.profile?.category ? (
              <Text style={styles.proseLabel}>{intelligence.profile.category}</Text>
            ) : null}
            {intelligence.overview ? (
              <Text style={styles.proseText}>{intelligence.overview}</Text>
            ) : null}
          </View>
        </>
      ) : null}

      {(intelligence?.currentState.length ?? 0) > 0 ? (
        <>
          <SectionHeader label={t("correspondent.currentState")} />
          {intelligence!.currentState.map((fact, index) => (
            <Row
              key={`${fact.label}-${index}`}
              minHeight={50}
              title={fact.label}
              value={fact.value}
              valueMeta={fact.asOf ? formatShortDate(fact.asOf) : undefined}
            />
          ))}
        </>
      ) : null}

      {(intelligence?.timeline.length ?? 0) > 0 ? (
        <>
          <SectionHeader label={t("correspondent.timeline")} />
          {intelligence!.timeline.map((event, index) => (
            <Row
              key={`${event.title}-${index}`}
              dot="green"
              title={event.title}
              meta={event.description}
              valueMeta={event.date ? formatShortDate(event.date) : undefined}
            />
          ))}
        </>
      ) : null}

      {insurance ? (
        <>
          <SectionHeader label={t("correspondent.insurance")} />
          {insurance.latestPremiumAmount != null ? (
            <Row
              minHeight={50}
              title={t("correspondent.insurance.latestPremium")}
              value={formatCurrency(
                insurance.latestPremiumAmount,
                insurance.latestPremiumCurrency ?? "EUR",
              )}
            />
          ) : null}
          {insurance.renewalDate ? (
            <Row
              minHeight={50}
              title={t("correspondent.insurance.renewal")}
              value={formatShortDate(insurance.renewalDate)}
            />
          ) : null}
          {insurance.cancellationWindow ? (
            <Row
              minHeight={50}
              title={t("correspondent.insurance.cancellation")}
              value={insurance.cancellationWindow}
            />
          ) : null}
        </>
      ) : null}

      {(data?.documentTypeBreakdown.length ?? 0) > 0 ? (
        <>
          <SectionHeader label={t("correspondent.types")} />
          {data!.documentTypeBreakdown.map((type) => (
            <Row key={type.name} minHeight={50} title={type.name} value={String(type.count)} />
          ))}
        </>
      ) : null}

      {/* Documents, as standard rows */}
      <SectionHeader
        label={t("correspondent.documents")}
        count={documentsQuery.data?.total ?? documents.length}
      />
      {documentsQuery.isError ? (
        <View style={styles.gutter}>
          <ErrorCard
            message={t("correspondent.screen.loadDocumentsFailed")}
            onRetry={() => documentsQuery.refetch()}
          />
        </View>
      ) : null}
      {documentsQuery.data && documents.length === 0 ? (
        <EmptyState title={t("correspondent.screen.noDocumentsTitle")} />
      ) : null}
      {documents.map((document) => {
        const state = documentRowState(document);
        return (
          <Row
            key={document.id}
            minHeight={62}
            dot={
              state === "failed"
                ? "red"
                : state === "ready"
                  ? document.reviewStatus === "pending"
                    ? "amber"
                    : "green"
                  : "faint"
            }
            pulse={state === "processing" || state === "queued"}
            tone={state === "failed" ? "bad" : "default"}
            title={titleForDocument(document)}
            meta={documentMeta(document, t)}
            value={formatCurrency(document.amount, document.currency ?? "EUR")}
            valueMeta={formatShortDate(document.issueDate ?? document.createdAt)}
            onPress={() =>
              navigation.navigate("DocumentDetail", {
                documentId: document.id,
                title: titleForDocument(document),
              })
            }
          />
        );
      })}
    </Screen>
  );
}

const useStyles = createThemedStyles((c) => ({
  gutter: {
    padding: 16,
  },
  hint: {
    ...text.meta,
    color: c.muted,
  },
  statStrip: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  statCell: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 3,
  },
  statCellDivided: {
    borderRightWidth: 1,
    borderRightColor: c.borderSoft,
  },
  statValue: {
    ...text.statValue,
    color: c.ink,
  },
  statLabel: {
    ...text.small,
    color: c.faint,
  },

  /* sparkline */
  sparkline: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  sparkColumn: {
    flex: 1,
    alignItems: "center",
    gap: 6,
  },
  sparkTrack: {
    height: 56,
    width: "100%",
    justifyContent: "flex-end",
  },
  sparkBar: {
    width: "100%",
    borderRadius: radii.sm,
    backgroundColor: c.raised,
  },
  sparkBarCurrent: {
    backgroundColor: c.accent,
  },
  sparkLabel: {
    ...text.numeric,
    fontSize: 10,
    lineHeight: 13,
    color: c.faint,
  },

  /* key changes */
  changeRow: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    gap: 5,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
  },
  changeTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  changeTitle: {
    ...text.rowTitle,
    flex: 1,
    color: c.ink,
  },
  changeDate: {
    ...text.numeric,
    color: c.faint,
  },
  changeValues: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  changeBefore: {
    ...text.amount,
    color: c.faint,
    textDecorationLine: "line-through",
  },
  changeArrow: {
    ...text.small,
    color: c.dim,
  },
  changeAfter: {
    ...text.amount,
    color: c.ink,
  },
  changeAfterDown: {
    color: c.green,
  },
  changeDescription: {
    ...text.meta,
    color: c.dim,
  },

  /* prose */
  prose: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
  },
  proseLabel: {
    ...text.sectionLabel,
    color: c.dim,
  },
  proseText: {
    ...text.meta,
    color: c.ink,
  },
}));
