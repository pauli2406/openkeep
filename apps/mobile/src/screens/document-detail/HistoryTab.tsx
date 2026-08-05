import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { useQuery } from "@tanstack/react-query";
import { EmptyState, SectionHeader } from "../../components/ui";
import { useI18n } from "../../i18n";
import { createThemedStyles, radii } from "../../theme";
import { text } from "../../typography";
import { formatDate, type DocumentHistoryResponse, type DocumentTextResponse } from "../../lib";
import { formatEventType } from "./shared";

/** The recognised text per page, then what changed. Unchanged in substance. */
export function HistoryTab({
  textQuery,
  historyQuery,
}: {
  textQuery: ReturnType<typeof useQuery<DocumentTextResponse>>;
  historyQuery: ReturnType<typeof useQuery<DocumentHistoryResponse>>;
}) {
  const styles = useStyles();
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const pageGroups = useMemo(() => {
    if (!textQuery.data?.blocks) {
      return [];
    }
    const groups = new Map<number, string[]>();
    for (const block of textQuery.data.blocks) {
      const existing = groups.get(block.page) ?? [];
      existing.push(block.text);
      groups.set(block.page, existing);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a - b)
      .map(([page, lines]) => ({ page, text: lines.join(" ") }));
  }, [textQuery.data]);

  const items = historyQuery.data?.items ?? [];

  return (
    <>
      <SectionHeader
        label={t("documentDetail.recognisedText")}
        count={pageGroups.length > 0 ? `${pageGroups.length} ${t("scan.pages")}` : undefined}
      />
      {textQuery.isLoading ? (
        <Text style={styles.hint}>{t("documentDetail.activity.loadingOcr")}</Text>
      ) : null}
      {textQuery.data && pageGroups.length === 0 ? (
        <EmptyState
          title={t("documentDetail.activity.noOcrTitle")}
          body={t("documentDetail.activity.noOcrBody")}
        />
      ) : null}
      {pageGroups.map(({ page, text: pageText }) => (
        <View key={page} style={styles.pageBlock}>
          <Text style={styles.pageLabel}>{`${t("documentDetail.activity.page")} ${page}`}</Text>
          <Text style={styles.ocrText} selectable>
            {pageText}
          </Text>
        </View>
      ))}

      <SectionHeader label={t("documentDetail.changes")} />
      {historyQuery.data && items.length === 0 ? (
        <EmptyState
          title={t("documentDetail.activity.noHistoryTitle")}
          body={t("documentDetail.activity.noHistoryBody")}
        />
      ) : null}
      <View style={styles.timeline}>
        {items.map((item) => {
          const isExpanded = expanded.has(item.id);
          const hasPayload = item.payload && Object.keys(item.payload).length > 0;
          return (
            <Pressable
              key={item.id}
              disabled={!hasPayload}
              onPress={() =>
                setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(item.id)) {
                    next.delete(item.id);
                  } else {
                    next.add(item.id);
                  }
                  return next;
                })
              }
              style={styles.timelineRow}
            >
              <View style={styles.timelineDot} />
              <View style={styles.timelineText}>
                <Text style={styles.eventTitle}>{formatEventType(item.eventType)}</Text>
                <Text style={styles.eventMeta}>
                  {`${formatDate(item.createdAt)} · ${item.actorDisplayName ?? item.actorEmail ?? t("documentDetail.activity.system")}`}
                </Text>
                {isExpanded && hasPayload ? (
                  <View style={styles.payload}>
                    {Object.entries(item.payload).map(([key, value]) => (
                      <Text key={key} style={styles.payloadLine}>
                        {`${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value ?? "-")}`}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

const useStyles = createThemedStyles((c) => ({
  hint: {
    ...text.meta,
    padding: 16,
    color: c.dim,
  },
  pageBlock: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
  },
  pageLabel: {
    ...text.sectionLabel,
    color: c.faint,
  },
  ocrText: {
    ...text.numeric,
    fontSize: 11.5,
    lineHeight: 18,
    marginTop: 8,
    borderRadius: radii.md,
    backgroundColor: c.raised,
    color: c.ink,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  timeline: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
  },
  timelineRow: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 7,
  },
  timelineDot: {
    width: 6,
    height: 6,
    flexShrink: 0,
    marginTop: 6,
    borderRadius: radii.pill,
    backgroundColor: c.green,
  },
  timelineText: {
    flex: 1,
    minWidth: 0,
  },
  eventTitle: {
    ...text.meta,
    fontSize: 13,
    color: c.ink,
  },
  eventMeta: {
    ...text.numeric,
    fontSize: 10.5,
    lineHeight: 14,
    marginTop: 2,
    color: c.faint,
  },
  payload: {
    marginTop: 6,
    gap: 2,
  },
  payloadLine: {
    ...text.numeric,
    fontSize: 10.5,
    lineHeight: 15,
    color: c.dim,
  },
}));
