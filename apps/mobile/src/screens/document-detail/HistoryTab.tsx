import { Text, View } from "react-native";
import type { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorCard } from "../../components/ui";
import { useI18n } from "../../i18n";
import { createThemedStyles, radii } from "../../theme";
import { text } from "../../typography";
import type { DocumentHistoryResponse } from "../../lib";
import { RawJson, SkeletonLines } from "./parts";
import { formatEventType, formatTimestamp } from "./shared";

/** What happened to this document, newest as the server orders it, on a ruled line. */
export function HistoryTab({
  historyQuery,
}: {
  historyQuery: ReturnType<typeof useQuery<DocumentHistoryResponse>>;
}) {
  const styles = useStyles();
  const { t } = useI18n();
  const items = historyQuery.data?.items ?? [];

  if (historyQuery.isLoading) {
    return (
      <View style={styles.tab}>
        <SkeletonLines widths={["66%", "50%"]} />
        <SkeletonLines widths={["66%", "50%"]} />
        <SkeletonLines widths={["66%", "50%"]} />
      </View>
    );
  }
  if (historyQuery.isError) {
    return (
      <View style={styles.tab}>
        <ErrorCard
          message={t("documentDetail.loadHistoryFailed")}
          onRetry={() => void historyQuery.refetch()}
        />
      </View>
    );
  }
  if (items.length === 0) {
    return (
      <View style={styles.tab}>
        <EmptyState icon="history" title={t("documentDetail.noAuditEvents")} />
      </View>
    );
  }

  return (
    <View style={styles.tab}>
      <Text style={styles.heading}>{t("documentDetail.documentHistory")}</Text>
      <View style={styles.timeline}>
        <View style={styles.rule} />
        {items.map((item) => (
          <View key={item.id} style={styles.event}>
            <View style={styles.dot} />
            <Text style={styles.eventTitle}>{formatEventType(item.eventType)}</Text>
            <Text style={styles.eventMeta}>
              {`${item.actorDisplayName || item.actorEmail || t("documentDetail.system")} · ${formatTimestamp(item.createdAt)}`}
            </Text>
            {item.payload && Object.keys(item.payload).length > 0 ? (
              <RawJson label={t("documentDetail.details")} value={item.payload} />
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((c) => ({
  tab: {
    gap: 12,
    padding: 16,
  },
  heading: {
    ...text.bodyStrong,
    color: c.ink,
  },
  timeline: {
    gap: 16,
  },
  rule: {
    position: "absolute",
    top: 6,
    bottom: 6,
    left: 5,
    width: 1,
    backgroundColor: c.border,
  },
  event: {
    paddingLeft: 20,
  },
  dot: {
    position: "absolute",
    top: 5,
    left: 0,
    width: 11,
    height: 11,
    borderWidth: 2,
    borderColor: c.panel,
    borderRadius: radii.pill,
    backgroundColor: c.accent,
  },
  eventTitle: {
    ...text.bodyStrong,
    color: c.ink,
  },
  eventMeta: {
    ...text.numeric,
    marginTop: 1,
    color: c.muted,
  },
}));
