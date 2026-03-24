import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type {
  SemanticSearchResponse,
  SemanticSearchResult,
} from "@openkeep/types";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import Markdown from "react-markdown";
import {
  Search as SearchIcon,
  Sparkles,
  FileText,
  Loader2,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  BrainCircuit,
  BookOpen,
  X,
  Quote,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useAnswerStream, linkifyCitations } from "@/hooks/use-answer-stream";

type SearchParams = {
  q?: string;
};

export const Route = createFileRoute("/search")({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    q: (search.q as string) || undefined,
  }),
  component: SearchPage,
});

// ---------------------------------------------------------------------------
// Main search page
// ---------------------------------------------------------------------------

function SearchPage() {
  const { q } = Route.useSearch();
  const navigate = Route.useNavigate();

  const searchTerm = q ?? "";
  const [aiExpanded, setAiExpanded] = useState(false);
  const answerStream = useAnswerStream();
  const lastStreamedQuery = useRef<string>("");

  // Hybrid search — always runs semantic + keyword
  const searchQuery = useQuery({
    queryKey: ["search", "hybrid", searchTerm],
    queryFn: async () => {
      const { data, error } = await api.POST("/api/search/semantic", {
        body: {
          query: searchTerm,
          page: 1,
          pageSize: 20,
           maxChunkMatches: 6,
        },
      });
      if (error) throw new Error("Search failed");
      return data as unknown as SemanticSearchResponse;
    },
    enabled: searchTerm.length > 0,
  });

  // Auto-trigger AI answer when search term changes and panel is expanded
  useEffect(() => {
    if (
      aiExpanded &&
      searchTerm.length > 0 &&
      lastStreamedQuery.current !== searchTerm
    ) {
      lastStreamedQuery.current = searchTerm;
      answerStream.startStream(searchTerm);
    }
  }, [aiExpanded, searchTerm, answerStream.startStream]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const input = form.elements.namedItem("search") as HTMLInputElement;
    const value = input.value.trim();
    navigate({
      search: { q: value || undefined },
    });
  }

  function handleToggleAI() {
    const next = !aiExpanded;
    setAiExpanded(next);
    if (next && searchTerm.length > 0 && lastStreamedQuery.current !== searchTerm) {
      lastStreamedQuery.current = searchTerm;
      answerStream.startStream(searchTerm);
    }
  }

  function handleRetryAI() {
    if (searchTerm.length > 0) {
      lastStreamedQuery.current = searchTerm;
      answerStream.startStream(searchTerm);
    }
  }

  const hasResults = searchQuery.data && searchQuery.data.items.length > 0;
  const isStreaming =
    answerStream.status === "searching" || answerStream.status === "streaming";

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6 pb-20">
      {/* ─── Header ─── */}
      <header>
        <h1 className="flex items-center gap-2.5 text-3xl font-bold tracking-tight">
          <SearchIcon className="h-7 w-7 text-[var(--explorer-cobalt)]" />
          Search
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Hybrid keyword + semantic search across your archive
        </p>
      </header>

      {/* ─── Search bar ─── */}
      <form onSubmit={handleSearchSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            name="search"
            defaultValue={searchTerm}
            placeholder="Search your documents..."
            className="h-11 rounded-xl border-[var(--explorer-border-strong)] bg-card pl-10 text-[15px] shadow-sm transition-shadow focus-visible:shadow-md"
          />
        </div>
        <Button
          type="submit"
          className="h-11 rounded-xl px-5 text-[15px]"
        >
          Search
        </Button>
      </form>

      {/* ─── AI Answer panel toggle ─── */}
      {searchTerm.length > 0 && (
        <div>
          <button
            type="button"
            onClick={handleToggleAI}
            className={cn(
              "group flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-200",
              aiExpanded
                ? "border-[var(--explorer-cobalt-soft)] bg-[var(--explorer-cobalt-soft)]"
                : "border-[var(--explorer-border)] bg-card hover:border-[var(--explorer-border-strong)] hover:bg-[var(--explorer-paper-strong)]",
            )}
          >
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                aiExpanded
                  ? "bg-[var(--explorer-cobalt)] text-white"
                  : "bg-[var(--explorer-cobalt-soft)] text-[var(--explorer-cobalt)] group-hover:bg-[var(--explorer-cobalt)] group-hover:text-white",
              )}
            >
              <BrainCircuit className="h-4 w-4" />
            </span>
            <span className="flex-1">
              <span className="text-sm font-semibold text-foreground">
                AI Answer
              </span>
              <span className="ml-2 text-xs text-muted-foreground">
                {aiExpanded
                  ? isStreaming
                    ? "Generating..."
                    : answerStream.status === "done"
                      ? "Answer ready"
                      : "Ask your archive a question"
                  : "Click to get an AI-generated answer"}
              </span>
            </span>
            {isStreaming && (
              <Loader2 className="h-4 w-4 animate-spin text-[var(--explorer-cobalt)]" />
            )}
            {aiExpanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>

          {/* ─── AI Answer content ─── */}
          {aiExpanded && (
            <div
              className={cn(
                "mt-0 overflow-hidden rounded-b-xl border border-t-0 transition-all",
                "border-[var(--explorer-cobalt-soft)] bg-card",
              )}
            >
              <div className="px-5 py-4">
                {/* Error state */}
                {answerStream.status === "error" && (
                  <div className="flex items-start gap-3 rounded-lg border border-[var(--explorer-rust-soft)] bg-[var(--explorer-rust-soft)] px-4 py-3">
                    <X className="mt-0.5 h-4 w-4 shrink-0 text-[var(--explorer-rust)]" />
                    <div className="flex-1 text-sm text-[var(--explorer-rust)]">
                      <p className="font-medium">Could not generate an answer</p>
                      <p className="mt-0.5 text-xs opacity-80">
                        {answerStream.errorMessage}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRetryAI}
                      className="shrink-0"
                    >
                      Retry
                    </Button>
                  </div>
                )}

                {/* Searching state */}
                {answerStream.status === "searching" && (
                  <div className="flex items-center gap-3 py-6 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin text-[var(--explorer-cobalt)]" />
                    <span className="text-sm">
                      Searching your archive and preparing an answer...
                    </span>
                  </div>
                )}

                {/* Streaming / done answer */}
                {(answerStream.status === "streaming" ||
                  answerStream.status === "done") && (
                  <div className="space-y-4">
                    {/* Answer text (rendered as markdown) */}
                    <div className="prose prose-sm max-w-none text-foreground prose-headings:font-semibold prose-headings:tracking-tight prose-p:leading-relaxed prose-li:leading-relaxed prose-strong:text-foreground">
                      <Markdown
                        components={{
                          a: ({ href, children, ...props }) => {
                            // Internal document links produced by linkifyCitations
                            if (href?.startsWith("/documents/")) {
                              const documentId = href.replace("/documents/", "");
                              return (
                                <Link
                                  to="/documents/$documentId"
                                  params={{ documentId }}
                                  className="no-underline"
                                  {...props}
                                >
                                  <span className="inline-flex items-center rounded bg-[var(--explorer-cobalt-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--explorer-cobalt)] transition-colors hover:bg-[var(--explorer-cobalt)] hover:text-white">
                                    {children}
                                  </span>
                                </Link>
                              );
                            }
                            // Normal external links
                            return (
                              <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
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
                        <span className="inline-block h-4 w-1.5 animate-pulse rounded-full bg-[var(--explorer-cobalt)]" />
                      )}
                    </div>

                    {/* Citations */}
                    {answerStream.citations.length > 0 && (
                      <div className="space-y-2 border-t border-[var(--explorer-border)] pt-3">
                        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          <Quote className="h-3 w-3" />
                          Sources
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {answerStream.citations.map((cit, i) => (
                            <Link
                              key={`${cit.documentId}-${cit.chunkIndex}`}
                              to="/documents/$documentId"
                              params={{ documentId: cit.documentId }}
                              className="group/cit flex items-start gap-2.5 rounded-lg border border-[var(--explorer-border)] bg-[var(--explorer-paper)] px-3 py-2.5 transition-colors hover:border-[var(--explorer-border-strong)] hover:bg-[var(--explorer-paper-strong)]"
                            >
                              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--explorer-cobalt-soft)] text-[10px] font-bold text-[var(--explorer-cobalt)]">
                                {i + 1}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium group-hover/cit:underline">
                                  {cit.documentTitle}
                                </p>
                                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                  {cit.quote}
                                </p>
                                {(cit.pageFrom || cit.pageTo) && (
                                  <span className="mt-1 inline-block text-[10px] font-medium text-muted-foreground/70">
                                    p.{cit.pageFrom ?? cit.pageTo}
                                    {cit.pageTo && cit.pageTo !== cit.pageFrom
                                      ? `\u2013${cit.pageTo}`
                                      : ""}
                                  </span>
                                )}
                              </div>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Insufficient evidence */}
                    {answerStream.status === "done" &&
                      !answerStream.answerText && (
                        <div className="rounded-lg border border-amber-200/60 bg-amber-50/50 px-4 py-3 text-sm text-amber-900">
                          Not enough evidence in your archive to answer this
                          question confidently.
                        </div>
                      )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Empty state ─── */}
      {!searchTerm && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--explorer-cobalt-soft)]">
            <SearchIcon className="h-7 w-7 text-[var(--explorer-cobalt)]" />
          </div>
          <p className="mt-5 text-lg font-semibold text-foreground">
            Search your archive
          </p>
          <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
            Enter a query to search across all your documents. Combines
            keyword matching with semantic understanding for the best results.
          </p>
        </div>
      )}

      {/* ─── Loading ─── */}
      {searchTerm && searchQuery.isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--explorer-cobalt)]" />
        </div>
      )}

      {/* ─── Error ─── */}
      {searchTerm && searchQuery.isError && (
        <div className="rounded-xl border border-[var(--explorer-rust-soft)] bg-[var(--explorer-rust-soft)] p-4 text-sm text-[var(--explorer-rust)]">
          Search failed. Please try again.
        </div>
      )}

      {/* ─── No results ─── */}
      {searchTerm &&
        searchQuery.data &&
        searchQuery.data.items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FileText className="h-12 w-12 text-muted-foreground/30" />
            <p className="mt-4 text-lg font-semibold text-foreground">
              No documents found
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try different keywords or rephrase your query
            </p>
          </div>
        )}

      {/* ─── Results list ─── */}
      {hasResults && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {searchQuery.data!.items.length} result
            {searchQuery.data!.items.length !== 1 ? "s" : ""}
          </p>

          <div className="space-y-2">
            {searchQuery.data!.items.map((result) => (
              <SearchResultCard key={result.document.id} result={result} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result card
// ---------------------------------------------------------------------------

function SearchResultCard({ result }: { result: SemanticSearchResult }) {
  const doc = result.document;
  const [chunksOpen, setChunksOpen] = useState(false);

  return (
    <div className="group rounded-xl border border-[var(--explorer-border)] bg-card transition-all hover:border-[var(--explorer-border-strong)] hover:shadow-sm">
      <div className="flex items-start gap-4 px-4 py-3.5">
        {/* Icon */}
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--explorer-paper-strong)]">
          <FileText className="h-4 w-4 text-muted-foreground" />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1 space-y-1">
          <Link
            to="/documents/$documentId"
            params={{ documentId: doc.id }}
            className="text-[15px] font-semibold leading-snug text-foreground hover:underline"
          >
            {doc.title || "Untitled Document"}
          </Link>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {doc.correspondent && (
              <span className="text-sm text-muted-foreground">
                {doc.correspondent.name}
              </span>
            )}
            {doc.issueDate && (
              <span className="text-sm text-muted-foreground">
                {format(new Date(doc.issueDate), "MMM d, yyyy")}
              </span>
            )}
            {!doc.issueDate && doc.createdAt && (
              <span className="text-sm text-muted-foreground">
                {format(new Date(doc.createdAt), "MMM d, yyyy")}
              </span>
            )}
            {doc.documentType && (
              <Badge variant="outline" className="text-[10px]">
                {doc.documentType.name}
              </Badge>
            )}
          </div>
        </div>

        {/* Scores */}
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge
            variant="secondary"
            className="tabular-nums text-xs font-semibold"
          >
            {Math.round((result.semanticScore ?? result.score) * 100)}%
          </Badge>

          <div className="flex gap-1.5">
            {result.semanticScore != null && result.semanticScore > 0 && (
              <span
                className="flex items-center gap-0.5 text-[10px] text-muted-foreground"
                title="Semantic similarity"
              >
                <Sparkles className="h-2.5 w-2.5" />
                {Math.round(result.semanticScore * 100)}
              </span>
            )}
            {result.keywordScore != null && result.keywordScore > 0 && (
              <span
                className="flex items-center gap-0.5 text-[10px] text-muted-foreground"
                title="Keyword relevance"
              >
                <SearchIcon className="h-2.5 w-2.5" />
                {Math.round(result.keywordScore * 100)}
              </span>
            )}
          </div>
        </div>

        {/* Link arrow */}
        <Link
          to="/documents/$documentId"
          params={{ documentId: doc.id }}
          className="mt-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </div>

      {/* Matched chunks */}
      {result.matchedChunks.length > 0 && (
        <div className="border-t border-[var(--explorer-border)]">
          <button
            type="button"
            onClick={() => setChunksOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-4 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <BookOpen className="h-3 w-3" />
            {result.matchedChunks.length} matched excerpt
            {result.matchedChunks.length !== 1 ? "s" : ""}
            {chunksOpen ? (
              <ChevronUp className="ml-auto h-3 w-3" />
            ) : (
              <ChevronDown className="ml-auto h-3 w-3" />
            )}
          </button>

          {chunksOpen && (
            <div className="space-y-1.5 px-4 pb-3">
              {result.matchedChunks.slice(0, 3).map((chunk, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-[var(--explorer-border)] bg-[var(--explorer-paper)] px-3 py-2"
                >
                  <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                    {chunk.text}
                  </p>
                  {(chunk.pageFrom || chunk.pageTo) && (
                    <p className="mt-1 text-[10px] font-medium text-muted-foreground/60">
                      Page {chunk.pageFrom ?? chunk.pageTo}
                      {chunk.pageTo && chunk.pageTo !== chunk.pageFrom
                        ? `\u2013${chunk.pageTo}`
                        : ""}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
