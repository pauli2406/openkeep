import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import Markdown from "react-markdown";
import {
  Search,
  Clock,
  Sparkles,
  X,
  Loader2,
  FileText,
  Quote,
  ArrowRight,
  Command,
  CornerDownLeft,
  AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useAnswerStream, linkifyCitations } from "@/hooks/use-answer-stream";
import { useRecentSearches } from "@/hooks/use-recent-searches";
import {
  fetchExplorerFacets,
  fetchDashboardInsights,
  type ExplorerFacets,
} from "@/lib/explorer";
import type {
  DashboardInsightsResponse,
  SemanticSearchResponse,
  SemanticSearchResult,
} from "@openkeep/types";

// ---------------------------------------------------------------------------
// Suggestion generation
// ---------------------------------------------------------------------------

function generateSuggestions(
  facets: ExplorerFacets | undefined,
  insights: DashboardInsightsResponse | undefined,
): string[] {
  if (!facets && !insights) return [];
  const suggestions: string[] = [];

  if (insights?.overdueItems && insights.overdueItems.length > 0) {
    suggestions.push("What documents are overdue and need attention?");
  }

  if (insights?.upcomingDeadlines && insights.upcomingDeadlines.length > 0) {
    suggestions.push("What are my upcoming deadlines this month?");
  }

  const topCorrespondent = facets?.correspondents[0];
  if (topCorrespondent) {
    suggestions.push(`Summarize my documents from ${topCorrespondent.name}`);
  }

  const secondCorrespondent = facets?.correspondents[1];
  if (secondCorrespondent) {
    suggestions.push(
      `What are the key topics in ${secondCorrespondent.name} documents?`,
    );
  }

  const topDocType = facets?.documentTypes[0];
  if (topDocType) {
    suggestions.push(`Show me all ${topDocType.name.toLowerCase()} documents`);
  }

  const topTag = facets?.tags[0];
  if (topTag) {
    suggestions.push(`What documents are tagged "${topTag.name}"?`);
  }

  if (facets?.years && facets.years.length >= 2) {
    const latestYear = facets.years[facets.years.length - 1];
    if (latestYear) {
      suggestions.push(
        `Compare documents from ${latestYear.year} vs ${latestYear.year - 1}`,
      );
    }
  }

  if (
    facets?.amountRange?.max !== null &&
    facets?.amountRange?.max !== undefined &&
    facets.amountRange.max > 0
  ) {
    suggestions.push("What are my highest value documents?");
  }

  return suggestions.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OmnibarScreen =
  | "idle"
  | "zero-state"
  | "searching"
  | "results"
  | "citation-preview";

interface CitationTarget {
  documentId: string;
  title: string;
  quote?: string;
  pageFrom?: number | null;
  pageTo?: number | null;
}

// ---------------------------------------------------------------------------
// Text block type for document text API
// ---------------------------------------------------------------------------

interface TextBlock {
  documentId: string;
  page: number;
  lineIndex: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  text: string;
}

// ---------------------------------------------------------------------------
// Main Omnibar
// ---------------------------------------------------------------------------

export function Omnibar() {
  const location = useLocation();
  const [screen, setScreen] = useState<OmnibarScreen>("idle");
  const [query, setQuery] = useState("");
  const [citation, setCitation] = useState<CitationTarget | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const answerStream = useAnswerStream();
  const { recentSearches, addSearch, removeSearch, clearAll } =
    useRecentSearches();

  const isOpen = screen !== "idle";
  const isOnSearchPage = location.pathname === "/search";

  // Data for zero state suggestions
  const facetsQuery = useQuery({
    queryKey: ["explorer", "facets"],
    queryFn: fetchExplorerFacets,
    staleTime: 5 * 60 * 1000,
    enabled: isOpen,
  });

  const insightsQuery = useQuery({
    queryKey: ["dashboard", "insights"],
    queryFn: fetchDashboardInsights,
    staleTime: 5 * 60 * 1000,
    enabled: isOpen,
  });

  const suggestions = useMemo(
    () => generateSuggestions(facetsQuery.data, insightsQuery.data),
    [facetsQuery.data, insightsQuery.data],
  );

  // Semantic search for document results
  const searchQuery = useQuery({
    queryKey: ["omnibar", "search", query],
    queryFn: async () => {
      const { data, error } = await api.POST("/api/search/semantic", {
        body: {
          query,
          page: 1,
          pageSize: 6,
          maxChunkMatches: 3,
        },
      });
      if (error) throw new Error("Search failed");
      return data as unknown as SemanticSearchResponse;
    },
    enabled: query.length > 0 && (screen === "searching" || screen === "results"),
  });

  // ─── Open / Close ───

  const open = useCallback(() => {
    setScreen("zero-state");
    setQuery("");
    answerStream.reset();
    setCitation(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [answerStream]);

  const close = useCallback(() => {
    setScreen("idle");
    setQuery("");
    answerStream.reset();
    setCitation(null);
  }, [answerStream]);

  const stepBack = useCallback(() => {
    if (screen === "citation-preview") {
      setCitation(null);
      setScreen("results");
    } else if (screen === "results" || screen === "searching") {
      setScreen("zero-state");
      setQuery("");
      answerStream.reset();
    } else {
      close();
    }
  }, [screen, answerStream, close]);

  // ─── Submit query ───

  const submitQuery = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      setQuery(trimmed);
      setScreen("searching");
      addSearch(trimmed);
      answerStream.startStream(trimmed);
    },
    [addSearch, answerStream],
  );

  // ─── Open citation preview ───

  const openCitation = useCallback((target: CitationTarget) => {
    setCitation(target);
    setScreen("citation-preview");
  }, []);

  // ─── Update screen when stream completes ───

  useEffect(() => {
    if (
      screen === "searching" &&
      (answerStream.status === "done" || answerStream.status === "error")
    ) {
      setScreen("results");
    }
  }, [screen, answerStream.status]);

  // ─── Keyboard shortcuts ───

  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      // Cmd+K / Ctrl+K to toggle
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (isOpen) {
          close();
        } else {
          open();
        }
        return;
      }

      // Escape to step back
      if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        stepBack();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, open, close, stepBack]);

  // ─── Scroll lock when open ───

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // ─── Input key handler ───

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitQuery(query);
    }
  };

  // ─── Hide resting pill on /search ───

  if (isOnSearchPage && !isOpen) return null;

  return (
    <>
      {/* ─── Resting Trigger ─── */}
      {!isOpen && (
        <div className="fixed right-4 top-20 z-40 md:right-6 md:top-6">
          <button
            type="button"
            onClick={open}
            aria-label="Open archive search"
            className="omnibar-rest group flex h-12 items-center gap-2 rounded-2xl border border-[color:var(--explorer-border)] bg-white/90 px-3 shadow-[0_4px_12px_-2px_rgba(0,0,0,0.05)] backdrop-blur-sm transition-all duration-200 hover:border-[color:var(--explorer-border-strong)] hover:shadow-[0_20px_40px_-10px_rgba(0,0,0,0.08)]"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-[color:var(--explorer-paper)] text-[color:var(--explorer-muted)] transition-colors group-hover:bg-[color:var(--explorer-cobalt-soft)] group-hover:text-[color:var(--explorer-cobalt)]">
              <Search className="h-4 w-4" />
            </span>
            <kbd className="hidden items-center gap-1 rounded-lg border border-[color:var(--explorer-border)] bg-[color:var(--explorer-paper)] px-2 py-1 text-[11px] font-medium text-[color:var(--explorer-muted)] sm:flex">
              <Command className="h-3 w-3" />
              <span>K</span>
            </kbd>
          </button>
        </div>
      )}

      {/* ─── Overlay ─── */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-center">
          {/* Backdrop */}
          <div
            className="omnibar-backdrop absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={close}
          />

          {/* Panel */}
          <div
            ref={panelRef}
            className={cn(
              "omnibar-panel relative mt-6 flex max-h-[min(600px,calc(100vh-3rem))] flex-col overflow-hidden rounded-2xl border border-[color:var(--explorer-border)] bg-white shadow-[0_20px_40px_-10px_rgba(0,0,0,0.08)]",
              screen === "citation-preview"
                ? "w-[min(1200px,calc(100vw-2rem))]"
                : "w-[min(720px,calc(100vw-2rem))]",
            )}
          >
            {screen === "citation-preview" && citation ? (
              <CitationPreviewPane
                citation={citation}
                answerStream={answerStream}
                searchResults={searchQuery.data?.items ?? []}
                onClose={() => {
                  setCitation(null);
                  setScreen("results");
                }}
              />
            ) : (
              <>
                {/* Search input */}
                <div className="flex items-center gap-3 border-b border-[color:var(--explorer-border)] px-5">
                  <Search className="h-5 w-5 shrink-0 text-[color:var(--explorer-muted)]" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                    placeholder="Ask the archive..."
                    className="h-16 flex-1 bg-transparent text-lg text-[color:var(--explorer-ink)] placeholder-[color:var(--explorer-muted)] outline-none"
                    autoFocus
                  />
                  {query.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        setScreen("zero-state");
                        answerStream.reset();
                        inputRef.current?.focus();
                      }}
                      className="rounded-md p-1 text-[color:var(--explorer-muted)] transition-colors hover:text-[color:var(--explorer-ink)]"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  <kbd className="hidden items-center gap-0.5 rounded-md border border-[color:var(--explorer-border)] px-1.5 py-0.5 text-[10px] font-medium text-[color:var(--explorer-muted)] sm:flex">
                    <CornerDownLeft className="h-2.5 w-2.5" />
                  </kbd>
                </div>

                {/* Content area */}
                <div className="flex-1 overflow-y-auto">
                  {screen === "zero-state" && (
                    <ZeroState
                      recentSearches={recentSearches}
                      suggestions={suggestions}
                      suggestionsLoading={
                        facetsQuery.isLoading || insightsQuery.isLoading
                      }
                      onSelectQuery={submitQuery}
                      onRemoveRecent={removeSearch}
                      onClearAll={clearAll}
                    />
                  )}

                  {(screen === "searching" || screen === "results") && (
                    <ResultsPane
                      query={query}
                      answerStream={answerStream}
                      searchResults={searchQuery.data?.items ?? []}
                      searchLoading={searchQuery.isLoading}
                      onCitationClick={openCitation}
                      onFollowUp={submitQuery}
                      onRetry={() => answerStream.startStream(query)}
                      onOpenFullPage={close}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Zero State
// ---------------------------------------------------------------------------

function ZeroState({
  recentSearches,
  suggestions,
  suggestionsLoading,
  onSelectQuery,
  onRemoveRecent,
  onClearAll,
}: {
  recentSearches: Array<{ query: string; timestamp: number }>;
  suggestions: string[];
  suggestionsLoading: boolean;
  onSelectQuery: (query: string) => void;
  onRemoveRecent: (query: string) => void;
  onClearAll: () => void;
}) {
  const safeRecentSearches = recentSearches ?? [];
  const safeSuggestions = suggestions ?? [];

  return (
    <div className="py-2">
      {/* Recent Searches */}
      {safeRecentSearches.length > 0 && (
        <section>
          <div className="flex items-center justify-between px-5 py-3">
            <h3 className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[color:var(--explorer-muted)]">
              Recent Searches
            </h3>
            <button
              type="button"
              onClick={onClearAll}
              className="text-[0.68rem] font-medium text-[color:var(--explorer-muted)] transition-colors hover:text-[color:var(--explorer-rust)]"
            >
              Clear all
            </button>
          </div>
          <div>
            {safeRecentSearches.map((item) => (
              <div
                key={item.query}
                className="group flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-[color:var(--explorer-paper)]"
              >
                <Clock className="h-4 w-4 shrink-0 text-[color:var(--explorer-muted)]/60" />
                <button
                  type="button"
                  onClick={() => onSelectQuery(item.query)}
                  className="flex-1 truncate text-left text-[14px] text-[color:var(--explorer-ink)]"
                >
                  {item.query}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveRecent(item.query);
                  }}
                  className="rounded p-0.5 text-[color:var(--explorer-muted)] opacity-0 transition-all hover:text-[color:var(--explorer-rust)] group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Suggestions */}
      <section>
        <div className="px-5 py-3">
          <h3 className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[color:var(--explorer-muted)]">
            Suggested for you
          </h3>
        </div>

        {suggestionsLoading ? (
          <div className="space-y-1 px-5 pb-3">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 py-2.5"
              >
                <div className="h-4 w-4 animate-pulse rounded bg-[color:var(--explorer-paper-strong)]" />
                <div
                  className="h-4 animate-pulse rounded bg-[color:var(--explorer-paper-strong)]"
                  style={{ width: `${55 + i * 10}%` }}
                />
              </div>
            ))}
          </div>
        ) : safeSuggestions.length > 0 ? (
          <div>
            {safeSuggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => onSelectQuery(suggestion)}
                className="group flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-[color:var(--explorer-paper)]"
              >
                <Sparkles className="h-4 w-4 shrink-0 text-[color:var(--explorer-cobalt)]/50 transition-colors group-hover:text-[color:var(--explorer-cobalt)]" />
                <span className="flex-1 truncate text-[14px] text-[color:var(--explorer-ink)]">
                  {suggestion}
                </span>
                <ArrowRight className="h-3 w-3 text-[color:var(--explorer-muted)] opacity-0 transition-all group-hover:opacity-100" />
              </button>
            ))}
          </div>
        ) : (
          <div className="px-5 pb-4 text-sm text-[color:var(--explorer-muted)]">
            No suggestions available yet. Upload some documents to get started.
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results Pane
// ---------------------------------------------------------------------------

function ResultsPane({
  query,
  answerStream,
  searchResults,
  searchLoading,
  onCitationClick,
  onFollowUp,
  onRetry,
  onOpenFullPage,
}: {
  query: string;
  answerStream: ReturnType<typeof useAnswerStream>;
  searchResults: SemanticSearchResult[];
  searchLoading: boolean;
  onCitationClick: (target: CitationTarget) => void;
  onFollowUp: (query: string) => void;
  onRetry: () => void;
  onOpenFullPage: () => void;
}) {
  const isStreaming =
    answerStream.status === "searching" || answerStream.status === "streaming";

  // Generate follow-up suggestions from context
  const followUps = useMemo(() => {
    if (answerStream.status !== "done" || searchResults.length === 0) return [];
    const items: string[] = [];

    const firstDoc = searchResults[0]?.document;
    if (firstDoc?.correspondent) {
      items.push(
        `What other documents are from ${firstDoc.correspondent.name}?`,
      );
    }
    if (firstDoc?.documentType) {
      items.push(`Show me similar ${firstDoc.documentType.name} documents`);
    }
    items.push(`Tell me more about "${query}"`);

    return items.slice(0, 3);
  }, [answerStream.status, searchResults, query]);

  return (
    <div className="p-5">
      {/* Query heading */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className="font-[var(--font-display)] text-xl leading-tight text-[color:var(--explorer-ink)]">
          {query}
        </h2>
        <Link
          to="/search"
          search={{ q: query }}
          onClick={onOpenFullPage}
          className="shrink-0 rounded-lg border border-[color:var(--explorer-border)] bg-white px-3 py-1.5 text-xs font-medium text-[color:var(--explorer-ink)] transition-colors hover:bg-[color:var(--explorer-paper)]"
        >
          Open full search
        </Link>
      </div>

      {/* Error state */}
      {answerStream.status === "error" && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-[color:var(--explorer-rust-soft)] bg-[color:var(--explorer-rust-soft)] px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--explorer-rust)]" />
          <div className="flex-1">
            <p className="text-sm font-medium text-[color:var(--explorer-rust)]">
              Archive retrieval failed
            </p>
            <p className="mt-0.5 text-xs text-[color:var(--explorer-rust)]/80">
              {answerStream.errorMessage ?? "Try rephrasing your question."}
            </p>
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded-lg border border-[color:var(--explorer-border)] bg-white px-3 py-1.5 text-xs font-medium text-[color:var(--explorer-ink)] transition-colors hover:bg-[color:var(--explorer-paper)]"
          >
            Retry
          </button>
        </div>
      )}

      {/* Searching skeleton */}
      {answerStream.status === "searching" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-6 w-6 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-[color:var(--explorer-cobalt)]" />
            </div>
            <span className="text-sm text-[color:var(--explorer-muted)]">
              Searching your archive...
            </span>
          </div>
          {/* Text skeletons */}
          <div className="space-y-2.5">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="h-4 animate-pulse rounded bg-[color:var(--explorer-paper-strong)]"
                style={{
                  width: `${85 - i * 15}%`,
                  animationDelay: `${i * 150}ms`,
                }}
              />
            ))}
          </div>
          {/* Citation skeletons */}
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            {[...Array(2)].map((_, i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-xl border border-[color:var(--explorer-border)] bg-[color:var(--explorer-paper)]"
                style={{ animationDelay: `${i * 200 + 400}ms` }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Streaming / Done answer */}
      {(answerStream.status === "streaming" ||
        answerStream.status === "done") && (
        <div className="space-y-4">
          {/* AI Summary box */}
          <div className="rounded-xl border border-[color:var(--explorer-cobalt-soft)] bg-[color:var(--explorer-cobalt-soft)]/40 px-4 py-3">
            <div className="prose prose-sm max-w-none text-[color:var(--explorer-ink)] prose-headings:font-semibold prose-p:leading-relaxed prose-li:leading-relaxed prose-strong:text-[color:var(--explorer-ink)]">
              <Markdown
                components={{
                  a: ({ href, children, title, ...externalProps }) => {
                    if (href?.startsWith("/documents/")) {
                      const documentId = href.replace("/documents/", "");
                      return (
                        <Link
                          to="/documents/$documentId"
                          params={{ documentId }}
                          className="no-underline"
                          title={title}
                        >
                          <span className="inline-flex items-center rounded bg-[color:var(--explorer-rust-soft)] px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-[color:var(--explorer-rust)] transition-colors hover:bg-[color:var(--explorer-rust)] hover:text-white">
                            {children}
                          </span>
                        </Link>
                      );
                    }
                    return (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                          {...externalProps}
                      >
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {linkifyCitations(
                  answerStream.answerText,
                  answerStream.citations,
                  answerStream.searchResults,
                )}
              </Markdown>
              {answerStream.status === "streaming" && (
                <span className="inline-block h-4 w-1.5 animate-pulse rounded-full bg-[color:var(--explorer-cobalt)]" />
              )}
            </div>
          </div>

          {/* Citations / Sources */}
          {answerStream.citations.length > 0 && (
            <div>
              <h3 className="mb-2.5 flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[color:var(--explorer-muted)]">
                <Quote className="h-3 w-3" />
                Sources
              </h3>
              <div className="grid grid-cols-2 gap-2.5">
                {answerStream.citations.map((cit, i) => (
                  <button
                    key={`${cit.documentId}-${cit.chunkIndex}`}
                    type="button"
                    onClick={() =>
                      onCitationClick({
                        documentId: cit.documentId,
                        title: cit.documentTitle,
                        quote: cit.quote,
                        pageFrom: cit.pageFrom,
                        pageTo: cit.pageTo,
                      })
                    }
                    className="group/card flex items-start gap-2.5 rounded-xl border border-[color:var(--explorer-border)] bg-white px-3 py-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-[color:var(--explorer-cobalt)]/35 hover:shadow-sm"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[color:var(--explorer-rust-soft)] text-[10px] font-bold text-[color:var(--explorer-rust)]">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[color:var(--explorer-ink)] group-hover/card:underline">
                        {cit.documentTitle}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-[color:var(--explorer-muted)]">
                        {cit.quote}
                      </p>
                      {(cit.pageFrom || cit.pageTo) && (
                        <span className="mt-1 inline-block text-[10px] font-medium text-[color:var(--explorer-muted)]/70">
                          p.{cit.pageFrom ?? cit.pageTo}
                          {cit.pageTo && cit.pageTo !== cit.pageFrom
                            ? `\u2013${cit.pageTo}`
                            : ""}
                        </span>
                      )}
                    </div>
                    <ArrowRight className="mt-1 h-3 w-3 shrink-0 text-[color:var(--explorer-muted)] opacity-0 transition-opacity group-hover/card:opacity-100" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Document results (when no citations or as additional) */}
          {answerStream.citations.length === 0 &&
            searchResults.length > 0 && (
              <div>
                <h3 className="mb-2.5 flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[color:var(--explorer-muted)]">
                  <FileText className="h-3 w-3" />
                  Matching Documents
                </h3>
                <div className="grid grid-cols-2 gap-2.5">
                  {searchResults.slice(0, 4).map((result) => (
                    <button
                      key={result.document.id}
                      type="button"
                      onClick={() =>
                        onCitationClick({
                          documentId: result.document.id,
                          title: result.document.title,
                          quote: result.matchedChunks[0]?.text,
                        })
                      }
                      className="group/card flex items-start gap-2.5 rounded-xl border border-[color:var(--explorer-border)] bg-white px-3 py-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-[color:var(--explorer-cobalt)]/35 hover:shadow-sm"
                    >
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--explorer-muted)]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[color:var(--explorer-ink)] group-hover/card:underline">
                          {result.document.title}
                        </p>
                        {result.document.correspondent && (
                          <p className="mt-0.5 truncate text-xs text-[color:var(--explorer-muted)]">
                            {result.document.correspondent.name}
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

          {/* No answer text */}
          {answerStream.status === "done" && !answerStream.answerText && (
            <div className="rounded-xl border border-amber-200/60 bg-amber-50/50 px-4 py-3 text-sm text-amber-900">
              Not enough evidence in your archive to answer this question
              confidently.
            </div>
          )}

          {/* Follow-up chips */}
          {followUps.length > 0 && answerStream.status === "done" && (
            <div>
              <h3 className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[color:var(--explorer-muted)]">
                Follow up
              </h3>
              <div className="flex flex-wrap gap-2">
                {followUps.map((fu) => (
                  <button
                    key={fu}
                    type="button"
                    onClick={() => onFollowUp(fu)}
                    className="rounded-full border border-[color:var(--explorer-border)] bg-white px-3 py-1.5 text-xs font-medium text-[color:var(--explorer-ink)] transition-all hover:border-[color:var(--explorer-cobalt)]/35 hover:bg-[color:var(--explorer-cobalt-soft)]"
                  >
                    {fu}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Search results loading below AI answer */}
      {searchLoading && answerStream.status !== "searching" && (
        <div className="mt-3 flex items-center gap-2 text-sm text-[color:var(--explorer-muted)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading documents...
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Citation Preview (Split Pane)
// ---------------------------------------------------------------------------

function CitationPreviewPane({
  citation,
  answerStream,
  searchResults,
  onClose,
}: {
  citation: CitationTarget;
  answerStream: ReturnType<typeof useAnswerStream>;
  searchResults: SemanticSearchResult[];
  onClose: () => void;
}) {
  // Fetch document detail
  const documentQuery = useQuery({
    queryKey: ["document", citation.documentId],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/documents/{id}", {
        params: { path: { id: citation.documentId } },
      });
      if (error) throw new Error("Failed to load document");
      return data as unknown as {
        id: string;
        title: string;
        correspondent: { id: string; name: string; slug: string } | null;
        documentType: { id: string; name: string; slug: string } | null;
        issueDate: string | null;
        createdAt: string;
        tags: Array<{ id: string; name: string; slug: string }>;
      };
    },
  });

  // Fetch document text blocks
  const textQuery = useQuery({
    queryKey: ["document-text", citation.documentId],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/documents/{id}/text", {
        params: { path: { id: citation.documentId } },
      });
      if (error) throw new Error("Failed to load document text");
      return data as unknown as { documentId: string; blocks: TextBlock[] };
    },
    enabled: documentQuery.isSuccess,
  });

  const doc = documentQuery.data;
  const blocks = textQuery.data?.blocks ?? [];

  // Group blocks by page
  const pages = useMemo(() => {
    const pageMap = new Map<number, TextBlock[]>();
    for (const block of blocks) {
      const existing = pageMap.get(block.page) ?? [];
      existing.push(block);
      pageMap.set(block.page, existing);
    }
    return Array.from(pageMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([pageNum, pageBlocks]) => ({
        page: pageNum,
        blocks: pageBlocks.sort((a, b) => a.lineIndex - b.lineIndex),
      }));
  }, [blocks]);

  // Find the page containing the cited text
  const citedPage = useMemo(() => {
    if (citation.pageFrom) return citation.pageFrom;
    if (!citation.quote) return null;

    const quoteLower = citation.quote.toLowerCase().slice(0, 80);
    for (const page of pages) {
      const pageText = page.blocks.map((b) => b.text).join(" ").toLowerCase();
      if (pageText.includes(quoteLower)) return page.page;
    }
    return null;
  }, [citation, pages]);

  // Scroll to cited page
  const docViewerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (citedPage !== null && docViewerRef.current) {
      const pageEl = docViewerRef.current.querySelector(
        `[data-page="${citedPage}"]`,
      );
      if (pageEl) {
        pageEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }, [citedPage, pages]);

  return (
    <div className="flex h-full min-h-0">
      {/* Left panel – Search summary (40%) */}
      <div className="flex w-2/5 flex-col overflow-y-auto border-r border-[color:var(--explorer-border)]">
        <div className="flex items-center justify-between border-b border-[color:var(--explorer-border)] px-4 py-3">
          <h3 className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-[color:var(--explorer-muted)]">
            Search Results
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[color:var(--explorer-muted)] transition-colors hover:text-[color:var(--explorer-ink)]"
          >
            <ArrowRight className="h-4 w-4 rotate-180" />
          </button>
        </div>

        {/* Mini AI summary */}
        {answerStream.answerText && (
          <div className="border-b border-[color:var(--explorer-border)] p-4">
            <div className="prose prose-sm max-w-none text-[color:var(--explorer-ink)] prose-p:text-[13px] prose-p:leading-relaxed">
              <Markdown
                components={{
                  a: ({ href, children, title, ...externalProps }) => {
                    if (href?.startsWith("/documents/")) {
                      const documentId = href.replace("/documents/", "");
                      return (
                        <Link
                          to="/documents/$documentId"
                          params={{ documentId }}
                          className="no-underline"
                          title={title}
                        >
                          <span className="inline-flex items-center rounded bg-[color:var(--explorer-rust-soft)] px-1 py-0.5 text-[10px] font-bold text-[color:var(--explorer-rust)]">
                            {children}
                          </span>
                        </Link>
                      );
                    }
                    return (
                      <a href={href} target="_blank" rel="noopener noreferrer" {...externalProps}>
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {linkifyCitations(
                  answerStream.answerText,
                  answerStream.citations,
                  answerStream.searchResults,
                )}
              </Markdown>
            </div>
          </div>
        )}

        {/* Other citations */}
        {answerStream.citations.length > 0 && (
          <div className="p-4">
            <h4 className="mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--explorer-muted)]">
              All Sources
            </h4>
            <div className="space-y-1.5">
              {answerStream.citations.map((cit, i) => (
                <div
                  key={`${cit.documentId}-${cit.chunkIndex}`}
                  className={cn(
                    "flex items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                    cit.documentId === citation.documentId
                      ? "bg-[color:var(--explorer-cobalt-soft)] border border-[color:var(--explorer-cobalt)]/20"
                      : "hover:bg-[color:var(--explorer-paper)]",
                  )}
                >
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold bg-[color:var(--explorer-rust-soft)] text-[color:var(--explorer-rust)]">
                    {i + 1}
                  </span>
                  <p className="truncate text-xs font-medium text-[color:var(--explorer-ink)]">
                    {cit.documentTitle}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right panel – Document viewer (60%) */}
      <div className="flex w-3/5 flex-col">
        {/* Document header */}
        <div className="flex items-start justify-between border-b border-[color:var(--explorer-border)] px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-[var(--font-display)] text-lg text-[color:var(--explorer-ink)]">
              {doc?.title ?? citation.title}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[color:var(--explorer-muted)]">
              {doc?.correspondent && <span>{doc.correspondent.name}</span>}
              {doc?.issueDate && (
                <span>{format(new Date(doc.issueDate), "MMM d, yyyy")}</span>
              )}
              {doc?.documentType && (
                <span className="rounded-full border border-[color:var(--explorer-border)] px-2 py-0.5">
                  {doc.documentType.name}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Link
              to="/documents/$documentId"
              params={{ documentId: citation.documentId }}
              className="rounded-lg border border-[color:var(--explorer-border)] px-2.5 py-1.5 text-xs font-medium text-[color:var(--explorer-ink)] transition-colors hover:bg-[color:var(--explorer-paper)]"
            >
              Open full
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-[color:var(--explorer-muted)] transition-colors hover:text-[color:var(--explorer-ink)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Document text content */}
        <div ref={docViewerRef} className="flex-1 overflow-y-auto p-5">
          {documentQuery.isLoading || textQuery.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-[color:var(--explorer-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading document...
            </div>
          ) : documentQuery.isError ? (
            <div className="py-8 text-center text-sm text-[color:var(--explorer-rust)]">
              Failed to load document
            </div>
          ) : pages.length === 0 ? (
            <div className="py-8 text-center text-sm text-[color:var(--explorer-muted)]">
              No text content available for this document.
              <div className="mt-3">
                <Link
                  to="/documents/$documentId"
                  params={{ documentId: citation.documentId }}
                  className="text-[color:var(--explorer-cobalt)] hover:underline"
                >
                  Open the full document view
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {pages.map((page) => (
                <div key={page.page} data-page={page.page}>
                  <p className="mb-2 text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-[color:var(--explorer-muted)]">
                    Page {page.page}
                  </p>
                  <div className="space-y-0.5">
                    {page.blocks.map((block, bi) => {
                      // Highlight the block if it matches the cited quote
                      const isHighlighted =
                        citation.quote &&
                        citation.pageFrom === page.page &&
                        citation.quote
                          .toLowerCase()
                          .includes(block.text.toLowerCase().slice(0, 40));

                      return (
                        <p
                          key={bi}
                          className={cn(
                            "text-sm leading-relaxed text-[color:var(--explorer-ink)]",
                            isHighlighted &&
                              "rounded bg-[color:var(--explorer-rust-soft)] px-1.5 py-0.5 ring-1 ring-[color:var(--explorer-rust)]/20",
                          )}
                        >
                          {block.text}
                        </p>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
