import { useQuery } from "@tanstack/react-query";
import type { ProcessingStatusResponse } from "@openkeep/types";
import { Activity, AlertCircle, Loader2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { api, getApiErrorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  QueueCard,
  formatJobTime,
  jobStatusVariant,
  queueLabel,
} from "./shared";

export function ProcessingActivitySection() {
  const { language, t } = useI18n();
  const statusQuery = useQuery({
    queryKey: ["health", "processing-status"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/health/status");
      if (error || !data) {
        throw new Error(
          getApiErrorMessage(error, t("settings.failedToLoadProcessingStatus")),
        );
      }
      return data as ProcessingStatusResponse;
    },
    refetchInterval: 15_000,
  });

  const status = statusQuery.data;
  const totalDocuments = Object.values(status?.documents.byStatus ?? {}).reduce(
    (sum, count) => sum + count,
    0,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Activity className="h-5 w-5" />
          {t("settings.processingActivity")}
        </CardTitle>
        <CardDescription>
          {t("settings.processingActivityDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("settings.loadingProcessingStatus")}
          </div>
        ) : null}

        {statusQuery.isError ? (
          <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
            <AlertCircle className="h-4 w-4" />
            {statusQuery.error instanceof Error
              ? statusQuery.error.message
              : t("settings.failedToLoadProcessingStatus")}
          </p>
        ) : null}

        {status ? (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <QueueCard
                label={t("settings.ocrQueue")}
                value={status.queues.processing.depth}
                active={status.queues.processing.depth > 0}
              />
              <QueueCard
                label={t("settings.embedQueue")}
                value={status.queues.embedding.depth}
                active={status.queues.embedding.depth > 0}
              />
              <QueueCard
                label={t("settings.totalDocs")}
                value={totalDocuments}
                active={false}
              />
              <QueueCard
                label={t("settings.pendingReview")}
                value={status.documents.pendingReview}
                active={status.documents.pendingReview > 0}
                variant="warning"
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">
                {t("settings.documentsByStatus")}
              </p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(status.documents.byStatus).map(([name, count]) => (
                  <Badge key={name} variant="secondary">
                    <span className="capitalize">{name.replaceAll("_", " ")}</span>
                    <span className="ok-num ml-1">{count}</span>
                  </Badge>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">{t("settings.recentJobs")}</p>
              {status.recentJobs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("settings.noProcessingJobs")}
                </p>
              ) : (
                <div className="divide-y rounded-md border">
                  {status.recentJobs.slice(0, 8).map((job) => (
                    <div
                      key={job.id}
                      className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
                    >
                      <Badge variant={jobStatusVariant(job.status)}>{job.status}</Badge>
                      <span className="font-medium">{queueLabel(job.queueName)}</span>
                      <Link
                        to="/documents/$documentId"
                        params={{ documentId: job.documentId }}
                        className="ok-num truncate text-xs text-muted-foreground underline-offset-2 hover:underline"
                      >
                        {job.documentId}
                      </Link>
                      <span className="ok-num ml-auto text-xs text-muted-foreground">
                        {formatJobTime(job.createdAt, language, t)}
                      </span>
                      {job.lastError ? (
                        <p className="basis-full text-xs text-destructive">
                          {job.lastError}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
