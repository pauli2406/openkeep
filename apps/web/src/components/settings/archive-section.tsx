import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueries, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ArchiveImportResult,
  ArchiveSnapshot,
  ArchiveSnapshot as ArchiveSnapshotType,
  Document,
  EmailIngestStatusResponse,
  WatchFolderScanResponse,
  WatchFolderStatusResponse,
} from "@openkeep/types";
import { Archive, ChevronRight, Download, FolderSearch, Mail, RefreshCw, Upload } from "lucide-react";
import { format } from "date-fns";
import type { ReactNode } from "react";
import { IconTile } from "@/components/layout/page";
import { api, authFetch, getApiErrorMessage } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { useHostFileSaver } from "@/lib/host-shell";
import {
  QueueCard,
  RetryAlert,
  SectionCard,
  StatusBadge,
  WatchFolderFieldReview,
  formatWatchFolderAction,
  formatWatchFolderReason,
  watchFolderActionVariant,
} from "./shared";

/** The head of one ingest source: what it is and whether it is set up. */
function SourceHead({
  icon,
  title,
  description,
  status,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  status: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="flex min-w-0 flex-1 basis-56 items-start gap-3">
        <IconTile size="sm">{icon}</IconTile>
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">{status}</div>
    </div>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h4 className="text-xs font-medium text-muted-foreground">{children}</h4>;
}

export function ArchiveOperationsSection() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const hostFileSaver = useHostFileSaver();
  const [snapshotText, setSnapshotText] = useState("");
  const [importMode, setImportMode] = useState<"replace" | "merge">("replace");
  const [watchDryRun, setWatchDryRun] = useState(true);
  const [lastImportResult, setLastImportResult] = useState<string | null>(null);
  const [watchResult, setWatchResult] = useState<WatchFolderScanResponse | null>(null);

  const emailInboxQuery = useQuery({
    queryKey: ["email-ingest", "status"],
    queryFn: async () => {
      const response = await authFetch("/api/email-ingest/status");
      if (!response.ok) {
        throw new Error(t("settings.emailInboxStatusFailed"));
      }
      return (await response.json()) as EmailIngestStatusResponse;
    },
    refetchInterval: 30_000,
  });

  const pollNowMutation = useMutation({
    mutationFn: async () => {
      const response = await authFetch("/api/email-ingest/poll", { method: "POST" });
      if (!response.ok) {
        throw new Error(t("settings.emailInboxPollFailed"));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["email-ingest", "status"] });
    },
  });

  const watchStatusQuery = useQuery({
    queryKey: ["archive", "watch-folder", "status"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/archive/watch-folder");
      if (error || !data) {
        throw new Error(
          getApiErrorMessage(error, t("settings.watchFolderStatusFailed")),
        );
      }
      return data as WatchFolderStatusResponse;
    },
    refetchInterval: 30_000,
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      if (hostFileSaver) {
        let result;
        try {
          result = await hostFileSaver({ kind: "archive-export" });
        } catch {
          throw new Error(t("settings.exportArchiveFailed"));
        }
        if (result.status === "failed") {
          throw new Error(result.message);
        }
        return null;
      }
      const { data, error } = await api.GET("/api/archive/export", {});
      if (error) {
        throw new Error(getApiErrorMessage(error, t("settings.failedToExportArchive")));
      }
      return data as ArchiveSnapshot;
    },
    onSuccess: (data) => {
      if (data) {
        setSnapshotText(JSON.stringify(data, null, 2));
      }
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const snapshot = JSON.parse(snapshotText) as ArchiveSnapshotType;
      const { data, error } = await api.POST("/api/archive/import", {
        body: {
          mode: importMode,
          snapshot,
        },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("settings.failedToImportArchive")));
      }
      return data as ArchiveImportResult;
    },
    onSuccess: (data) => {
      setLastImportResult(JSON.stringify(data, null, 2));
    },
  });

  const watchMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/api/archive/watch-folder/scan", {
        body: { dryRun: watchDryRun },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("settings.failedToScanWatchFolder")));
      }
      return data as WatchFolderScanResponse;
    },
    onSuccess: (data) => {
      setWatchResult(data);
      void queryClient.invalidateQueries({
        queryKey: ["archive", "watch-folder", "status"],
      });
    },
  });

  const watchImportedCount =
    watchResult?.summary.imported ?? 0;
  const watchDuplicateCount =
    watchResult?.summary.duplicate ?? 0;
  const watchUnsupportedCount =
    watchResult?.summary.unsupported ?? 0;
  const watchFailedCount =
    watchResult?.summary.failed ?? 0;
  const watchPlannedCount =
    watchResult?.summary.planned ?? 0;
  const watchProblemItems =
    watchResult?.items.filter(
      (item) => item.action !== "imported" && item.action !== "duplicate",
    ) ?? [];
  const watchReviewDocumentQueries = useQueries({
    queries: (watchResult?.items ?? [])
      .filter((item) => item.documentId)
      .map((item) => ({
        queryKey: ["watch-folder-scan-document", item.documentId],
        queryFn: async () => {
          const { data, error } = await api.GET("/api/documents/{id}", {
            params: { path: { id: item.documentId! } },
          });
          if (error) {
            throw new Error(getApiErrorMessage(error, t("settings.failedToLoadScanResultDetails")));
          }
          return data as Document;
        },
      })),
  });
  const watchReviewDocuments = new Map(
    watchReviewDocumentQueries
      .map((query) => query.data)
      .filter((doc): doc is Document => Boolean(doc))
      .map((doc) => [doc.id, doc]),
  );
  const watchReviewDocumentStates = new Map(
    (watchResult?.items ?? [])
      .filter((item) => item.documentId)
      .map((item, index) => [item.documentId!, watchReviewDocumentQueries[index]]),
  );
  return (
    <SectionCard
      icon={<Archive />}
      title={t("settings.archivePortability")}
      description={t("settings.archivePortabilityDescription")}
    >
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <SubHeading>{t("settings.sources")}</SubHeading>

          <div className="overflow-hidden rounded-xl border">
            <div className="flex flex-col gap-3 p-4">
              {watchStatusQuery.isLoading ? <Skeleton className="h-16 rounded-lg" /> : null}

              {watchStatusQuery.data ? (
                <>
                  <SourceHead
                    icon={<FolderSearch />}
                    title={t("settings.watchFolderServer")}
                    description={t("settings.watchFolderServerDescription")}
                    status={
                      <StatusBadge tone={watchStatusQuery.data.configured ? "ok" : "muted"}>
                        {watchStatusQuery.data.configured
                          ? t("settings.configured")
                          : t("settings.notConfigured")}
                      </StatusBadge>
                    }
                  />
                  {watchStatusQuery.data.configuredPath ? (
                    <p className="font-mono text-xs break-all text-muted-foreground">
                      {t("settings.path")}: {watchStatusQuery.data.configuredPath}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {t("settings.lastScan")}:{" "}
                      <span className="num">
                        {watchStatusQuery.data.lastScan
                          ? format(new Date(watchStatusQuery.data.lastScan.scannedAt), "MMM d, yyyy HH:mm")
                          : t("settings.neverScanned")}
                      </span>
                    </span>
                    <span>
                      {t("settings.lastImport")}:{" "}
                      <span className="num">
                        {watchStatusQuery.data.lastImport
                          ? format(new Date(watchStatusQuery.data.lastImport.scannedAt), "MMM d, yyyy HH:mm")
                          : t("settings.neverScanned")}
                      </span>
                    </span>
                  </div>
                </>
              ) : null}

              {watchStatusQuery.isError ? (
                <RetryAlert
                  message={
                    watchStatusQuery.error instanceof Error
                      ? watchStatusQuery.error.message
                      : t("settings.watchFolderStatusFailed")
                  }
                  onRetry={() => void watchStatusQuery.refetch()}
                />
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/40 px-4 py-2.5">
              <div className="flex items-center gap-2.5">
                <Switch
                  id="watch-dry-run"
                  checked={watchDryRun}
                  onCheckedChange={(checked) => setWatchDryRun(checked)}
                />
                <Label htmlFor="watch-dry-run" className="font-normal">
                  {watchDryRun ? t("settings.dryRunEnabled") : t("settings.dryRunDisabled")}
                </Label>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => watchMutation.mutate()}
                disabled={watchMutation.isPending}
              >
                {watchMutation.isPending ? <Spinner /> : <RefreshCw />}
                {t("settings.scanWatchFolder")}
              </Button>
            </div>
          </div>

          {watchMutation.isError && (
            <RetryAlert
              message={
                watchMutation.error instanceof Error
                  ? watchMutation.error.message
                  : t("settings.failedToScanWatchFolder")
              }
            />
          )}

          {watchResult && (
            <div className="flex flex-col gap-4 rounded-xl border p-4">
              <div>
                <p className="text-sm font-medium">{t("settings.watchFolderScan")}</p>
                <p className="font-mono text-xs break-all text-muted-foreground">
                  {t("settings.path")}: {watchResult.configuredPath}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5">
                <QueueCard
                  label={t("settings.imported")}
                  value={watchImportedCount}
                  active={watchImportedCount > 0}
                />
                <QueueCard
                  label={t("settings.duplicates")}
                  value={watchDuplicateCount}
                  active={watchDuplicateCount > 0}
                />
                <QueueCard
                  label={t("settings.unsupported")}
                  value={watchUnsupportedCount}
                  active={watchUnsupportedCount > 0}
                  variant="warning"
                />
                <QueueCard
                  label={t("settings.failures")}
                  value={watchFailedCount}
                  active={watchFailedCount > 0}
                  variant="warning"
                />
                <QueueCard
                  label={watchResult.dryRun ? t("settings.planned") : t("settings.total")}
                  value={watchResult.dryRun ? watchPlannedCount : watchResult.summary.total}
                  active={(watchResult.dryRun ? watchPlannedCount : watchResult.summary.total) > 0}
                />
              </div>
              {watchResult.items.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <SubHeading>{t("settings.currentScanResults")}</SubHeading>
                    <p className="text-xs text-muted-foreground">
                      <span className="num">{watchResult.items.length}</span>{" "}
                      {t(watchResult.items.length === 1 ? "settings.itemOne" : "settings.itemOther")}
                    </p>
                  </div>
                  <div className="divide-y rounded-lg border">
                    {watchResult.items.map((item) => (
                      <div key={`${item.path}:${item.action}:${item.reason}`} className="p-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex min-w-0 flex-col gap-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={watchFolderActionVariant(item.action)}>
                                {formatWatchFolderAction(item.action)}
                              </Badge>
                              <span className="font-mono text-xs font-medium break-all">{item.path}</span>
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span>{t("settings.reason")}: {formatWatchFolderReason(item.reason)}</span>
                              {item.mimeType && <span>MIME: {item.mimeType}</span>}
                              {item.destinationPath && (
                                <span className="break-all">{t("settings.destination")}: {item.destinationPath}</span>
                              )}
                            </div>
                            {item.detail && (
                              <p className="text-xs text-muted-foreground">{item.detail}</p>
                            )}
                          </div>
                          {item.documentId && (
                            <Button asChild size="sm" variant="outline" className="shrink-0 self-start">
                              <Link
                                to="/documents/$documentId"
                                params={{ documentId: item.documentId }}
                              >
                                {t("settings.openDocument")}
                              </Link>
                            </Button>
                          )}
                        </div>
                        {item.documentId && (
                          <details className="group mt-3 rounded-lg bg-muted/50 px-3 py-2">
                            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
                              <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
                              {t("settings.inspectExtractedFields")}
                            </summary>
                            <div className="mt-3">
                              <WatchFolderFieldReview
                                document={watchReviewDocuments.get(item.documentId) ?? null}
                                isLoading={watchReviewDocumentStates.get(item.documentId)?.isLoading ?? false}
                                isError={watchReviewDocumentStates.get(item.documentId)?.isError ?? false}
                              />
                            </div>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {watchProblemItems.length > 0 && (
                <div className="flex flex-col gap-2">
                  <SubHeading>{t("settings.currentScanIssues")}</SubHeading>
                  <div className="divide-y rounded-lg border bg-muted/30">
                    {watchProblemItems.map((item) => (
                      <div key={`${item.path}:${item.reason}`} className="p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={
                              item.action === "failed" || item.action === "unsupported"
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {formatWatchFolderAction(item.action)}
                          </Badge>
                          <span className="font-mono text-xs font-medium break-all">{item.path}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>{t("settings.reason")}: {formatWatchFolderReason(item.reason)}</span>
                          {item.failureCode && (
                            <span>{t("settings.code")}: {item.failureCode}</span>
                          )}
                          {item.mimeType && <span>MIME: {item.mimeType}</span>}
                          {item.destinationPath && (
                            <span className="break-all">{t("settings.destination")}: {item.destinationPath}</span>
                          )}
                        </div>
                        {item.detail && (
                          <p className="mt-2 text-xs text-muted-foreground">{item.detail}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {watchResult.history.length > 0 && (
                <div className="flex flex-col gap-2">
                  <SubHeading>{t("settings.recentScans")}</SubHeading>
                  <div className="divide-y rounded-lg border">
                    {watchResult.history.map((entry) => (
                      <div
                        key={entry.scannedAt}
                        className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
                      >
                        <div>
                          <p className="num text-sm font-medium">
                            {format(new Date(entry.scannedAt), "MMM d, yyyy HH:mm")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {entry.dryRun ? t("settings.dryRunEnabled") : t("settings.liveScan")}
                          </p>
                        </div>
                        <div className="num flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          <span>{t("settings.imported")}: {entry.imported}</span>
                          <span>{t("settings.duplicates")}: {entry.duplicate}</span>
                          <span>{t("settings.unsupported")}: {entry.unsupported}</span>
                          <span>{t("settings.failures")}: {entry.failed}</span>
                          <span>{t("settings.planned")}: {entry.planned}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {emailInboxQuery.data ? (
            <div className="flex flex-col gap-3 rounded-xl border p-4">
              <SourceHead
                icon={<Mail />}
                title={t("settings.emailInbox")}
                description={t("settings.emailInboxDescription")}
                status={
                  <>
                    <StatusBadge tone={emailInboxQuery.data.configured ? "ok" : "muted"}>
                      {emailInboxQuery.data.configured
                        ? t("settings.configured")
                        : t("settings.notConfigured")}
                    </StatusBadge>
                    {emailInboxQuery.data.configured ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => pollNowMutation.mutate()}
                        disabled={pollNowMutation.isPending}
                      >
                        {pollNowMutation.isPending ? <Spinner /> : <RefreshCw />}
                        {t("settings.pollNow")}
                      </Button>
                    ) : null}
                  </>
                }
              />
              {emailInboxQuery.data.mailbox ? (
                <p className="font-mono text-xs break-all text-muted-foreground">
                  {emailInboxQuery.data.mailbox.user}@{emailInboxQuery.data.mailbox.host} ·{" "}
                  {emailInboxQuery.data.mailbox.folder}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {t("settings.lastPoll")}:{" "}
                  <span className="num">
                    {typeof emailInboxQuery.data.lastPoll?.at === "string"
                      ? format(new Date(emailInboxQuery.data.lastPoll.at), "MMM d, yyyy HH:mm")
                      : t("settings.neverPolled")}
                  </span>
                </span>
                <span>
                  {t("settings.emailImported")}:{" "}
                  <span className="num">{emailInboxQuery.data.counts.imported}</span>
                </span>
                <span>
                  {t("settings.emailSkipped")}:{" "}
                  <span className="num">{emailInboxQuery.data.counts.skipped}</span>
                </span>
                <span>
                  {t("settings.emailRejected")}:{" "}
                  <span className="num">{emailInboxQuery.data.counts.rejected}</span>
                </span>
              </div>
              {emailInboxQuery.data.recentRejections.length > 0 ? (
                <div className="flex flex-col gap-1 rounded-lg bg-muted/50 px-3 py-2">
                  <p className="text-xs font-medium">{t("settings.recentRejections")}</p>
                  {emailInboxQuery.data.recentRejections.slice(0, 5).map((rejection) => (
                    <p
                      key={`${rejection.fromAddress}-${rejection.createdAt}`}
                      className="text-xs break-all text-muted-foreground"
                    >
                      {rejection.fromAddress || "?"} — {rejection.reason ?? rejection.status}
                      {rejection.subject ? ` (${rejection.subject})` : ""}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="flex flex-col gap-3">
          <SubHeading>{t("settings.snapshotSection")}</SubHeading>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="archive-snapshot">{t("settings.snapshotJson")}</Label>
            <Select
              value={importMode}
              onValueChange={(value: "replace" | "merge") => setImportMode(value)}
            >
              <SelectTrigger aria-label={t("settings.importMode")} className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="replace">{t("settings.replace")}</SelectItem>
                <SelectItem value="merge">{t("settings.importModeMerge")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Textarea
            id="archive-snapshot"
            value={snapshotText}
            onChange={(event) => setSnapshotText(event.target.value)}
            placeholder={t("settings.snapshotPlaceholder")}
            className="max-h-96 min-h-40 font-mono text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
              {exportMutation.isPending ? <Spinner /> : <Download />}
              {t("settings.exportSnapshot")}
            </Button>
            <Button
              variant="outline"
              onClick={() => importMutation.mutate()}
              disabled={importMutation.isPending || !snapshotText.trim()}
            >
              {importMutation.isPending ? <Spinner /> : <Upload />}
              {t("settings.importSnapshot")}
            </Button>
          </div>

          {exportMutation.isError && (
            <RetryAlert
              message={
                exportMutation.error instanceof Error
                  ? exportMutation.error.message
                  : t("settings.exportArchiveFailed")
              }
            />
          )}

          {importMutation.isError && (
            <RetryAlert
              message={
                importMutation.error instanceof Error
                  ? importMutation.error.message
                  : t("settings.importArchiveFailed")
              }
            />
          )}

          {lastImportResult && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {t("settings.lastImportResult")}
              </p>
              <pre className="overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">
                {lastImportResult}
              </pre>
            </div>
          )}
        </section>
      </div>
    </SectionCard>
  );
}
