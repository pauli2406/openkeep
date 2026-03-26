import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Document, ReviewReason } from "@openkeep/types";
import { api, getApiErrorMessage } from "@/lib/api";
import { DocumentProcessingIndicator } from "@/components/document-processing-indicator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { processingRefetchInterval } from "@/lib/document-processing";
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
  BrainCircuit,
  ClipboardCheck,
  AlertTriangle,
  CheckCircle,
  RotateCcw,
  FileText,
  Loader2,
  Inbox,
} from "lucide-react";
import { format } from "date-fns";
import { useI18n } from "@/lib/i18n";

function formatReviewReason(reason: string): string {
  return reason
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatFieldLabel(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatFieldDate(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return format(new Date(value), "MMM d, yyyy");
  } catch {
    return value;
  }
}

function getFieldValue(document: Document, field: string): string | null {
  switch (field) {
    case "correspondent":
      return document.correspondent?.name ?? null;
    case "issueDate":
      return formatFieldDate(document.issueDate);
    case "dueDate":
      return formatFieldDate(document.dueDate);
    case "expiryDate":
      return formatFieldDate(document.expiryDate);
    case "amount":
      return document.amount !== null
        ? `${document.amount.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })} ${document.currency ?? ""}`.trim()
        : null;
    case "currency":
      return document.currency ?? null;
    case "referenceNumber":
      return document.referenceNumber ?? null;
    case "holderName":
      return document.holderName ?? null;
    case "issuingAuthority":
      return document.issuingAuthority ?? null;
    default:
      return null;
  }
}

function ReviewFieldPanel({ item }: { item: Document }) {
  const { language } = useI18n();
  const requiredFields =
    item.metadata?.reviewEvidence?.requiredFields ?? item.documentType?.requiredFields ?? [];

  if (requiredFields.length === 0) {
    return null;
  }

  const missingFields =
    item.metadata?.reviewEvidence?.missingFields ??
    requiredFields.filter((field) => !getFieldValue(item, field));
  const missingFieldSet = new Set(missingFields);
  const foundFields = requiredFields
    .map((field) => ({ field, value: getFieldValue(item, field) }))
    .filter((entry) => !missingFieldSet.has(entry.field) && entry.value !== null);

  const copy = language === "de"
    ? {
        verify: "Extrahierte Felder prufen",
        missingCount: (count: number) => `${count} fehlen`,
        allFound: "Alle Pflichtfelder gefunden",
        foundCount: (count: number) => `${count} gefunden`,
        foundValues: "Gefundene Werte",
        noValues: "Noch keine Pflichtwerte gefunden.",
        missingFields: "Fehlende Pflichtfelder",
        noneMissing: "Keine fehlen.",
      }
    : {
        verify: "Verify extracted fields",
        missingCount: (count: number) => `${count} missing`,
        allFound: "All key fields found",
        foundCount: (count: number) => `${count} found`,
        foundValues: "Found values",
        noValues: "No required values found yet.",
        missingFields: "Missing key fields",
        noneMissing: "None missing.",
      };

  return (
    <details
      className="mt-4 rounded-2xl border border-border/70 bg-background/70"
      open={item.reviewReasons.includes("missing_key_fields")}
    >
      <summary className="cursor-pointer list-none px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-foreground">{copy.verify}</span>
          <Badge variant={missingFields.length > 0 ? "warning" : "success"}>
            {missingFields.length > 0
              ? copy.missingCount(missingFields.length)
              : copy.allFound}
          </Badge>
          {foundFields.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {copy.foundCount(foundFields.length)}
            </span>
          )}
        </div>
      </summary>
      <div className="grid gap-3 border-t border-border/60 px-4 py-4 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {copy.foundValues}
          </p>
          {foundFields.length > 0 ? (
            foundFields.map(({ field, value }) => (
              <div key={field} className="rounded-xl border bg-muted/20 px-3 py-2">
                <p className="text-xs text-muted-foreground">{formatFieldLabel(field)}</p>
                <p className="text-sm font-medium text-foreground">{value}</p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">{copy.noValues}</p>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {copy.missingFields}
          </p>
          {missingFields.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {missingFields.map((field) => (
                <Badge key={field} variant="warning">
                  <AlertTriangle className="mr-1 h-3 w-3" />
                  {formatFieldLabel(field)}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{copy.noneMissing}</p>
          )}
        </div>
      </div>
    </details>
  );
}

export const Route = createFileRoute("/review")({
  component: ReviewPage,
});

function ReviewPage() {
  const { language } = useI18n();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [reasonFilter, setReasonFilter] = useState<ReviewReason | "all">("all");

  const copy = language === "de"
    ? {
        fetchError: "Prufungswarteschlange konnte nicht geladen werden",
        loadFailed: "Die Prufungswarteschlange konnte nicht geladen werden. Bitte versuche es erneut.",
        retry: "Erneut versuchen",
        title: "Prufungswarteschlange",
        pendingDocs: (count: number) => `${count} ${count === 1 ? "Dokument" : "Dokumente"} warten auf Prufung`,
        filterByReason: "Nach Grund filtern",
        allReasons: "Alle Grunde",
        allCaughtUp: "Alles erledigt!",
        noReview: "Keine Dokumente brauchen eine Prufung",
        noMatching: "Keine passenden Dokumente",
        noMatchFilter: "Keine Dokumente passen zum gewahlten Filter",
        clearFilter: "Filter zurucksetzen",
        untitled: "Unbenanntes Dokument",
        resolve: "Abschliessen",
        requeue: "Neu einreihen",
        confidence: "Konfidenz",
        previous: "Zuruck",
        next: "Weiter",
        page: (page: number, totalPages: number) => `Seite ${page} von ${totalPages}`,
      }
    : {
        fetchError: "Failed to fetch review queue",
        loadFailed: "Failed to load review queue. Please try again.",
        retry: "Retry",
        title: "Review Queue",
        pendingDocs: (count: number) => `${count} ${count === 1 ? "document" : "documents"} pending review`,
        filterByReason: "Filter by reason",
        allReasons: "All reasons",
        allCaughtUp: "All caught up!",
        noReview: "No documents need review",
        noMatching: "No matching documents",
        noMatchFilter: "No documents match the selected filter",
        clearFilter: "Clear filter",
        untitled: "Untitled Document",
        resolve: "Resolve",
        requeue: "Requeue",
        confidence: "Confidence",
        previous: "Previous",
        next: "Next",
        page: (page: number, totalPages: number) => `Page ${page} of ${totalPages}`,
      };

  const reviewQuery = useQuery({
    queryKey: ["documents", "review", page],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/documents/review", {
        params: {
          query: {
            page,
            pageSize: 20,
          },
        },
      });
      if (!response.ok || error || !data) {
        throw new Error(copy.fetchError);
      }
      return data;
    },
    refetchInterval: (query) => processingRefetchInterval(query.state.data, (data) => data?.items),
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
          {copy.loadFailed}
        </p>
        <Button variant="outline" onClick={() => reviewQuery.refetch()}>
          {copy.retry}
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
            {copy.title}
          </h1>
          <p className="text-muted-foreground">
            {copy.pendingDocs(total)}
          </p>
        </div>

        {/* Filter by reason */}
        {allReasons.size > 0 && (
          <Select
            value={reasonFilter}
            onValueChange={(value) => setReasonFilter(value as ReviewReason | "all")}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder={copy.filterByReason} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{copy.allReasons}</SelectItem>
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
                <h3 className="mt-4 text-lg font-semibold">{copy.allCaughtUp}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {copy.noReview}
                </p>
              </>
            ) : (
              <>
                <Inbox className="h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold">
                  {copy.noMatching}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {copy.noMatchFilter}
                </p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => setReasonFilter("all")}
                >
                  {copy.clearFilter}
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
                        {item.title || copy.untitled}
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
                    {copy.resolve}
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
                    {copy.requeue}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-wrap items-center gap-2">
                <DocumentProcessingIndicator document={item} className="w-full" />
                {item.reviewReasons.map((reason) => (
                  <Badge key={reason} variant="warning">
                    <AlertTriangle className="mr-1 h-3 w-3" />
                    {formatReviewReason(reason)}
                  </Badge>
                ))}
                {item.confidence !== null && item.confidence !== undefined && (
                  <Badge variant="secondary">
                    {copy.confidence}: {Math.round(item.confidence * 100)}%
                  </Badge>
                )}
                {item.metadata?.intelligence?.routing?.documentType && (
                  <Badge variant="outline">
                    <BrainCircuit className="mr-1 h-3 w-3" />
                    {item.metadata.intelligence.routing.documentType}
                  </Badge>
                )}
              </div>
              {(item.metadata?.intelligence?.validation?.warnings?.length ?? 0) > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.metadata?.intelligence?.validation?.warnings?.map((warning) => (
                    <Badge key={warning} variant="outline" className="text-xs">
                      {formatReviewReason(warning)}
                    </Badge>
                  ))}
                </div>
              )}
              {item.metadata?.intelligence?.summary?.value && (
                <p className="mt-3 text-sm text-muted-foreground">
                  {item.metadata.intelligence.summary.value}
                </p>
              )}
              <ReviewFieldPanel item={item as Document} />
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
            {copy.previous}
          </Button>
          <span className="text-sm text-muted-foreground">
            {copy.page(page, Math.ceil(total / 20))}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= Math.ceil(total / 20)}
            onClick={() => setPage((p) => p + 1)}
          >
            {copy.next}
          </Button>
        </div>
      )}
    </div>
  );
}
