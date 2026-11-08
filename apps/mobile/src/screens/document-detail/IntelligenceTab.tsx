import { useEffect } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Markdown from "react-native-markdown-display";
import { IconTile } from "../../components/layout";
import { EmptyState, Pill } from "../../components/ui";
import type { useDocumentSummary } from "../../hooks/useDocumentSummary";
import { useI18n } from "../../i18n";
import { createThemedStyles, radii, useColors } from "../../theme";
import { text } from "../../typography";
import type { ArchiveDocument } from "../../lib";
import {
  ConfidenceMeter,
  InlineError,
  InspectorCard,
  MetaRows,
  SkeletonLines,
  useAnswerMarkdownStyles,
} from "./parts";
import {
  formatAgentFieldLabel,
  formatAgentFieldValue,
  formatDuration,
  formatReasonCode,
} from "./shared";

/** What the agents made of the document, card by card. Reads from the cached copy too. */
export function IntelligenceTab({
  document,
  summary,
  offlineReadOnly,
}: {
  document: ArchiveDocument;
  summary: ReturnType<typeof useDocumentSummary>;
  offlineReadOnly: boolean;
}) {
  const styles = useStyles();
  const { t } = useI18n();
  const intelligence = document.metadata?.intelligence;

  if (!intelligence) {
    // The agents never ran, but a summary can still be asked for.
    if (summary.status === "idle") {
      return (
        <EmptyState
          icon="brain"
          title={t("documentDetail.noAgentIntelligence")}
          action={offlineReadOnly ? undefined : t("documentDetail.insights.generateSummary")}
          onAction={offlineReadOnly ? undefined : () => void summary.generate(false)}
        />
      );
    }
    return (
      <View style={styles.tab}>
        <SummaryCard
          documentId={document.id}
          summary={summary}
          initialSummary={document.metadata?.summary ?? null}
          initialProvider={null}
          initialModel={null}
          offlineReadOnly={offlineReadOnly}
        />
      </View>
    );
  }

  const fieldConfidence = intelligence.extraction?.fieldConfidence ?? {};
  const fieldProvenance = intelligence.extraction?.fieldProvenance ?? {};
  const visibleFields = Object.entries({
    ...intelligence.extraction?.fields,
    ...intelligence.validation?.normalizedFields,
  }).filter(([, value]) => {
    if (value == null) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  });
  const warnings = intelligence.validation?.warnings ?? [];
  const errors = intelligence.validation?.errors ?? [];
  const duplicateSignals = intelligence.validation?.duplicateSignals ?? {};
  const hasDuplicateSignals = Object.keys(duplicateSignals).length > 0;
  const durations = Object.entries(intelligence.pipeline?.durationsMs ?? {});
  const taggedValues = intelligence.tagging?.tags ?? [];

  return (
    <View style={styles.tab}>
      <Text style={styles.heading}>{t("documentDetail.documentIntelligence")}</Text>

      <SummaryCard
        documentId={document.id}
        summary={summary}
        initialSummary={intelligence.summary?.value ?? document.metadata?.summary ?? null}
        initialProvider={intelligence.summary?.provider ?? null}
        initialModel={intelligence.summary?.model ?? null}
        offlineReadOnly={offlineReadOnly}
      />

      <InspectorCard
        title={t("documentDetail.routing")}
        aside={
          intelligence.routing?.confidence != null ? (
            <ConfidenceMeter value={intelligence.routing.confidence} showValue />
          ) : null
        }
      >
        <MetaRows
          rows={[
            [t("documentDetail.type"), intelligence.routing?.documentType ?? "-"],
            ...(intelligence.routing?.subtype
              ? ([[t("documentDetail.subtype"), intelligence.routing.subtype]] as Array<
                  [string, string]
                >)
              : []),
            ...(intelligence.routing?.provider
              ? ([
                  [
                    t("documentDetail.model"),
                    `${intelligence.routing.provider}${
                      intelligence.routing.model ? ` / ${intelligence.routing.model}` : ""
                    }`,
                  ],
                ] as Array<[string, string]>)
              : []),
          ]}
        />
        {intelligence.routing?.reasoningHints?.length ? (
          <View style={styles.pills}>
            {intelligence.routing.reasoningHints.map((hint) => (
              <Pill key={hint} tone="outline" label={hint} />
            ))}
          </View>
        ) : null}
      </InspectorCard>

      <InspectorCard
        title={t("documentDetail.typeSpecificFields")}
        aside={
          intelligence.extraction?.provider ? (
            <Text style={styles.asideText} numberOfLines={1}>
              {`${intelligence.extraction.provider}${
                intelligence.extraction.model ? ` / ${intelligence.extraction.model}` : ""
              }`}
            </Text>
          ) : null
        }
      >
        {visibleFields.length === 0 ? (
          <Text style={styles.hint}>{t("documentDetail.noExtractedFields")}</Text>
        ) : (
          <View>
            {visibleFields.map(([field, value], index) => {
              const provenance = fieldProvenance[field];
              const confidence = fieldConfidence[field];
              return (
                <View
                  key={field}
                  style={[styles.extractedRow, index > 0 ? styles.extractedRowRuled : null]}
                >
                  <View style={styles.extractedHead}>
                    <View style={styles.extractedText}>
                      <Text style={styles.extractedLabel}>{formatAgentFieldLabel(field)}</Text>
                      <Text style={styles.extractedValue}>{formatAgentFieldValue(value)}</Text>
                    </View>
                    {confidence != null ? <ConfidenceMeter value={confidence} showValue /> : null}
                  </View>
                  {provenance ? (
                    <View style={styles.provenance}>
                      <Text style={styles.provenanceText}>
                        <Text style={styles.provenanceLabel}>{t("documentDetail.source")}</Text>
                        {` ${provenance.source ?? "-"}${
                          provenance.provider ? ` / ${provenance.provider}` : ""
                        }`}
                      </Text>
                      {provenance.page != null || provenance.lineIndex != null ? (
                        <Text style={styles.provenanceText}>
                          <Text style={styles.provenanceLabel}>{t("documentDetail.location")}</Text>
                          {` ${
                            provenance.page != null
                              ? `${t("documentDetail.pageWord")} ${provenance.page}`
                              : ""
                          }${
                            provenance.lineIndex != null
                              ? `, ${t("documentDetail.lineWord")} ${provenance.lineIndex}`
                              : ""
                          }`}
                        </Text>
                      ) : null}
                      {provenance.snippet ? (
                        <View style={styles.snippet}>
                          <Text style={styles.snippetText}>{provenance.snippet}</Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </InspectorCard>

      <InspectorCard title={t("documentDetail.taggingCorrespondent")}>
        {taggedValues.length > 0 ? (
          <View style={styles.pills}>
            {taggedValues.map((tag) => (
              <Pill key={tag} tone="soft" label={tag} />
            ))}
          </View>
        ) : null}
        <MetaRows
          rows={[
            [
              t("documentDetail.correspondent"),
              intelligence.correspondentResolution?.resolvedName ?? "-",
            ],
            [t("documentDetail.strategy"), intelligence.correspondentResolution?.strategy ?? "-"],
          ]}
        />
      </InspectorCard>

      <InspectorCard title={t("documentDetail.validation")}>
        {warnings.length === 0 && errors.length === 0 && !hasDuplicateSignals ? (
          <Text style={styles.hint}>{t("documentDetail.noValidationIssues")}</Text>
        ) : null}
        {warnings.length > 0 ? (
          <View style={styles.badgeGroup}>
            <Text style={styles.groupLabel}>{t("documentDetail.warnings")}</Text>
            <View style={styles.pills}>
              {warnings.map((warning) => (
                <Pill key={warning} tone="warn" label={formatReasonCode(warning)} />
              ))}
            </View>
          </View>
        ) : null}
        {errors.length > 0 ? (
          <View style={styles.badgeGroup}>
            <Text style={styles.groupLabel}>{t("documentDetail.errors")}</Text>
            <View style={styles.pills}>
              {errors.map((error) => (
                <Pill key={error} tone="bad" label={formatReasonCode(error)} />
              ))}
            </View>
          </View>
        ) : null}
        {hasDuplicateSignals ? (
          <View style={styles.codeBlock}>
            <Text style={styles.codeText} selectable>
              {JSON.stringify(duplicateSignals, null, 2)}
            </Text>
          </View>
        ) : null}
      </InspectorCard>

      <InspectorCard title={t("documentDetail.pipeline")}>
        <MetaRows
          rows={[
            [t("documentDetail.framework"), intelligence.pipeline?.framework ?? "-"],
            [t("documentDetail.status"), intelligence.pipeline?.status ?? "-"],
            [
              t("documentDetail.runId"),
              intelligence.pipeline?.runId ? (
                <Text style={styles.codeText} selectable>
                  {intelligence.pipeline.runId}
                </Text>
              ) : (
                "-"
              ),
            ],
            [
              t("documentDetail.providerOrder"),
              (intelligence.pipeline?.providerOrder ?? []).join(" → ") || "-",
            ],
          ]}
        />
        {durations.length > 0 ? (
          <View style={styles.pills}>
            {durations.map(([key, value]) => (
              <Pill
                key={key}
                tone="outline"
                label={`${formatAgentFieldLabel(key)}: ${formatDuration(value)}`}
              />
            ))}
          </View>
        ) : null}
      </InspectorCard>
    </View>
  );
}

/**
 * The summary, in the one soft card on the tab. The web generates one on sight
 * when a document has none, and so does this; regenerating is always a choice.
 */
function SummaryCard({
  documentId,
  summary,
  initialSummary,
  initialProvider,
  initialModel,
  offlineReadOnly,
}: {
  documentId: string;
  summary: ReturnType<typeof useDocumentSummary>;
  initialSummary: string | null;
  initialProvider: string | null;
  initialModel: string | null;
  offlineReadOnly: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  const markdownStyles = useAnswerMarkdownStyles();
  const { t } = useI18n();

  const { generate, status } = summary;
  const untouched = status === "idle";
  useEffect(() => {
    if (!initialSummary && untouched && !offlineReadOnly) {
      void generate(false);
    }
    // Once per document: a failed attempt must not retry itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, offlineReadOnly]);

  const streaming = status === "streaming";
  const bodyText = untouched ? initialSummary : summary.summaryText;
  const provider = untouched ? initialProvider : summary.provider;
  const model = untouched ? initialModel : summary.model;

  return (
    <View style={styles.summary}>
      <View style={styles.summaryHeader}>
        <IconTile size="sm" tone="solid">
          <MaterialCommunityIcons name="creation" size={15} color={colors.onGradient} />
        </IconTile>
        <Text style={styles.summaryTitle} numberOfLines={1}>
          {t("documentDetail.generatedSummary")}
        </Text>
        {offlineReadOnly ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: streaming, busy: streaming }}
            disabled={streaming}
            onPress={() => void generate(true)}
            hitSlop={{ top: 12, bottom: 12, left: 4, right: 4 }}
            style={styles.regenerate}
          >
            {streaming ? (
              <ActivityIndicator size="small" color={colors.muted} />
            ) : (
              <MaterialCommunityIcons name="restore" size={14} color={colors.muted} />
            )}
            <Text style={styles.regenerateText}>
              {streaming ? t("documentDetail.summaryGenerating") : t("documentDetail.summaryRegenerate")}
            </Text>
          </Pressable>
        )}
      </View>

      {status === "error" ? (
        <InlineError message={summary.errorMessage ?? t("documentDetail.summaryFailed")} />
      ) : null}

      {bodyText ? (
        <Markdown style={markdownStyles}>{bodyText}</Markdown>
      ) : streaming ? (
        <SkeletonLines />
      ) : status === "error" ? null : (
        <Text style={styles.hint}>
          {offlineReadOnly ? t("documentDetail.insights.aiDisabled") : "—"}
        </Text>
      )}

      {provider ? (
        <Text style={styles.provenanceText}>
          {`${t("documentDetail.provider")}: ${provider}${model ? ` / ${model}` : ""}`}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((c) => ({
  tab: {
    gap: 16,
    padding: 16,
  },
  heading: {
    ...text.bodyStrong,
    color: c.ink,
  },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  asideText: {
    ...text.meta,
    flexShrink: 1,
    color: c.muted,
  },
  hint: {
    ...text.body,
    color: c.muted,
  },
  extractedRow: {
    gap: 4,
    paddingVertical: 10,
  },
  extractedRowRuled: {
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  extractedHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  extractedText: {
    flex: 1,
    minWidth: 0,
  },
  extractedLabel: {
    ...text.metaStrong,
    color: c.muted,
  },
  extractedValue: {
    ...text.body,
    color: c.ink,
  },
  provenance: {
    gap: 4,
  },
  provenanceText: {
    ...text.meta,
    color: c.muted,
  },
  provenanceLabel: {
    ...text.metaStrong,
    color: c.muted,
  },
  snippet: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    borderRadius: radii.sm,
    backgroundColor: c.highlight,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  snippetText: {
    ...text.meta,
    color: c.highlightInk,
  },
  badgeGroup: {
    gap: 4,
  },
  groupLabel: {
    ...text.metaStrong,
    color: c.muted,
  },
  codeBlock: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.lg,
    backgroundColor: c.bar,
    padding: 10,
  },
  codeText: {
    ...text.mono,
    fontSize: 11,
    lineHeight: 17,
    color: c.ink,
  },
  summary: {
    gap: 12,
    padding: 16,
    borderRadius: radii.xl,
    backgroundColor: c.accentSoft,
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  summaryTitle: {
    ...text.bodyStrong,
    flex: 1,
    color: c.ink,
  },
  regenerate: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 24,
  },
  regenerateText: {
    ...text.metaStrong,
    color: c.muted,
  },
}));
