import { useQuery } from "@tanstack/react-query";
import type { ProcessingStatusResponse } from "@openkeep/types";
import { Activity, ListChecks } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { api, getApiErrorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  QueueCard,
  RetryAlert,
  SectionCard,
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
    <SectionCard
      icon={<Activity />}
      title={t("settings.processingActivity")}
      description={t("settings.processingActivityDescription")}
    >
      <div className="flex flex-col gap-5">
        {statusQuery.isLoading ? (
          <div
            className="grid grid-cols-2 gap-3 lg:grid-cols-4"
            role="status"
            aria-label={t("settings.loadingProcessingStatus")}
          >
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : null}

        {statusQuery.isError ? (
          <RetryAlert
            message={
              statusQuery.error instanceof Error
                ? statusQuery.error.message
                : t("settings.failedToLoadProcessingStatus")
            }
            onRetry={() => void statusQuery.refetch()}
          />
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

            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                {t("settings.documentsByStatus")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(status.documents.byStatus).map(([name, count]) => (
                  <Badge key={name} variant="secondary">
                    <span className="capitalize">{name.replaceAll("_", " ")}</span>
                    <span className="num font-semibold">{count}</span>
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                {t("settings.recentJobs")}
              </p>
              {status.recentJobs.length === 0 ? (
                <Empty className="border py-8">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <ListChecks />
                    </EmptyMedia>
                    <EmptyDescription>{t("settings.noProcessingJobs")}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <div className="divide-y rounded-lg border">
                  {status.recentJobs.slice(0, 8).map((job) => (
                    <div
                      key={job.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm"
                    >
                      <Badge variant={jobStatusVariant(job.status)} className="capitalize">
                        {job.status}
                      </Badge>
                      <span className="font-medium">{queueLabel(job.queueName)}</span>
                      <Link
                        to="/documents/$documentId"
                        params={{ documentId: job.documentId }}
                        className="min-w-0 truncate font-mono text-xs text-muted-foreground underline-offset-2 hover:text-brand hover:underline"
                      >
                        {job.documentId}
                      </Link>
                      <span className="num ml-auto text-xs text-muted-foreground">
                        {formatJobTime(job.createdAt, language, t)}
                      </span>
                      {job.lastError ? (
                        <p className="basis-full text-xs text-destructive">{job.lastError}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </SectionCard>
  );
}
