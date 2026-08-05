import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
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
import { Panel, ErrorCard, Screen } from "../components/ui";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import type { AppStackParamList } from "../../App";
import { createThemedStyles, useColors } from "../theme";
import { fonts, text } from "../typography";
import {
  formatCurrency,
  formatDate,
  linkifyCitations,
  titleForDocument,
  type AnswerCitation,
  type ArchiveDocument,
} from "../lib";
import { useAnswerStream } from "../hooks/useAnswerStream";
import { useRecentSearches } from "../hooks/useRecentSearches";
import { useSuggestions } from "../hooks/useSuggestions";
import { Pill } from "../components/ui";

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export function SearchScreen() {
  const colors = useColors();
  const styles = useStyles();
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const [query, setQuery] = useState("");
  const inputRef = useRef<TextInput>(null);
  const shouldUseCache = offline.shouldUseCache || auth.isOfflineSession;

  const answerStream = useAnswerStream(auth.streamFetch);
  const { recentSearches, addSearch, removeSearch, clearAll } = useRecentSearches();
  const { suggestions, isLoading: suggestionsLoading } = useSuggestions(
    auth.authFetch,
    !shouldUseCache,
  );

  const cachedSearchQuery = useQuery({
    queryKey: ["cached-search", query.trim(), offline.cacheSummary.updatedAt],
    enabled: shouldUseCache && query.trim().length > 0,
    queryFn: () => offline.queryCachedDocuments({ query }),
  });

  const isStreaming = answerStream.status === "searching" || answerStream.status === "streaming";
  const hasAnswer = !shouldUseCache && (answerStream.status === "streaming" || answerStream.status === "done");
  const hasQuery = shouldUseCache ? query.trim().length > 0 : answerStream.status !== "idle";

  const runSearch = useCallback(
    (searchQuery?: string) => {
      const q = (searchQuery ?? query).trim();
      if (!q) return;
      void addSearch(q);
      if (searchQuery) setQuery(searchQuery);
      if (shouldUseCache) {
        answerStream.reset();
        return;
      }
      answerStream.startStream(q);
    },
    [query, addSearch, answerStream, shouldUseCache],
  );

  const handleSuggestionPress = useCallback(
    (suggestion: string) => {
      setQuery(suggestion);
      void addSearch(suggestion);
      if (shouldUseCache) {
        answerStream.reset();
        inputRef.current?.blur();
        return;
      }
      answerStream.startStream(suggestion);
      inputRef.current?.blur();
    },
    [addSearch, answerStream, shouldUseCache],
  );

  const handleRecentPress = useCallback(
    (recentQuery: string) => {
      setQuery(recentQuery);
      if (shouldUseCache) {
        answerStream.reset();
        inputRef.current?.blur();
        return;
      }
      answerStream.startStream(recentQuery);
      inputRef.current?.blur();
    },
    [answerStream, shouldUseCache],
  );

  return (
    <Screen
      title={t("search.title")}
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
            <ActivityIndicator color={colors.accentFillInk} size="small" />
          ) : (
            <Text style={styles.searchButtonText}>{t("search.search")}</Text>
          )}
        </Pressable>
      </View>

      {/* ─── Error ─── */}
      {!shouldUseCache && answerStream.status === "error" && (
        <ErrorCard
          message={answerStream.errorMessage ?? t("search.searchFailed")}
          onRetry={() => runSearch()}
        />
      )}

      {/* ─── Searching state ─── */}
      {!shouldUseCache && answerStream.status === "searching" && <SearchingSkeleton label={t("search.searching")} />}

      {shouldUseCache && query.trim().length > 0 ? (
        <CachedSearchResults
          loading={cachedSearchQuery.isLoading}
          documents={cachedSearchQuery.data?.items ?? []}
          loadingLabel={t("search.searchingCache")}
          emptyLabel={t("search.noCachedResults")}
          documentLabel={t("search.document")}
          unfiledLabel={t("documents.unfiled")}
          onOpen={(document) =>
            navigation.navigate("DocumentDetail", {
              documentId: document.id,
              title: titleForDocument(document),
            })
          }
        />
      ) : null}

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
          openItemsLabel={t("search.openItems")}
          totalLabel={t("search.total")}
          structuredResultsLabel={t("search.structuredResults")}
          dueDateLabel={t("search.dueDate")}
          expiryDateLabel={t("search.expiryDate")}
          amountLabel={t("search.amount")}
          actionLabel={t("search.action")}
          reviewLabel={t("search.reviewStatus")}
          reviewReasonsLabel={t("search.reviewReasons")}
          onCitationPress={(citation) =>
            navigation.navigate("DocumentDetail", {
              documentId: citation.documentId,
              title: citation.documentTitle,
            })
          }
          onDocumentPress={(documentId, title) =>
            navigation.navigate("DocumentDetail", {
              documentId,
              title,
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

function CachedSearchResults({
  loading,
  documents,
  loadingLabel,
  emptyLabel,
  documentLabel,
  unfiledLabel,
  onOpen,
}: {
  loading: boolean;
  documents: ArchiveDocument[];
  loadingLabel: string;
  emptyLabel: string;
  documentLabel: string;
  unfiledLabel: string;
  onOpen: (document: ArchiveDocument) => void;
}) {
  const styles = useStyles();
  if (loading) {
    return (
      <Panel padded>
        <Text style={styles.mutedText}>{loadingLabel}</Text>
      </Panel>
    );
  }

  if (documents.length === 0) {
    return (
      <Panel padded>
        <Text style={styles.mutedText}>{emptyLabel}</Text>
      </Panel>
    );
  }

  return (
    <View style={styles.cachedResults}>
      {documents.map((document) => (
        <Pressable
          key={document.id}
          onPress={() => onOpen(document)}
          style={({ pressed }) => [styles.resultCard, pressed ? styles.resultCardPressed : null]}
        >
          <View style={styles.resultHeader}>
            <Text style={styles.resultTitle}>{titleForDocument(document)}</Text>
            <Pill label={document.status} tone={document.status === "ready" ? "ok" : document.status === "failed" ? "bad" : "warn"} />
          </View>
          <Text style={styles.resultMeta}>
            {document.correspondent?.name ?? unfiledLabel} · {document.documentType?.name ?? documentLabel}
          </Text>
          <Text style={styles.resultMeta}>{formatDate(document.createdAt)}</Text>
          <Text style={styles.resultMeta}>{formatCurrency(document.amount, document.currency ?? "EUR")}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Searching skeleton
// ---------------------------------------------------------------------------

function SearchingSkeleton({ label }: { label: string }) {
  const colors = useColors();
  const styles = useStyles();
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
    <Panel padded>
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
    </Panel>
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
  openItemsLabel,
  totalLabel,
  structuredResultsLabel,
  dueDateLabel,
  expiryDateLabel,
  amountLabel,
  actionLabel,
  reviewLabel,
  reviewReasonsLabel,
  onCitationPress,
  onDocumentPress,
}: {
  answerStream: ReturnType<typeof useAnswerStream>;
  documentLabel: string;
  aiAnswerLabel: string;
  generatingLabel: string;
  answerReadyLabel: string;
  insufficientLabel: string;
  sourcesLabel: string;
  openItemsLabel: string;
  totalLabel: string;
  structuredResultsLabel: string;
  dueDateLabel: string;
  expiryDateLabel: string;
  amountLabel: string;
  actionLabel: string;
  reviewLabel: string;
  reviewReasonsLabel: string;
  onCitationPress: (citation: AnswerCitation) => void;
  onDocumentPress: (documentId: string, title: string) => void;
}) {
  const colors = useColors();
  const styles = useStyles();
  const markdownStyles = useMarkdownStyles();
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
          {answerStream.answerText.length > 0 &&
            answerStream.answerStatus !== "insufficient_evidence" && (
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
              {answerStream.lowConfidence && answerStream.status === "done" && (
                <Text style={styles.lowConfidenceHint}>
                  ⚠ This answer is based on weak evidence — verify it against the cited sources.
                </Text>
              )}
            </View>
          )}

          {/* Insufficient evidence */}
          {answerStream.status === "done" &&
            (answerStream.answerStatus === "insufficient_evidence" ||
              !answerStream.answerText) && (
            <View style={styles.insufficientBox}>
              <Text style={styles.insufficientText}>
                {answerStream.answerStatus === "insufficient_evidence" &&
                answerStream.answerText
                  ? answerStream.answerText
                  : insufficientLabel}
              </Text>
            </View>
          )}

          {answerStream.structuredData && (
            <View style={styles.structuredSection}>
              <View style={styles.structuredHeader}>
                <View style={styles.structuredTitleWrap}>
                  <Text style={styles.sourcesLabel}>{`⊞  ${structuredResultsLabel}`}</Text>
                  <Text style={styles.structuredTitle}>{answerStream.structuredData.title}</Text>
                  {answerStream.structuredData.description ? (
                    <Text style={styles.structuredDescription}>
                      {answerStream.structuredData.description}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.structuredPills}>
                  <Pill
                    label={`${openItemsLabel} ${
                      answerStream.structuredData.kind === "deadline_items"
                        ? answerStream.structuredData.totalOpenCount
                        : answerStream.structuredData.totalCount
                    }`}
                  />
                  {answerStream.structuredData.kind === "deadline_items" &&
                  answerStream.structuredData.totalAmount !== null ? (
                    <Pill
                      label={`${totalLabel} ${formatCurrency(
                        answerStream.structuredData.totalAmount,
                        answerStream.structuredData.currency ?? "EUR",
                      )}`}
                      tone="warn"
                    />
                  ) : null}
                </View>
              </View>

              <View style={styles.structuredList}>
                {answerStream.structuredData.kind === "deadline_items"
                  ? answerStream.structuredData.items.map((item) => (
                      <Pressable
                        key={item.documentId}
                        onPress={() => onDocumentPress(item.documentId, item.title)}
                        style={({ pressed }) => [
                          styles.structuredCard,
                          pressed ? styles.sourceCardPressed : null,
                        ]}
                      >
                        <Text style={styles.structuredItemTitle}>{item.title}</Text>
                        <Text style={styles.structuredItemMeta}>
                          {[item.correspondentName, item.documentTypeName]
                            .filter(Boolean)
                            .join(" · ") || documentLabel}
                        </Text>
                        <View style={styles.structuredChipRow}>
                          <StructuredChip label={`${dueDateLabel} ${formatDate(item.dueDate)}`} />
                          {item.amount !== null ? (
                            <StructuredChip
                              label={`${amountLabel} ${formatCurrency(item.amount, item.currency ?? "EUR")}`}
                            />
                          ) : null}
                          <StructuredChip label={`${actionLabel} ${item.taskLabel}`} />
                        </View>
                      </Pressable>
                    ))
                  : answerStream.structuredData.items.map((item) => (
                      <Pressable
                        key={item.id}
                        onPress={() => onDocumentPress(item.id, titleForDocument(item))}
                        style={({ pressed }) => [
                          styles.structuredCard,
                          pressed ? styles.sourceCardPressed : null,
                        ]}
                      >
                        <Text style={styles.structuredItemTitle}>{titleForDocument(item)}</Text>
                        <Text style={styles.structuredItemMeta}>
                          {[item.correspondent?.name, item.documentType?.name]
                            .filter(Boolean)
                            .join(" · ") || documentLabel}
                        </Text>
                        <View style={styles.structuredChipRow}>
                          {item.expiryDate ? (
                            <StructuredChip label={`${expiryDateLabel} ${formatDate(item.expiryDate)}`} />
                          ) : null}
                          {item.reviewStatus === "pending" ? (
                            <StructuredChip label={`${reviewLabel} ${item.reviewStatus}`} />
                          ) : null}
                          {item.reviewReasons.length > 0 ? (
                            <StructuredChip
                              label={`${reviewReasonsLabel} ${item.reviewReasons.join(", ")}`}
                            />
                          ) : null}
                        </View>
                      </Pressable>
                    ))}
              </View>
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

function StructuredChip({ label }: { label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.structuredChip}>
      <Text style={styles.structuredChipText}>{label}</Text>
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
  const styles = useStyles();
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

const useMarkdownStyles = createThemedStyles((c) => ({
  body: {
    fontFamily: fonts.sans.regular,
    color: c.ink,
    fontSize: 15,
    lineHeight: 24,
  },
  heading1: {
    fontSize: 20,
    fontFamily: fonts.sans.semibold,
    color: c.ink,
    marginTop: 16,
    marginBottom: 8,
  },
  heading2: {
    fontSize: 18,
    fontFamily: fonts.sans.semibold,
    color: c.ink,
    marginTop: 14,
    marginBottom: 6,
  },
  heading3: {
    fontSize: 16,
    fontFamily: fonts.sans.semibold,
    color: c.ink,
    marginTop: 12,
    marginBottom: 4,
  },
  strong: {
    fontFamily: fonts.sans.semibold,
    color: c.ink,
  },
  em: {
    // A real italic face, because React Native does not synthesise one for a
    // named family on Android.
    fontFamily: fonts.sans.italic,
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
    color: c.accent,
    backgroundColor: "#f6ead1",
    fontFamily: fonts.sans.semibold,
    fontSize: 11,
    letterSpacing: 0.3,
    borderRadius: 4,
    paddingHorizontal: 1,
  },
  table: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 8,
    marginTop: 8,
    marginBottom: 8,
  },
  thead: {
    backgroundColor: c.raised,
  },
  th: {
    padding: 8,
    fontFamily: fonts.sans.semibold,
    fontSize: 13,
    color: c.ink,
    borderBottomWidth: 1,
    borderColor: c.border,
  },
  td: {
    fontFamily: fonts.sans.regular,
    padding: 8,
    fontSize: 13,
    color: c.ink,
    borderBottomWidth: 1,
    borderColor: c.border,
  },
  tr: {
    borderBottomWidth: 1,
    borderColor: c.border,
  },
  blockquote: {
    backgroundColor: c.raised,
    borderLeftWidth: 3,
    borderLeftColor: c.accent,
    paddingLeft: 12,
    paddingVertical: 8,
    marginVertical: 8,
    borderRadius: 4,
  },
  code_inline: {
    backgroundColor: c.raised,
    color: c.ink,
    fontSize: 13,
    fontFamily: fonts.mono.regular,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  fence: {
    backgroundColor: c.raised,
    borderRadius: 8,
    padding: 12,
    marginVertical: 8,
    fontFamily: fonts.mono.regular,
    fontSize: 13,
  },
}));

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const useStyles = createThemedStyles((c) => ({
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
    backgroundColor: c.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: 14,
    minHeight: 50,
  },
  searchIcon: {
    // A symbol Text node: Public Sans has no glyph for it, so leave the
    // family to the system font.
    fontSize: 18,
    color: c.muted,
    marginRight: 8,
  },
  searchInput: {
    fontFamily: fonts.sans.regular,
    flex: 1,
    fontSize: 16,
    color: c.ink,
    paddingVertical: 12,
  },
  clearButton: {
    padding: 4,
    marginLeft: 4,
  },
  clearButtonText: {
    fontSize: 14,
    color: c.muted,
    fontFamily: fonts.sans.semibold,
  },
  searchButton: {
    // The search action is the accent fill, so its label can be the fill ink.
    // `ink` here would collide with `accentFillInk` once dark lands.
    backgroundColor: c.accentFill,
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
    color: c.accentFillInk,
    fontSize: 15,
    fontFamily: fonts.sans.semibold,
    letterSpacing: 0.2,
  },
  cachedResults: {
    gap: 10,
  },
  mutedText: {
    fontFamily: fonts.sans.regular,
    color: c.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  resultCard: {
    backgroundColor: c.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    padding: 14,
    gap: 8,
  },
  resultCardPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.99 }],
  },
  resultHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  resultTitle: {
    flex: 1,
    color: c.ink,
    fontSize: 15,
    fontFamily: fonts.sans.semibold,
    lineHeight: 20,
  },
  resultMeta: {
    fontFamily: fonts.sans.regular,
    color: c.muted,
    fontSize: 12,
    lineHeight: 16,
  },

  // Searching skeleton
  searchingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchingText: {
    fontFamily: fonts.sans.regular,
    fontSize: 14,
    color: c.muted,
  },
  skeletonLines: {
    gap: 10,
    marginTop: 4,
  },
  skeletonLine: {
    height: 12,
    backgroundColor: c.raised,
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
    backgroundColor: c.raised,
    borderRadius: 14,
  },

  // AI Answer panel
  aiPanelContainer: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.border,
    overflow: "hidden",
  },
  aiPanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: c.panel,
  },
  aiPanelHeaderExpanded: {
    backgroundColor: "#efe8de",
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  aiIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: c.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  aiIconExpanded: {
    backgroundColor: c.accentFill,
  },
  aiIconText: {
    // A symbol Text node: Public Sans has no glyph for it, so leave the
    // family to the system font.
    fontSize: 16,
    color: c.accent,
  },
  aiIconTextExpanded: {
    fontFamily: fonts.sans.regular,
    color: c.accentFillInk,
  },
  aiPanelHeaderText: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  aiPanelTitle: {
    fontSize: 14,
    fontFamily: fonts.sans.semibold,
    color: c.ink,
  },
  aiPanelStatus: {
    fontFamily: fonts.sans.regular,
    fontSize: 12,
    color: c.muted,
  },
  aiChevron: {
    fontFamily: fonts.sans.regular,
    fontSize: 16,
    color: c.muted,
  },
  aiPanelContent: {
    backgroundColor: c.panel,
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
    backgroundColor: c.accent,
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
  lowConfidenceHint: {
    fontFamily: fonts.sans.regular,
    marginTop: 8,
    fontSize: 12,
    color: "#b45309",
  },
  insufficientText: {
    fontFamily: fonts.sans.regular,
    fontSize: 14,
    color: c.amber,
    lineHeight: 20,
  },

  structuredSection: {
    gap: 12,
  },
  structuredHeader: {
    gap: 10,
  },
  structuredTitleWrap: {
    gap: 4,
  },
  structuredTitle: {
    fontSize: 15,
    fontFamily: fonts.sans.semibold,
    color: c.ink,
  },
  structuredDescription: {
    fontFamily: fonts.sans.regular,
    fontSize: 13,
    lineHeight: 18,
    color: c.muted,
  },
  structuredPills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  structuredList: {
    gap: 10,
  },
  structuredCard: {
    backgroundColor: c.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    padding: 14,
    gap: 8,
  },
  structuredItemTitle: {
    fontSize: 14,
    fontFamily: fonts.sans.semibold,
    color: c.ink,
  },
  structuredItemMeta: {
    fontFamily: fonts.sans.regular,
    fontSize: 12,
    lineHeight: 16,
    color: c.muted,
  },
  structuredChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  structuredChip: {
    borderRadius: 999,
    backgroundColor: c.raised,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  structuredChipText: {
    fontSize: 11,
    fontFamily: fonts.sans.semibold,
    color: c.ink,
  },

  // Sources
  sourcesSection: {
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: c.border,
    paddingTop: 14,
  },
  sourcesLabel: {
    fontSize: 11,
    fontFamily: fonts.sans.semibold,
    color: c.muted,
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
    backgroundColor: c.panel,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border,
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
    ...text.numericStrong,
    color: c.accent,
  },
  sourceTitle: {
    flex: 1,
    fontSize: 13,
    fontFamily: fonts.sans.semibold,
    color: c.ink,
    lineHeight: 17,
  },
  sourceQuote: {
    fontFamily: fonts.sans.regular,
    fontSize: 12,
    color: c.muted,
    lineHeight: 16,
  },
  sourcePage: {
    fontSize: 10,
    fontFamily: fonts.sans.semibold,
    color: c.muted,
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
    fontFamily: fonts.sans.semibold,
    color: c.muted,
    letterSpacing: 2.2,
  },
  zeroClearAll: {
    fontFamily: fonts.sans.regular,
    fontSize: 13,
    color: c.muted,
  },
  zeroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  zeroRowPressed: {
    opacity: 0.6,
  },
  zeroRowIcon: {
    // A symbol Text node: Public Sans has no glyph for it, so leave the
    // family to the system font.
    fontSize: 18,
    color: c.muted,
    width: 24,
    textAlign: "center",
  },
  zeroRowIconSpark: {
    // A symbol Text node: Public Sans has no glyph for it, so leave the
    // family to the system font.
    fontSize: 16,
    color: c.accent,
    opacity: 0.65,
    width: 24,
    textAlign: "center",
  },
  zeroRowText: {
    fontFamily: fonts.sans.regular,
    flex: 1,
    fontSize: 15,
    color: c.ink,
    lineHeight: 21,
  },
  zeroRowRemove: {
    padding: 4,
  },
  zeroRowRemoveText: {
    // A symbol Text node: Public Sans has no glyph for it, so leave the
    // family to the system font.
    fontSize: 12,
    color: c.muted,
  },
  zeroEmptyText: {
    fontFamily: fonts.sans.regular,
    fontSize: 14,
    color: c.muted,
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
    backgroundColor: c.raised,
  },
  skeletonTextLine: {
    height: 14,
    borderRadius: 7,
    backgroundColor: c.raised,
  },
}));
