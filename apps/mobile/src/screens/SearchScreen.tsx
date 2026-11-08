import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextInput,
  View,
} from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../auth";
import { AnswerMarkdown } from "../components/chat/AnswerMarkdown";
import { CitationSheet } from "../components/chat/CitationSheet";
import { Composer } from "../components/chat/Composer";
import {
  fill,
  foldTurn,
  historyFromTurns,
  nextFollowing,
  relativeAgeParts,
  splitCitations,
  turnFromStream,
  type Turn,
} from "../components/chat/conversations";
import {
  AnswerSkeleton,
  AssistantRow,
  CopyAnswerButton,
  QuestionBubble,
  TraceLine,
  WarningNote,
} from "../components/chat/parts";
import { Sources } from "../components/chat/Sources";
import { StructuredCard } from "../components/chat/StructuredCard";
import { useConversations } from "../components/chat/useConversations";
import { BottomSheet, Chip, Gradient, IconTile, Skeleton } from "../components/layout";
import { Button, EmptyState, Notice, Panel, Row } from "../components/ui";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import type { AppStackParamList } from "../../App";
import { createThemedStyles, radii, raisedShadow, useColors } from "../theme";
import { text } from "../typography";
import { formatShortDate, titleForDocument, type AnswerCitation } from "../lib";
import { useAnswerStream } from "../hooks/useAnswerStream";
import { useRecentSearches } from "../hooks/useRecentSearches";
import { queryAllCachedDocuments } from "../offline-pages";

type Translate = ReturnType<typeof useI18n>["t"];

function ageLabel(at: number, t: Translate) {
  const { unit, count } = relativeAgeParts(at, Date.now());
  if (unit === "now") return t("chat.ageNow");
  const key = unit === "days" ? "chat.ageDays" : unit === "weeks" ? "chat.ageWeeks" : "chat.ageMonths";
  return fill(t(key), { count });
}

function usedSourcesLabel(count: number, t: Translate) {
  return count === 1 ? t("chat.usedSourcesOne") : fill(t("chat.usedSourcesMany"), { count });
}

/** A finished turn of the thread. */
function TurnView({
  turn,
  onOpenCitation,
  onOpenDocument,
  isReachable,
}: {
  turn: Turn;
  onOpenCitation: (citation: AnswerCitation) => void;
  onOpenDocument: (documentId: string, title: string) => void;
  isReachable: (documentId: string) => boolean;
}) {
  const styles = useStyles();
  const { t } = useI18n();
  const { used, unused } = splitCitations(turn.citations);

  return (
    <View style={styles.turn}>
      <QuestionBubble>{turn.question}</QuestionBubble>
      <AssistantRow>
        {turn.source === "error" ? (
          <Text style={styles.answerError}>{turn.answer}</Text>
        ) : (
          <AnswerMarkdown
            text={turn.answer}
            citations={turn.citations}
            onCitationSelect={onOpenCitation}
          />
        )}

        {turn.insufficient ? <WarningNote label={t("chat.notEnoughEvidence")} /> : null}
        {turn.lowConfidence && !turn.source ? <WarningNote label={t("chat.lowConfidence")} /> : null}

        {turn.structuredRows && turn.structuredRows.length > 0 ? (
          <StructuredCard
            title={turn.structuredTitle ?? t("chat.documentColumn")}
            total={turn.structuredTotal}
            rows={turn.structuredRows}
            onOpen={onOpenDocument}
            isReachable={isReachable}
          />
        ) : null}

        {used.length > 0 ? (
          <Sources
            citations={used}
            label={usedSourcesLabel(used.length, t)}
            defaultOpen
            pageLabel={t("chat.pageAbbrev")}
            onSelect={onOpenCitation}
            isReachable={isReachable}
            unreachableNote={t("chat.notCached")}
          />
        ) : null}
        {unused.length > 0 ? (
          <Sources
            citations={unused}
            label={fill(t("chat.furtherMatches"), { count: unused.length })}
            pageLabel={t("chat.pageAbbrev")}
            onSelect={onOpenCitation}
            isReachable={isReachable}
            unreachableNote={t("chat.notCached")}
          />
        ) : null}

        {turn.source ? null : <CopyAnswerButton value={turn.answer} />}
      </AssistantRow>
    </View>
  );
}

function SuggestionRow({
  items,
  onPick,
  disabled,
}: {
  items: string[];
  onPick: (item: string) => void;
  disabled: boolean;
}) {
  const styles = useStyles();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.suggestions}
      contentContainerStyle={styles.suggestionRow}
    >
      {items.map((item) => (
        <Chip key={item} label={item} onPress={() => onPick(item)} disabled={disabled} />
      ))}
    </ScrollView>
  );
}

/** A phone's keyboard covers the home indicator, so the inset only counts without one. */
function useKeyboardShown() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setShown(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setShown(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return shown;
}

type Pending = { question: string; target: string | null };

export function SearchScreen() {
  const styles = useStyles();
  const colors = useColors();
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const route = useRoute<RouteProp<{ Chat: { q?: string } | undefined }, "Chat">>();
  const insets = useSafeAreaInsets();
  const keyboardShown = useKeyboardShown();
  const shouldUseCache = offline.shouldUseCache || auth.isOfflineSession;

  const stream = useAnswerStream(auth.streamFetch);
  const { recentSearches, addSearch, clearAll } = useRecentSearches();
  const { conversations, loaded, commit } = useConversations();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  /** The question in flight, and the conversation it was asked in. */
  const [pending, setPending] = useState<Pending | null>(null);
  const [selectedCitation, setSelectedCitation] = useState<AnswerCitation | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  const rootRef = useRef<View>(null);
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const following = useRef(true);
  const lastOffset = useRef(0);
  /** The saved conversations have been read and the latest one selected. */
  const [picked, setPicked] = useState(false);

  // Like the web, Chat opens on the latest conversation.
  useEffect(() => {
    if (!loaded) {
      setPicked(false);
    } else if (!picked) {
      setActiveId(conversations[0]?.id ?? null);
      setPicked(true);
    }
  }, [conversations, loaded, picked]);

  const providersQuery = useQuery({
    queryKey: ["health", "providers", auth.apiUrl],
    queryFn: async () => {
      const response = await auth.authFetch("/api/health/providers");
      if (!response.ok) throw new Error("providers");
      return (await response.json()) as { activeChatProvider?: string | null };
    },
    staleTime: 5 * 60_000,
    enabled: !shouldUseCache,
  });
  const chatModel = providersQuery.data?.activeChatProvider ?? null;

  // Offline the draft searches the local copy instead of asking.
  const cachedSearch = useQuery({
    queryKey: ["cached-search", draft.trim(), offline.cacheSummary.revision],
    enabled: shouldUseCache && draft.trim().length > 0,
    queryFn: () => offline.queryCachedDocuments({ query: draft }),
  });

  // Which documents the local copy holds, so a citation can say it cannot be followed.
  const cachedList = useQuery({
    queryKey: ["cached-ids", offline.cacheSummary.revision],
    enabled: shouldUseCache,
    // Every document, not the first page: one past it is still on the device.
    queryFn: () => queryAllCachedDocuments(offline.queryCachedDocuments, {}),
  });
  const cachedIds = useMemo(
    () => new Set((cachedList.data?.items ?? []).map((document) => document.id)),
    [cachedList.data],
  );
  const isReachable = useCallback(
    (documentId: string) => !shouldUseCache || cachedIds.has(documentId),
    [cachedIds, shouldUseCache],
  );

  const active = conversations.find((entry) => entry.id === activeId) ?? null;
  const busy = pending !== null;

  const ask = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      // One stream at a time: a second question would abort the first.
      if (!trimmed || busy || shouldUseCache) {
        return;
      }
      addSearch(trimmed);
      setDraft("");
      setPending({ question: trimmed, target: activeId });
      following.current = true;
      setShowJump(false);
      // Replay the visible thread so follow-up questions resolve server-side;
      // the hook caps how many turns are sent.
      void stream.startStream(trimmed, historyFromTurns(active?.turns ?? []));
    },
    [active, activeId, addSearch, busy, shouldUseCache, stream],
  );

  // Deep link from the omnibar's "open full search". It waits for the saved
  // conversations, and for any answer still on its way, rather than losing it.
  const deepLinkedQuestion = route.params?.q;
  useEffect(() => {
    if (!deepLinkedQuestion || !picked || busy || shouldUseCache) {
      return;
    }
    navigation.setParams({ q: undefined } as never);
    ask(deepLinkedQuestion);
  }, [ask, busy, deepLinkedQuestion, navigation, picked, shouldUseCache]);

  // A finished stream is folded into the conversation it was asked in.
  useEffect(() => {
    if (!pending || (stream.status !== "done" && stream.status !== "error")) {
      return;
    }
    const { conversations: next, createdId } = foldTurn(
      conversations,
      pending.target,
      turnFromStream(pending.question, stream, {
        error: t("chat.errorNote"),
        insufficient: t("chat.notEnoughEvidence"),
      }),
      { now: Date.now(), newId: `conversation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
    );
    commit(next);
    // Only follow it if the user has not moved on while the answer was streaming.
    if (createdId && activeId === pending.target) {
      setActiveId(createdId);
    }
    setPending(null);
    stream.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.status]);

  const scrollToEnd = useCallback((animated: boolean) => {
    scrollRef.current?.scrollToEnd({ animated });
  }, []);

  const onThreadScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    following.current = nextFollowing(following.current, lastOffset.current, {
      offset: contentOffset.y,
      viewport: layoutMeasurement.height,
      content: contentSize.height,
    });
    lastOffset.current = contentOffset.y;
    setShowJump(!following.current);
  }, []);

  const followEnd = useCallback(() => {
    if (following.current) {
      scrollToEnd(false);
    }
  }, [scrollToEnd]);

  const openCitation = useCallback((citation: AnswerCitation) => {
    Keyboard.dismiss();
    setSelectedCitation(citation);
  }, []);

  const openDocument = useCallback(
    (documentId: string, title: string) =>
      navigation.navigate("DocumentDetail", { documentId, title }),
    [navigation],
  );

  /** Opens on the page the passage is on, with the passage highlighted. */
  const findInDocument = useCallback(
    (citation: AnswerCitation) => {
      setSelectedCitation(null);
      navigation.navigate("DocumentDetail", {
        documentId: citation.documentId,
        title: citation.documentTitle,
        citation: { page: citation.pageFrom, quote: citation.quote },
      });
    },
    [navigation],
  );

  const selectConversation = useCallback((id: string | null) => {
    setActiveId(id);
    setSelectedCitation(null);
    setHistoryOpen(false);
    following.current = true;
    lastOffset.current = 0;
    setShowJump(false);
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
  }, []);

  const confirmClearRecent = () => {
    Alert.alert(t("chat.clearRecentConfirmTitle"), t("chat.clearRecentConfirmBody"), [
      { text: t("settings.cancel"), style: "cancel" },
      { text: t("chat.clearRecent"), style: "destructive", onPress: () => clearAll() },
    ]);
  };

  const followUps = useMemo(
    () =>
      recentSearches
        .filter((entry) => entry.query !== active?.turns.at(-1)?.question)
        .slice(0, 3)
        .map((entry) => entry.query),
    [active, recentSearches],
  );
  const starters = [
    t("chat.starter1"),
    t("chat.starter2"),
    t("chat.starter3"),
    t("chat.starter4"),
  ];

  const showPending = pending !== null && pending.target === activeId;
  const isEmpty = !active && !showPending;
  const canSend = draft.trim().length > 0 && !busy && !shouldUseCache;
  const composer = (
    <Composer
      inputRef={inputRef}
      value={draft}
      onChangeText={setDraft}
      onSend={() => ask(draft)}
      placeholder={t("chat.placeholder")}
      hint={
        shouldUseCache
          ? t("state.offline")
          : chatModel
            ? `${chatModel} · ${t("chat.onlyText")}`
            : t("chat.onlyText")
      }
      busy={busy}
      canSend={canSend}
    />
  );

  // Offline the assistant is unavailable, but the local copy is searchable.
  const cachedResults =
    shouldUseCache && draft.trim().length > 0 ? (
      cachedSearch.isLoading ? (
        <Text style={styles.cacheNote}>{t("chat.searchingCache")}</Text>
      ) : (cachedSearch.data?.items.length ?? 0) === 0 ? (
        <EmptyState icon="file-search-outline" title={t("chat.noCachedResults")} />
      ) : (
        <Panel style={styles.cacheList}>
          {cachedSearch.data?.items.map((document) => (
            <Row
              key={document.id}
              title={titleForDocument(document)}
              meta={document.correspondent?.name ?? t("documents.unfiled")}
              valueMeta={formatShortDate(document.issueDate ?? document.createdAt)}
              onPress={() => openDocument(document.id, titleForDocument(document))}
            />
          ))}
        </Panel>
      )
    ) : null;

  return (
    <View
      ref={rootRef}
      style={styles.root}
      // The header sits above this screen, and the keyboard's position is measured
      // from the window: without the offset the composer ends up behind it.
      onLayout={() =>
        rootRef.current?.measureInWindow((_x, y) => {
          if (Number.isFinite(y)) setKeyboardOffset(y);
        })
      }
    >
      {shouldUseCache ? <Notice label={t("state.offlineChat")} /> : null}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={keyboardOffset}
      >
        {!loaded ? (
          <View style={styles.flex} />
        ) : isEmpty ? (
          <Gradient name="wash" style={styles.flex}>
            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.emptyContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.emptyHeading}>
                <IconTile size="lg" tone="solid">
                  <MaterialCommunityIcons name="creation" size={22} color={colors.onGradient} />
                </IconTile>
                <Text accessibilityRole="header" style={styles.emptyTitle}>
                  {t("chat.emptyTitle")}
                </Text>
                <Text style={styles.emptyBody}>{t("chat.emptyBody")}</Text>
              </View>
              {composer}
              {shouldUseCache ? null : (
                <SuggestionRow
                  items={[...new Set([...followUps, ...starters])]}
                  onPick={ask}
                  disabled={busy}
                />
              )}
              {cachedResults}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("chat.history")}
              onPress={() => setHistoryOpen(true)}
              style={styles.emptyHistory}
            >
              <MaterialCommunityIcons name="history" size={20} color={colors.muted} />
            </Pressable>
          </Gradient>
        ) : (
          <>
            <View style={styles.threadBar}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("chat.history")}
                onPress={() => setHistoryOpen(true)}
                style={styles.barIcon}
              >
                <MaterialCommunityIcons name="history" size={20} color={colors.muted} />
              </Pressable>
              <Text accessibilityRole="header" style={styles.threadTitle} numberOfLines={1}>
                {active?.title ?? pending?.question}
              </Text>
              {active ? (
                <Text style={styles.threadTurns}>
                  {active.turns.length === 1
                    ? t("chat.turnOne")
                    : fill(t("chat.turnsMany"), { count: active.turns.length })}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("chat.newConversation")}
                onPress={() => selectConversation(null)}
                style={styles.barNew}
              >
                <MaterialCommunityIcons name="plus" size={17} color={colors.muted} />
                <Text style={styles.barNewText}>{t("chat.newOne")}</Text>
              </Pressable>
            </View>

            <View style={styles.flex}>
              <ScrollView
                ref={scrollRef}
                style={styles.flex}
                contentContainerStyle={styles.thread}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                scrollEventThrottle={64}
                onScroll={onThreadScroll}
                onContentSizeChange={followEnd}
                onLayout={followEnd}
              >
                {(active?.turns ?? []).map((turn, index) => (
                  <TurnView
                    key={`${active?.id}-${index}`}
                    turn={turn}
                    onOpenCitation={openCitation}
                    onOpenDocument={openDocument}
                    isReachable={isReachable}
                  />
                ))}

                {showPending ? (
                  <View style={styles.turn} accessibilityState={{ busy: true }}>
                    <QuestionBubble>{pending.question}</QuestionBubble>
                    <AssistantRow>
                      <View>
                        {stream.status === "searching" ? (
                          <TraceLine icon="magnify" label={t("chat.searching")} status="pulse" />
                        ) : stream.searchResults.length > 0 ? (
                          <TraceLine
                            icon="check-circle-outline"
                            label={fill(t("chat.searchedMany"), {
                              count: stream.searchResults.length,
                            })}
                          />
                        ) : null}
                        {stream.toolStatus ? (
                          <TraceLine label={stream.toolStatus} status="spin" />
                        ) : null}
                      </View>
                      {stream.answerText ? (
                        <AnswerMarkdown
                          text={stream.answerText}
                          citations={stream.citations}
                          onCitationSelect={openCitation}
                        />
                      ) : (
                        <AnswerSkeleton />
                      )}
                      {stream.lowConfidence ? (
                        <WarningNote label={t("chat.lowConfidence")} />
                      ) : null}
                    </AssistantRow>
                  </View>
                ) : null}

                {cachedResults}
              </ScrollView>

              {showJump ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("chat.jumpToEnd")}
                  onPress={() => {
                    following.current = true;
                    setShowJump(false);
                    scrollToEnd(true);
                  }}
                  style={styles.jump}
                >
                  <MaterialCommunityIcons name="arrow-down" size={18} color={colors.ink} />
                </Pressable>
              ) : null}
            </View>

            <View
              style={[
                styles.composerDock,
                { paddingBottom: keyboardShown ? 12 : Math.max(insets.bottom, 16) },
              ]}
            >
              {followUps.length > 0 && !shouldUseCache ? (
                <SuggestionRow items={followUps} onPick={ask} disabled={busy} />
              ) : null}
              {composer}
            </View>
          </>
        )}
      </KeyboardAvoidingView>

      <CitationSheet
        citation={selectedCitation}
        onClose={() => setSelectedCitation(null)}
        onFind={findInDocument}
        reachable={selectedCitation ? isReachable(selectedCitation.documentId) : true}
      />

      <BottomSheet
        visible={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={t("chat.history")}
        footer={
          <View style={styles.flex}>
            <Button
              label={t("chat.newConversation")}
              icon="plus"
              variant="secondary"
              onPress={() => selectConversation(null)}
            />
          </View>
        }
      >
        {!loaded ? (
          <Skeleton style={styles.historySkeleton} />
        ) : conversations.length === 0 ? (
          <Text style={styles.historyEmpty}>{t("chat.noConversations")}</Text>
        ) : (
          <View style={styles.historyList}>
            {conversations.map((entry) => {
              const current = entry.id === activeId;
              return (
                <Pressable
                  key={entry.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: current }}
                  onPress={() => selectConversation(entry.id)}
                  style={({ pressed }) => [
                    styles.historyRow,
                    current ? styles.historyRowActive : null,
                    pressed && !current ? styles.historyRowPressed : null,
                  ]}
                >
                  <Text
                    style={[styles.historyTitle, current ? styles.historyTitleActive : null]}
                    numberOfLines={1}
                  >
                    {entry.title}
                  </Text>
                  <Text style={styles.historyAge}>{ageLabel(entry.at, t)}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <Text style={styles.privacyNote}>{t("chat.privacyNote")}</Text>
        {recentSearches.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={confirmClearRecent}
            style={styles.clearRecent}
          >
            <Text style={styles.clearRecentText}>{t("chat.clearRecentQuestions")}</Text>
          </Pressable>
        ) : null}
      </BottomSheet>
    </View>
  );
}

const useStyles = createThemedStyles((c) => ({
  root: {
    flex: 1,
    backgroundColor: c.app,
  },
  flex: {
    flex: 1,
  },

  /* empty */
  emptyContent: {
    flexGrow: 1,
    justifyContent: "center",
    gap: 20,
    paddingHorizontal: 16,
    paddingVertical: 56,
  },
  emptyHeading: {
    alignItems: "center",
    gap: 12,
  },
  emptyTitle: {
    ...text.screenTitle,
    fontSize: 30,
    lineHeight: 36,
    color: c.accent,
    textAlign: "center",
  },
  emptyBody: {
    ...text.body,
    maxWidth: 320,
    color: c.muted,
    textAlign: "center",
  },
  emptyHistory: {
    ...StyleSheet.absoluteFillObject,
    top: 4,
    left: 4,
    right: undefined,
    bottom: undefined,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  suggestions: {
    flexGrow: 0,
    marginHorizontal: -16,
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },

  /* thread */
  threadBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 48,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  barIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  threadTitle: {
    ...text.bodyStrong,
    flex: 1,
    minWidth: 0,
    color: c.ink,
  },
  threadTurns: {
    ...text.numeric,
    color: c.muted,
    marginLeft: 4,
  },
  barNew: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 44,
    paddingHorizontal: 10,
  },
  barNewText: {
    ...text.bodyStrong,
    color: c.muted,
  },
  thread: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 16,
    gap: 24,
  },
  turn: {
    gap: 16,
  },
  answerError: {
    ...text.body,
    color: c.red,
  },
  jump: {
    position: "absolute",
    alignSelf: "center",
    bottom: 10,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.panel,
    ...raisedShadow(c),
  },
  composerDock: {
    flexShrink: 0,
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 4,
  },

  /* offline search of the local copy */
  cacheNote: {
    ...text.body,
    color: c.muted,
    textAlign: "center",
  },
  cacheList: {
    overflow: "hidden",
  },

  /* history */
  historySkeleton: {
    height: 44,
  },
  historyEmpty: {
    ...text.body,
    color: c.muted,
    paddingVertical: 8,
  },
  historyList: {
    gap: 2,
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 10,
    borderRadius: radii.md,
  },
  historyRowActive: {
    backgroundColor: c.accentSoft,
  },
  historyRowPressed: {
    backgroundColor: c.bar,
  },
  historyTitle: {
    ...text.body,
    flex: 1,
    color: c.ink,
  },
  historyTitleActive: {
    ...text.bodyStrong,
    color: c.accentSoftInk,
  },
  historyAge: {
    ...text.numeric,
    color: c.muted,
  },
  privacyNote: {
    ...text.small,
    color: c.muted,
  },
  clearRecent: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
  },
  clearRecentText: {
    ...text.metaStrong,
    color: c.accent,
  },
}));
