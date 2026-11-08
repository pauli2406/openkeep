import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Markdown from "react-native-markdown-display";
import { Gradient, IconTile } from "../../components/layout";
import { Button, EmptyState, ErrorCard } from "../../components/ui";
import type { QaCitation } from "../../api/document";
import type { useDocumentQa } from "../../hooks/useDocumentQa";
import { useI18n } from "../../i18n";
import { createThemedStyles, radii, raisedShadow, useColors } from "../../theme";
import { text } from "../../typography";
import type { QaHistoryEntry } from "../../lib";
import { IconButton, InlineError, SkeletonLines, useAnswerMarkdownStyles } from "./parts";
import { citationForLink, linkQaCitations } from "./shared";

/**
 * The per-document chat: persisted turns, the one in flight, and a composer the
 * route pins under the column. A citation opens its page in the viewer above, so
 * an answer and the passage it rests on are one scroll apart.
 */
export function QaTab({
  history,
  historyLoading,
  historyError,
  onRetryHistory,
  qa,
  offlineReadOnly,
  clearPending,
  clearError,
  onClearHistory,
  onOpenCitation,
}: {
  history: QaHistoryEntry[];
  historyLoading: boolean;
  historyError: boolean;
  onRetryHistory: () => void;
  qa: ReturnType<typeof useDocumentQa>;
  offlineReadOnly: boolean;
  clearPending: boolean;
  clearError: string | null;
  onClearHistory: () => void;
  onOpenCitation: (citation: QaCitation) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();

  if (offlineReadOnly) {
    return <EmptyState icon="cloud-off-outline" title={t("documentDetail.askDisabled")} />;
  }
  if (historyLoading) {
    return (
      <View style={styles.thread}>
        <SkeletonLines />
      </View>
    );
  }
  if (historyError && qa.status === "idle") {
    return (
      <View style={styles.thread}>
        <ErrorCard
          message={t("documentDetail.loadQaHistoryFailed")}
          onRetry={onRetryHistory}
        />
      </View>
    );
  }

  if (history.length === 0 && qa.status === "idle") {
    const starters = [
      t("documentDetail.qaStarterSummary"),
      t("documentDetail.qaStarterDates"),
      t("documentDetail.qaStarterAction"),
    ];
    return (
      <Gradient name="wash" style={styles.empty}>
        <IconTile size="lg" tone="solid">
          <MaterialCommunityIcons name="creation" size={22} color={colors.onGradient} />
        </IconTile>
        <Text style={styles.emptyTitle} accessibilityRole="header">
          {t("documentDetail.askAboutDocument")}
        </Text>
        <Text style={styles.emptyBody}>{t("documentDetail.qaEmptyBody")}</Text>
        <View style={styles.starters}>
          {starters.map((starter) => (
            <Pressable
              key={starter}
              accessibilityRole="button"
              hitSlop={{ top: 4, bottom: 4 }}
              onPress={() => void qa.ask(starter)}
              style={({ pressed }) => [styles.starter, pressed ? styles.starterPressed : null]}
            >
              <Text style={styles.starterText}>{starter}</Text>
            </Pressable>
          ))}
        </View>
      </Gradient>
    );
  }

  return (
    <View>
      {history.length > 0 ? (
        <View style={styles.threadHeader}>
          <Text style={styles.threadTitle} numberOfLines={1}>
            {t("documentDetail.askAboutDocument")}
          </Text>
          <Button
            label={t("documentDetail.clearHistory")}
            icon="trash-can-outline"
            variant="ghost"
            size="sm"
            loading={clearPending}
            onPress={onClearHistory}
          />
        </View>
      ) : null}

      <View style={styles.thread}>
        {clearError ? <InlineError message={clearError} /> : null}

        {history.map((entry) => (
          <AnsweredTurn key={entry.id} entry={entry} onOpenCitation={onOpenCitation} />
        ))}

        {qa.question ? (
          <View style={styles.turn}>
            <QuestionBubble question={qa.question} />
            <View style={styles.answerRow}>
              <AnswerAvatar />
              <View style={styles.answerBody}>
                {qa.status === "error" ? (
                  <View style={styles.failure}>
                    <InlineError message={qa.errorMessage ?? t("documentDetail.failedToAnswer")} />
                    <Button
                      label={t("common.retry")}
                      variant="secondary"
                      size="sm"
                      onPress={() => void qa.ask(qa.question!)}
                    />
                  </View>
                ) : (
                  <>
                    {qa.status === "loading" ? (
                      <View style={styles.traceLine}>
                        <ActivityIndicator size="small" color={colors.muted} />
                        <Text style={styles.traceText}>{t("documentDetail.searchingChunks")}</Text>
                      </View>
                    ) : qa.citations.length > 0 ? (
                      <View style={styles.traceLine}>
                        <MaterialCommunityIcons
                          name="check-circle-outline"
                          size={15}
                          color={colors.muted}
                        />
                        <Text style={styles.traceText}>
                          {`${t("documentDetail.referencedExcerpts")} (${qa.citations.length})`}
                        </Text>
                      </View>
                    ) : null}
                    {qa.answerText ? (
                      <AnswerMarkdown
                        answer={qa.answerText}
                        citations={qa.citations}
                        onOpenCitation={onOpenCitation}
                      />
                    ) : (
                      <SkeletonLines />
                    )}
                  </>
                )}
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function AnsweredTurn({
  entry,
  onOpenCitation,
}: {
  entry: QaHistoryEntry;
  onOpenCitation: (citation: QaCitation) => void;
}) {
  const styles = useStyles();
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const citations: QaCitation[] = entry.citations ?? [];
  // A legacy entry has no `used` flag: it counts as used.
  const used = citations.filter((citation) => citation.used !== false);
  const unused = citations.filter((citation) => citation.used === false);
  const answer = entry.answer ?? "";

  return (
    <View style={styles.turn}>
      <QuestionBubble question={entry.question} />
      <View style={styles.answerRow}>
        <AnswerAvatar />
        <View style={styles.answerBody}>
          <AnswerMarkdown answer={answer} citations={citations} onOpenCitation={onOpenCitation} />
          {used.length > 0 ? (
            <Excerpts
              citations={used}
              numbered={citations}
              label={`${t("documentDetail.referencedExcerpts")} (${used.length})`}
              onSelect={onOpenCitation}
            />
          ) : null}
          {unused.length > 0 ? (
            <Excerpts
              citations={unused}
              numbered={citations}
              label={`${t("documentDetail.qaFurtherMatches")} (${unused.length})`}
              onSelect={onOpenCitation}
            />
          ) : null}
          {answer ? (
            <View style={styles.answerFooter}>
              <IconButton
                icon={copied ? "check" : "content-copy"}
                label={t("documentDetail.copyAnswer")}
                size={28}
                tone={copied ? "accent" : "muted"}
                onPress={() => {
                  void Clipboard.setStringAsync(answer).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
              />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function QuestionBubble({ question }: { question: string }) {
  const styles = useStyles();
  return (
    <View style={styles.questionRow}>
      <Gradient name="action" borderRadius={radii.xl} style={styles.bubble}>
        <Text style={styles.bubbleText}>{question}</Text>
      </Gradient>
    </View>
  );
}

function AnswerAvatar() {
  const colors = useColors();
  return (
    <IconTile size="sm" tone="solid">
      <MaterialCommunityIcons name="creation" size={15} color={colors.onGradient} />
    </IconTile>
  );
}

/** Markdown whose `[n]` markers are tappable and whose ordinary links still open. */
function AnswerMarkdown({
  answer,
  citations,
  onOpenCitation,
}: {
  answer: string;
  citations: QaCitation[];
  onOpenCitation: (citation: QaCitation) => void;
}) {
  const markdownStyles = useAnswerMarkdownStyles();
  return (
    <Markdown
      style={markdownStyles}
      onLinkPress={(url) => {
        const citation = citationForLink(url, citations);
        if (citation) {
          onOpenCitation(citation);
          return false;
        }
        return !url.startsWith("citation:");
      }}
    >
      {linkQaCitations(answer, citations)}
    </Markdown>
  );
}

/** The passages an answer rests on. Each one opens its page in the viewer. */
function Excerpts({
  citations,
  numbered,
  label,
  onSelect,
}: {
  citations: QaCitation[];
  /** The full list, so a citation keeps the number the answer's marker uses. */
  numbered: QaCitation[];
  label: string;
  onSelect: (citation: QaCitation) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
        style={styles.traceButton}
      >
        <MaterialCommunityIcons name="file-document-outline" size={15} color={colors.muted} />
        <Text style={styles.traceText}>{label}</Text>
        <MaterialCommunityIcons
          name={open ? "chevron-down" : "chevron-right"}
          size={15}
          color={colors.muted}
        />
      </Pressable>
      {open ? (
        <View style={styles.excerpts}>
          {citations.map((citation) => {
            const number = citation.index ?? numbered.indexOf(citation) + 1;
            const pageFrom = citation.pageFrom ?? citation.pageTo;
            return (
              <Pressable
                key={`${citation.chunkIndex}-${number}`}
                accessibilityRole="button"
                onPress={() => onSelect(citation)}
                style={({ pressed }) => [styles.excerpt, pressed ? styles.excerptPressed : null]}
              >
                <View style={styles.excerptNumber}>
                  <Text style={styles.excerptNumberText}>{number}</Text>
                </View>
                <View style={styles.excerptText}>
                  <Text style={styles.excerptQuote} numberOfLines={2}>
                    {citation.quote}
                  </Text>
                  {pageFrom ? (
                    <Text style={styles.excerptPage}>
                      {`${t("documentDetail.pageWord")} ${pageFrom}${
                        citation.pageTo && citation.pageTo !== pageFrom
                          ? `–${citation.pageTo}`
                          : ""
                      }`}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/** A floating pill with a gradient send button, pinned under the column by the route. */
export function QaComposer({ busy, onSend }: { busy: boolean; onSend: (question: string) => void }) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const [question, setQuestion] = useState("");
  const blocked = busy || question.trim().length === 0;

  const send = () => {
    if (blocked) {
      return;
    }
    onSend(question.trim());
    setQuestion("");
  };

  return (
    <View style={styles.composer}>
      <View style={styles.pill}>
        <TextInput
          value={question}
          onChangeText={setQuestion}
          placeholder={t("documentDetail.askQuestionPlaceholder")}
          placeholderTextColor={colors.dim}
          accessibilityLabel={t("documentDetail.askQuestionPlaceholder")}
          style={styles.input}
          multiline
          numberOfLines={1}
          returnKeyType="send"
          submitBehavior="submit"
          onSubmitEditing={send}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("documentDetail.ask")}
          accessibilityState={{ disabled: blocked, busy }}
          disabled={blocked}
          hitSlop={4}
          onPress={send}
          style={({ pressed }) => [
            blocked ? styles.sendBlocked : null,
            pressed ? styles.sendPressed : null,
          ]}
        >
          <Gradient name="action" borderRadius={radii.pill} style={styles.send}>
            {busy ? (
              <ActivityIndicator size="small" color={colors.onGradient} />
            ) : (
              <MaterialCommunityIcons name="arrow-up" size={18} color={colors.onGradient} />
            )}
          </Gradient>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((c) => ({
  empty: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  emptyTitle: {
    ...text.barTitle,
    color: c.ink,
    textAlign: "center",
  },
  emptyBody: {
    ...text.body,
    maxWidth: 300,
    color: c.muted,
    textAlign: "center",
  },
  starters: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 6,
    paddingTop: 8,
  },
  starter: {
    justifyContent: "center",
    minHeight: 36,
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: radii.pill,
    backgroundColor: c.panel,
    paddingHorizontal: 14,
  },
  starterPressed: {
    backgroundColor: c.raised,
  },
  starterText: {
    ...text.meta,
    color: c.muted,
  },
  threadHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  threadTitle: {
    ...text.bodyStrong,
    flex: 1,
    color: c.ink,
  },
  thread: {
    gap: 24,
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  turn: {
    gap: 16,
  },
  questionRow: {
    alignItems: "flex-end",
  },
  bubble: {
    maxWidth: "85%",
    overflow: "hidden",
    borderBottomRightRadius: radii.sm,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  bubbleText: {
    ...text.body,
    color: c.onGradient,
  },
  answerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  answerBody: {
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  answerFooter: {
    flexDirection: "row",
  },
  failure: {
    alignItems: "flex-start",
    gap: 8,
  },
  traceLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 24,
  },
  traceButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    minHeight: 44,
  },
  traceText: {
    ...text.meta,
    color: c.muted,
  },
  excerpts: {
    gap: 6,
  },
  excerpt: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    minHeight: 44,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.md,
    backgroundColor: c.panel,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  excerptPressed: {
    backgroundColor: c.raised,
  },
  excerptNumber: {
    alignItems: "center",
    justifyContent: "center",
    width: 18,
    height: 18,
    flexShrink: 0,
    borderRadius: radii.pill,
    backgroundColor: c.accentSoft,
  },
  excerptNumberText: {
    ...text.numericStrong,
    fontSize: 10,
    lineHeight: 14,
    color: c.accentSoftInk,
  },
  excerptText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  excerptQuote: {
    ...text.meta,
    color: c.muted,
  },
  excerptPage: {
    ...text.numericStrong,
    color: c.ink,
  },
  composer: {
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: c.panel,
  },
  pill: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.xxl,
    backgroundColor: c.panel,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
    ...raisedShadow(c),
  },
  input: {
    ...text.body,
    flex: 1,
    minHeight: 36,
    maxHeight: 128,
    paddingTop: 8,
    paddingBottom: 8,
    color: c.ink,
  },
  send: {
    alignItems: "center",
    justifyContent: "center",
    width: 36,
    height: 36,
  },
  sendBlocked: {
    opacity: 0.45,
  },
  sendPressed: {
    opacity: 0.85,
  },
}));
