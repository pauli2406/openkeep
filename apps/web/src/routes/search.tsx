import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
  mode?: "keyword" | "semantic";
};

export const Route = createFileRoute("/search")({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    q: (search.q as string) || undefined,
    mode: (search.mode as "keyword" | "semantic") || undefined,
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

interface SemanticChunk {
  text: string;
  score: number;
}

interface SemanticResult {
  documentId: string;
  title: string;
  score: number;
  keywordScore?: number;
  semanticScore?: number;
  chunks: SemanticChunk[];
}

interface SemanticResponse {
  results: SemanticResult[];
}

function SearchPage() {
  const { q, mode } = Route.useSearch();
  const navigate = Route.useNavigate();

  const searchTerm = q ?? "";
  const searchMode = mode ?? "keyword";

  function setSearchTerm(value: string) {
    navigate({
      search: (prev) => ({ ...prev, q: value || undefined }),
      replace: true,
    });
  }

  function setSearchMode(value: string) {
    navigate({
      search: (prev) => ({
        ...prev,
        mode: (value as "keyword" | "semantic") || undefined,
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
      const { data, error } = await api.GET("/api/search/documents" as never, {
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
        "/api/search/semantic" as never,
        { body: { query: searchTerm } } as never,
      );
      if (error) throw new Error("Semantic search failed");
      return data as unknown as SemanticResponse;
    },
    enabled: searchMode === "semantic" && searchTerm.length > 0,
  });

  const isLoading =
    (searchMode === "keyword" && keywordQuery.isLoading) ||
    (searchMode === "semantic" && semanticQuery.isLoading);

  const isError =
    (searchMode === "keyword" && keywordQuery.isError) ||
    (searchMode === "semantic" && semanticQuery.isError);

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
            semanticQuery.data.results.length === 0 && (
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

          {semanticQuery.data && semanticQuery.data.results.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {semanticQuery.data.results.length} result
                {semanticQuery.data.results.length !== 1 ? "s" : ""} found
              </p>
              {semanticQuery.data.results.map((result) => (
                <Card
                  key={result.documentId}
                  className="transition-colors hover:bg-muted/30"
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="text-base">
                        <Link
                          to="/documents/$documentId"
                          params={{ documentId: result.documentId }}
                          className="hover:underline"
                        >
                          {result.title || "Untitled Document"}
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
                    {(result.semanticScore !== undefined ||
                      result.keywordScore !== undefined) && (
                      <div className="flex flex-wrap gap-2">
                        {result.semanticScore !== undefined && (
                          <Badge variant="outline" className="text-xs">
                            <Sparkles className="mr-1 h-3 w-3" />
                            Semantic: {Math.round(result.semanticScore * 100)}%
                          </Badge>
                        )}
                        {result.keywordScore !== undefined && (
                          <Badge variant="outline" className="text-xs">
                            <SearchIcon className="mr-1 h-3 w-3" />
                            Keyword: {Math.round(result.keywordScore * 100)}%
                          </Badge>
                        )}
                      </div>
                    )}

                    {/* Matched chunks */}
                    {result.chunks.length > 0 && (
                      <div className="space-y-1.5">
                        {result.chunks.slice(0, 3).map((chunk, i) => (
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
                          params={{ documentId: result.documentId }}
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
      </Tabs>
    </div>
  );
}
