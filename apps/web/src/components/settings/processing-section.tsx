import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type {
  ArchiveImportResult,
  ArchiveSnapshot,
  ArchiveSnapshot as ArchiveSnapshotType,
  Correspondent,
  Document,
  DocumentType,
  HealthProvidersResponse,
  HealthResponse,
  ProcessingStatusResponse,
  ProviderConfig,
  ReadinessResponse,
  Tag,
  WatchFolderScanResponse,
} from "@openkeep/types";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertCircle,
  Loader2,
  Activity,
  RefreshCw,
  } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { QueueCard, formatJobTime, jobStatusVariant, queueLabel } from "./shared";

export function ProcessingActivitySection() {
  const { language, t } = useI18n();
  const statusQuery = useQuery({
    queryKey: ["health", "status"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/health/status");
      if (!response.ok || error || !data) {
        throw error ?? new Error(t("settings.failedToFetchStatus"));
      }
      return data as ProcessingStatusResponse;
    },
    refetchInterval: 5000,
  });

  const data = statusQuery.data;

  const totalDocs = data
    ? Object.values(data.documents.byStatus).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="h-5 w-5" />
              {t("settings.processingActivity")}
            </CardTitle>
            <CardDescription>
              {t("settings.processingActivityDescription")}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => statusQuery.refetch()}
            disabled={statusQuery.isFetching}
          >
            <RefreshCw
              className={`h-4 w-4 ${statusQuery.isFetching ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {statusQuery.isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {statusQuery.isError && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {t("settings.failedToLoadProcessingStatus")}
          </div>
        )}

        {data && (
          <>
            {/* Queue depths + Document counts */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <QueueCard
                label={t("settings.ocrQueue")}
                value={data.queues.processing.depth}
                active={data.queues.processing.depth > 0}
              />
              <QueueCard
                label={t("settings.embedQueue")}
                value={data.queues.embedding.depth}
                active={data.queues.embedding.depth > 0}
              />
              <QueueCard
                label={t("settings.totalDocs")}
                value={totalDocs}
                active={false}
              />
              <QueueCard
                label={t("settings.pendingReview")}
                value={data.documents.pendingReview}
                active={data.documents.pendingReview > 0}
                variant="warning"
              />
            </div>

            {/* Document status breakdown */}
            {Object.keys(data.documents.byStatus).length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">{t("settings.documentsByStatus")}</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data.documents.byStatus).map(
                    ([status, count]) => (
                      <div
                        key={status}
                        className="flex items-center gap-1.5 rounded-md border px-2.5 py-1"
                      >
                        <div
                          className={`h-2 w-2 rounded-full ${
                            status === "ready"
                              ? "bg-[var(--ok-green)]"
                              : status === "processing"
                                ? "bg-[var(--ok-amber)] animate-pulse"
                                : status === "pending"
                                  ? "bg-[var(--ok-cat-2)]"
                                  : status === "failed"
                                    ? "bg-[var(--ok-red)]"
                                    : "bg-[var(--ok-dim)]"
                          }`}
                        />
                        <span className="text-xs font-medium capitalize">
                          {status}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          <span className="ok-num">{count}</span>
                        </span>
                      </div>
                    ),
                  )}
                </div>
              </div>
            )}

            <Separator />

            {/* Recent jobs */}
            <div>
              <p className="mb-2 text-sm font-medium">{t("settings.recentJobs")}</p>
              {data.recentJobs.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {t("settings.noProcessingJobs")}
                </p>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {data.recentJobs.map((job) => (
                    <div
                      key={job.id}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant={jobStatusVariant(job.status)}>
                            {job.status}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {queueLabel(job.queueName)}
                          </span>
                        </div>
                        {job.lastError && (
                          <p className="mt-1 truncate text-xs text-destructive">
                            {job.lastError}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs text-muted-foreground font-mono">
                          {job.documentId.slice(0, 8)}
                        </p>
                        <p className="ok-num text-xs text-muted-foreground">
                          {formatJobTime(job.createdAt, language, t)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

