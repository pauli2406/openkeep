import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type {
  AnswerQueryResponse,
  SemanticSearchResponse,
} from "@openkeep/types";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Search as SearchIcon,
  Sparkles,
  FileText,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { format } from "date-fns";

type SearchParams = {
  q?: string;
  mode?: "keyword" | "semantic" | "answer";
};

export const Route = createFileRoute("/search")({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    q: (search.q as string) || undefined,
    mode: (search.mode as "keyword" | "semantic" | "answer") || undefined,
  }),
  component: SearchPage,
});

interface KeywordResult {
  id: string;
  title: string;
  correspondent: { id: string; name: string } | null;
  issueDate: string | null;
  createdAt: string;
  snippets?: string[];
  status: string;
}

interface KeywordResponse {
  items: KeywordResult[];
  total: number;
}

function SearchPage() {
  const { q, mode } = Route.useSearch();
  const navigate = Route.useNavigate();

  const searchTerm = q ?? "";
  const searchMode = mode ?? "keyword";

  function setSearchMode(value: string) {
    navigate({
      search: (prev) => ({
        ...prev,
        mode: (value as "keyword" | "semantic" | "answer") || undefined,
      }),
      replace: true,
    });
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const input = form.elements.namedItem("search") as HTMLInputElement;
    navigate({
      search: (prev) => ({ ...prev, q: input.value || undefined }),
    });
  }

  const keywordQuery = useQuery({
    queryKey: ["search", "keyword", searchTerm],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/search/documents", {
        params: { query: { query: searchTerm } },
      } as never);
      if (error) throw new Error("Search failed");
      return data as unknown as KeywordResponse;
    },
    enabled: searchMode === "keyword" && searchTerm.length > 0,
  });

  const semanticQuery = useQuery({
    queryKey: ["search", "semantic", searchTerm],
    queryFn: async () => {
      const { data, error } = await api.POST(
        "/api/search/semantic",
        { body: { query: searchTerm } } as never,
      );
      if (error) throw new Error("Semantic search failed");
      return data as unknown as SemanticSearchResponse;
    },
    enabled: searchMode === "semantic" && searchTerm.length > 0,
  });

  const answerQuery = useQuery({
    queryKey: ["search", "answer", searchTerm],
    queryFn: async () => {
      const { data, error } = await api.POST(
        // TODO: Path exists in SDK but TS can't resolve the large PathsWithMethod union
        "/api/search/answer" as never,
        { body: { query: searchTerm } } as never,
      );
      if (error) throw new Error("Answer query failed");
      return data as unknown as AnswerQueryResponse;
    },
    enabled: searchMode === "answer" && searchTerm.length > 0,
  });

  const isLoading =
    (searchMode === "keyword" && keywordQuery.isLoading) ||
    (searchMode === "semantic" && semanticQuery.isLoading) ||
    (searchMode === "answer" && answerQuery.isLoading);

  const isError =
    (searchMode === "keyword" && keywordQuery.isError) ||
    (searchMode === "semantic" && semanticQuery.isError) ||
    (searchMode === "answer" && answerQuery.isError);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <SearchIcon className="h-7 w-7" />
          Search
        </h1>
        <p className="text-muted-foreground">
          Find documents in your archive
        </p>
      </div>

      {/* Search input */}
      <form onSubmit={handleSearchSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="search"
            defaultValue={searchTerm}
            placeholder="Search documents..."
            className="pl-9"
          />
        </div>
        <Button type="submit">Search</Button>
      </form>

      {/* Mode toggle */}
      <Tabs value={searchMode} onValueChange={setSearchMode}>
        <TabsList>
          <TabsTrigger value="keyword" className="gap-1.5">
            <SearchIcon className="h-3.5 w-3.5" />
            Keyword
          </TabsTrigger>
          <TabsTrigger value="semantic" className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Semantic
          </TabsTrigger>
          <TabsTrigger value="answer" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Answer
          </TabsTrigger>
        </TabsList>

        {/* Keyword results */}
        <TabsContent value="keyword">
          {!searchTerm && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <SearchIcon className="h-12 w-12 text-muted-foreground/40" />
              <p className="mt-4 text-lg font-medium text-muted-foreground">
                Enter a search query to find documents
              </p>
            </div>
          )}

          {searchTerm && isLoading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {searchTerm && isError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
              Search failed. Please try again.
            </div>
          )}

          {searchTerm &&
            keywordQuery.data &&
            keywordQuery.data.items.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <FileText className="h-12 w-12 text-muted-foreground/40" />
                <p className="mt-4 text-lg font-medium text-muted-foreground">
                  No documents match your search
                </p>
                <p className="mt-1 text-sm text-muted-foreground/70">
                  Try different keywords or use semantic search
                </p>
              </div>
            )}

          {keywordQuery.data && keywordQuery.data.items.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {keywordQuery.data.total} result
                {keywordQuery.data.total !== 1 ? "s" : ""} found
              </p>
              {keywordQuery.data.items.map((result) => (
                <Card
                  key={result.id}
                  className="transition-colors hover:bg-muted/30"
                >
                  <CardContent className="flex items-start gap-4 p-4">
                    <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <Link
                        to="/documents/$documentId"
                        params={{ documentId: result.id }}
                        className="font-medium leading-snug hover:underline"
                      >
                        {result.title || "Untitled Document"}
                      </Link>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        {result.correspondent && (
                          <span>{result.correspondent.name}</span>
                        )}
                        {result.issueDate && (
                          <span>
                            {format(
                              new Date(result.issueDate),
                              "MMM d, yyyy",
                            )}
                          </span>
                        )}
                        {!result.issueDate && result.createdAt && (
                          <span>
                            {format(
                              new Date(result.createdAt),
                              "MMM d, yyyy",
                            )}
                          </span>
                        )}
                      </div>

                      {result.snippets && result.snippets.length > 0 && (
                        <div className="space-y-1 pt-1">
                          {result.snippets.slice(0, 3).map((snippet, i) => (
                            <p
                              key={i}
                              className="line-clamp-2 text-sm text-muted-foreground"
                              dangerouslySetInnerHTML={{ __html: snippet }}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    <Link
                      to="/documents/$documentId"
                      params={{ documentId: result.id }}
                      className="shrink-0"
                    >
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Semantic results */}
        <TabsContent value="semantic">
          {!searchTerm && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Sparkles className="h-12 w-12 text-muted-foreground/40" />
              <p className="mt-4 text-lg font-medium text-muted-foreground">
                Enter a search query to find documents
              </p>
              <p className="mt-1 text-sm text-muted-foreground/70">
                Semantic search understands meaning, not just keywords
              </p>
            </div>
          )}

          {searchTerm && isLoading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {searchTerm && isError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
              Semantic search failed. Please try again.
            </div>
          )}

          {searchTerm &&
            semanticQuery.data &&
            semanticQuery.data.items.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <FileText className="h-12 w-12 text-muted-foreground/40" />
                <p className="mt-4 text-lg font-medium text-muted-foreground">
                  No documents match your search
                </p>
                <p className="mt-1 text-sm text-muted-foreground/70">
                  Try rephrasing your query or use keyword search
                </p>
              </div>
            )}

          {semanticQuery.data && semanticQuery.data.items.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {semanticQuery.data.items.length} result
                {semanticQuery.data.items.length !== 1 ? "s" : ""} found
              </p>
              {semanticQuery.data.items.map((result) => (
                <Card
                  key={result.document.id}
                  className="transition-colors hover:bg-muted/30"
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="text-base">
                        <Link
                          to="/documents/$documentId"
                          params={{ documentId: result.document.id }}
                          className="hover:underline"
                        >
                          {result.document.title || "Untitled Document"}
                        </Link>
                      </CardTitle>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant="secondary">
                          Score: {Math.round(result.score * 100)}%
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 pt-0">
                    {/* Score breakdown */}
                    {(result.semanticScore != null ||
                      result.keywordScore != null) && (
                      <div className="flex flex-wrap gap-2">
                        {result.semanticScore != null && (
                          <Badge variant="outline" className="text-xs">
                            <Sparkles className="mr-1 h-3 w-3" />
                            Semantic: {Math.round(result.semanticScore * 100)}%
                          </Badge>
                        )}
                        {result.keywordScore != null && (
                          <Badge variant="outline" className="text-xs">
                            <SearchIcon className="mr-1 h-3 w-3" />
                            Keyword: {Math.round(result.keywordScore * 100)}%
                          </Badge>
                        )}
                      </div>
                    )}

                    {/* Matched chunks */}
                    {result.matchedChunks.length > 0 && (
                      <div className="space-y-1.5">
                        {result.matchedChunks.slice(0, 3).map((chunk, i) => (
                          <div
                            key={i}
                            className="rounded-md border bg-muted/30 px-3 py-2"
                          >
                            <p className="line-clamp-3 text-sm text-muted-foreground">
                              {chunk.text}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex justify-end pt-1">
                      <Button variant="ghost" size="sm" asChild>
                        <Link
                          to="/documents/$documentId"
                          params={{ documentId: result.document.id }}
                        >
                          View document
                          <ArrowRight className="ml-1 h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="answer">
          {!searchTerm && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <FileText className="h-12 w-12 text-muted-foreground/40" />
              <p className="mt-4 text-lg font-medium text-muted-foreground">
                Ask a question about your archive
              </p>
              <p className="mt-1 text-sm text-muted-foreground/70">
                Answers are grounded in matched document chunks and citations
              </p>
            </div>
          )}

          {searchTerm && isLoading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {searchTerm && isError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
              Answer generation failed. Please try again.
            </div>
          )}

          {answerQuery.data && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Document Answer</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {answerQuery.data.status === "answered" ? (
                    <p className="text-sm leading-6">
                      {answerQuery.data.answer}
                    </p>
                  ) : (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      Not enough grounded evidence to answer confidently.
                    </div>
                  )}

                  {answerQuery.data.reasoning && (
                    <p className="text-sm text-muted-foreground">
                      {answerQuery.data.reasoning}
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Citations</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {answerQuery.data.citations.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No citations available for this query.
                    </p>
                  ) : (
                    answerQuery.data.citations.map((citation) => (
                      <div
                        key={`${citation.documentId}-${citation.chunkIndex}`}
                        className="rounded-lg border p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Link
                            to="/documents/$documentId"
                            params={{ documentId: citation.documentId }}
                            className="text-sm font-medium hover:underline"
                          >
                            {citation.documentTitle}
                          </Link>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline">
                              Chunk {citation.chunkIndex + 1}
                            </Badge>
                            {(citation.pageFrom || citation.pageTo) && (
                              <Badge variant="secondary">
                                Page {citation.pageFrom ?? citation.pageTo}
                                {citation.pageTo &&
                                citation.pageTo !== citation.pageFrom
                                  ? `-${citation.pageTo}`
                                  : ""}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {citation.quote}
                        </p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {answerQuery.data.results.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Supporting Documents</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {answerQuery.data.results.map((result) => (
                      <div
                        key={result.document.id}
                        className="rounded-lg border p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Link
                              to="/documents/$documentId"
                              params={{ documentId: result.document.id }}
                              className="text-sm font-medium hover:underline"
                            >
                              {result.document.title}
                            </Link>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Score: {Math.round(result.score * 100)}%
                            </p>
                          </div>
                          <Button variant="ghost" size="sm" asChild>
                            <Link
                              to="/documents/$documentId"
                              params={{ documentId: result.document.id }}
                            >
                              View
                              <ArrowRight className="ml-1 h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        </div>

                        {result.matchedChunks.length > 0 && (
                          <div className="mt-3 space-y-2">
                            {result.matchedChunks.slice(0, 2).map((chunk) => (
                              <div
                                key={`${result.document.id}-${chunk.chunkIndex}`}
                                className="rounded-md border bg-muted/30 px-3 py-2"
                              >
                                <p className="line-clamp-3 text-sm text-muted-foreground">
                                  {chunk.text}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
