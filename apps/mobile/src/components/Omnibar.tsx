import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { AppStackParamList } from "../../App";
import { useAuth } from "../auth";
import { useAnswerStream } from "../hooks/useAnswerStream";
import { useDashboardInsights } from "../hooks/useDashboardInsights";
import { useRecentSearches } from "../hooks/useRecentSearches";
import { useSuggestions } from "../hooks/useSuggestions";
import { useI18n } from "../i18n";
import {
  formatDate,
  titleForDocument,
  type AnswerCitation,
  type ArchiveDocument,
  type DocumentTextResponse,
} from "../lib";
import { useOfflineArchive } from "../offline-archive";
import { createThemedStyles, radii, useColors } from "../theme";
import { text } from "../typography";
import { AnswerMarkdown } from "./chat/AnswerMarkdown";
import { fill, splitCitations } from "./chat/conversations";
import {
  buildFollowUps,
  buildPaletteRows,
  citedPageOf,
  groupBlocksByPage,
  isCitedBlock,
  PALETTE_SECTIONS,
  type PaletteRow,
  type PaletteSection,
} from "./chat/palette";
import { AnswerSkeleton, AssistantRow, TraceLine, WarningNote } from "./chat/parts";
import { Sources } from "./chat/Sources";
import { IconTile, Skeleton } from "./layout";
import { useShell } from "./shell-context";
import { Button, EmptyState, ErrorCard, FullScreenModal, Notice, Pill } from "./ui";

type Level = "palette" | "searching" | "results" | "citation";

type CitationTarget = {
  documentId: string;
  title: string;
  quote?: string;
  pageFrom?: number | null;
  pageTo?: number | null;
};

function citationTarget(citation: AnswerCitation): CitationTarget {
  return {
    documentId: citation.documentId,
    title: citation.documentTitle,
    quote: citation.quote,
    pageFrom: citation.pageFrom,
    pageTo: citation.pageTo,
  };
}

/**
 * Search, ask or jump, from anywhere: the web's omnibar as a full-screen modal.
 * Android's back button and the close button step back one level, like Esc on the
 * web: a citation back to its answer, an answer back to the palette, the palette
 * out of the app's way.
 */
export function Omnibar() {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const auth = useAuth();
  const offline = useOfflineArchive();
  const shell = useShell();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const shouldUseCache = offline.shouldUseCache || auth.isOfflineSession;
  const open = shell.omnibarOpen;

  const [level, setLevel] = useState<Level>("palette");
  const [query, setQuery] = useState("");
  const [citation, setCitation] = useState<CitationTarget | null>(null);
  const inputRef = useRef<TextInput>(null);

  const stream = useAnswerStream(auth.streamFetch);
  const { recentSearches, addSearch } = useRecentSearches();
  const insights = useDashboardInsights();
  const { suggestions, isLoading: suggestionsLoading, facets } = useSuggestions(
    auth.authFetch,
    open && !shouldUseCache,
  );

  const needle = query.replace(/^>/, "").trim();
  const cachedFacets = useQuery({
    queryKey: ["omnibar", "cached-facets", offline.cacheSummary.revision],
    enabled: open && shouldUseCache,
    queryFn: () => offline.loadCachedFacets(),
  });
  const cachedDocuments = useQuery({
    queryKey: ["omnibar", "cached-documents", needle, offline.cacheSummary.revision],
    enabled: open && shouldUseCache && needle.length > 0 && !query.startsWith(">"),
    queryFn: () => offline.queryCachedDocuments({ query: needle, pageSize: 5 }),
  });

  const reset = useCallback(() => {
    setLevel("palette");
    setQuery("");
    setCitation(null);
    stream.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every opening starts at the palette, whatever the last one was left on.
  useEffect(() => {
    if (open) {
      reset();
    }
  }, [open, reset]);

  const close = useCallback(() => {
    reset();
    shell.closeOmnibar();
  }, [reset, shell]);

  const stepBack = useCallback(() => {
    if (level === "citation") {
      setCitation(null);
      setLevel("results");
    } else if (level === "results" || level === "searching") {
      setLevel("palette");
      setQuery("");
      stream.reset();
    } else {
      close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [close, level]);

  const submitQuery = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || shouldUseCache) {
        return;
      }
      setQuery(trimmed);
      setLevel("searching");
      addSearch(trimmed);
      void stream.startStream(trimmed);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addSearch, shouldUseCache, stream.startStream],
  );

  useEffect(() => {
    if (level === "searching" && (stream.status === "done" || stream.status === "error")) {
      setLevel("results");
    }
  }, [level, stream.status]);

  const rows = useMemo(
    () =>
      buildPaletteRows({
        query,
        suggestions,
        recents: recentSearches.map((entry) => entry.query),
        facets: shouldUseCache ? cachedFacets.data : facets,
        cachedDocuments: (cachedDocuments.data?.items ?? []).map((document) => ({
          id: document.id,
          title: titleForDocument(document),
        })),
        pendingReview: insights.data?.stats.pendingReview,
        online: !shouldUseCache,
        t,
      }),
    [
      cachedDocuments.data,
      cachedFacets.data,
      facets,
      insights.data,
      query,
      recentSearches,
      shouldUseCache,
      suggestions,
      t,
    ],
  );

  const openDocument = useCallback(
    (target: CitationTarget) => {
      close();
      navigation.navigate("DocumentDetail", {
        documentId: target.documentId,
        title: target.title,
        ...(target.quote
          ? { citation: { page: target.pageFrom ?? null, quote: target.quote } }
          : {}),
      });
    },
    [close, navigation],
  );

  const runRow = useCallback(
    (row: PaletteRow) => {
      const { action } = row;
      if (action.kind === "ask") {
        submitQuery(action.query);
        return;
      }
      close();
      if (action.kind === "scan") {
        navigation.navigate("Scan");
      } else if (action.kind === "document") {
        navigation.navigate("DocumentDetail", {
          documentId: action.documentId,
          title: action.title,
        });
      } else {
        navigation.navigate("Home", {
          screen: action.route,
          ...(action.applyFilters ? { params: { applyFilters: action.applyFilters } } : {}),
        } as never);
      }
    },
    [close, navigation, submitQuery],
  );

  const openFullSearch = useCallback(() => {
    const question = query;
    close();
    navigation.navigate("Home", { screen: "Chat", params: { q: question } } as never);
  }, [close, navigation, query]);

  const streaming = stream.status === "searching" || stream.status === "streaming";

  return (
    <FullScreenModal visible={open} onRequestClose={stepBack} style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {level === "citation" && citation ? (
          <CitationPreview
            citation={citation}
            citations={stream.citations}
            answerText={stream.answerText}
            onSelectCitation={setCitation}
            onBack={stepBack}
            onOpenDocument={() => openDocument(citation)}
          />
        ) : (
          <>
            <View style={styles.inputBar}>
              {streaming ? (
                <ActivityIndicator size="small" color={colors.accent} style={styles.inputIcon} />
              ) : (
                <MaterialCommunityIcons
                  name="magnify"
                  size={20}
                  color={colors.muted}
                  style={styles.inputIcon}
                />
              )}
              <TextInput
                ref={inputRef}
                autoFocus
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={() => {
                  if (level !== "palette") {
                    submitQuery(query);
                  } else if (query.trim().length > 0 && rows[0]) {
                    // Enter takes the first row, which is the ask row while typing.
                    runRow(rows[0]);
                  }
                }}
                placeholder={t("omnibar.placeholder")}
                placeholderTextColor={colors.muted}
                accessibilityLabel={t("omnibar.placeholder")}
                returnKeyType="search"
                autoCorrect={false}
                style={styles.input}
              />
              {query.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("omnibar.clear")}
                  onPress={() => {
                    setQuery("");
                    setLevel("palette");
                    stream.reset();
                    inputRef.current?.focus();
                  }}
                  style={styles.clear}
                >
                  <MaterialCommunityIcons name="close" size={18} color={colors.muted} />
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={level === "palette" ? t("omnibar.close") : t("omnibar.back")}
                onPress={stepBack}
                style={styles.closeButton}
              >
                <Text style={styles.closeText}>
                  {level === "palette" ? t("omnibar.close") : t("omnibar.back")}
                </Text>
              </Pressable>
            </View>

            {shouldUseCache ? <Notice label={t("omnibar.offline")} /> : null}

            {level === "palette" ? (
              <Palette rows={rows} loading={suggestionsLoading && !needle} onRun={runRow} />
            ) : (
              <ResultsPane
                query={query}
                stream={stream}
                onCitation={(target) => {
                  setCitation(target);
                  setLevel("citation");
                }}
                onFollowUp={submitQuery}
                onRetry={() => void stream.startStream(query)}
                onOpenFullSearch={openFullSearch}
              />
            )}
          </>
        )}
      </KeyboardAvoidingView>
    </FullScreenModal>
  );
}

function Palette({
  rows,
  loading,
  onRun,
}: {
  rows: PaletteRow[];
  loading: boolean;
  onRun: (row: PaletteRow) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const labels: Record<PaletteSection, string> = {
    ask: t("omnibar.sectionAsk"),
    recent: t("omnibar.sectionRecent"),
    documents: t("omnibar.sectionDocuments"),
    actions: t("omnibar.sectionActions"),
    jump: t("omnibar.sectionJump"),
  };

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.palette}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {PALETTE_SECTIONS.map((section) => {
        const sectionRows = rows.filter((row) => row.section === section);
        const showSkeleton = section === "ask" && loading;
        if (sectionRows.length === 0 && !showSkeleton) {
          return null;
        }
        return (
          <View key={section} style={styles.section}>
            <Text style={styles.sectionLabel}>{labels[section]}</Text>
            {sectionRows.map((row) => (
              <Pressable
                key={row.id}
                accessibilityRole="button"
                accessibilityLabel={row.meta ? `${row.label}, ${row.meta}` : row.label}
                onPress={() => onRun(row)}
                style={({ pressed }) => [styles.paletteRow, pressed ? styles.paletteRowPressed : null]}
              >
                {section === "ask" ? (
                  <IconTile size="sm">
                    <MaterialCommunityIcons
                      name={row.icon as never}
                      size={15}
                      color={colors.accentSoftInk}
                    />
                  </IconTile>
                ) : (
                  <View style={styles.rowIcon}>
                    <MaterialCommunityIcons name={row.icon as never} size={15} color={colors.muted} />
                  </View>
                )}
                <Text style={styles.rowLabel} numberOfLines={2}>
                  {row.label}
                </Text>
                {row.meta ? (
                  <View style={styles.rowMeta}>
                    <Pill label={row.meta} tone="outline" />
                  </View>
                ) : null}
              </Pressable>
            ))}
            {showSkeleton
              ? [78, 62, 70].map((width) => (
                  <View key={width} style={styles.paletteRow}>
                    <Skeleton style={styles.skeletonIcon} />
                    <Skeleton style={[styles.skeletonLine, { width: `${width}%` }]} />
                  </View>
                ))
              : null}
          </View>
        );
      })}
      {rows.length === 0 ? <Text style={styles.noMatches}>{t("omnibar.noMatches")}</Text> : null}
    </ScrollView>
  );
}

function ResultsPane({
  query,
  stream,
  onCitation,
  onFollowUp,
  onRetry,
  onOpenFullSearch,
}: {
  query: string;
  stream: ReturnType<typeof useAnswerStream>;
  onCitation: (target: CitationTarget) => void;
  onFollowUp: (question: string) => void;
  onRetry: () => void;
  onOpenFullSearch: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const { status, answerText, citations, searchResults, toolStatus, lowConfidence } = stream;
  const isStreaming = status === "searching" || status === "streaming";

  const followUps = useMemo(
    () =>
      status === "done" && searchResults.length > 0
        ? buildFollowUps(query, searchResults[0]?.document, t)
        : [],
    [query, searchResults, status, t],
  );

  // What the answer actually cited; the full retrieval set only appears when no
  // marker survived.
  const { used } = splitCitations(citations);
  const shown = used.length > 0 ? used : citations;

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.results}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <View style={styles.resultsHead}>
        <Text accessibilityRole="header" style={styles.resultsQuestion}>
          {query}
        </Text>
        <Button
          label={t("omnibar.openFullSearch")}
          variant="secondary"
          size="sm"
          onPress={onOpenFullSearch}
        />
      </View>

      {status === "error" ? (
        <ErrorCard
          message={stream.errorMessage ?? t("omnibar.tryRephrasing")}
          onRetry={onRetry}
        />
      ) : (
        <AssistantRow>
          {isStreaming ? (
            <View>
              {status === "searching" ? (
                <TraceLine icon="magnify" label={t("omnibar.searching")} status="pulse" />
              ) : searchResults.length > 0 ? (
                <TraceLine
                  icon="check-circle-outline"
                  label={
                    searchResults.length === 1
                      ? t("omnibar.searchedOne")
                      : fill(t("omnibar.searchedMany"), { count: searchResults.length })
                  }
                />
              ) : null}
              {toolStatus ? <TraceLine label={toolStatus} status="spin" /> : null}
            </View>
          ) : null}

          {answerText ? (
            <AnswerMarkdown
              text={answerText}
              citations={citations}
              onCitationSelect={(entry) => onCitation(citationTarget(entry))}
            />
          ) : isStreaming ? (
            <AnswerSkeleton />
          ) : null}

          {lowConfidence || (status === "done" && !answerText) ? (
            <WarningNote label={t("omnibar.insufficient")} />
          ) : null}

          {shown.length > 0 ? (
            <Sources
              citations={shown}
              label={
                shown.length === 1
                  ? t("omnibar.usedSourcesOne")
                  : fill(t("omnibar.usedSourcesMany"), { count: shown.length })
              }
              defaultOpen
              pageLabel={t("omnibar.pageAbbrev")}
              onSelect={(entry) => onCitation(citationTarget(entry))}
            />
          ) : null}

          {citations.length === 0 && searchResults.length > 0 ? (
            <View style={styles.followGroup}>
              <Text style={styles.sectionLabel}>{t("omnibar.matchingDocuments")}</Text>
              {searchResults.slice(0, 4).map((result) => (
                <Pressable
                  key={result.document.id}
                  accessibilityRole="button"
                  onPress={() =>
                    onCitation({
                      documentId: result.document.id,
                      title: result.document.title,
                      quote: result.matchedChunks?.[0]?.text,
                    })
                  }
                  style={({ pressed }) => [styles.match, pressed ? styles.paletteRowPressed : null]}
                >
                  <MaterialCommunityIcons
                    name="file-document-outline"
                    size={16}
                    color={colors.muted}
                  />
                  <View style={styles.matchBody}>
                    <Text style={styles.matchTitle} numberOfLines={1}>
                      {result.document.title}
                    </Text>
                    {result.document.correspondent ? (
                      <Text style={styles.matchMeta} numberOfLines={1}>
                        {result.document.correspondent.name}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}

          {followUps.length > 0 ? (
            <View style={styles.followGroup}>
              <Text style={styles.sectionLabel}>{t("omnibar.followUp")}</Text>
              <View style={styles.followRow}>
                {followUps.map((followUp) => (
                  <Pressable
                    key={followUp}
                    accessibilityRole="button"
                    onPress={() => onFollowUp(followUp)}
                    style={({ pressed }) => [styles.followUp, pressed ? styles.paletteRowPressed : null]}
                  >
                    <Text style={styles.followUpText}>{followUp}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </AssistantRow>
      )}
    </ScrollView>
  );
}

/** The cited document's text with the passage marked, above the answer it came from. */
function CitationPreview({
  citation,
  citations,
  answerText,
  onSelectCitation,
  onBack,
  onOpenDocument,
}: {
  citation: CitationTarget;
  citations: AnswerCitation[];
  answerText: string;
  onSelectCitation: (target: CitationTarget) => void;
  onBack: () => void;
  onOpenDocument: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const auth = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  const pageOffsets = useRef(new Map<number, number>());

  const documentQuery = useQuery({
    queryKey: ["omnibar", "document", auth.apiUrl, citation.documentId],
    queryFn: async () => {
      const response = await auth.authFetch(`/api/documents/${citation.documentId}`);
      if (!response.ok) throw new Error("document");
      return (await response.json()) as ArchiveDocument;
    },
  });

  const textQuery = useQuery({
    queryKey: ["omnibar", "document-text", auth.apiUrl, citation.documentId],
    queryFn: async () => {
      const response = await auth.authFetch(`/api/documents/${citation.documentId}/text`);
      if (!response.ok) throw new Error("text");
      return (await response.json()) as DocumentTextResponse;
    },
    enabled: documentQuery.isSuccess,
  });

  const pages = useMemo(() => groupBlocksByPage(textQuery.data?.blocks ?? []), [textQuery.data]);
  const citedPage = citedPageOf(citation, pages);
  const doc = documentQuery.data;
  const issued = doc?.issueDate ? formatDate(doc.issueDate) : null;

  const scrollToCitedPage = (page: number) => {
    if (page === citedPage) {
      scrollRef.current?.scrollTo({ y: pageOffsets.current.get(page) ?? 0, animated: false });
    }
  };

  return (
    <View style={styles.flex}>
      <View style={styles.previewBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("omnibar.backToResults")}
          onPress={onBack}
          style={styles.previewBack}
        >
          <MaterialCommunityIcons name="arrow-left" size={20} color={colors.muted} />
        </Pressable>
        <View style={styles.previewTitleWrap}>
          <Text style={styles.previewTitle} numberOfLines={1}>
            {doc?.title ?? citation.title}
          </Text>
          {doc?.correspondent || issued || doc?.documentType ? (
            <Text style={styles.previewMeta} numberOfLines={1}>
              {[doc?.correspondent?.name, issued, doc?.documentType?.name]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          ) : null}
        </View>
        <Button
          label={t("omnibar.openDocument")}
          variant="secondary"
          size="sm"
          onPress={onOpenDocument}
        />
      </View>

      <ScrollView ref={scrollRef} style={styles.stage} contentContainerStyle={styles.stageContent}>
        {documentQuery.isLoading || textQuery.isLoading ? (
          <View style={styles.paper}>
            {[64, 92, 88, 94, 70, 90, 42].map((width) => (
              <Skeleton key={width} style={[styles.skeletonLine, { width: `${width}%` }]} />
            ))}
          </View>
        ) : documentQuery.isError || textQuery.isError ? (
          <ErrorCard
            message={t("omnibar.documentFailed")}
            onRetry={() => {
              void documentQuery.refetch();
              void textQuery.refetch();
            }}
          />
        ) : pages.length === 0 ? (
          <EmptyState
            icon="file-document-outline"
            title={t("omnibar.noTextTitle")}
            body={t("omnibar.noTextDetail")}
            action={t("omnibar.openDocument")}
            onAction={onOpenDocument}
          />
        ) : (
          pages.map((page) => (
            <View
              key={page.page}
              style={styles.page}
              onLayout={(event) => {
                pageOffsets.current.set(page.page, event.nativeEvent.layout.y);
                scrollToCitedPage(page.page);
              }}
            >
              <Text style={styles.pageLabel}>{fill(t("omnibar.page"), { page: page.page })}</Text>
              <View style={styles.paper}>
                {page.blocks.map((block) => {
                  const cited = page.page === citedPage && isCitedBlock(citation.quote, block.text);
                  return (
                    <Text
                      key={block.lineIndex}
                      selectable
                      style={[styles.paperLine, cited ? styles.paperLineCited : null]}
                    >
                      {block.text}
                    </Text>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {answerText || citations.length > 0 ? (
        <ScrollView style={styles.previewAnswer} contentContainerStyle={styles.previewAnswerContent}>
          {answerText ? (
            <AnswerMarkdown
              text={answerText}
              citations={citations}
              onCitationSelect={(entry) => onSelectCitation(citationTarget(entry))}
            />
          ) : null}
          {citations.length > 0 ? (
            <View style={styles.allSources}>
              <Text style={styles.sectionLabel}>{t("omnibar.allSources")}</Text>
              {citations.map((entry, index) => {
                const current = entry.documentId === citation.documentId;
                return (
                  <Pressable
                    key={`${entry.documentId}-${entry.chunkIndex}`}
                    accessibilityRole="button"
                    onPress={() => onSelectCitation(citationTarget(entry))}
                    style={[styles.allSource, current ? styles.allSourceActive : null]}
                  >
                    <View style={styles.sourceBadge}>
                      <Text style={styles.sourceBadgeText}>{entry.index ?? index + 1}</Text>
                    </View>
                    <Text
                      style={[styles.allSourceTitle, current ? styles.allSourceTitleActive : null]}
                      numberOfLines={1}
                    >
                      {entry.documentTitle}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((c) => ({
  root: {
    flex: 1,
    backgroundColor: c.panel,
  },
  flex: {
    flex: 1,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 56,
    paddingLeft: 16,
    paddingRight: 4,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  inputIcon: {
    width: 20,
    marginRight: 12,
  },
  input: {
    ...text.body,
    fontSize: 16,
    flex: 1,
    minWidth: 0,
    height: 56,
    color: c.ink,
    // The browser's focus ring, in the test harness; a phone draws none.
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : {}),
  },
  clear: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  closeButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  closeText: {
    ...text.bodyStrong,
    color: c.muted,
  },

  /* palette */
  palette: {
    padding: 8,
    paddingBottom: 24,
    gap: 8,
  },
  section: {
    gap: 2,
  },
  sectionLabel: {
    ...text.sectionLabel,
    color: c.muted,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  paletteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: radii.lg,
  },
  paletteRowPressed: {
    backgroundColor: c.bar,
  },
  rowIcon: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
    backgroundColor: c.bar,
  },
  rowLabel: {
    ...text.body,
    flex: 1,
    minWidth: 0,
    color: c.ink,
  },
  rowMeta: {
    flexShrink: 0,
  },
  noMatches: {
    ...text.body,
    paddingVertical: 32,
    color: c.muted,
    textAlign: "center",
  },
  skeletonIcon: {
    width: 28,
    height: 28,
  },
  skeletonLine: {
    height: 12,
    borderRadius: radii.pill,
  },

  /* results */
  results: {
    padding: 16,
    gap: 20,
  },
  resultsHead: {
    gap: 10,
    alignItems: "flex-start",
  },
  resultsQuestion: {
    ...text.barTitle,
    fontSize: 18,
    lineHeight: 24,
    color: c.ink,
  },
  followGroup: {
    gap: 6,
  },
  followRow: {
    gap: 8,
    alignItems: "flex-start",
  },
  followUp: {
    maxWidth: "100%",
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.xl,
  },
  followUpText: {
    ...text.body,
    color: c.muted,
  },
  match: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.lg,
  },
  matchBody: {
    flex: 1,
    minWidth: 0,
  },
  matchTitle: {
    ...text.body,
    color: c.ink,
  },
  matchMeta: {
    ...text.small,
    color: c.muted,
  },

  /* citation preview */
  previewBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 56,
    paddingRight: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  previewBack: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  previewTitleWrap: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  previewTitle: {
    ...text.bodyStrong,
    color: c.ink,
  },
  previewMeta: {
    ...text.small,
    color: c.muted,
  },
  stage: {
    flex: 1,
    backgroundColor: c.bar,
  },
  stageContent: {
    padding: 12,
    gap: 16,
  },
  page: {
    gap: 6,
  },
  pageLabel: {
    ...text.numericStrong,
    color: c.muted,
  },
  paper: {
    gap: 4,
    padding: 16,
    borderWidth: 1,
    borderColor: c.paperBorder,
    borderRadius: radii.md,
    backgroundColor: c.paper,
  },
  paperLine: {
    ...text.body,
    color: c.paperInk,
  },
  paperLineCited: {
    borderRadius: radii.sm,
    paddingHorizontal: 4,
    marginHorizontal: -4,
    backgroundColor: c.highlight,
    color: c.highlightInk,
  },
  previewAnswer: {
    flexGrow: 0,
    maxHeight: "38%",
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  previewAnswerContent: {
    padding: 16,
    gap: 12,
  },
  allSources: {
    gap: 2,
  },
  allSource: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 8,
    borderRadius: radii.md,
  },
  allSourceActive: {
    backgroundColor: c.accentSoft,
  },
  allSourceTitle: {
    ...text.body,
    flex: 1,
    color: c.ink,
  },
  allSourceTitleActive: {
    color: c.accentSoftInk,
  },
  sourceBadge: {
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: c.accentSoft,
  },
  sourceBadgeText: {
    ...text.numericStrong,
    fontSize: 10,
    lineHeight: 14,
    color: c.accentSoftInk,
  },
}));
