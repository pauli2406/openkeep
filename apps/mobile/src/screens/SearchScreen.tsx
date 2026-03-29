import { useNavigation } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import Markdown from "react-native-markdown-display";
import { useAuth } from "../auth";
import { Card, ErrorCard, Screen } from "../components/ui";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import type { AppStackParamList } from "../../App";
import { colors, shadow } from "../theme";
import { linkifyCitations, titleForDocument, type AnswerCitation } from "../lib";
import { useAnswerStream } from "../hooks/useAnswerStream";
import { useRecentSearches } from "../hooks/useRecentSearches";
import { useSuggestions } from "../hooks/useSuggestions";

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export function SearchScreen() {
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const [query, setQuery] = useState("");
  const inputRef = useRef<TextInput>(null);

  const answerStream = useAnswerStream(auth.streamFetch);
  const { recentSearches, addSearch, removeSearch, clearAll } = useRecentSearches();
  const { suggestions, isLoading: suggestionsLoading } = useSuggestions(
    auth.authFetch,
    !offline.shouldUseOffline,
  );

  const isStreaming = answerStream.status === "searching" || answerStream.status === "streaming";
  const hasAnswer = answerStream.status === "streaming" || answerStream.status === "done";
  const hasQuery = answerStream.status !== "idle";

  const runSearch = useCallback(
    (searchQuery?: string) => {
      const q = (searchQuery ?? query).trim();
      if (!q) return;
      void addSearch(q);
      if (searchQuery) setQuery(searchQuery);
      answerStream.startStream(q);
    },
    [query, addSearch, answerStream],
  );

  const handleSuggestionPress = useCallback(
    (suggestion: string) => {
      setQuery(suggestion);
      void addSearch(suggestion);
      answerStream.startStream(suggestion);
      inputRef.current?.blur();
    },
    [addSearch, answerStream],
  );

  const handleRecentPress = useCallback(
    (recentQuery: string) => {
      setQuery(recentQuery);
      answerStream.startStream(recentQuery);
      inputRef.current?.blur();
    },
    [answerStream],
  );

  return (
    <Screen
      title={t("search.title")}
      subtitle={t("search.subtitle")}
      headerVariant="compact"
    >
      {/* ─── Search bar ─── */}
      <View style={styles.searchBarContainer}>
        <View style={styles.searchInputWrap}>
          <Text style={styles.searchIcon}>{"⌕"}</Text>
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={setQuery}
            placeholder={t("search.placeholder")}
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            onSubmitEditing={() => runSearch()}
            style={styles.searchInput}
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable
              onPress={() => {
                setQuery("");
                answerStream.reset();
                inputRef.current?.focus();
              }}
              hitSlop={8}
              style={styles.clearButton}
            >
              <Text style={styles.clearButtonText}>{"✕"}</Text>
            </Pressable>
          )}
        </View>
        <Pressable
          onPress={() => runSearch()}
          disabled={isStreaming || !query.trim()}
          style={({ pressed }) => [
            styles.searchButton,
            (isStreaming || !query.trim()) && styles.searchButtonDisabled,
            pressed && !(isStreaming || !query.trim()) ? styles.searchButtonPressed : null,
          ]}
        >
          {isStreaming ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.searchButtonText}>{t("search.search")}</Text>
          )}
        </Pressable>
      </View>

      {/* ─── Error ─── */}
      {answerStream.status === "error" && (
        <ErrorCard
          message={answerStream.errorMessage ?? t("search.searchFailed")}
          onRetry={() => runSearch()}
        />
      )}

      {/* ─── Searching state ─── */}
      {answerStream.status === "searching" && <SearchingSkeleton label={t("search.searching")} />}

      {/* ─── AI Answer panel ─── */}
      {hasAnswer && (
        <AIAnswerPanel
          answerStream={answerStream}
          documentLabel={t("search.document")}
          aiAnswerLabel={t("search.aiAnswer")}
          generatingLabel={t("search.generating")}
          answerReadyLabel={t("search.answerReady")}
          insufficientLabel={t("search.insufficient")}
          sourcesLabel={t("search.sources")}
          onCitationPress={(citation) =>
            navigation.navigate("DocumentDetail", {
              documentId: citation.documentId,
              title: citation.documentTitle,
            })
          }
        />
      )}

      {/* ─── Empty state: recent + suggestions ─── */}
      {!hasQuery && (
        <ZeroState
          recentSearches={recentSearches}
          suggestions={suggestions}
          suggestionsLoading={suggestionsLoading}
          onSelectQuery={handleSuggestionPress}
          onSelectRecent={handleRecentPress}
          onRemoveRecent={removeSearch}
          onClearAll={clearAll}
          recentLabel={t("search.recentSearches")}
          clearAllLabel={t("search.clearAll")}
          suggestedLabel={t("search.suggested")}
          noSuggestionsLabel={t("search.noSuggestions")}
        />
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Searching skeleton
// ---------------------------------------------------------------------------

function SearchingSkeleton({ label }: { label: string }) {
  const opacity = useRef(new Animated.Value(0.35)).current;

  useState(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.35,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  });

  return (
    <Card>
      <View style={styles.searchingHeader}>
        <ActivityIndicator color={colors.accent} size="small" />
        <Text style={styles.searchingText}>{label}</Text>
      </View>
      <View style={styles.skeletonLines}>
        <Animated.View style={[styles.skeletonLine, { width: "90%", opacity }]} />
        <Animated.View style={[styles.skeletonLine, { width: "75%", opacity }]} />
        <Animated.View style={[styles.skeletonLine, { width: "60%", opacity }]} />
      </View>
      <View style={styles.skeletonSources}>
        <Animated.View style={[styles.skeletonSourceCard, { opacity }]} />
        <Animated.View style={[styles.skeletonSourceCard, { opacity }]} />
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// AI Answer panel
// ---------------------------------------------------------------------------

function AIAnswerPanel({
  answerStream,
  documentLabel,
  aiAnswerLabel,
  generatingLabel,
  answerReadyLabel,
  insufficientLabel,
  sourcesLabel,
  onCitationPress,
}: {
  answerStream: ReturnType<typeof useAnswerStream>;
  documentLabel: string;
  aiAnswerLabel: string;
  generatingLabel: string;
  answerReadyLabel: string;
  insufficientLabel: string;
  sourcesLabel: string;
  onCitationPress: (citation: AnswerCitation) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isStreaming = answerStream.status === "searching" || answerStream.status === "streaming";

  const statusLabel = isStreaming
    ? generatingLabel
    : answerStream.status === "done"
      ? answerReadyLabel
      : "";

  const linkedText = linkifyCitations(
    answerStream.answerText,
    answerStream.citations,
    answerStream.searchResults.map((r) => ({
      document: { id: r.document.id, title: r.document.title },
    })),
  );

  return (
    <View style={styles.aiPanelContainer}>
      {/* Header toggle */}
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        style={[
          styles.aiPanelHeader,
          expanded ? styles.aiPanelHeaderExpanded : null,
        ]}
      >
        <View style={[styles.aiIcon, expanded ? styles.aiIconExpanded : null]}>
          <Text style={[styles.aiIconText, expanded ? styles.aiIconTextExpanded : null]}>{"✦"}</Text>
        </View>
        <View style={styles.aiPanelHeaderText}>
          <Text style={styles.aiPanelTitle}>{aiAnswerLabel}</Text>
          <Text style={styles.aiPanelStatus}>{statusLabel}</Text>
        </View>
        {isStreaming && <ActivityIndicator color={colors.accent} size="small" />}
        <Text style={styles.aiChevron}>{expanded ? "▴" : "▾"}</Text>
      </Pressable>

      {/* Content */}
      {expanded && (
        <View style={styles.aiPanelContent}>
          {/* Answer text */}
          {answerStream.answerText.length > 0 && (
            <View style={styles.answerTextContainer}>
              <Markdown
                style={markdownStyles}
                onLinkPress={(url: string) => {
                  if (url.startsWith("/documents/")) {
                    const documentId = url.replace("/documents/", "");
                    const cit = answerStream.citations.find((c) => c.documentId === documentId);
                    onCitationPress({
                      documentId,
                      documentTitle: cit?.documentTitle ?? documentLabel,
                      chunkIndex: cit?.chunkIndex ?? 0,
                      quote: cit?.quote ?? "",
                      pageFrom: cit?.pageFrom ?? null,
                      pageTo: cit?.pageTo ?? null,
                    });
                    return false;
                  }
                  return true;
                }}
              >
                {linkedText}
              </Markdown>
              {answerStream.status === "streaming" && (
                <View style={styles.streamingCursor} />
              )}
            </View>
          )}

          {/* Insufficient evidence */}
          {answerStream.status === "done" && !answerStream.answerText && (
            <View style={styles.insufficientBox}>
              <Text style={styles.insufficientText}>
                {insufficientLabel}
              </Text>
            </View>
          )}

          {/* Sources */}
          {answerStream.citations.length > 0 && (
            <View style={styles.sourcesSection}>
              <Text style={styles.sourcesLabel}>{`⊞  ${sourcesLabel}`}</Text>
              <View style={styles.sourcesGrid}>
                {answerStream.citations.map((cit, i) => (
                  <Pressable
                    key={`${cit.documentId}-${cit.chunkIndex}`}
                    onPress={() => onCitationPress(cit)}
                    style={({ pressed }) => [
                      styles.sourceCard,
                      pressed ? styles.sourceCardPressed : null,
                    ]}
                  >
                    <View style={styles.sourceCardTop}>
                      <View style={styles.sourceNumber}>
                        <Text style={styles.sourceNumberText}>{i + 1}</Text>
                      </View>
                      <Text style={styles.sourceTitle} numberOfLines={2}>
                        {cit.documentTitle}
                      </Text>
                    </View>
                    <Text style={styles.sourceQuote} numberOfLines={2}>
                      {cit.quote}
                    </Text>
                    {(cit.pageFrom || cit.pageTo) && (
                      <Text style={styles.sourcePage}>
                        {"p."}
                        {cit.pageFrom ?? cit.pageTo}
                        {cit.pageTo && cit.pageTo !== cit.pageFrom
                          ? `\u2013${cit.pageTo}`
                          : ""}
                      </Text>
                    )}
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Zero state (recent + suggestions)
// ---------------------------------------------------------------------------

function ZeroState({
  recentSearches,
  suggestions,
  suggestionsLoading,
  onSelectQuery,
  onSelectRecent,
  onRemoveRecent,
  onClearAll,
  recentLabel,
  clearAllLabel,
  suggestedLabel,
  noSuggestionsLabel,
}: {
  recentSearches: Array<{ query: string; timestamp: number }>;
  suggestions: string[];
  suggestionsLoading: boolean;
  onSelectQuery: (query: string) => void;
  onSelectRecent: (query: string) => void;
  onRemoveRecent: (query: string) => void;
  onClearAll: () => void;
  recentLabel: string;
  clearAllLabel: string;
  suggestedLabel: string;
  noSuggestionsLabel: string;
}) {
  return (
    <View style={styles.zeroState}>
      {/* Recent searches */}
      {recentSearches.length > 0 && (
        <View style={styles.zeroSection}>
          <View style={styles.zeroSectionHeader}>
            <Text style={styles.zeroSectionTitle}>{recentLabel}</Text>
            <Pressable onPress={() => void onClearAll()} hitSlop={8}>
              <Text style={styles.zeroClearAll}>{clearAllLabel}</Text>
            </Pressable>
          </View>
          {recentSearches.map((item) => (
            <Pressable
              key={item.query}
              onPress={() => onSelectRecent(item.query)}
              style={({ pressed }) => [
                styles.zeroRow,
                pressed ? styles.zeroRowPressed : null,
              ]}
            >
              <Text style={styles.zeroRowIcon}>{"◷"}</Text>
              <Text style={styles.zeroRowText} numberOfLines={1}>
                {item.query}
              </Text>
              <Pressable
                onPress={() => void onRemoveRecent(item.query)}
                hitSlop={10}
                style={styles.zeroRowRemove}
              >
                <Text style={styles.zeroRowRemoveText}>{"✕"}</Text>
              </Pressable>
            </Pressable>
          ))}
        </View>
      )}

      {/* Suggestions */}
      <View style={styles.zeroSection}>
        <View style={styles.zeroSectionHeader}>
          <Text style={styles.zeroSectionTitle}>{suggestedLabel}</Text>
        </View>

        {suggestionsLoading ? (
          <View style={styles.suggestionsLoading}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={styles.zeroRow}>
                <View style={[styles.skeletonDot, { opacity: 0.4 + i * 0.1 }]} />
                <View
                  style={[
                    styles.skeletonTextLine,
                    { width: `${55 + i * 10}%`, opacity: 0.4 + i * 0.1 },
                  ]}
                />
              </View>
            ))}
          </View>
        ) : suggestions.length > 0 ? (
          suggestions.map((suggestion) => (
            <Pressable
              key={suggestion}
              onPress={() => onSelectQuery(suggestion)}
              style={({ pressed }) => [
                styles.zeroRow,
                pressed ? styles.zeroRowPressed : null,
              ]}
            >
              <Text style={styles.zeroRowIconSpark}>{"✦"}</Text>
              <Text style={styles.zeroRowText} numberOfLines={1}>
                {suggestion}
              </Text>
            </Pressable>
          ))
        ) : (
          <View style={styles.zeroRow}>
            <Text style={styles.zeroEmptyText}>
              {noSuggestionsLabel}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Markdown styles
// ---------------------------------------------------------------------------

const markdownStyles = StyleSheet.create({
  body: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 24,
  },
  heading1: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.text,
    marginTop: 16,
    marginBottom: 8,
  },
  heading2: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.text,
    marginTop: 14,
    marginBottom: 6,
  },
  heading3: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    marginTop: 12,
    marginBottom: 4,
  },
  strong: {
    fontWeight: "800",
    color: colors.text,
  },
  em: {
    fontStyle: "italic",
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
  paragraph: {
    marginTop: 0,
    marginBottom: 8,
  },
  link: {
    color: colors.accent,
    backgroundColor: "#f6ead1",
    fontWeight: "800",
    fontSize: 11,
    letterSpacing: 0.3,
    borderRadius: 4,
    paddingHorizontal: 1,
  },
  table: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    marginTop: 8,
    marginBottom: 8,
  },
  thead: {
    backgroundColor: colors.surfaceMuted,
  },
  th: {
    padding: 8,
    fontWeight: "800",
    fontSize: 13,
    color: colors.text,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  td: {
    padding: 8,
    fontSize: 13,
    color: colors.text,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  tr: {
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  blockquote: {
    backgroundColor: colors.surfaceMuted,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    paddingLeft: 12,
    paddingVertical: 8,
    marginVertical: 8,
    borderRadius: 4,
  },
  code_inline: {
    backgroundColor: colors.surfaceMuted,
    color: colors.text,
    fontSize: 13,
    fontFamily: "Menlo",
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  fence: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
    padding: 12,
    marginVertical: 8,
    fontFamily: "Menlo",
    fontSize: 13,
  },
});

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  // Search bar
  searchBarContainer: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  searchInputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    minHeight: 50,
    ...shadow,
    shadowOpacity: 0.06,
    shadowRadius: 12,
  },
  searchIcon: {
    fontSize: 18,
    color: colors.muted,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    paddingVertical: 12,
  },
  clearButton: {
    padding: 4,
    marginLeft: 4,
  },
  clearButtonText: {
    fontSize: 14,
    color: colors.muted,
    fontWeight: "600",
  },
  searchButton: {
    backgroundColor: colors.text,
    borderRadius: 16,
    minHeight: 50,
    paddingHorizontal: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  searchButtonDisabled: {
    opacity: 0.45,
  },
  searchButtonPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.97 }],
  },
  searchButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.2,
  },

  // Searching skeleton
  searchingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchingText: {
    fontSize: 14,
    color: colors.muted,
  },
  skeletonLines: {
    gap: 10,
    marginTop: 4,
  },
  skeletonLine: {
    height: 12,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 6,
  },
  skeletonSources: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  skeletonSourceCard: {
    flex: 1,
    height: 72,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 14,
  },

  // AI Answer panel
  aiPanelContainer: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    ...shadow,
  },
  aiPanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: colors.surfaceRaised,
  },
  aiPanelHeaderExpanded: {
    backgroundColor: "#efe8de",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  aiIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  aiIconExpanded: {
    backgroundColor: colors.accent,
  },
  aiIconText: {
    fontSize: 16,
    color: colors.accent,
  },
  aiIconTextExpanded: {
    color: "#fff",
  },
  aiPanelHeaderText: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  aiPanelTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.text,
  },
  aiPanelStatus: {
    fontSize: 12,
    color: colors.muted,
  },
  aiChevron: {
    fontSize: 16,
    color: colors.muted,
  },
  aiPanelContent: {
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 16,
  },

  // Answer text
  answerTextContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
  },
  streamingCursor: {
    width: 6,
    height: 18,
    borderRadius: 3,
    backgroundColor: colors.accent,
    marginLeft: 2,
    marginBottom: 2,
    opacity: 0.8,
  },

  // Insufficient evidence
  insufficientBox: {
    backgroundColor: "#f6ead1",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  insufficientText: {
    fontSize: 14,
    color: colors.warning,
    lineHeight: 20,
  },

  // Sources
  sourcesSection: {
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 14,
  },
  sourcesLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.muted,
    letterSpacing: 1.8,
    textTransform: "uppercase",
  },
  sourcesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  sourceCard: {
    width: "48%",
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 6,
  },
  sourceCardPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  sourceCardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  sourceNumber: {
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: "#f6ead1",
    alignItems: "center",
    justifyContent: "center",
  },
  sourceNumberText: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.accent,
  },
  sourceTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: colors.text,
    lineHeight: 17,
  },
  sourceQuote: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 16,
  },
  sourcePage: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.muted,
    opacity: 0.7,
  },

  // Zero state
  zeroState: {
    gap: 24,
  },
  zeroSection: {
    gap: 4,
  },
  zeroSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 8,
  },
  zeroSectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.muted,
    letterSpacing: 2.2,
  },
  zeroClearAll: {
    fontSize: 13,
    color: colors.muted,
  },
  zeroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  zeroRowPressed: {
    opacity: 0.6,
  },
  zeroRowIcon: {
    fontSize: 18,
    color: colors.muted,
    width: 24,
    textAlign: "center",
  },
  zeroRowIconSpark: {
    fontSize: 16,
    color: colors.accent,
    opacity: 0.65,
    width: 24,
    textAlign: "center",
  },
  zeroRowText: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    lineHeight: 21,
  },
  zeroRowRemove: {
    padding: 4,
  },
  zeroRowRemoveText: {
    fontSize: 12,
    color: colors.muted,
  },
  zeroEmptyText: {
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
  },

  // Suggestion loading skeletons
  suggestionsLoading: {
    gap: 0,
  },
  skeletonDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
  },
  skeletonTextLine: {
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.surfaceMuted,
  },
});
