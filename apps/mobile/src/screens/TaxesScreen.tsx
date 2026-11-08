import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Sharing from "expo-sharing";
import {
  availableTaxYears,
  defaultTaxYear,
  documentsFilterForGroup,
  downloadTaxYearExport,
  fetchTaxFacets,
  fetchTaxYear,
  formatIssueDate,
  formatTaxTotal,
  type TaxYearDocument,
  type TaxYearGroup,
  type TaxYearMembership,
  type TaxYearResponse,
} from "../api/taxes";
import { useAuth } from "../auth";
import { fill } from "../components/chat/conversations";
import {
  BottomSheet,
  Gradient,
  GradientPanel,
  IconTile,
  Skeleton,
} from "../components/layout";
import { Button, EmptyState, ErrorCard, Notice, Panel, Pill, Screen } from "../components/ui";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import type { AppStackParamList } from "../../App";
import { createThemedStyles, radii, useColors } from "../theme";
import { text } from "../typography";
import { formatCurrency } from "../lib";

export function TaxesScreen() {
  const styles = useStyles();
  const colors = useColors();
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();
  const shouldUseCache = offline.shouldUseCache || auth.isOfflineSession;

  const [year, setYear] = useState(() => defaultTaxYear());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [exportState, setExportState] = useState<"idle" | "running" | "failed">("idle");

  const taxYearQuery = useQuery({
    queryKey: ["taxes", auth.apiUrl, year],
    queryFn: () => fetchTaxYear(auth.authFetch, year),
    enabled: !shouldUseCache,
  });

  // The tab stays mounted, so a document edited or deleted elsewhere would leave
  // stale totals here. Coming back to the screen fetches the report again.
  const refetchTaxYear = taxYearQuery.refetch;
  useFocusEffect(
    useCallback(() => {
      if (!shouldUseCache) void refetchTaxYear();
    }, [refetchTaxYear, shouldUseCache]),
  );

  // Only offer years that actually hold documents, plus the one in view.
  const facetsQuery = useQuery({
    queryKey: ["search", "facets", auth.apiUrl],
    queryFn: () => fetchTaxFacets(auth.authFetch),
    staleTime: 5 * 60 * 1000,
    enabled: !shouldUseCache,
  });
  const years = useMemo(
    () => availableTaxYears(year, facetsQuery.data?.years),
    [facetsQuery.data, year],
  );

  const data = taxYearQuery.data;

  const runExport = async () => {
    setExportState("running");
    try {
      const file = await downloadTaxYearExport(auth.authFetch, year);
      setExportState("idle");
      await Sharing.shareAsync(file, {
        mimeType: "application/zip",
        UTI: "public.zip-archive",
        dialogTitle: t("taxes.export"),
      });
    } catch {
      setExportState("failed");
    }
  };

  if (shouldUseCache) {
    return (
      <Screen
        title={t("tabs.taxes")}
        padded={false}
        notice={<Notice label={t("state.offlineReadOnly")} />}
      >
        <EmptyState
          icon="bank-outline"
          title={t("taxes.offlineTitle")}
          body={t("taxes.offlineBody")}
        />
      </Screen>
    );
  }

  return (
    <Screen title={fill(t("taxes.title"), { year })} hideHeader>
      <View style={styles.heading}>
        <View style={styles.titleRow}>
          <IconTile>
            <MaterialCommunityIcons name="bank-outline" size={18} color={colors.accentSoftInk} />
          </IconTile>
          <Text accessibilityRole="header" style={styles.title} numberOfLines={2}>
            {fill(t("taxes.title"), { year })}
          </Text>
        </View>
        <View style={styles.actions}>
          <Button
            label={exportState === "running" ? t("taxes.exporting") : t("taxes.export")}
            icon="tray-arrow-down"
            variant="secondary"
            size="sm"
            loading={exportState === "running"}
            disabled={!data || data.documentCount === 0}
            onPress={() => void runExport()}
          />
          <View style={styles.spacer} />
          <Text style={styles.yearLabel}>{t("taxes.yearPicker")}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t("taxes.pickYear")}: ${year}`}
            onPress={() => setPickerOpen(true)}
            hitSlop={{ top: 6, bottom: 6 }}
            style={styles.yearButton}
          >
            <Text style={styles.yearValue}>{year}</Text>
            <MaterialCommunityIcons name="chevron-down" size={16} color={colors.muted} />
          </Pressable>
        </View>
        {exportState === "failed" ? (
          <Text accessibilityRole="alert" style={styles.exportFailed}>
            {t("taxes.exportFailed")}
          </Text>
        ) : null}
        <Text style={styles.description}>{t("taxes.description")}</Text>
      </View>

      {taxYearQuery.isLoading ? (
        <TaxesSkeleton label={t("taxes.loading")} />
      ) : taxYearQuery.isError || !data ? (
        <ErrorCard message={t("taxes.error")} onRetry={() => void taxYearQuery.refetch()} />
      ) : data.documentCount === 0 ? (
        <Gradient name="wash" borderRadius={radii.xl} style={styles.empty}>
          <IconTile size="lg" tone="solid">
            <MaterialCommunityIcons name="receipt-text-outline" size={22} color={colors.onGradient} />
          </IconTile>
          <Text style={styles.emptyText}>{fill(t("taxes.empty"), { year })}</Text>
        </Gradient>
      ) : (
        <>
          <YearSummary data={data} />
          <View style={styles.groups}>
            <Text accessibilityRole="header" style={styles.groupsHeading}>
              {t("taxes.groupsHeading")}
            </Text>
            {data.groups.map((group) => (
              <TaxGroupCard key={group.documentTypeId ?? "unfiled"} group={group} year={year} />
            ))}
          </View>
        </>
      )}

      <BottomSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={t("taxes.pickYear")}
      >
        <View style={styles.yearList}>
          {years.map((option) => {
            const current = option === year;
            return (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityState={{ selected: current }}
                onPress={() => {
                  setYear(option);
                  setExportState("idle");
                  setPickerOpen(false);
                }}
                style={({ pressed }) => [
                  styles.yearRow,
                  current ? styles.yearRowActive : null,
                  pressed && !current ? styles.yearRowPressed : null,
                ]}
              >
                <Text style={[styles.yearRowText, current ? styles.yearRowTextActive : null]}>
                  {option}
                </Text>
                {current ? (
                  <MaterialCommunityIcons name="check" size={18} color={colors.accentSoftInk} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>
    </Screen>
  );
}

function TaxesSkeleton({ label }: { label: string }) {
  const styles = useStyles();
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} style={styles.skeleton}>
      <Skeleton style={styles.skeletonPanel} />
      <Skeleton style={styles.skeletonHeading} />
      <Skeleton style={styles.skeletonCard} />
      <Skeleton style={styles.skeletonCardShort} />
    </View>
  );
}

/** The year at a glance: the sum first, then what it does and doesn't include. */
function YearSummary({ data }: { data: TaxYearResponse }) {
  const styles = useStyles();
  const { t } = useI18n();
  const [lead, ...otherTotals] = data.totals;
  const documents = data.documentCount.toLocaleString();

  return (
    <GradientPanel>
      <View style={styles.summary}>
        <View>
          <Text style={styles.summaryLabel}>
            {lead ? fill(t("taxes.metricTotal"), { currency: lead.currency }) : t("taxes.metricDocuments")}
          </Text>
          <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit>
            {lead ? formatTaxTotal(lead) : documents}
          </Text>
        </View>
        <View style={styles.tiles}>
          {otherTotals.map((total) => (
            <SummaryTile
              key={total.currency}
              label={fill(t("taxes.metricTotal"), { currency: total.currency })}
              value={formatTaxTotal(total)}
            />
          ))}
          {lead ? <SummaryTile label={t("taxes.metricDocuments")} value={documents} /> : null}
          <SummaryTile
            label={t("taxes.metricUnsummed")}
            value={data.unsummedCount.toLocaleString()}
          />
        </View>
      </View>
    </GradientPanel>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

function TaxGroupCard({ group, year }: { group: TaxYearGroup; year: number }) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const [expanded, setExpanded] = useState(true);

  const name = group.documentType ?? t("taxes.unfiled");
  const totals = group.totals.map(formatTaxTotal).join(" · ");
  const filter = documentsFilterForGroup(group, year);

  return (
    <Panel style={styles.group}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${name}, ${group.count}`}
        onPress={() => setExpanded((current) => !current)}
        style={styles.groupTrigger}
      >
        <MaterialCommunityIcons
          name={expanded ? "chevron-down" : "chevron-right"}
          size={18}
          color={colors.muted}
        />
        <Text style={styles.groupName} numberOfLines={1}>
          {name}
        </Text>
        <View style={styles.groupCount}>
          <Text style={styles.groupCountText}>{group.count}</Text>
        </View>
        {group.unsummedCount > 0 ? (
          <Text style={styles.groupUnsummed} numberOfLines={1}>
            {fill(t("taxes.groupUnsummed"), { count: group.unsummedCount })}
          </Text>
        ) : null}
      </Pressable>

      {filter || totals ? (
        <View style={styles.groupMeta}>
          {filter ? (
            <Pressable
              accessibilityRole="link"
              onPress={() =>
                navigation.navigate("Home", {
                  screen: "Documents",
                  params: { applyFilters: filter },
                } as never)
              }
              hitSlop={8}
              style={styles.groupLink}
            >
              <MaterialCommunityIcons name="folder-open-outline" size={15} color={colors.muted} />
              <Text style={styles.groupLinkText}>{t("taxes.openInDocuments")}</Text>
            </Pressable>
          ) : null}
          <View style={styles.spacer} />
          {totals ? <Text style={styles.groupTotal}>{totals}</Text> : null}
        </View>
      ) : null}

      {expanded
        ? group.documents.map((document) => <TaxRow key={document.id} document={document} />)
        : null}
    </Panel>
  );
}

function TaxRow({ document }: { document: TaxYearDocument }) {
  const styles = useStyles();
  const { language, t } = useI18n();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const hasAmount = document.amount !== null && document.currency;
  const meta = [document.correspondentName, formatIssueDate(document.issueDate, language)]
    .filter(Boolean)
    .join(" · ");

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        navigation.navigate("DocumentDetail", { documentId: document.id, title: document.title })
      }
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {document.title}
        </Text>
        {meta ? (
          <Text style={styles.rowMeta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
        <MembershipBadge memberVia={document.memberVia} />
      </View>
      <Text style={hasAmount ? styles.rowAmount : styles.rowNoAmount} numberOfLines={1}>
        {hasAmount ? formatCurrency(document.amount, document.currency!) : t("taxes.noAmount")}
      </Text>
    </Pressable>
  );
}

function MembershipBadge({ memberVia }: { memberVia: TaxYearMembership }) {
  const styles = useStyles();
  const { t } = useI18n();
  const label =
    memberVia === "tag" ? t("taxes.viaTag") : memberVia === "type" ? t("taxes.viaType") : t("taxes.viaBoth");
  const hint = memberVia === "type" ? t("taxes.viaTypeHint") : t("taxes.viaTagHint");
  return (
    <View accessible accessibilityLabel={label} accessibilityHint={hint} style={styles.badge}>
      <Pill label={label} tone="outline" />
    </View>
  );
}

const useStyles = createThemedStyles((c) => ({
  heading: {
    gap: 12,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  title: {
    ...text.screenTitle,
    flex: 1,
    color: c.ink,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  spacer: {
    flex: 1,
  },
  yearLabel: {
    ...text.body,
    color: c.muted,
  },
  yearButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 38,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.md,
    backgroundColor: c.app,
  },
  yearValue: {
    ...text.numericStrong,
    fontSize: 14,
    lineHeight: 20,
    color: c.ink,
  },
  exportFailed: {
    ...text.small,
    color: c.red,
  },
  description: {
    ...text.body,
    color: c.muted,
  },
  skeleton: {
    gap: 12,
  },
  skeletonPanel: {
    height: 208,
    borderRadius: radii.xxl,
  },
  skeletonHeading: {
    height: 18,
    width: 160,
    marginTop: 8,
  },
  skeletonCard: {
    height: 148,
    borderRadius: radii.xl,
  },
  skeletonCardShort: {
    height: 100,
    borderRadius: radii.xl,
  },
  empty: {
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 56,
  },
  emptyText: {
    ...text.body,
    maxWidth: 320,
    color: c.muted,
    textAlign: "center",
  },

  /* summary */
  summary: {
    gap: 20,
  },
  summaryLabel: {
    ...text.body,
    color: c.onGradientMuted,
  },
  summaryValue: {
    ...text.statValue,
    fontSize: 36,
    lineHeight: 44,
    marginTop: 4,
    color: c.onGradient,
  },
  tiles: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  tile: {
    flexGrow: 1,
    flexBasis: "45%",
    minWidth: 0,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radii.lg,
    backgroundColor: c.tile,
  },
  tileLabel: {
    ...text.body,
    color: c.onGradientMuted,
  },
  tileValue: {
    ...text.statValue,
    fontSize: 24,
    lineHeight: 30,
    marginTop: 4,
    color: c.onGradient,
  },

  /* groups */
  groups: {
    gap: 12,
  },
  groupsHeading: {
    ...text.barTitle,
    color: c.ink,
  },
  group: {
    overflow: "hidden",
  },
  groupTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  groupName: {
    ...text.bodyStrong,
    flexShrink: 1,
    color: c.ink,
  },
  groupCount: {
    minWidth: 24,
    alignItems: "center",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: c.raised,
  },
  groupCountText: {
    ...text.numericStrong,
    color: c.ink,
  },
  groupUnsummed: {
    ...text.small,
    flexShrink: 1,
    color: c.amber,
  },
  groupMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 36,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  groupLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 28,
  },
  groupLinkText: {
    ...text.meta,
    color: c.muted,
  },
  groupTotal: {
    ...text.amount,
    fontFamily: text.barTitle.fontFamily,
    flexShrink: 1,
    color: c.ink,
    textAlign: "right",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  rowPressed: {
    backgroundColor: c.bar,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    ...text.rowTitle,
    color: c.ink,
  },
  rowMeta: {
    ...text.meta,
    color: c.muted,
  },
  badge: {
    alignSelf: "flex-start",
    marginTop: 4,
  },
  rowAmount: {
    ...text.amount,
    flexShrink: 0,
    color: c.ink,
  },
  rowNoAmount: {
    ...text.body,
    flexShrink: 0,
    color: c.muted,
  },

  /* year picker */
  yearList: {
    gap: 2,
  },
  yearRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: radii.md,
  },
  yearRowActive: {
    backgroundColor: c.accentSoft,
  },
  yearRowPressed: {
    backgroundColor: c.bar,
  },
  yearRowText: {
    ...text.numeric,
    fontSize: 14,
    lineHeight: 20,
    color: c.ink,
  },
  yearRowTextActive: {
    ...text.numericStrong,
    fontSize: 14,
    lineHeight: 20,
    color: c.accentSoftInk,
  },
}));
