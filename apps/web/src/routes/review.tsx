import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReviewReason, SearchDocumentsResponse } from "@openkeep/types";
import { api, authFetch, getApiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ClipboardCheck,
  AlertTriangle,
  CheckCircle,
  RotateCcw,
  FileText,
  Loader2,
  Inbox,
} from "lucide-react";
import { format } from "date-fns";

export const Route = createFileRoute("/review")({
  component: ReviewPage,
});

function ReviewPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [reasonFilter, setReasonFilter] = useState<ReviewReason | "all">("all");

  const reviewQuery = useQuery({
    queryKey: ["documents", "review", page],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "20",
      });
      const response = await authFetch(`/api/documents/review?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch review queue");
      return (await response.json()) as SearchDocumentsResponse;
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const { error } = await api.POST("/api/documents/{id}/review/resolve", {
        params: { path: { id: documentId } },
        body: {},
      });
      if (error) throw new Error(getApiErrorMessage(error, "Failed to resolve review"));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents", "review"] });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });

  const requeueMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const { error } = await api.POST("/api/documents/{id}/review/requeue", {
        params: { path: { id: documentId } },
        body: { force: true },
      });
      if (error) throw new Error(getApiErrorMessage(error, "Failed to requeue document"));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents", "review"] });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });

  if (reviewQuery.isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (reviewQuery.isError) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-4">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground">
          Failed to load review queue. Please try again.
        </p>
        <Button variant="outline" onClick={() => reviewQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const items = reviewQuery.data?.items ?? [];
  const total = reviewQuery.data?.total ?? 0;

  // Collect unique review reasons for filter dropdown
  const allReasons = new Set<ReviewReason>();
  for (const item of items) {
    if (item.reviewReasons) {
      for (const r of item.reviewReasons) {
        allReasons.add(r);
      }
    }
  }

  const filteredItems =
    reasonFilter === "all"
      ? items
      : items.filter((item) => item.reviewReasons?.includes(reasonFilter));

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <ClipboardCheck className="h-7 w-7" />
            Review Queue
          </h1>
          <p className="text-muted-foreground">
            {total} {total === 1 ? "document" : "documents"} pending review
          </p>
        </div>

        {/* Filter by reason */}
        {allReasons.size > 0 && (
          <Select
            value={reasonFilter}
            onValueChange={(value) => setReasonFilter(value as ReviewReason | "all")}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Filter by reason" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All reasons</SelectItem>
              {Array.from(allReasons).map((reason) => (
                <SelectItem key={reason} value={reason}>
                  {reason}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Empty state */}
      {filteredItems.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            {total === 0 ? (
              <>
                <CheckCircle className="h-12 w-12 text-emerald-500" />
                <h3 className="mt-4 text-lg font-semibold">All caught up!</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  No documents need review
                </p>
              </>
            ) : (
              <>
                <Inbox className="h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold">
                  No matching documents
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  No documents match the selected filter
                </p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => setReasonFilter("all")}
                >
                  Clear filter
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Review items */}
      <div className="space-y-3">
        {filteredItems.map((item) => (
          <Card key={item.id}>
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-base">
                    <Link
                      to="/documents/$documentId"
                      params={{ documentId: item.id }}
                      className="hover:underline"
                    >
                      <span className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        {item.title || "Untitled Document"}
                      </span>
                    </Link>
                  </CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-2">
                    {item.correspondent && (
                      <span>
                        {typeof item.correspondent === "string"
                          ? item.correspondent
                          : item.correspondent.name}
                      </span>
                    )}
                    {item.documentType && (
                      <>
                        <span className="text-muted-foreground/50">|</span>
                        <span>
                          {typeof item.documentType === "string"
                            ? item.documentType
                            : item.documentType.name}
                        </span>
                      </>
                    )}
                    {item.createdAt && (
                      <>
                        <span className="text-muted-foreground/50">|</span>
                        <span>
                          {format(new Date(item.createdAt), "MMM d, yyyy")}
                        </span>
                      </>
                    )}
                  </CardDescription>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => resolveMutation.mutate(item.id)}
                    disabled={
                      resolveMutation.isPending || requeueMutation.isPending
                    }
                  >
                    {resolveMutation.isPending &&
                    resolveMutation.variables === item.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle className="h-4 w-4" />
                    )}
                    Resolve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => requeueMutation.mutate(item.id)}
                    disabled={
                      resolveMutation.isPending || requeueMutation.isPending
                    }
                  >
                    {requeueMutation.isPending &&
                    requeueMutation.variables === item.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4" />
                    )}
                    Requeue
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-wrap items-center gap-2">
                {item.reviewReasons.map((reason) => (
                  <Badge key={reason} variant="warning">
                    <AlertTriangle className="mr-1 h-3 w-3" />
                    {reason}
                  </Badge>
                ))}
                {item.confidence !== null && item.confidence !== undefined && (
                  <Badge variant="secondary">
                    Confidence: {Math.round(item.confidence * 100)}%
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pagination */}
      {total > 20 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {Math.ceil(total / 20)}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= Math.ceil(total / 20)}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
