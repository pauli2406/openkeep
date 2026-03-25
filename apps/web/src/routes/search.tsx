import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Search as SearchIcon,
  Loader2,
  ChevronDown,
  ChevronUp,
  BrainCircuit,
  X,
  Quote,
  ArrowRight,
} from "lucide-react";
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
// Main search page — AI-first, no matching-documents list
// ---------------------------------------------------------------------------

function SearchPage() {
  const { q } = Route.useSearch();
  const navigate = Route.useNavigate();

  const searchTerm = q ?? "";
  const answerStream = useAnswerStream();
  const lastStreamedQuery = useRef<string>("");
  const [panelExpanded, setPanelExpanded] = useState(true);

  // Auto-trigger AI answer whenever the search term changes
  useEffect(() => {
    if (searchTerm.length > 0 && lastStreamedQuery.current !== searchTerm) {
      lastStreamedQuery.current = searchTerm;
      setPanelExpanded(true);
      answerStream.startStream(searchTerm);
    }
  }, [searchTerm, answerStream.startStream]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const input = form.elements.namedItem("search") as HTMLInputElement;
    const value = input.value.trim();
    navigate({ search: { q: value || undefined } });
  }

  function handleRetry() {
    if (searchTerm.length > 0) {
      lastStreamedQuery.current = searchTerm;
      answerStream.startStream(searchTerm);
    }
  }

  const isStreaming =
    answerStream.status === "searching" || answerStream.status === "streaming";
  const hasAnswer =
    answerStream.status === "streaming" || answerStream.status === "done";

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
            placeholder="Ask your archive..."
            className="h-11 rounded-xl border-[var(--explorer-border-strong)] bg-card pl-10 text-[15px] shadow-sm transition-shadow focus-visible:shadow-md"
          />
        </div>
        <Button
          type="submit"
          disabled={isStreaming}
          className="h-11 rounded-xl px-5 text-[15px]"
        >
          {isStreaming ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Search"
          )}
        </Button>
      </form>

      {/* ─── AI Answer panel ─── */}
      {searchTerm.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[var(--explorer-border)] shadow-sm">
          {/* Panel header / toggle */}
          <button
            type="button"
            onClick={() => setPanelExpanded((v) => !v)}
            className={cn(
              "group flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors",
              panelExpanded
                ? "border-b border-[var(--explorer-border)] bg-[var(--explorer-cobalt-soft)]"
                : "bg-card hover:bg-[var(--explorer-paper-strong)]",
            )}
          >
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                panelExpanded
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
                {isStreaming
                  ? "Generating..."
                  : answerStream.status === "done"
                    ? "Answer ready"
                    : answerStream.status === "error"
                      ? "Error"
                      : ""}
              </span>
            </span>
            {isStreaming && (
              <Loader2 className="h-4 w-4 animate-spin text-[var(--explorer-cobalt)]" />
            )}
            {panelExpanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>

          {/* Panel content */}
          {panelExpanded && (
            <div className="bg-card px-5 py-5">
              {/* Error state */}
              {answerStream.status === "error" && (
                <div className="flex items-start gap-3 rounded-xl border border-[var(--explorer-rust-soft)] bg-[var(--explorer-rust-soft)] px-4 py-3">
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
                    onClick={handleRetry}
                    className="shrink-0"
                  >
                    Retry
                  </Button>
                </div>
              )}

              {/* Searching skeleton */}
              {answerStream.status === "searching" && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2.5">
                    <Loader2 className="h-5 w-5 animate-spin text-[var(--explorer-cobalt)]" />
                    <span className="text-sm text-muted-foreground">
                      Searching your archive and preparing an answer...
                    </span>
                  </div>
                  {/* Text skeletons */}
                  <div className="space-y-2.5">
                    {[...Array(3)].map((_, i) => (
                      <div
                        key={i}
                        className="h-4 animate-pulse rounded bg-[var(--explorer-paper-strong)]"
                        style={{
                          width: `${85 - i * 15}%`,
                          animationDelay: `${i * 150}ms`,
                        }}
                      />
                    ))}
                  </div>
                  {/* Source card skeletons */}
                  <div className="mt-4 grid grid-cols-2 gap-2.5">
                    {[...Array(2)].map((_, i) => (
                      <div
                        key={i}
                        className="h-20 animate-pulse rounded-xl border border-[var(--explorer-border)] bg-[var(--explorer-paper)]"
                        style={{ animationDelay: `${i * 200 + 400}ms` }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Streaming / done answer */}
              {hasAnswer && (
                <div className="space-y-5">
                  {/* Answer body — rendered as GFM markdown */}
                  <div
                    className={cn(
                      "prose prose-sm max-w-none text-foreground",
                      "prose-headings:font-semibold prose-headings:tracking-tight",
                      "prose-p:leading-relaxed prose-li:leading-relaxed",
                      "prose-strong:text-foreground",
                      // GFM table styling
                      "prose-table:border-collapse prose-table:rounded-lg prose-table:border prose-table:border-[var(--explorer-border)]",
                      "prose-th:border prose-th:border-[var(--explorer-border)] prose-th:bg-[var(--explorer-paper-strong)] prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:text-xs prose-th:font-semibold",
                      "prose-td:border prose-td:border-[var(--explorer-border)] prose-td:px-3 prose-td:py-2 prose-td:text-sm",
                    )}
                  >
                    <Markdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ href, children, title, ...props }) => {
                          // Internal document links produced by linkifyCitations
                          if (href?.startsWith("/documents/")) {
                            const documentId = href.replace(
                              "/documents/",
                              "",
                            );
                            return (
                              <Link
                                to="/documents/$documentId"
                                params={{ documentId }}
                                className="no-underline"
                                title={title}
                              >
                                <span className="inline-flex items-center rounded bg-[var(--explorer-cobalt-soft)] px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-[var(--explorer-cobalt)] transition-colors hover:bg-[var(--explorer-cobalt)] hover:text-white">
                                  {children}
                                </span>
                              </Link>
                            );
                          }
                          // Normal external links
                          return (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              {...props}
                            >
                              {children}
                            </a>
                          );
                        },
                        // Ensure tables get scrollable overflow on narrow viewports
                        table: ({ children, ...props }) => (
                          <div className="overflow-x-auto">
                            <table {...props}>{children}</table>
                          </div>
                        ),
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

                  {/* Sources */}
                  {answerStream.citations.length > 0 && (
                    <div className="space-y-2.5 border-t border-[var(--explorer-border)] pt-4">
                      <p className="flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        <Quote className="h-3 w-3" />
                        Sources
                      </p>
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        {answerStream.citations.map((cit, i) => (
                          <Link
                            key={`${cit.documentId}-${cit.chunkIndex}`}
                            to="/documents/$documentId"
                            params={{ documentId: cit.documentId }}
                            className="group/cit flex items-start gap-2.5 rounded-xl border border-[var(--explorer-border)] bg-[var(--explorer-paper)] px-3 py-2.5 transition-all hover:-translate-y-0.5 hover:border-[var(--explorer-border-strong)] hover:shadow-sm"
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
                                  {cit.pageTo &&
                                  cit.pageTo !== cit.pageFrom
                                    ? `\u2013${cit.pageTo}`
                                    : ""}
                                </span>
                              )}
                            </div>
                            <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/cit:opacity-100" />
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Insufficient evidence */}
                  {answerStream.status === "done" &&
                    !answerStream.answerText && (
                      <div className="rounded-xl border border-amber-200/60 bg-amber-50/50 px-4 py-3 text-sm text-amber-900">
                        Not enough evidence in your archive to answer this
                        question confidently.
                      </div>
                    )}
                </div>
              )}
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
            Enter a query to search across all your documents. The AI will
            analyze your archive and provide a direct answer with sources.
          </p>
        </div>
      )}
    </div>
  );
}
