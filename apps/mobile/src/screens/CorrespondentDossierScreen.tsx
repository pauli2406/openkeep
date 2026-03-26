import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAuth } from "../auth";
import { DocumentProcessingIndicator } from "../components/DocumentProcessingIndicator";
import { Card, EmptyState, ErrorCard, Pill, Screen } from "../components/ui";
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
  titleForDocument,
  toneForStatus,
  type ArchiveDocument,
  type CorrespondentInsightsResponse,
  type CorrespondentIntelligence,
  type SearchDocumentsResponse,
} from "../lib";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compareIsoDates(left: string | null | undefined, right: string | null | undefined): number {
  return (left ?? "").localeCompare(right ?? "");
}

function compareDocumentsNewestFirst(left: ArchiveDocument, right: ArchiveDocument): number {
  return compareIsoDates(right.issueDate ?? right.createdAt, left.issueDate ?? left.createdAt);
}

function findCurrentStateFact(
  intelligence: CorrespondentIntelligence | null,
  label: string,
): string | null {
  return (
    intelligence?.currentState.find(
      (fact) => fact.label.toLowerCase() === label.toLowerCase(),
    )?.value ?? null
  );
}

function buildSmartHighlight(
  data: CorrespondentInsightsResponse,
  intelligence: CorrespondentIntelligence | null,
  t: ReturnType<typeof useI18n>["t"],
): { label: string; value: string } {
  const insurance = intelligence?.domainInsights.insurance;
  if (insurance?.latestPremiumAmount != null && insurance.latestPremiumCurrency) {
    return {
      label: t("correspondent.smartHighlight.latestPremium"),
      value:
        formatCurrency(insurance.latestPremiumAmount, insurance.latestPremiumCurrency),
    };
  }

  const latestAmount = findCurrentStateFact(intelligence, "Latest amount");
  if (latestAmount) {
    return { label: t("correspondent.smartHighlight.latestAmount"), value: latestAmount };
  }

  const latestDocumentType = findCurrentStateFact(intelligence, "Latest document type");
  if (latestDocumentType) {
    return { label: t("correspondent.smartHighlight.latestType"), value: latestDocumentType };
  }

  return {
    label: t("correspondent.smartHighlight.topType"),
    value: data.documentTypeBreakdown[0]?.name ?? t("correspondent.smartHighlight.na"),
  };
}

// ---------------------------------------------------------------------------
// Section: Metric Ribbon
// ---------------------------------------------------------------------------

function MetricRibbon({
  items,
}: {
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={ribbonStyles.scroll}
    >
      {items.map((item) => (
        <View key={item.label} style={ribbonStyles.metric}>
          <Text style={ribbonStyles.label}>{item.label}</Text>
          <Text style={ribbonStyles.value} numberOfLines={1}>
            {item.value}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const ribbonStyles = StyleSheet.create({
  scroll: {
    gap: 10,
  },
  metric: {
    minWidth: 120,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 20,
    padding: 16,
    gap: 6,
  },
  label: {
    fontSize: 10,
    fontWeight: "800",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  value: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.5,
  },
});

// ---------------------------------------------------------------------------
// Section: Relationship Overview
// ---------------------------------------------------------------------------

function RelationshipOverview({
  intelligence,
  intelligenceStatus,
}: {
  intelligence: CorrespondentIntelligence | null;
  intelligenceStatus: string;
}) {
  const { t } = useI18n();

  return (
    <Card>
      <Text style={sectionStyles.eyebrow}>{t("correspondent.relationship.title")}</Text>
      <View style={overviewStyles.body}>
        {intelligenceStatus === "ready" && intelligence?.overview ? (
          <>
            <Text style={overviewStyles.overviewText}>
              {intelligence.overview}
            </Text>
            {intelligence.profile ? (
              <View style={overviewStyles.chipRow}>
                <View style={overviewStyles.chip}>
                  <Text style={overviewStyles.chipText}>
                    {intelligence.profile.category ?? t("correspondent.relationship.unknownCategory")}
                  </Text>
                </View>
                {intelligence.profile.subcategory ? (
                  <View style={overviewStyles.chip}>
                    <Text style={overviewStyles.chipText}>
                      {intelligence.profile.subcategory}
                    </Text>
                  </View>
                ) : null}
                {(intelligence.profile.keySignals ?? []).map((signal) => (
                  <View key={signal} style={overviewStyles.chip}>
                    <Text style={overviewStyles.chipText}>{signal}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : intelligenceStatus === "pending" ? (
          <Text style={overviewStyles.pendingText}>{t("correspondent.relationship.pending")}</Text>
        ) : (
          <Text style={overviewStyles.pendingText}>{t("correspondent.relationship.unavailable")}</Text>
        )}
      </View>
    </Card>
  );
}

const overviewStyles = StyleSheet.create({
  body: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 18,
    padding: 16,
    gap: 14,
  },
  overviewText: {
    fontSize: 17,
    fontWeight: "700",
    lineHeight: 26,
    color: colors.text,
    letterSpacing: -0.2,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  pendingText: {
    fontSize: 14,
    color: colors.muted,
    lineHeight: 21,
  },
});

// ---------------------------------------------------------------------------
// Section: Key Changes
// ---------------------------------------------------------------------------

function KeyChanges({
  changes,
}: {
  changes: CorrespondentIntelligence["changes"];
}) {
  const { t } = useI18n();

  return (
    <Card>
      <Text style={sectionStyles.eyebrow}>{t("correspondent.keyChanges.title")}</Text>
      {changes.length > 0 ? (
        <View style={changeStyles.list}>
          {changes.map((change, index) => (
            <View key={`${change.title}-${index}`} style={changeStyles.item}>
              <View style={changeStyles.headerRow}>
                <Text style={changeStyles.title} numberOfLines={2}>
                  {change.title}
                </Text>
                <Text style={changeStyles.date}>
                  {change.effectiveDate ?? t("correspondent.keyChanges.undated")}
                </Text>
              </View>
              <Text style={changeStyles.description}>{change.description}</Text>
              {change.valueBefore || change.valueAfter ? (
                <Text style={changeStyles.transition}>
                  {change.valueBefore ?? t("correspondent.keyChanges.na")} {"\u2192"}{" "}
                  {change.valueAfter ?? t("correspondent.keyChanges.na")}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <EmptyCard label={t("correspondent.keyChanges.empty")} />
      )}
    </Card>
  );
}

const changeStyles = StyleSheet.create({
  list: {
    gap: 10,
  },
  item: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.6)",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  date: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.muted,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  description: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 19,
  },
  transition: {
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 0.2,
  },
});

// ---------------------------------------------------------------------------
// Section: Monthly Activity (mini bar chart)
// ---------------------------------------------------------------------------

function MonthlyActivity({
  data,
}: {
  data: Array<{ month: string; count: number }>;
}) {
  const { t } = useI18n();

  if (data.length === 0) {
    return null;
  }

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const BAR_MAX_HEIGHT = 48;
  let previousYear = "";

  return (
    <Card>
      <Text style={sectionStyles.eyebrow}>{t("correspondent.monthlyActivity.title")}</Text>
      <Text style={activityStyles.title}>{t("correspondent.monthlyActivity.rhythm")}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={activityStyles.chartScroll}
      >
        {data.map((point) => {
          const year = formatMonthYear(point.month);
          const showYear = year !== previousYear;
          previousYear = year;
          const barHeight = Math.max(4, (point.count / maxCount) * BAR_MAX_HEIGHT);

          return (
            <View key={point.month} style={activityStyles.barColumn}>
              {showYear ? (
                <Text style={activityStyles.yearLabel}>{year}</Text>
              ) : (
                <View style={activityStyles.yearPlaceholder} />
              )}
              <View style={activityStyles.barTrack}>
                <View
                  style={[activityStyles.bar, { height: barHeight }]}
                />
              </View>
              <Text style={activityStyles.monthLabel}>
                {formatMonthLabel(point.month)}
              </Text>
              {point.count > 0 ? (
                <Text style={activityStyles.countLabel}>{point.count}</Text>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </Card>
  );
}

const activityStyles = StyleSheet.create({
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.3,
    marginTop: -8,
  },
  chartScroll: {
    gap: 0,
    paddingTop: 4,
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
// Section: Current State
// ---------------------------------------------------------------------------

function CurrentState({
  facts,
}: {
  facts: CorrespondentIntelligence["currentState"];
}) {
  const { t } = useI18n();

  return (
    <Card>
      <Text style={sectionStyles.eyebrow}>{t("correspondent.currentState.title")}</Text>
      {facts.length > 0 ? (
        <View style={factStyles.list}>
          {facts.map((fact) => (
            <View key={`${fact.label}-${fact.value}`} style={factStyles.item}>
              <View style={factStyles.content}>
                <Text style={factStyles.label}>{fact.label}</Text>
                <Text style={factStyles.value}>{fact.value}</Text>
              </View>
              {fact.asOf ? (
                <Text style={factStyles.asOf}>{fact.asOf}</Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <EmptyCard label={t("correspondent.currentState.empty")} />
      )}
    </Card>
  );
}

const factStyles = StyleSheet.create({
  list: {
    gap: 10,
  },
  item: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.55)",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  content: {
    flex: 1,
    gap: 4,
  },
  label: {
    fontSize: 10,
    fontWeight: "800",
    color: colors.muted,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  value: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  asOf: {
    fontSize: 12,
    color: colors.muted,
  },
});

// ---------------------------------------------------------------------------
// Section: Timeline Highlights
// ---------------------------------------------------------------------------

function TimelineHighlights({
  events,
}: {
  events: CorrespondentIntelligence["timeline"];
}) {
  const { t } = useI18n();

  const sorted = [...events].sort((a, b) =>
    compareIsoDates(b.date, a.date),
  );

  return (
    <Card>
      <Text style={sectionStyles.eyebrow}>{t("correspondent.timeline.title")}</Text>
      {sorted.length > 0 ? (
        <View style={timelineStyles.list}>
          {sorted.map((event, index) => (
            <View key={`${event.title}-${index}`} style={timelineStyles.item}>
              <View style={timelineStyles.headerRow}>
                <Text style={timelineStyles.title} numberOfLines={2}>
                  {event.title}
                </Text>
                <Text style={timelineStyles.date}>
                  {event.date ?? t("correspondent.timeline.undated")}
                </Text>
              </View>
              <Text style={timelineStyles.description}>
                {event.description}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <EmptyCard label={t("correspondent.timeline.empty")} />
      )}
    </Card>
  );
}

const timelineStyles = StyleSheet.create({
  list: {
    gap: 10,
  },
  item: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.55)",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
  },
  date: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.muted,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  description: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 19,
  },
});

// ---------------------------------------------------------------------------
// Section: Insurance Lens (conditional)
// ---------------------------------------------------------------------------

function InsuranceLens({
  insurance,
}: {
  insurance: NonNullable<CorrespondentIntelligence["domainInsights"]["insurance"]>;
}) {
  const { t } = useI18n();

  return (
    <View style={insuranceStyles.wrap}>
      <Text style={sectionStyles.eyebrow}>{t("correspondent.insurance.title")}</Text>

      <View style={insuranceStyles.grid}>
        <FactPanel
          label={t("correspondent.insurance.policyReferences")}
          value={insurance.policyReferences.join(", ") || t("correspondent.insurance.na")}
        />
        <FactPanel
          label={t("correspondent.insurance.latestPremium")}
          value={
            insurance.latestPremiumAmount != null &&
            insurance.latestPremiumCurrency
              ? formatCurrency(
                  insurance.latestPremiumAmount,
                  insurance.latestPremiumCurrency,
                )
              : t("correspondent.insurance.na")
          }
        />
        <FactPanel
          label={t("correspondent.insurance.renewal")}
          value={insurance.renewalDate ?? t("correspondent.insurance.na")}
        />
        <FactPanel
          label={t("correspondent.insurance.cancellation")}
          value={insurance.cancellationWindow ?? t("correspondent.insurance.na")}
        />
      </View>

      {(insurance.coverageHighlights ?? []).length > 0 ? (
        <View style={insuranceStyles.chipRow}>
          {insurance.coverageHighlights.map((item) => (
            <View key={item} style={insuranceStyles.chip}>
              <Text style={insuranceStyles.chipText}>{item}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function FactPanel({ label, value }: { label: string; value: string }) {
  return (
    <View style={insuranceStyles.factPanel}>
      <Text style={insuranceStyles.factLabel}>{label}</Text>
      <Text style={insuranceStyles.factValue}>{value}</Text>
    </View>
  );
}

const insuranceStyles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 16,
    ...shadow,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  factPanel: {
    flex: 1,
    minWidth: "45%" as unknown as number,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.65)",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 6,
  },
  factLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: colors.muted,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  factValue: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.7)",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
});

// ---------------------------------------------------------------------------
// Section: Type Breakdown
// ---------------------------------------------------------------------------

function TypeBreakdown({
  items,
}: {
  items: Array<{ name: string; count: number }>;
}) {
  const { t } = useI18n();

  return (
    <Card>
      <Text style={sectionStyles.eyebrow}>{t("correspondent.typeBreakdown.title")}</Text>
      {items.length > 0 ? (
        <View style={typeStyles.list}>
          {items.map((item) => (
            <View key={item.name} style={typeStyles.item}>
              <Text style={typeStyles.name}>{item.name}</Text>
              <Text style={typeStyles.count}>{item.count}</Text>
            </View>
          ))}
        </View>
      ) : (
        <EmptyCard label={t("correspondent.typeBreakdown.empty")} />
      )}
    </Card>
  );
}

const typeStyles = StyleSheet.create({
  list: {
    gap: 10,
  },
  item: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.55)",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  name: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  count: {
    fontSize: 14,
    color: colors.muted,
  },
});

// ---------------------------------------------------------------------------
// Section: Legacy Summary
// ---------------------------------------------------------------------------

function LegacySummary({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <Card>
      <Text style={sectionStyles.eyebrow}>{t("correspondent.legacySummary.title")}</Text>
      <View style={summaryStyles.body}>
        <Text style={summaryStyles.text}>{text}</Text>
      </View>
    </Card>
  );
}

const summaryStyles = StyleSheet.create({
  body: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.55)",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  text: {
    fontSize: 14,
    color: colors.muted,
    lineHeight: 22,
  },
});

// ---------------------------------------------------------------------------
// Section: Documents list
// ---------------------------------------------------------------------------

function DocumentCard({
  document,
  onOpen,
}: {
  document: ArchiveDocument;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [pressed ? docStyles.pressed : null]}
    >
      <Card style={docStyles.card}>
        <View style={docStyles.topRow}>
          <Text style={docStyles.meta}>
            {document.documentType?.name ?? t("correspondent.documentCard.document")}
          </Text>
          <Pill label={formatCorrespondentDocumentStatus(t, document.status)} tone={toneForStatus(document.status)} />
        </View>
        <Text numberOfLines={2} style={docStyles.title}>
          {titleForDocument(document)}
        </Text>
        <DocumentProcessingIndicator document={document} />
        <View style={docStyles.footerRow}>
          <Text style={docStyles.detail}>
            {formatDate(document.issueDate)} {"\u00b7"}{" "}
            {formatCurrency(document.amount, document.currency ?? "EUR")}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
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
// Small helpers
// ---------------------------------------------------------------------------

function EmptyCard({ label }: { label: string }) {
  return (
    <View style={emptyCardStyles.wrap}>
      <Text style={emptyCardStyles.text}>{label}</Text>
    </View>
  );
}

function formatCorrespondentDocumentStatus(
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

const emptyCardStyles = StyleSheet.create({
  wrap: {
    minHeight: 80,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
  },
  text: {
    fontSize: 14,
    color: colors.muted,
  },
});

// ---------------------------------------------------------------------------
// Shared section styles
// ---------------------------------------------------------------------------

const sectionStyles = StyleSheet.create({
  eyebrow: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
});

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

type Props = NativeStackScreenProps<AppStackParamList, "CorrespondentDossier">;

export function CorrespondentDossierScreen() {
  const route = useRoute<Props["route"]>();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();

  const { slug, name } = route.params;
  if (offline.shouldUseOffline) {
    return (
      <Screen
        title={name}
        headerVariant="compact"
        includeTopSafeArea={false}
        contentContainerStyle={styles.content}
      >
        <Card>
          <Text style={styles.loadingText}>
            {t("correspondent.screen.offlineOnly")}
          </Text>
        </Card>
      </Screen>
    );
  }

  // ── Primary query: insights (polls every 4s while pending) ──
  const insightsQuery = useQuery({
    queryKey: ["correspondent", slug, "insights", auth.apiUrl],
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
      return current?.summaryStatus === "pending" ||
        current?.intelligenceStatus === "pending"
        ? 4_000
        : false;
    },
  });

  // ── Secondary query: documents (enabled once we have the correspondent ID) ──
  const correspondentId = insightsQuery.data?.correspondent.id;
  const documentsQuery = useQuery({
    queryKey: [
      "correspondent",
      slug,
      "documents",
      correspondentId,
      auth.apiUrl,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        correspondentIds: correspondentId!,
        page: "1",
        pageSize: "20",
        sort: "issueDate",
        direction: "desc",
      });
      const response = await auth.authFetch(
        `/api/documents?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error(t("correspondent.screen.loadDocumentsFailed"));
      }
      return (await response.json()) as SearchDocumentsResponse;
    },
    enabled: Boolean(correspondentId),
    refetchInterval: (query) => processingRefetchInterval(query.state.data, (data) => data?.items),
  });

  // ── Loading state ──
  if (insightsQuery.isLoading) {
    return (
      <Screen
        title={name}
        headerVariant="compact"
        includeTopSafeArea={false}
        contentContainerStyle={styles.content}
      >
        <Card>
          <Text style={styles.loadingText}>
            {t("correspondent.screen.loadDossier")}
          </Text>
        </Card>
      </Screen>
    );
  }

  // ── Error state ──
  if (insightsQuery.isError || !insightsQuery.data) {
    return (
      <Screen
        title={name}
        headerVariant="compact"
        includeTopSafeArea={false}
        contentContainerStyle={styles.content}
      >
        <ErrorCard
          message={t("correspondent.screen.loadInsights")}
          onRetry={() => insightsQuery.refetch()}
        />
      </Screen>
    );
  }

  // ── Data ready ──
  const data = insightsQuery.data;
  const intelligence = data.intelligence;
  const intelligenceStatus = data.intelligenceStatus;
  const smartHighlight = buildSmartHighlight(data, intelligence, t);

  const orderedDocuments = [
    ...(documentsQuery.data?.items ?? []),
  ].sort(compareDocumentsNewestFirst);

  const summaryText =
    data.summary ??
    intelligence?.profile?.narrative ??
    t("correspondent.screen.noSummary");

  return (
    <Screen
      title={name}
      subtitle={t("correspondent.screen.subtitle")}
      headerVariant="compact"
      includeTopSafeArea={false}
      contentContainerStyle={styles.content}
    >
      {/* ── Metric ribbon ── */}
      <MetricRibbon
        items={[
          {
              label: t("correspondent.screen.metricDocuments"),
            value: data.stats.documentCount.toLocaleString(),
          },
          smartHighlight,
          {
              label: t("correspondent.screen.metricLastDocument"),
              value: data.stats.dateRange.to ?? t("correspondent.screen.undated"),
            },
            {
              label: t("correspondent.screen.metricChanges"),
              value: String(intelligence?.changes.length ?? 0),
            },
        ]}
      />

      {/* ── Relationship overview ── */}
      <RelationshipOverview
        intelligence={intelligence}
        intelligenceStatus={intelligenceStatus}
      />

      {/* ── Key changes ── */}
      <KeyChanges changes={intelligence?.changes ?? []} />

      {/* ── Monthly activity ── */}
      {data.timeline.length > 0 ? (
        <MonthlyActivity data={data.timeline} />
      ) : null}

      {/* ── Current state ── */}
      <CurrentState facts={intelligence?.currentState ?? []} />

      {/* ── Timeline highlights ── */}
      <TimelineHighlights events={intelligence?.timeline ?? []} />

      {/* ── Insurance lens (conditional) ── */}
      {intelligence?.domainInsights.insurance ? (
        <InsuranceLens insurance={intelligence.domainInsights.insurance} />
      ) : null}

      {/* ── Type breakdown ── */}
      <TypeBreakdown items={data.documentTypeBreakdown} />

      {/* ── Legacy summary ── */}
      <LegacySummary text={summaryText} />

      {/* ── Documents ── */}
      <View style={styles.documentsSection}>
        <View style={styles.documentsSectionHeader}>
          <Text style={sectionStyles.eyebrow}>{t("correspondent.screen.documents")}</Text>
          <Text style={styles.documentsTitle}>
            {`${t("correspondent.screen.documentsFrom")} ${data.correspondent.name}`}
          </Text>
        </View>

        {documentsQuery.isLoading ? (
          <Card>
            <Text style={styles.loadingText}>
              {t("correspondent.screen.loadingDocuments")}
            </Text>
          </Card>
        ) : documentsQuery.isError ? (
          <ErrorCard
            message={t("correspondent.screen.loadDocumentsFailed")}
            onRetry={() => documentsQuery.refetch()}
          />
        ) : orderedDocuments.length === 0 ? (
          <EmptyState
            title={t("correspondent.screen.noDocumentsTitle")}
            body={t("correspondent.screen.noDocumentsBody")}
          />
        ) : (
          orderedDocuments.map((document) => (
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
  documentsSection: {
    gap: 14,
  },
  documentsSectionHeader: {
    gap: 6,
  },
  documentsTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.3,
  },
});
