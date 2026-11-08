import { useNavigation, useRoute } from "@react-navigation/native";
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { AppStackParamList } from "../../App";
import { formatRowDate, setCorrespondentCategory, smartHighlight } from "../api/documents";
import { useAuth } from "../auth";
import { GradientPanel, Skeleton } from "../components/layout";
import { Button, EmptyState, ErrorCard, Notice, Panel, Pill, Screen } from "../components/ui";
import { processingRefetchInterval } from "../document-processing";
import { useI18n, type TranslationKey } from "../i18n";
import {
  fetchTaxonomy,
  formatCurrency,
  formatMonthLabel,
  taxonomyQueryKey,
  titleForDocument,
  type CorrespondentInsightsResponse,
  type CorrespondentIntelligenceChange,
  type CorrespondentTimelinePoint,
  type DocumentFilters,
  type SearchDocumentsResponse,
} from "../lib";
import { useOfflineArchive } from "../offline-archive";
import { createThemedStyles, radii, useColors } from "../theme";
import { tabular, text } from "../typography";
import { CardList, DocumentRow, Meter } from "./documents/parts";
import { CategorySheet } from "./documents/PickerSheets";

type Props = NativeStackScreenProps<AppStackParamList, "CorrespondentDossier">;

/** A titled card; its body sets its own padding. */
function Section({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Panel style={styles.section}>
      <View style={styles.sectionHead}>
        {icon ? (
          <MaterialCommunityIcons name={icon as never} size={17} color={colors.accent} />
        ) : null}
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {title}
        </Text>
        {action}
      </View>
      {children}
    </Panel>
  );
}

function EmptyNote({ label }: { label: string }) {
  const styles = useStyles();
  return <Text style={styles.emptyNote}>{label}</Text>;
}

/** A figure on a small card; the dossier's one highlight carries the accent. */
function StatCard({
  label,
  value,
  icon,
  highlight = false,
}: {
  label: string;
  value: string;
  icon?: string;
  highlight?: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Panel style={[styles.stat, highlight ? styles.statHighlight : null]}>
      <View style={styles.statHead}>
        <Text style={styles.statLabel} numberOfLines={1}>
          {label}
        </Text>
        {icon ? (
          <MaterialCommunityIcons name={icon as never} size={16} color={colors.muted} />
        ) : null}
      </View>
      <Text
        style={[styles.statValue, highlight ? styles.statValueHighlight : null]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {value}
      </Text>
    </Panel>
  );
}

/** Twelve months of activity, the current one in the action gradient's blue. */
function ActivitySparkline({ points }: { points: CorrespondentTimelinePoint[] }) {
  const styles = useStyles();
  const recent = points.slice(-12);
  const peak = Math.max(1, ...recent.map((point) => point.count));

  return (
    <View style={styles.sparkline}>
      {recent.map((point, index) => (
        <View key={point.month} style={styles.sparkColumn}>
          <View style={styles.sparkTrack}>
            <View
              style={[
                styles.sparkBar,
                index === recent.length - 1 ? styles.sparkBarCurrent : null,
                { height: Math.max(4, Math.round((point.count / peak) * 72)) },
              ]}
            />
          </View>
          <Text style={styles.sparkLabel} numberOfLines={1}>
            {formatMonthLabel(point.month).slice(0, 1)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ChangeRow({
  change,
  last,
}: {
  change: CorrespondentIntelligenceChange;
  last: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const notAvailable = t("dossier.notAvailable");

  return (
    <View style={[styles.changeRow, last ? null : styles.rule]}>
      <View style={styles.changeTop}>
        <Text style={styles.changeTitle}>{change.title}</Text>
        <Text style={styles.changeDate}>
          {change.effectiveDate ? formatRowDate(change.effectiveDate) : t("dossier.undated")}
        </Text>
      </View>
      <Text style={styles.changeDescription}>{change.description}</Text>
      {change.valueBefore || change.valueAfter ? (
        <View style={styles.changeValues}>
          <Pill label={change.valueBefore ?? notAvailable} tone="outline" />
          <MaterialCommunityIcons name="arrow-right" size={14} color={colors.muted} />
          <Pill label={change.valueAfter ?? notAvailable} tone="soft" />
        </View>
      ) : null}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function DossierSkeleton() {
  const styles = useStyles();
  return (
    <>
      <Skeleton style={styles.skeletonHero} />
      <View style={styles.stats}>
        {[0, 1, 2, 3].map((card) => (
          <Skeleton key={card} style={styles.skeletonStat} />
        ))}
      </View>
      <Skeleton style={styles.skeletonSection} />
      <Skeleton style={styles.skeletonSection} />
    </>
  );
}

const HIGHLIGHT_LABELS: Record<ReturnType<typeof smartHighlight>["kind"], TranslationKey> = {
  latestPremium: "dossier.latestPremium",
  latestAmount: "dossier.latestAmount",
  latestType: "dossier.latestType",
  topType: "dossier.topType",
};

export function CorrespondentDossierScreen() {
  const styles = useStyles();
  const colors = useColors();
  const route = useRoute<Props["route"]>();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const queryClient = useQueryClient();
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();
  const shouldUseCache = offline.shouldUseCache || auth.isOfflineSession;
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);

  const { slug, name } = route.params;

  const insightsQuery = useQuery({
    queryKey: ["correspondent", slug, "insights", auth.apiUrl, shouldUseCache],
    enabled: !shouldUseCache,
    queryFn: async () => {
      const response = await auth.authFetch(
        `/api/correspondents/${encodeURIComponent(slug)}/insights`,
      );
      if (!response.ok) {
        throw new Error(t("dossier.loadError"));
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
      offline.cacheSummary.revision,
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
        throw new Error(t("dossier.documentsError"));
      }
      return (await response.json()) as SearchDocumentsResponse;
    },
    enabled: shouldUseCache || Boolean(correspondentId),
    refetchInterval: shouldUseCache
      ? false
      : (query) => processingRefetchInterval(query.state.data, (data) => data?.items),
  });

  const categoriesQuery = useQuery({
    queryKey: taxonomyQueryKey(auth.apiUrl, "categories"),
    enabled: !shouldUseCache,
    queryFn: () => fetchTaxonomy(auth.authFetch, "categories", t("dossier.categoryFailed")),
  });

  const setCategoryMutation = useMutation({
    mutationFn: async (categoryId: string | null) => {
      const correspondent = insightsQuery.data?.correspondent;
      if (!correspondent) throw new Error(t("dossier.categoryFailed"));
      await setCorrespondentCategory(auth.authFetch, correspondent, categoryId);
    },
    onSuccess: async () => {
      setCategorySheetOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["correspondent", slug] }),
        queryClient.invalidateQueries({ queryKey: ["document-facets"] }),
        queryClient.invalidateQueries({ queryKey: ["taxonomies"] }),
      ]);
    },
    onError: () => setCategorySheetOpen(false),
  });

  const data = insightsQuery.data ?? null;
  const intelligence = data?.intelligence ?? null;
  const insurance = intelligence?.domainInsights.insurance;
  const displayName = data?.correspondent.name ?? name;

  /**
   * Neither source arrives in the order this list needs: the API sorts on
   * `issueDate` alone, which puts undated documents first in a `DESC` sort, and
   * the cache returns rows by when they were last viewed. Sort on the date the
   * row actually shows.
   */
  const documents = [...(documentsQuery.data?.items ?? [])].sort((a, b) => {
    const left = a.issueDate ?? a.createdAt;
    const right = b.issueDate ?? b.createdAt;
    return right.localeCompare(left);
  });

  // Offline the insights never load, so the correspondent's id comes off a document.
  const filterId = correspondentId ?? documents[0]?.correspondent?.id;

  function openInDocuments() {
    if (!filterId) return;
    const applyFilters: DocumentFilters = { correspondentIds: [filterId] };
    navigation.popTo("Home", { screen: "Documents", params: { applyFilters } } as never);
  }

  const openInDocumentsButton = filterId ? (
    <Button
      label={t("dossier.openInDocuments")}
      variant="secondary"
      size="sm"
      onPress={openInDocuments}
    />
  ) : null;

  const documentsSection = (
    <Section
      title={t("dossier.documentsFrom").replace("{name}", displayName)}
      action={openInDocumentsButton}
    >
      <View style={styles.sectionRuled}>
        {documentsQuery.isLoading ? (
          <View style={styles.sectionLoading}>
            <Skeleton style={styles.skeletonLine} />
            <Skeleton style={styles.skeletonLine} />
            <Skeleton style={styles.skeletonLine} />
          </View>
        ) : documentsQuery.isError ? (
          <View style={styles.sectionLoading}>
            <Text style={styles.errorText}>{t("dossier.documentsError")}</Text>
            <Button
              label={t("common.retry")}
              variant="secondary"
              size="sm"
              onPress={() => documentsQuery.refetch()}
            />
          </View>
        ) : documents.length === 0 ? (
          <EmptyState icon="file-search-outline" title={t("correspondent.screen.noDocumentsTitle")} />
        ) : (
          <CardList>
            {documents.map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                onPress={() =>
                  navigation.navigate("DocumentDetail", {
                    documentId: document.id,
                    title: titleForDocument(document),
                  })
                }
              />
            ))}
          </CardList>
        )}
      </View>
    </Section>
  );

  const newestDocument = documents[0]?.issueDate ?? documents[0]?.createdAt;

  const screenFrame = (children: ReactNode) => (
    <Screen
      title={t("correspondents.title")}
      onBack={() => navigation.goBack()}
      notice={shouldUseCache ? <Notice label={t("state.offline")} /> : undefined}
    >
      {children}
    </Screen>
  );

  if (shouldUseCache) {
    return screenFrame(
      <>
        <GradientPanel>
          <Text style={styles.heroTitle} accessibilityRole="header">
            {displayName}
          </Text>
          <Text style={styles.heroBody}>{t("dossier.offlineBody")}</Text>
        </GradientPanel>
        <View style={styles.stats}>
          <StatCard
            label={t("dossier.metricDocuments")}
            value={(documentsQuery.data?.total ?? documents.length).toLocaleString()}
            icon="file-multiple-outline"
          />
          <StatCard
            label={t("dossier.metricLastDocument")}
            value={newestDocument ? formatRowDate(newestDocument) : t("dossier.undated")}
            icon="calendar-clock-outline"
          />
        </View>
        {documentsSection}
      </>,
    );
  }

  if (insightsQuery.isLoading) {
    return screenFrame(<DossierSkeleton />);
  }

  if (insightsQuery.isError || !data) {
    return screenFrame(
      <ErrorCard message={t("dossier.loadError")} onRetry={() => insightsQuery.refetch()} />,
    );
  }

  const highlight = smartHighlight(data);
  const notAvailable = t("dossier.notAvailable");
  const categoryId = data.correspondent.categoryId ?? null;
  const categoryName =
    (categoriesQuery.data ?? []).find((category) => category.id === categoryId)?.name ??
    data.correspondent.categoryName ??
    t("dossier.categoryNone");
  const changes = intelligence?.changes ?? [];
  const currentState = intelligence?.currentState ?? [];
  const milestones = [...(intelligence?.timeline ?? [])].sort((left, right) =>
    (right.date ?? "").localeCompare(left.date ?? ""),
  );
  const maxTypeCount = Math.max(...data.documentTypeBreakdown.map((item) => item.count), 1);

  return screenFrame(
    <>
      <GradientPanel>
        <Text style={styles.heroTitle} accessibilityRole="header">
          {displayName}
        </Text>
        <Text style={styles.heroBody}>{t("dossier.description")}</Text>

        <View style={styles.categoryBlock}>
          <View style={styles.categoryHead}>
            <Text style={styles.categoryLabel}>{t("dossier.category")}</Text>
            {categoryId ? (
              <Text style={styles.categorySource} numberOfLines={1}>
                {data.correspondent.categorySource === "manual"
                  ? t("dossier.categorySetByYou")
                  : t("dossier.categoryAutomatic")}
              </Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t("dossier.category")}: ${categoryName}`}
            accessibilityState={{ busy: setCategoryMutation.isPending }}
            disabled={setCategoryMutation.isPending}
            onPress={() => setCategorySheetOpen(true)}
            style={({ pressed }) => [
              styles.categoryTrigger,
              pressed ? styles.categoryTriggerPressed : null,
            ]}
          >
            <Text style={styles.categoryValue} numberOfLines={1}>
              {categoryName}
            </Text>
            {setCategoryMutation.isPending ? (
              <ActivityIndicator size="small" color={colors.onGradient} />
            ) : (
              <MaterialCommunityIcons name="chevron-down" size={18} color={colors.onGradientMuted} />
            )}
          </Pressable>
          {setCategoryMutation.isError ? (
            <View style={styles.categoryError}>
              <Pill label={t("dossier.categoryFailed")} tone="bad" />
            </View>
          ) : null}
        </View>
      </GradientPanel>

      <View style={styles.stats}>
        <StatCard
          label={t("dossier.metricDocuments")}
          value={data.stats.documentCount.toLocaleString()}
          icon="file-multiple-outline"
        />
        <StatCard
          highlight
          label={t(HIGHLIGHT_LABELS[highlight.kind])}
          value={
            highlight.amount
              ? formatCurrency(highlight.amount.value, highlight.amount.currency)
              : (highlight.value ?? notAvailable)
          }
        />
        <StatCard
          label={t("dossier.metricLastDocument")}
          value={
            data.stats.dateRange.to ? formatRowDate(data.stats.dateRange.to) : t("dossier.undated")
          }
          icon="calendar-clock-outline"
        />
        <StatCard
          label={t("dossier.metricChanges")}
          value={String(changes.length)}
          icon="swap-horizontal"
        />
      </View>

      <Section title={t("dossier.overview")} icon="creation-outline">
        <View style={styles.sectionBody}>
          {data.intelligenceStatus === "ready" && intelligence?.overview ? (
            <>
              <Text style={styles.prose}>{intelligence.overview}</Text>
              {intelligence.profile ? (
                <View style={styles.badges}>
                  <Pill
                    label={intelligence.profile.category ?? t("dossier.unknownCategory")}
                    tone="soft"
                  />
                  {intelligence.profile.subcategory ? (
                    <Pill label={intelligence.profile.subcategory} tone="outline" />
                  ) : null}
                  {(intelligence.profile.keySignals ?? []).map((signal) => (
                    <Pill key={signal} label={signal} tone="outline" />
                  ))}
                </View>
              ) : null}
            </>
          ) : data.intelligenceStatus === "pending" ? (
            <View style={styles.generating}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.muted}>{t("dossier.generating")}</Text>
            </View>
          ) : (
            <Text style={styles.muted}>{t("dossier.noProvider")}</Text>
          )}
        </View>
      </Section>

      <Section title={t("correspondent.keyChanges")}>
        <View style={styles.sectionRuled}>
          {changes.length > 0 ? (
            changes.map((change, index) => (
              <ChangeRow
                key={`${change.title}-${index}`}
                change={change}
                last={index === changes.length - 1}
              />
            ))
          ) : (
            <EmptyNote label={t("dossier.noChanges")} />
          )}
        </View>
      </Section>

      {insurance ? (
        <Section title={t("dossier.insurance")}>
          <View style={styles.sectionBody}>
            <Fact
              label={t("dossier.policyReferences")}
              value={insurance.policyReferences.join(", ") || notAvailable}
            />
            <Fact
              label={t("dossier.latestPremium")}
              value={
                insurance.latestPremiumAmount != null && insurance.latestPremiumCurrency
                  ? formatCurrency(insurance.latestPremiumAmount, insurance.latestPremiumCurrency)
                  : notAvailable
              }
            />
            {insurance.premiumChangeSummary ? (
              <Fact
                label={t("correspondent.insurance.premiumChange")}
                value={insurance.premiumChangeSummary}
              />
            ) : null}
            <Fact
              label={t("dossier.renewal")}
              value={insurance.renewalDate ? formatRowDate(insurance.renewalDate) : notAvailable}
            />
            <Fact
              label={t("dossier.cancellation")}
              value={insurance.cancellationWindow ?? notAvailable}
            />
            {insurance.coverageHighlights.length > 0 ? (
              <View style={styles.badges}>
                {insurance.coverageHighlights.map((item) => (
                  <Pill key={item} label={item} tone="outline" />
                ))}
              </View>
            ) : null}
          </View>
        </Section>
      ) : null}

      {documentsSection}

      <Section title={t("dossier.activity")}>
        {data.timeline.length > 0 ? (
          <ActivitySparkline points={data.timeline} />
        ) : (
          <EmptyNote label={t("dossier.noTimeline")} />
        )}
      </Section>

      <Section title={t("dossier.currentState")}>
        <View style={styles.sectionRuled}>
          {currentState.length > 0 ? (
            currentState.map((fact, index) => (
              <View
                key={`${fact.label}-${fact.value}`}
                style={[styles.stateRow, index === currentState.length - 1 ? null : styles.rule]}
              >
                <View style={styles.stateBody}>
                  <Text style={styles.factLabel}>{fact.label}</Text>
                  <Text style={styles.factValue}>{fact.value}</Text>
                </View>
                {fact.asOf ? <Text style={styles.changeDate}>{formatRowDate(fact.asOf)}</Text> : null}
              </View>
            ))
          ) : (
            <EmptyNote label={t("dossier.noCurrentState")} />
          )}
        </View>
      </Section>

      <Section title={t("dossier.timeline")}>
        {milestones.length > 0 ? (
          <View style={styles.milestones}>
            {milestones.map((event, index) => (
              <View key={`${event.title}-${index}`} style={styles.milestone}>
                {index < milestones.length - 1 ? <View style={styles.milestoneRail} /> : null}
                <View style={styles.milestoneDot} />
                <Text style={styles.changeDate}>
                  {event.date ? formatRowDate(event.date) : t("dossier.undated")}
                </Text>
                <Text style={styles.milestoneTitle}>{event.title}</Text>
                <Text style={styles.muted}>{event.description}</Text>
              </View>
            ))}
          </View>
        ) : (
          <EmptyNote label={t("dossier.noTimeline")} />
        )}
      </Section>

      <Section title={t("dossier.typeBreakdown")}>
        {data.documentTypeBreakdown.length > 0 ? (
          <View style={styles.sectionBody}>
            {data.documentTypeBreakdown.map((item) => (
              <View key={item.name} style={styles.type}>
                <View style={styles.typeHead}>
                  <Text style={styles.typeName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.typeCount}>{item.count}</Text>
                </View>
                <Meter share={item.count / maxTypeCount} />
              </View>
            ))}
          </View>
        ) : (
          <EmptyNote label={t("dossier.noTypes")} />
        )}
      </Section>

      <Section title={t("dossier.summary")}>
        <View style={styles.sectionBody}>
          <Text style={styles.muted}>
            {data.summary ?? intelligence?.profile?.narrative ?? t("dossier.noSummary")}
          </Text>
        </View>
      </Section>

      <CategorySheet
        visible={categorySheetOpen}
        onClose={() => setCategorySheetOpen(false)}
        title={t("dossier.category")}
        noneLabel={t("dossier.categoryNone")}
        categories={categoriesQuery.data}
        loading={categoriesQuery.isLoading}
        error={categoriesQuery.isError}
        selectedId={categoryId}
        busy={setCategoryMutation.isPending}
        onSelect={(next) => {
          if (next === categoryId) {
            setCategorySheetOpen(false);
          } else {
            setCategoryMutation.mutate(next);
          }
        }}
        onRetry={() => categoriesQuery.refetch()}
      />
    </>,
  );
}

const useStyles = createThemedStyles((c) => ({
  heroTitle: {
    ...text.screenTitle,
    color: c.onGradient,
  },
  heroBody: {
    ...text.body,
    marginTop: 6,
    color: c.onGradientMuted,
  },
  categoryBlock: {
    gap: 6,
    marginTop: 16,
  },
  categoryHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
  },
  categoryLabel: {
    ...text.metaStrong,
    color: c.onGradientMuted,
  },
  categorySource: {
    ...text.small,
    flexShrink: 1,
    color: c.onGradientMuted,
  },
  categoryTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: radii.lg,
    backgroundColor: c.tile,
  },
  categoryTriggerPressed: {
    opacity: 0.8,
  },
  categoryValue: {
    ...text.bodyStrong,
    flex: 1,
    minWidth: 0,
    color: c.onGradient,
  },
  categoryError: {
    alignItems: "flex-start",
  },
  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  stat: {
    flexGrow: 1,
    flexBasis: "45%",
    minWidth: 0,
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  statHighlight: {
    backgroundColor: c.accentSoft,
  },
  statHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    minHeight: 16,
  },
  statLabel: {
    ...text.metaStrong,
    flex: 1,
    minWidth: 0,
    color: c.muted,
  },
  statValue: {
    ...text.barTitle,
    ...tabular,
    fontSize: 20,
    lineHeight: 26,
    color: c.ink,
  },
  statValueHighlight: {
    color: c.accent,
  },
  section: {
    overflow: "hidden",
  },
  sectionHead: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sectionTitle: {
    ...text.bodyStrong,
    flexShrink: 1,
    flexGrow: 1,
    color: c.ink,
  },
  sectionBody: {
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  sectionRuled: {
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  sectionLoading: {
    gap: 12,
    padding: 16,
  },
  errorText: {
    ...text.meta,
    color: c.red,
  },
  emptyNote: {
    ...text.body,
    paddingHorizontal: 16,
    paddingVertical: 24,
    textAlign: "center",
    color: c.muted,
  },
  prose: {
    ...text.body,
    color: c.ink,
  },
  muted: {
    ...text.body,
    flexShrink: 1,
    color: c.muted,
  },
  generating: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  rule: {
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  changeRow: {
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  changeTop: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
  },
  changeTitle: {
    ...text.rowTitle,
    flex: 1,
    color: c.ink,
  },
  changeDate: {
    ...text.numeric,
    color: c.muted,
  },
  changeDescription: {
    ...text.body,
    color: c.muted,
  },
  changeValues: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  fact: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.md,
    backgroundColor: c.bar,
  },
  factLabel: {
    ...text.small,
    color: c.muted,
  },
  factValue: {
    ...text.bodyStrong,
    marginTop: 2,
    color: c.ink,
  },
  sparkline: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  sparkColumn: {
    flex: 1,
    alignItems: "center",
    gap: 6,
  },
  sparkTrack: {
    height: 72,
    width: "100%",
    justifyContent: "flex-end",
  },
  sparkBar: {
    width: "100%",
    borderRadius: radii.sm,
    backgroundColor: c.accentSoft,
  },
  sparkBarCurrent: {
    backgroundColor: c.accent,
  },
  sparkLabel: {
    ...text.numeric,
    color: c.muted,
  },
  stateRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  stateBody: {
    flex: 1,
    minWidth: 0,
  },
  milestones: {
    gap: 16,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  milestone: {
    gap: 2,
    paddingLeft: 20,
  },
  milestoneRail: {
    position: "absolute",
    top: 8,
    bottom: -22,
    left: 3.5,
    width: 1,
    backgroundColor: c.border,
  },
  milestoneDot: {
    position: "absolute",
    top: 5,
    left: 0,
    width: 8,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: c.accent,
  },
  milestoneTitle: {
    ...text.rowTitle,
    color: c.ink,
  },
  type: {
    gap: 6,
  },
  typeHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
  },
  typeName: {
    ...text.body,
    flex: 1,
    minWidth: 0,
    color: c.ink,
  },
  typeCount: {
    ...text.amount,
    color: c.ink,
  },
  skeletonHero: {
    height: 176,
    borderRadius: radii.xxl,
  },
  skeletonStat: {
    flexGrow: 1,
    flexBasis: "45%",
    height: 76,
    borderRadius: radii.xl,
  },
  skeletonSection: {
    height: 200,
    borderRadius: radii.xl,
  },
  skeletonLine: {
    height: 14,
  },
}));
