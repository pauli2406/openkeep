import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Markdown from "react-native-markdown-display";
import { PulsingDot } from "../../components/ui";
import { useDocumentQa } from "../../hooks/useDocumentQa";
import { useDocumentSummary } from "../../hooks/useDocumentSummary";
import { useI18n } from "../../i18n";
import { createThemedStyles, radii, useColors } from "../../theme";
import { text } from "../../typography";
import { formatDate, type QaHistoryEntry } from "../../lib";

/**
 * The AI tab. The per-document chat used to be the last thing in a very long
 * `Analyse` tab, which is why nobody found it; here the summary is at the top,
 * three suggested questions sit under it, and the composer is pinned by the
 * route in place of the action bar. (#114)
 */
export function AskTab({
  documentId,
  streamFetch,
  qaHistory,
  refetchQaHistory,
  offlineMode,
  qa,
}: {
  documentId: string;
  streamFetch: (path: string, init?: RequestInit) => Promise<Response>;
  qaHistory: QaHistoryEntry[];
  refetchQaHistory: () => void;
  offlineMode: boolean;
  qa: ReturnType<typeof useDocumentQa>;
}) {
  const styles = useStyles();
  const colors = useColors();
  const markdownStyles = useMarkdownStyles();
  const { t } = useI18n();
  const summary = useDocumentSummary(streamFetch, documentId);

  // The server persists the Q&A entry at stream end (the done event carries
  // historyEntryId) — refresh the history list instead of writing client-side.
  useEffect(() => {
    if (qa.status === "done" && qa.answerText) {
      refetchQaHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qa.status]);

  const suggestions = [
    t("documentDetail.suggested.whatIsDue"),
    t("documentDetail.suggested.whoSent"),
    t("documentDetail.suggested.deadlines"),
  ];

  return (
    <>
      {/* Summary */}
      <View style={styles.summaryBlock}>
        <View style={styles.summaryHeader}>
          <MaterialCommunityIcons name="creation" size={14} color={colors.accent} />
          <Text style={styles.summaryLabel}>{t("documentDetail.summary")}</Text>
          {!offlineMode ? (
            <Pressable onPress={() => summary.generate(true)} hitSlop={10}>
              <Text style={styles.summaryAction}>{t("documentDetail.summaryNew")}</Text>
            </Pressable>
          ) : null}
        </View>

        {offlineMode ? (
          <Text style={styles.hint}>{t("documentDetail.insights.aiDisabled")}</Text>
        ) : summary.status === "idle" ? (
          <Pressable onPress={() => summary.generate()} hitSlop={8}>
            <Text style={styles.summaryAction}>
              {t("documentDetail.insights.generateSummary")}
            </Text>
          </Pressable>
        ) : summary.status === "error" ? (
          <Text style={styles.error}>{summary.errorMessage}</Text>
        ) : (
          <>
            <Markdown style={markdownStyles}>
              {summary.summaryText || t("documentDetail.insights.generating")}
            </Markdown>
            <Text style={styles.provenance}>
              {[
                summary.provider,
                summary.model,
                summary.isCached ? t("documentDetail.insights.cachedSummary") : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </>
        )}
      </View>

      {/* Suggested questions */}
      <View style={styles.askBlock}>
        <Text style={styles.blockLabel}>{t("documentDetail.askAbout")}</Text>
        <View style={styles.suggestionStack}>
          {suggestions.map((suggestion) => (
            <Pressable
              key={suggestion}
              onPress={() => qa.ask(suggestion)}
              disabled={offlineMode || qa.status === "streaming"}
              style={({ pressed }) => [
                styles.suggestion,
                pressed ? styles.suggestionPressed : null,
              ]}
            >
              <Text style={styles.suggestionText}>{suggestion}</Text>
              <MaterialCommunityIcons name="arrow-top-right" size={14} color={colors.faint} />
            </Pressable>
          ))}
        </View>
      </View>

      {/* The live answer */}
      {qa.status === "streaming" ? (
        <View style={styles.answerBlock}>
          <PulsingDot style={styles.answerDot} />
          <Markdown style={markdownStyles}>
            {qa.answerText || t("documentDetail.insights.thinking")}
          </Markdown>
        </View>
      ) : null}

      {qa.status === "done" && qa.answerText ? (
        <View style={styles.answerBlock}>
          <Markdown style={markdownStyles}>{qa.answerText}</Markdown>
          {qa.citations.length > 0 ? (
            <View style={styles.citations}>
              <Text style={styles.blockSubLabel}>{t("documentDetail.insights.sources")}</Text>
              {qa.citations.map((citation, index) => (
                <Text key={`${citation.chunkIndex}-${index}`} style={styles.citation}>
                  {`${
                    citation.pageFrom
                      ? `${t("documentDetail.activity.page")} ${citation.pageFrom}`
                      : `#${citation.chunkIndex}`
                  } · ${citation.quote.slice(0, 120)}${citation.quote.length > 120 ? "…" : ""}`}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {qa.status === "error" ? (
        <View style={styles.answerBlock}>
          <Text style={styles.error}>{qa.errorMessage}</Text>
        </View>
      ) : null}

      {/* Earlier questions */}
      {qaHistory.map((entry) => (
        <View key={entry.id} style={styles.historyBlock}>
          <Text style={styles.historyQuestion}>{entry.question}</Text>
          {entry.answer ? <Markdown style={markdownStyles}>{entry.answer}</Markdown> : null}
          <Text style={styles.provenance}>{formatDate(entry.createdAt)}</Text>
        </View>
      ))}
    </>
  );
}

const useStyles = createThemedStyles((c) => ({
  summaryBlock: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 9,
  },
  summaryLabel: {
    ...text.meta,
    flex: 1,
    color: c.dim,
  },
  summaryAction: {
    ...text.smallStrong,
    color: c.accent,
  },
  provenance: {
    ...text.numeric,
    fontSize: 10.5,
    lineHeight: 14,
    marginTop: 10,
    color: c.faint,
  },
  askBlock: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 10,
  },
  blockLabel: {
    ...text.meta,
    color: c.dim,
  },
  blockSubLabel: {
    ...text.small,
    color: c.faint,
  },
  suggestionStack: {
    gap: 7,
  },
  suggestion: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    minHeight: 44,
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: 9,
    backgroundColor: c.panel,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  suggestionPressed: {
    opacity: 0.8,
  },
  suggestionText: {
    ...text.meta,
    flex: 1,
    fontSize: 13,
    color: c.ink,
  },
  answerBlock: {
    paddingHorizontal: 16,
    paddingBottom: 13,
    gap: 8,
  },
  answerDot: {
    backgroundColor: c.accent,
    borderRadius: radii.pill,
  },
  citations: {
    gap: 4,
  },
  citation: {
    ...text.small,
    color: c.dim,
  },
  historyBlock: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: c.borderSoft,
  },
  historyQuestion: {
    ...text.metaStrong,
    marginBottom: 6,
    color: c.muted,
  },
  error: {
    ...text.meta,
    color: c.red,
  },
  hint: {
    ...text.meta,
    color: c.dim,
  },
}));

const useMarkdownStyles = createThemedStyles((c) => ({
  body: {
    ...text.meta,
    fontSize: 13.5,
    lineHeight: 22,
    color: c.ink,
  },
  strong: {
    ...text.metaStrong,
    fontSize: 13.5,
    lineHeight: 22,
    color: c.ink,
  },
  em: {
    fontStyle: "italic",
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 6,
  },
  bullet_list: {
    marginTop: 2,
    marginBottom: 2,
  },
  list_item: {
    marginBottom: 3,
    flexDirection: "row",
  },
  code_inline: {
    ...text.numeric,
    color: c.ink,
    backgroundColor: c.raised,
    borderRadius: radii.sm,
    paddingHorizontal: 4,
  },
}));

/**
 * Pinned by the route in place of the action bar, so the per-document chat is
 * where you would look for it. (#114)
 */
export function AskComposer({
  qa,
  disabled,
}: {
  qa: ReturnType<typeof useDocumentQa>;
  disabled: boolean;
}) {
  const styles = useComposerStyles();
  const colors = useColors();
  const { t } = useI18n();
  const [question, setQuestion] = useState("");

  const send = () => {
    const trimmed = question.trim();
    if (!trimmed || disabled) {
      return;
    }
    qa.ask(trimmed);
    setQuestion("");
  };

  return (
    <View style={styles.composer}>
      <View style={styles.row}>
        <TextInput
          value={question}
          onChangeText={setQuestion}
          placeholder={t("documentDetail.askPlaceholder")}
          placeholderTextColor={colors.dim}
          style={styles.input}
          multiline
          returnKeyType="send"
          onSubmitEditing={send}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("documentDetail.insights.ask")}
          onPress={send}
          disabled={!question.trim() || disabled || qa.status === "streaming"}
          style={({ pressed }) => [
            styles.send,
            !question.trim() || disabled ? styles.sendDisabled : null,
            pressed ? styles.sendPressed : null,
          ]}
        >
          <MaterialCommunityIcons name="arrow-up" size={18} color={colors.accentFillInk} />
        </Pressable>
      </View>
      <Text style={styles.note}>{t("documentDetail.onlyThisDocument")}</Text>
    </View>
  );
}

const useComposerStyles = createThemedStyles((c) => ({
  composer: {
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 7,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.bar,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: radii.xl,
    backgroundColor: c.panel,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 5,
  },
  input: {
    ...text.body,
    flex: 1,
    minHeight: 32,
    maxHeight: 100,
    paddingTop: 6,
    paddingBottom: 6,
    color: c.ink,
  },
  send: {
    height: 34,
    width: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.lg,
    backgroundColor: c.accentFill,
  },
  sendDisabled: {
    opacity: 0.4,
  },
  sendPressed: {
    opacity: 0.85,
  },
  note: {
    ...text.small,
    color: c.faint,
    textAlign: "center",
  },
}));
