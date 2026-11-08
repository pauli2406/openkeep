import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  fetchDocumentsPage,
  monthDateRange,
  unpaidByMonth,
  type AuthFetch,
  type DocumentsTimelineResponse,
} from "../../api/documents";
import { Skeleton } from "../../components/layout";
import { Button, EmptyState, Panel, Pill } from "../../components/ui";
import { processingRefetchInterval } from "../../document-processing";
import { useI18n } from "../../i18n";
import { formatCurrency, titleForDocument, type ArchiveDocument, type DocumentFilters } from "../../lib";
import { createThemedStyles, radii, useColors } from "../../theme";
import { tabular, text } from "../../typography";
import { CardList, CategoryDot, Meter } from "./parts";

/** Documents for one month, revealed when its card is opened. */
function MonthDocuments({
  authFetch,
  apiUrl,
  year,
  month,
  filters,
  onOpenDocument,
}: {
  authFetch: AuthFetch;
  apiUrl: string;
  year: number;
  month: number;
  filters: DocumentFilters;
  onOpenDocument: (document: ArchiveDocument) => void;
}) {
  const styles = useStyles();
  const { t } = useI18n();
  const range = monthDateRange(year, month, filters.dateFrom, filters.dateTo);
  const documentsQuery = useQuery({
    queryKey: ["documents", "timeline-month", apiUrl, year, month, filters],
    queryFn: () =>
      fetchDocumentsPage(authFetch, {
        filters: { ...filters, ...range },
        sort: { field: "issueDate", direction: "desc" },
        page: 1,
        pageSize: 50,
      }),
    refetchInterval: (query) => processingRefetchInterval(query.state.data, (data) => data?.items),
  });

  if (documentsQuery.isLoading) {
    return (
      <View style={styles.monthLoading}>
        <Skeleton style={styles.monthLoadingLine} />
        <Skeleton style={styles.monthLoadingLine} />
      </View>
    );
  }

  if (documentsQuery.isError) {
    return (
      <View style={styles.monthError}>
        <Text style={styles.monthErrorText}>{t("timeline.monthError")}</Text>
        <Button
          label={t("common.retry")}
          variant="secondary"
          size="sm"
          onPress={() => documentsQuery.refetch()}
        />
      </View>
    );
  }

  const items = documentsQuery.data?.items ?? [];
  if (items.length === 0) {
    return <Text style={styles.monthEmpty}>{t("timeline.emptyMonth")}</Text>;
  }

  return (
    <CardList>
      {items.map((document) => (
        <Pressable
          key={document.id}
          accessibilityRole="button"
          onPress={() => onOpenDocument(document)}
          style={({ pressed }) => [styles.monthRow, pressed ? styles.monthRowPressed : null]}
        >
          <CategoryDot value={document.correspondent?.name ?? document.status} />
          <Text style={styles.monthRowTitle} numberOfLines={1}>
            {titleForDocument(document)}
          </Text>
          <Text style={styles.monthRowAmount} numberOfLines={1}>
            {document.amount != null ? formatCurrency(document.amount, document.currency ?? "EUR") : "—"}
          </Text>
        </Pressable>
      ))}
    </CardList>
  );
}

/** Years, newest first, each a rail of month cards that open to their documents. */
export function TimelineView({
  authFetch,
  apiUrl,
  timeline,
  filters,
  onOpenDocument,
}: {
  authFetch: AuthFetch;
  apiUrl: string;
  timeline: DocumentsTimelineResponse;
  filters: DocumentFilters;
  onOpenDocument: (document: ArchiveDocument) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t, language } = useI18n();
  const [expanded, setExpanded] = useState<string[]>([]);

  // The timeline response carries no deadline data. The unpaid markers come from
  // the same filtered set the rows describe.
  const deadlinesQuery = useQuery({
    queryKey: ["documents", "timeline-deadlines", apiUrl, filters],
    queryFn: () =>
      fetchDocumentsPage(authFetch, {
        filters,
        sort: { field: "dueDate", direction: "asc" },
        page: 1,
        pageSize: 100,
      }),
    staleTime: 60_000,
  });
  const unpaid = useMemo(
    () => unpaidByMonth(deadlinesQuery.data?.items ?? [], new Date()),
    [deadlinesQuery.data],
  );

  const rows = timeline.years
    .flatMap((bucket) =>
      bucket.months
        // An out-of-range month would render an undefined label.
        .filter((month) => month.month >= 1 && month.month <= 12)
        .map((month) => ({ year: bucket.year, ...month })),
    )
    .sort((a, b) => b.year - a.year || b.month - a.month);

  if (rows.length === 0) {
    return (
      <Panel>
        <EmptyState icon="calendar-range" title={t("timeline.empty")} />
      </Panel>
    );
  }

  const max = Math.max(...rows.map((row) => row.count), 1);
  const years = [...new Set(rows.map((row) => row.year))];
  const monthFormat = new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-US", {
    month: "short",
    timeZone: "UTC",
  });

  return (
    <View style={styles.root}>
      {years.map((year) => {
        const months = rows.filter((row) => row.year === year);
        const yearTotal = months.reduce((sum, row) => sum + row.count, 0);
        return (
          <View key={year}>
            <View style={styles.yearHead}>
              <Text style={styles.year} accessibilityRole="header">
                {year}
              </Text>
              <Text style={styles.yearCount}>
                {yearTotal === 1
                  ? t("explorer.countOne")
                  : t("explorer.countMany").replace("{count}", String(yearTotal))}
              </Text>
            </View>

            {months.map((row, index) => {
              const key = `${row.year}-${row.month}`;
              const isExpanded = expanded.includes(key);
              const unpaidCount = unpaid.get(key) ?? 0;
              const samples = (row.topTypes.length ? row.topTypes : row.topCorrespondents)
                .slice(0, 3)
                .join(", ");
              const monthName = monthFormat.format(Date.UTC(2000, row.month - 1, 15));

              return (
                <View key={key} style={styles.monthItem}>
                  {/* Each month draws the rail down to the next marker. */}
                  {index < months.length - 1 ? <View style={styles.rail} /> : null}
                  <View style={[styles.marker, unpaidCount > 0 ? styles.markerUnpaid : null]} />
                  <Panel style={styles.monthCard}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: isExpanded }}
                      onPress={() =>
                        setExpanded((current) =>
                          current.includes(key)
                            ? current.filter((value) => value !== key)
                            : [...current, key],
                        )
                      }
                      style={({ pressed }) => [
                        styles.monthHead,
                        isExpanded ? styles.monthHeadOpen : null,
                        pressed ? styles.monthRowPressed : null,
                      ]}
                    >
                      <View style={styles.monthTop}>
                        <Text style={styles.monthName}>{`${monthName} ${row.year}`}</Text>
                        <View style={styles.monthMeter}>
                          <Meter share={row.count / max} />
                        </View>
                        <Text style={styles.monthCount}>{row.count}</Text>
                        <MaterialCommunityIcons
                          name={isExpanded ? "chevron-up" : "chevron-down"}
                          size={18}
                          color={colors.muted}
                        />
                      </View>
                      {samples || unpaidCount > 0 ? (
                        <View style={styles.monthBottom}>
                          <Text style={styles.samples} numberOfLines={1}>
                            {samples}
                          </Text>
                          {unpaidCount > 0 ? (
                            <Pill label={`${unpaidCount} ${t("timeline.unpaid")}`} tone="warn" />
                          ) : null}
                        </View>
                      ) : null}
                    </Pressable>
                    {isExpanded ? (
                      <View style={styles.monthBody}>
                        <MonthDocuments
                          authFetch={authFetch}
                          apiUrl={apiUrl}
                          year={row.year}
                          month={row.month}
                          filters={filters}
                          onOpenDocument={onOpenDocument}
                        />
                      </View>
                    ) : null}
                  </Panel>
                </View>
              );
            })}
          </View>
        );
      })}
      <Text style={styles.caption}>{t("timeline.caption")}</Text>
    </View>
  );
}

/** The timeline's shape while its buckets are on their way. */
export function TimelineSkeleton() {
  const styles = useStyles();
  return (
    <View style={styles.skeleton}>
      <Skeleton style={styles.skeletonYear} />
      {[0, 1, 2, 3, 4].map((row) => (
        <Skeleton key={row} style={styles.skeletonRow} />
      ))}
    </View>
  );
}

const MARKER = 12;
const INDENT = 26;

const useStyles = createThemedStyles((c) => ({
  root: {
    gap: 24,
  },
  yearHead: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 10,
    marginBottom: 12,
  },
  year: {
    ...text.barTitle,
    ...tabular,
    fontSize: 18,
    lineHeight: 24,
    color: c.ink,
  },
  yearCount: {
    ...text.small,
    color: c.muted,
  },
  monthItem: {
    paddingLeft: INDENT,
    paddingBottom: 10,
  },
  rail: {
    position: "absolute",
    top: 18,
    bottom: -18,
    left: MARKER / 2 - 0.5,
    width: 1,
    backgroundColor: c.border,
  },
  marker: {
    position: "absolute",
    top: 18,
    left: 0,
    width: MARKER,
    height: MARKER,
    borderRadius: radii.pill,
    backgroundColor: c.accent,
  },
  markerUnpaid: {
    backgroundColor: c.amber,
  },
  monthCard: {
    overflow: "hidden",
  },
  monthHead: {
    gap: 8,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  monthHeadOpen: {
    backgroundColor: c.bar,
  },
  monthTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  monthName: {
    ...text.bodyStrong,
    ...tabular,
    color: c.ink,
  },
  monthMeter: {
    flex: 1,
    minWidth: 0,
  },
  monthCount: {
    ...text.amount,
    minWidth: 20,
    textAlign: "right",
    color: c.ink,
  },
  monthBottom: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  samples: {
    ...text.meta,
    flex: 1,
    minWidth: 0,
    color: c.muted,
  },
  monthBody: {
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  monthLoading: {
    gap: 10,
    padding: 14,
  },
  monthLoadingLine: {
    height: 14,
  },
  monthError: {
    gap: 8,
    padding: 14,
    backgroundColor: c.redSoft,
  },
  monthErrorText: {
    ...text.meta,
    color: c.red,
  },
  monthEmpty: {
    ...text.meta,
    padding: 14,
    color: c.muted,
  },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  monthRowPressed: {
    backgroundColor: c.bar,
  },
  monthRowTitle: {
    ...text.rowTitle,
    flex: 1,
    minWidth: 0,
    color: c.ink,
  },
  monthRowAmount: {
    ...text.amount,
    color: c.ink,
  },
  caption: {
    ...text.small,
    color: c.muted,
  },
  skeleton: {
    gap: 10,
  },
  skeletonYear: {
    width: 64,
    height: 24,
    marginBottom: 4,
  },
  skeletonRow: {
    height: 52,
    borderRadius: radii.xl,
  },
}));
