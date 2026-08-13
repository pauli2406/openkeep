import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Markdown from "react-native-markdown-display";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../auth";
import {
  EmptyState,
  ErrorCard,
  Notice,
  PulsingDot,
  Row,
  Screen,
} from "../components/ui";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import type { AppStackParamList } from "../../App";
import { createThemedStyles, radii, useColors } from "../theme";
import { fonts, text } from "../typography";
import {
  formatCurrency,
  formatShortDate,
  linkifyCitations,
  titleForDocument,
  type AnswerCitation,
  type ArchiveDocument,
} from "../lib";
import { useAnswerStream, type StreamState } from "../hooks/useAnswerStream";
import { useRecentSearches } from "../hooks/useRecentSearches";
import { useSuggestions } from "../hooks/useSuggestions";

type Translate = ReturnType<typeof useI18n>["t"];

/**
 * One question and the answer to it. Completed turns hold a frozen copy of the
 * stream state; the turn at the end reads `answerStream` live. `useAnswerStream`
 * is unchanged — it still holds exactly one stream. (#112)
 */
type Turn = {
  id: string;
  question: string;
  answer: StreamState | null;
};

function citationsInOrder(citations: AnswerCitation[]) {
  // Prefer what the answer actually cited (legacy payloads have no `used` flag
  // and count as used); only when nothing was cited fall back to all hits.
  const used = citations.filter((citation) => citation.used !== false);
  const relevant = used.length > 0 ? used : citations;

  const seen = new Map<string, AnswerCitation>();
  for (const citation of relevant) {
    // Keyed by passage, not by index — the old `${index}:${documentId}` key was
    // unique per citation and never deduplicated anything.
    const key = `${citation.documentId}:${citation.chunkIndex}`;
    if (!seen.has(key)) {
      seen.set(key, citation);
    }
  }
  return Array.from(seen.values()).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

// ---------------------------------------------------------------------------
// Structured results — a compact bordered table, not a stack of cards
// ---------------------------------------------------------------------------

function StructuredTable({
  data,
  onOpen,
  t,
}: {
  data: NonNullable<StreamState["structuredData"]>;
  onOpen: (documentId: string, title: string) => void;
  t: Translate;
}) {
  const styles = useStyles();

  // Mixed currencies (and deadlines with no amounts at all) leave `totalAmount`
  // null, which would render as a bare dash. The open count is always there.
  const total =
    data.kind === "deadline_items"
      ? data.totalAmount === null
        ? String(data.totalOpenCount)
        : formatCurrency(data.totalAmount, data.currency ?? "EUR")
      : String(data.totalCount);

  return (
    <View style={styles.table}>
      <View style={styles.tableHeader}>
        <Text style={styles.tableHeaderLabel}>
          {data.kind === "document_table" ? data.title : t("chat.openItems")}
        </Text>
        <Text style={styles.tableHeaderTotal}>{total}</Text>
      </View>
      {data.kind === "deadline_items"
        ? data.items.map((item) => (
            <Row
              key={`${item.documentId}-${item.dueDate}`}
              minHeight={56}
              title={item.title}
              meta={
                item.isOverdue
                  ? `${Math.abs(item.daysUntilDue)}${t("dashboard.tasks.overdueDays")}`
                  : `${t("chat.dueDate")} ${formatShortDate(item.dueDate)}`
              }
              value={formatCurrency(item.amount, item.currency ?? "EUR")}
              valueTone={item.isOverdue ? "red" : "ink"}
              onPress={() => onOpen(item.documentId, item.title)}
            />
          ))
        : (data.items as ArchiveDocument[]).map((document) => (
            <Row
              key={document.id}
              minHeight={56}
              title={titleForDocument(document)}
              meta={document.correspondent?.name ?? t("documents.unfiled")}
              // "which contracts expire this month" is a question about expiry
              // dates; an issue date answers a different one.
              valueMeta={formatShortDate(
                data.kind === "expiring_contracts"
                  ? (document.expiryDate ?? document.issueDate ?? document.createdAt)
                  : (document.issueDate ?? document.createdAt),
              )}
              onPress={() => onOpen(document.id, titleForDocument(document))}
            />
          ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// One turn of the thread
// ---------------------------------------------------------------------------

function TurnView({
  turn,
  live,
  documentCount,
  onOpenDocument,
  onOpenCitation,
  cachedIds,
}: {
  turn: Turn;
  live: StreamState | null;
  documentCount: number;
  onOpenDocument: (documentId: string, title: string) => void;
  onOpenCitation: (citation: AnswerCitation) => void;
  /** Null when online: every document is reachable. */
  cachedIds: Set<string> | null;
}) {
  const styles = useStyles();
  const markdownStyles = useMarkdownStyles();
  const { t } = useI18n();

  const state = turn.answer ?? live;
  const searching = state?.status === "searching";
  const citations = state ? citationsInOrder(state.citations) : [];

  return (
    <View style={styles.turn}>
      <View style={styles.questionRow}>
        <View style={styles.questionBubble}>
          <Text style={styles.questionText}>{turn.question}</Text>
        </View>
      </View>

      {searching ? (
        <View style={styles.searchingWrap}>
          <View style={styles.searchingRow}>
            <Text style={styles.searchingText}>
              {`${t("chat.searched")} ${documentCount.toLocaleString()} ${t("chat.documents")}`}
            </Text>
            <PulsingDot style={styles.searchingDot} />
          </View>
          <View style={styles.skeletonLong} />
          <View style={styles.skeletonShort} />
        </View>
      ) : null}

      {state?.toolStatus ? (
        <View style={styles.searchingRow}>
          <Text style={styles.searchingText}>{state.toolStatus}</Text>
          <PulsingDot style={styles.searchingDot} />
        </View>
      ) : null}

      {state?.status === "error" ? (
        <Text style={styles.answerError}>{state.errorMessage ?? t("chat.failed")}</Text>
      ) : null}

      {state?.answerText ? (
        <Markdown
          style={markdownStyles}
          onLinkPress={(url) => {
            if (!url.startsWith("/documents/")) {
              // An ordinary http link in the answer: let the markdown component
              // open it rather than swallowing the tap.
              return true;
            }
            const [documentId, marker] = url.slice("/documents/".length).split("#c");
            const index = marker ? Number(marker) : null;
            const citation =
              (index !== null && Number.isFinite(index)
                ? citations.find(
                    (item) => item.documentId === documentId && item.index === index,
                  )
                : undefined) ?? citations.find((item) => item.documentId === documentId);
            if (citation && (!cachedIds || cachedIds.has(citation.documentId))) {
              onOpenCitation(citation);
            }
            return false;
          }}
        >
          {linkifyCitations(state.answerText, state.citations, state.searchResults)}
        </Markdown>
      ) : null}

      {state?.lowConfidence && state.status === "done" ? (
        <View style={styles.insufficient}>
          <Text style={styles.insufficientText}>{t("chat.lowConfidence")}</Text>
        </View>
      ) : null}

      {state?.answerStatus === "insufficient_evidence" ? (
        <View style={styles.insufficient}>
          <Text style={styles.insufficientText}>{t("chat.insufficient")}</Text>
        </View>
      ) : null}

      {state?.structuredData ? (
        <StructuredTable data={state.structuredData} onOpen={onOpenDocument} t={t} />
      ) : null}

      {citations.length > 0 ? (
        <View>
          <Text style={styles.sourcesLabel}>{t("chat.sources")}</Text>
          <View style={styles.sourceRow}>
            {citations.map((citation) => {
              // Offline, a citation into a document the copy has not got would
              // open a blank reader. Say so on the pill instead.
              const reachable = !cachedIds || cachedIds.has(citation.documentId);
              return (
                <Pressable
                  key={`${citation.index}-${citation.documentId}-${citation.chunkIndex}`}
                  onPress={() => (reachable ? onOpenCitation(citation) : undefined)}
                  disabled={!reachable}
                  style={[styles.sourcePill, reachable ? null : styles.sourcePillMuted]}
                >
                  <View style={styles.sourceIndex}>
                    <Text style={styles.sourceIndexText}>{citation.index ?? "?"}</Text>
                  </View>
                  <Text style={styles.sourceTitle} numberOfLines={1}>
                    {citation.documentTitle}
                  </Text>
                  {reachable ? null : (
                    <Text style={styles.sourceNote}>{t("chat.notCached")}</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export function SearchScreen() {
  const styles = useStyles();
  const colors = useColors();
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const shouldUseCache = offline.shouldUseCache || auth.isOfflineSession;

  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const turnCounter = useRef(0);

  const answerStream = useAnswerStream(auth.streamFetch);
  const { recentSearches, addSearch, clearAll } = useRecentSearches();
  const { suggestions } = useSuggestions(auth.authFetch, !shouldUseCache);

  const cachedSearch = useQuery({
    queryKey: ["cached-search", draft.trim(), offline.cacheSummary.revision],
    enabled: shouldUseCache && draft.trim().length > 0,
    queryFn: () => offline.queryCachedDocuments({ query: draft }),
  });

  const openDocument = useCallback(
    (documentId: string, title: string) =>
      navigation.navigate("DocumentDetail", { documentId, title }),
    [navigation],
  );

  /** A citation opens the document on the page its passage is on. */
  const openCitation = useCallback(
    (citation: AnswerCitation) =>
      navigation.navigate("DocumentDetail", {
        documentId: citation.documentId,
        title: citation.documentTitle,
        citation: { page: citation.pageFrom, quote: citation.quote },
      }),
    [navigation],
  );

  // Which documents the local copy actually holds, so a citation can say when
  // it cannot be followed.
  const cachedList = useQuery({
    queryKey: ["cached-ids", offline.cacheSummary.revision],
    enabled: shouldUseCache,
    queryFn: () => offline.queryCachedDocuments(),
  });
  const cachedIds = shouldUseCache
    ? new Set((cachedList.data?.items ?? []).map((document) => document.id))
    : null;

  const status = answerStream.status;

  /**
   * A finished stream is copied into its turn. That frees the single stream in
   * `useAnswerStream` for the next question while the thread keeps the answer.
   */
  useEffect(() => {
    if (status !== "done" && status !== "error") {
      return;
    }
    setTurns((current) => {
      const last = current.at(-1);
      if (!last || last.answer !== null) {
        return current;
      }
      const snapshot: StreamState = {
        status: answerStream.status,
        answerStatus: answerStream.answerStatus,
        lowConfidence: answerStream.lowConfidence,
        route: answerStream.route,
        answerText: answerStream.answerText,
        citations: answerStream.citations,
        searchResults: answerStream.searchResults,
        structuredData: answerStream.structuredData,
        toolStatus: null,
        errorMessage: answerStream.errorMessage,
      };
      return [...current.slice(0, -1), { ...last, answer: snapshot }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const busy = status === "searching" || status === "streaming";

  const ask = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      // A second question would abort the first stream, and only the last turn
      // reads the live state — the aborted one would sit there answerless.
      if (!trimmed || shouldUseCache || status === "searching" || status === "streaming") {
        return;
      }
      turnCounter.current += 1;
      // Replay the visible thread so follow-up questions resolve server-side.
      const history = turns
        .filter((turn) => turn.answer?.answerText)
        .flatMap((turn) => [
          { role: "user" as const, content: turn.question },
          { role: "assistant" as const, content: turn.answer!.answerText },
        ]);
      setTurns((current) => [
        ...current,
        { id: `turn-${turnCounter.current}`, question: trimmed, answer: null },
      ]);
      setDraft("");
      void addSearch(trimmed);
      answerStream.startStream(trimmed, history);
      inputRef.current?.blur();
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    },
    [addSearch, answerStream, shouldUseCache, status, turns],
  );

  const newThread = useCallback(() => {
    answerStream.reset();
    setTurns([]);
    setDraft("");
  }, [answerStream]);

  const liveState: StreamState | null =
    status === "idle"
      ? null
      : {
          status: answerStream.status,
          answerStatus: answerStream.answerStatus,
          lowConfidence: answerStream.lowConfidence,
          route: answerStream.route,
          answerText: answerStream.answerText,
          citations: answerStream.citations,
          searchResults: answerStream.searchResults,
          structuredData: answerStream.structuredData,
          toolStatus: answerStream.toolStatus,
          errorMessage: answerStream.errorMessage,
        };

  const documentCount = answerStream.searchResults.length;
  const lastQuestion = turns.at(-1)?.question;

  return (
    <Screen
      title={lastQuestion ?? t("chat.title")}
      titleMeta={t("chat.scopeArchive")}
      padded={false}
      scroll={false}
      notice={shouldUseCache ? <Notice label={t("state.offlineChat")} /> : undefined}
      right={
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("chat.historyAction")}
            onPress={() => setHistoryOpen(true)}
            hitSlop={12}
          >
            <MaterialCommunityIcons name="history" size={18} color={colors.muted} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("chat.newThread")}
            onPress={newThread}
            hitSlop={12}
          >
            <MaterialCommunityIcons name="plus" size={19} color={colors.muted} />
          </Pressable>
        </>
      }
    >
      <ScrollView ref={scrollRef} style={styles.threadScroll} contentContainerStyle={styles.thread}>
        {turns.length === 0 && !shouldUseCache ? (
          <EmptyState title={t("chat.placeholder")} body={t("chat.subtitle")} />
        ) : null}

        {turns.map((turn, index) => (
          <TurnView
            key={turn.id}
            turn={turn}
            live={index === turns.length - 1 ? liveState : null}
            documentCount={documentCount}
            onOpenDocument={openDocument}
            onOpenCitation={openCitation}
            cachedIds={cachedIds}
          />
        ))}

        {/* Offline the assistant is unavailable, but the local copy is searchable */}
        {shouldUseCache && draft.trim().length > 0
          ? cachedSearch.isLoading
            ? <Text style={styles.searchingText}>{t("chat.searchingCache")}</Text>
            : (cachedSearch.data?.items.length ?? 0) === 0
              ? <EmptyState title={t("chat.noCachedResults")} />
              : cachedSearch.data?.items.map((document) => (
                  <Row
                    key={document.id}
                    minHeight={56}
                    title={titleForDocument(document)}
                    meta={document.correspondent?.name ?? t("documents.unfiled")}
                    valueMeta={formatShortDate(document.issueDate ?? document.createdAt)}
                    onPress={() => openDocument(document.id, titleForDocument(document))}
                  />
                ))
          : null}

        {status === "error" && turns.length === 0 ? (
          <ErrorCard message={answerStream.errorMessage ?? t("chat.failed")} />
        ) : null}
      </ScrollView>

      {/* Composer */}
      <View style={styles.composer}>
        {suggestions.length > 0 && !shouldUseCache ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.suggestionRow}
          >
            {suggestions.slice(0, 4).map((suggestion) => (
              <Pressable
                key={suggestion}
                onPress={() => ask(suggestion)}
                disabled={busy}
                style={styles.suggestionChip}
              >
                <Text style={styles.suggestionText}>{suggestion}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={setDraft}
            placeholder={t("chat.placeholder")}
            placeholderTextColor={colors.dim}
            style={styles.input}
            multiline
            returnKeyType="send"
            onSubmitEditing={() => ask(draft)}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("chat.send")}
            onPress={() => ask(draft)}
            disabled={!draft.trim() || shouldUseCache || busy}
            style={({ pressed }) => [
              styles.sendButton,
              !draft.trim() || shouldUseCache || busy ? styles.sendButtonDisabled : null,
              pressed ? styles.sendButtonPressed : null,
            ]}
          >
            <MaterialCommunityIcons name="arrow-up" size={19} color={colors.accentFillInk} />
          </Pressable>
        </View>

        {answerStream.route ? (
          <Text style={styles.modelLine}>{`${t("chat.model")} ${answerStream.route}`}</Text>
        ) : null}
      </View>

      {/* Recent questions, behind the history icon */}
      <Modal
        visible={historyOpen}
        animationType="slide"
        onRequestClose={() => setHistoryOpen(false)}
      >
        <SafeAreaView style={styles.historyRoot} edges={["top", "bottom"]}>
          <View style={styles.historyBar}>
            <Text style={styles.historyTitle}>{t("chat.recentTitle")}</Text>
            {recentSearches.length > 0 ? (
              <Pressable onPress={() => void clearAll()} hitSlop={10}>
                <Text style={styles.historyAction}>{t("chat.clearRecent")}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => setHistoryOpen(false)} hitSlop={10}>
              <Text style={styles.historyAction}>{t("chat.close")}</Text>
            </Pressable>
          </View>
          <ScrollView>
            {recentSearches.length === 0 ? (
              <EmptyState title={t("chat.recentEmpty")} />
            ) : (
              recentSearches.map((entry) => (
                <Row
                  key={`${entry.timestamp}-${entry.query}`}
                  title={entry.query}
                  chevron
                  onPress={() => {
                    setHistoryOpen(false);
                    if (shouldUseCache) {
                      // The assistant is unavailable offline, but the draft is
                      // what drives the local cache search.
                      setDraft(entry.query);
                      return;
                    }
                    ask(entry.query);
                  }}
                />
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </Screen>
  );
}

const useStyles = createThemedStyles((c) => ({
  // Without a bounded height the thread grows past the viewport and pushes the
  // composer off screen instead of scrolling.
  threadScroll: {
    flex: 1,
  },
  thread: {
    padding: 16,
    gap: 16,
  },
  turn: {
    gap: 10,
  },
  questionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  questionBubble: {
    maxWidth: "82%",
    borderRadius: radii.xl,
    borderBottomRightRadius: 3,
    backgroundColor: c.accentSoft,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  questionText: {
    ...text.body,
    color: c.accentSoftInk,
  },

  /* streaming */
  searchingWrap: {
    gap: 8,
  },
  searchingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  searchingText: {
    ...text.numericMeta,
    color: c.dim,
  },
  searchingDot: {
    backgroundColor: c.accent,
    borderRadius: radii.pill,
  },
  skeletonLong: {
    height: 8,
    width: "92%",
    borderRadius: radii.sm,
    backgroundColor: c.raised,
  },
  skeletonShort: {
    height: 8,
    width: "62%",
    borderRadius: radii.sm,
    backgroundColor: c.raised,
  },
  answerError: {
    ...text.meta,
    color: c.red,
  },
  insufficient: {
    borderRadius: radii.lg,
    backgroundColor: c.amberSoft,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  insufficientText: {
    ...text.meta,
    color: c.amber,
  },

  /* structured table */
  table: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.lg,
    backgroundColor: c.bar,
    overflow: "hidden",
  },
  tableHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
  },
  tableHeaderLabel: {
    ...text.sectionLabel,
    flex: 1,
    fontSize: 9.5,
    color: c.dim,
  },
  tableHeaderTotal: {
    ...text.amount,
    color: c.ink,
  },

  /* sources */
  sourcesLabel: {
    ...text.sectionLabel,
    marginBottom: 7,
    color: c.dim,
  },
  sourceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  sourcePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    maxWidth: "100%",
    minHeight: 44,
    paddingHorizontal: 11,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  sourceIndex: {
    minWidth: 18,
    alignItems: "center",
    borderRadius: radii.sm,
    backgroundColor: c.accentSoft,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  sourceIndexText: {
    ...text.numericStrong,
    fontSize: 10,
    lineHeight: 14,
    color: c.accentSoftInk,
  },
  sourceTitle: {
    ...text.meta,
    flexShrink: 1,
    color: c.ink,
  },
  sourcePillMuted: {
    opacity: 0.6,
  },
  sourceNote: {
    ...text.small,
    color: c.faint,
  },

  /* composer */
  composer: {
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingTop: 9,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.bar,
    gap: 9,
  },
  suggestionRow: {
    flexDirection: "row",
    gap: 7,
  },
  suggestionChip: {
    flexShrink: 0,
    justifyContent: "center",
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  suggestionText: {
    ...text.meta,
    color: c.muted,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: radii.xl,
    backgroundColor: c.panel,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 6,
  },
  input: {
    ...text.body,
    flex: 1,
    minHeight: 34,
    maxHeight: 110,
    paddingTop: 7,
    paddingBottom: 7,
    color: c.ink,
  },
  sendButton: {
    height: 36,
    width: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.lg,
    backgroundColor: c.accentFill,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendButtonPressed: {
    opacity: 0.85,
  },
  modelLine: {
    ...text.numeric,
    fontSize: 10.5,
    lineHeight: 14,
    color: c.faint,
  },

  /* recent questions */
  historyRoot: {
    flex: 1,
    backgroundColor: c.app,
  },
  historyBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    height: 46,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.bar,
  },
  historyTitle: {
    ...text.barTitle,
    flex: 1,
    color: c.ink,
  },
  historyAction: {
    ...text.metaStrong,
    color: c.accent,
  },
}));

const useMarkdownStyles = createThemedStyles((c) => ({
  body: {
    ...text.body,
    color: c.ink,
    lineHeight: 24,
  },
  heading1: {
    ...text.barTitle,
    color: c.ink,
    marginTop: 12,
    marginBottom: 6,
  },
  heading2: {
    ...text.bodyStrong,
    color: c.ink,
    marginTop: 10,
    marginBottom: 5,
  },
  heading3: {
    ...text.bodyStrong,
    color: c.ink,
    marginTop: 8,
    marginBottom: 4,
  },
  strong: {
    ...text.bodyStrong,
    color: c.ink,
  },
  em: {
    // Android will not synthesise an italic for a named face, so name the face.
    fontFamily: fonts.sans.italic,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 8,
  },
  bullet_list: {
    marginTop: 4,
    marginBottom: 4,
  },
  ordered_list: {
    marginTop: 4,
    marginBottom: 4,
  },
  list_item: {
    marginBottom: 4,
    flexDirection: "row",
  },
  /** The inline citation marker: a small mono chip, not a blue link. */
  link: {
    ...text.numericStrong,
    fontSize: 10,
    lineHeight: 14,
    color: c.accentSoftInk,
    backgroundColor: c.accentSoft,
    borderRadius: radii.sm,
    paddingHorizontal: 4,
  },
  code_inline: {
    ...text.numeric,
    color: c.ink,
    backgroundColor: c.raised,
    borderRadius: radii.sm,
    paddingHorizontal: 4,
  },
  fence: {
    ...text.numeric,
    backgroundColor: c.raised,
    borderRadius: radii.lg,
    padding: 12,
    marginVertical: 8,
  },
  blockquote: {
    backgroundColor: c.raised,
    borderLeftWidth: 3,
    borderLeftColor: c.accent,
    paddingLeft: 12,
    paddingVertical: 8,
    marginVertical: 8,
    borderRadius: radii.sm,
  },
  table: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.lg,
    marginVertical: 8,
  },
  thead: {
    backgroundColor: c.raised,
  },
  th: {
    ...text.metaStrong,
    padding: 8,
    color: c.ink,
    borderBottomWidth: 1,
    borderColor: c.border,
  },
  td: {
    ...text.meta,
    padding: 8,
    color: c.ink,
    borderBottomWidth: 1,
    borderColor: c.border,
  },
  tr: {
    borderBottomWidth: 1,
    borderColor: c.border,
  },
}));
