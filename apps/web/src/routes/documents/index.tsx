import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  FileText,
  Calendar,
  Building2,
  Loader2,
  SlidersHorizontal,
  ArrowUpDown,
} from "lucide-react";
import { format } from "date-fns";

type DocumentsSearch = {
  query?: string;
  year?: number;
  correspondentId?: string;
  documentTypeId?: string;
  status?: "pending" | "processing" | "ready" | "failed";
  page?: number;
  pageSize?: number;
  sort?: "createdAt" | "issueDate" | "dueDate" | "title";
  direction?: "asc" | "desc";
};

export const Route = createFileRoute("/documents/")({
  validateSearch: (search: Record<string, unknown>): DocumentsSearch => ({
    query: (search.query as string) || undefined,
    year: search.year ? Number(search.year) : undefined,
    correspondentId: (search.correspondentId as string) || undefined,
    documentTypeId: (search.documentTypeId as string) || undefined,
    status: search.status as DocumentsSearch["status"],
    page: search.page ? Number(search.page) : undefined,
    pageSize: search.pageSize ? Number(search.pageSize) : undefined,
    sort: search.sort as DocumentsSearch["sort"],
    direction: search.direction as DocumentsSearch["direction"],
  }),
  component: DocumentsPage,
});

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "ready", label: "Ready" },
  { value: "failed", label: "Failed" },
] as const;

const SORT_OPTIONS = [
  { value: "createdAt", label: "Created" },
  { value: "issueDate", label: "Issue Date" },
  { value: "title", label: "Title" },
] as const;

function statusVariant(status: string) {
  switch (status) {
    case "ready":
      return "success" as const;
    case "failed":
      return "destructive" as const;
    case "processing":
      return "warning" as const;
    default:
      return "secondary" as const;
  }
}

function DocumentsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [searchInput, setSearchInput] = useState(search.query ?? "");

  const params = {
    query: search.query,
    year: search.year,
    correspondentId: search.correspondentId,
    documentTypeId: search.documentTypeId,
    status: search.status,
    page: search.page ?? 1,
    pageSize: search.pageSize ?? 20,
    sort: search.sort ?? "createdAt",
    direction: search.direction ?? "desc",
  };

  const documentsQuery = useQuery({
    queryKey: ["documents", params],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/documents", {
        params: { query: params },
      });
      if (error) throw error;
      return data;
    },
  });

  const facetsQuery = useQuery({
    queryKey: ["documents", "facets"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/documents/facets");
      if (error) throw error;
      return data as unknown as {
        years: Array<{ year: number; count: number }>;
        correspondents: Array<{
          id: string;
          name: string;
          slug: string;
          count: number;
        }>;
        documentTypes: Array<{
          id: string;
          name: string;
          slug: string;
          count: number;
        }>;
        tags: Array<{
          id: string;
          name: string;
          slug: string;
          count: number;
        }>;
      };
    },
  });

  function updateSearch(updates: Partial<DocumentsSearch>) {
    navigate({
      search: ((prev: DocumentsSearch) => {
        const next = { ...prev, ...updates };
        // Reset to page 1 when filters change (unless page itself is being set)
        if (!("page" in updates)) {
          next.page = undefined;
        }
        // Strip undefined values
        return Object.fromEntries(
          Object.entries(next).filter(([, v]) => v !== undefined && v !== ""),
        ) as DocumentsSearch;
      }) as never,
    });
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateSearch({ query: searchInput || undefined });
  }

  function clearFilter(key: keyof DocumentsSearch) {
    if (key === "query") setSearchInput("");
    updateSearch({ [key]: undefined });
  }

  const data = documentsQuery.data;
  const facets = facetsQuery.data;
  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;
  const currentPage = data?.page ?? 1;

  // Collect active filters for badge display
  const activeFilters: Array<{
    key: keyof DocumentsSearch;
    label: string;
  }> = [];
  if (search.query) activeFilters.push({ key: "query", label: `"${search.query}"` });
  if (search.year) activeFilters.push({ key: "year", label: `Year: ${search.year}` });
  if (search.correspondentId) {
    const name =
      facets?.correspondents.find((c) => c.id === search.correspondentId)?.name ??
      "Correspondent";
    activeFilters.push({ key: "correspondentId", label: name });
  }
  if (search.documentTypeId) {
    const name =
      facets?.documentTypes.find((t) => t.id === search.documentTypeId)?.name ?? "Type";
    activeFilters.push({ key: "documentTypeId", label: name });
  }
  if (search.status) {
    const label =
      STATUS_OPTIONS.find((s) => s.value === search.status)?.label ?? search.status;
    activeFilters.push({ key: "status", label: `Status: ${label}` });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="text-sm text-muted-foreground">
          Browse and filter your document archive.
        </p>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearchSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search documents..."
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-3">
        <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />

        {/* Year */}
        <Select
          value={search.year?.toString() ?? ""}
          onValueChange={(v) =>
            updateSearch({ year: v ? Number(v) : undefined })
          }
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            {facets?.years.map((y) => (
              <SelectItem key={y.year} value={y.year.toString()}>
                {y.year} ({y.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Correspondent */}
        <Select
          value={search.correspondentId ?? ""}
          onValueChange={(v) =>
            updateSearch({ correspondentId: v || undefined })
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Correspondent" />
          </SelectTrigger>
          <SelectContent>
            {facets?.correspondents.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name} ({c.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Document Type */}
        <Select
          value={search.documentTypeId ?? ""}
          onValueChange={(v) =>
            updateSearch({ documentTypeId: v || undefined })
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Document Type" />
          </SelectTrigger>
          <SelectContent>
            {facets?.documentTypes.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name} ({t.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Status */}
        <Select
          value={search.status ?? ""}
          onValueChange={(value) =>
            updateSearch({
              status: (value || undefined) as DocumentsSearch["status"],
            })
          }
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Separator + Sort */}
        <div className="ml-auto flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
          <Select
            value={search.sort ?? "createdAt"}
            onValueChange={(value) =>
              updateSearch({ sort: value as DocumentsSearch["sort"] })
            }
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={search.direction ?? "desc"}
            onValueChange={(value) =>
              updateSearch({ direction: value as DocumentsSearch["direction"] })
            }
          >
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desc">Newest</SelectItem>
              <SelectItem value="asc">Oldest</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Active filter badges */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {activeFilters.map((f) => (
            <Badge
              key={f.key}
              variant="secondary"
              className="cursor-pointer gap-1 pr-1.5"
              onClick={() => clearFilter(f.key)}
            >
              {f.label}
              <X className="h-3 w-3" />
            </Badge>
          ))}
          {activeFilters.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-muted-foreground"
              onClick={() => {
                setSearchInput("");
                navigate({ search: {} } as never);
              }}
            >
              Clear all
            </Button>
          )}
        </div>
      )}

      {/* Loading */}
      {documentsQuery.isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Error */}
      {documentsQuery.isError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load documents. Please try again.
        </div>
      )}

      {/* Document list */}
      {data && !documentsQuery.isLoading && (
        <>
          {data.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <FileText className="h-12 w-12 text-muted-foreground/40" />
              <p className="mt-4 text-lg font-medium text-muted-foreground">
                No documents found
              </p>
              <p className="mt-1 text-sm text-muted-foreground/70">
                {activeFilters.length > 0
                  ? "Try adjusting your filters."
                  : "Upload a document to get started."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.items.map((doc) => (
                <Card key={doc.id} className="transition-colors hover:bg-muted/30">
                  <CardContent className="flex items-start gap-4 p-4">
                    <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-start justify-between gap-3">
                        <Link
                          to={"/documents/$documentId" as never}
                          params={{ documentId: doc.id } as never}
                          className="font-medium leading-snug hover:underline"
                        >
                          {doc.title}
                        </Link>
                        <Badge variant={statusVariant(doc.status)} className="shrink-0">
                          {doc.status}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        {doc.correspondent && (
                          <span className="inline-flex items-center gap-1">
                            <Building2 className="h-3.5 w-3.5" />
                            {doc.correspondent.name}
                          </span>
                        )}
                        {doc.documentType && (
                          <span className="inline-flex items-center gap-1">
                            <FileText className="h-3.5 w-3.5" />
                            {doc.documentType.name}
                          </span>
                        )}
                        {doc.issueDate && (
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" />
                            {format(new Date(doc.issueDate), "MMM d, yyyy")}
                          </span>
                        )}
                      </div>

                      {doc.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {doc.tags.map((tag) => (
                            <Badge key={tag.id} variant="outline" className="text-xs">
                              {tag.name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-muted-foreground">
                {data.total} document{data.total !== 1 ? "s" : ""} &middot; Page{" "}
                {currentPage} of {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage <= 1}
                  onClick={() => updateSearch({ page: currentPage - 1 })}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages}
                  onClick={() => updateSearch({ page: currentPage + 1 })}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
