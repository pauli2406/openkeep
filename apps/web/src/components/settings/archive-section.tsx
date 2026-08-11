import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueries, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  WatchFolderStatusResponse,
} from "@openkeep/types";
import { api, getApiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  Loader2,
  RefreshCw,
  Download,
  Upload,
  } from "lucide-react";
import { format } from "date-fns";
import { useI18n } from "@/lib/i18n";
import { useHostFileSaver } from "@/lib/host-shell";
import { QueueCard, WatchFolderFieldReview, formatWatchFolderAction, formatWatchFolderReason, watchFolderActionVariant } from "./shared";

export function ArchiveOperationsSection() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const hostFileSaver = useHostFileSaver();
  const [snapshotText, setSnapshotText] = useState("");
  const [importMode, setImportMode] = useState<"replace" | "merge">("replace");
  const [watchDryRun, setWatchDryRun] = useState(true);
  const [lastImportResult, setLastImportResult] = useState<string | null>(null);
  const [watchResult, setWatchResult] = useState<WatchFolderScanResponse | null>(null);

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
    <Card>
      <CardHeader>
          <CardTitle className="text-lg">{t("settings.archivePortability")}</CardTitle>
          <CardDescription>
            {t("settings.archivePortabilityDescription")}
          </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {watchStatusQuery.data ? (
          <div className="rounded-md border bg-muted/20 px-3 py-2.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  {t("settings.watchFolderServer")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("settings.watchFolderServerDescription")}
                </p>
              </div>
              <Badge
                variant={watchStatusQuery.data.configured ? "success" : "secondary"}
              >
                {watchStatusQuery.data.configured
                  ? t("settings.configured")
                  : t("settings.notConfigured")}
              </Badge>
            </div>
            {watchStatusQuery.data.configuredPath ? (
              <p className="ok-num mt-2 break-all text-xs text-muted-foreground">
                {t("settings.path")}: {watchStatusQuery.data.configuredPath}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <span>
                {t("settings.lastScan")}: {watchStatusQuery.data.lastScan
                  ? format(new Date(watchStatusQuery.data.lastScan.scannedAt), "MMM d, yyyy HH:mm")
                  : t("settings.neverScanned")}
              </span>
              <span>
                {t("settings.lastImport")}: {watchStatusQuery.data.lastImport
                  ? format(new Date(watchStatusQuery.data.lastImport.scannedAt), "MMM d, yyyy HH:mm")
                  : t("settings.neverScanned")}
              </span>
            </div>
          </div>
        ) : null}

        {watchStatusQuery.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {watchStatusQuery.error instanceof Error
              ? watchStatusQuery.error.message
              : t("settings.watchFolderStatusFailed")}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
            {exportMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {t("settings.exportSnapshot")}
          </Button>
          <Button
            variant={watchDryRun ? "outline" : "secondary"}
            onClick={() => setWatchDryRun((value) => !value)}
          >
            {watchDryRun ? t("settings.dryRunEnabled") : t("settings.dryRunDisabled")}
          </Button>
          <Button
            variant="outline"
            onClick={() => watchMutation.mutate()}
            disabled={watchMutation.isPending}
          >
            {watchMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t("settings.scanWatchFolder")}
          </Button>
        </div>

        {exportMutation.isError && (
          <p className="text-sm text-destructive">
            {exportMutation.error instanceof Error
              ? exportMutation.error.message
              : t("settings.exportArchiveFailed")}
          </p>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="archive-snapshot">{t("settings.snapshotJson")}</Label>
            <Select
              value={importMode}
              onValueChange={(value: "replace" | "merge") => setImportMode(value)}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="replace">{t("settings.replace")}</SelectItem>
                <SelectItem value="merge">{t("settings.merge")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <textarea
            id="archive-snapshot"
            value={snapshotText}
            onChange={(event) => setSnapshotText(event.target.value)}
            placeholder={t("settings.snapshotPlaceholder")}
            className="min-h-56 w-full rounded-md border bg-background px-3 py-2 text-sm font-mono outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => importMutation.mutate()}
              disabled={importMutation.isPending || !snapshotText.trim()}
            >
              {importMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {t("settings.importSnapshot")}
            </Button>
          </div>
          {importMutation.isError && (
            <p className="text-sm text-destructive">
              {importMutation.error instanceof Error
                ? importMutation.error.message
                : t("settings.importArchiveFailed")}
            </p>
          )}
        </div>

        {lastImportResult && (
          <div className="space-y-2">
            <Label>{t("settings.lastImportResult")}</Label>
            <pre className="overflow-auto rounded-md border bg-muted/50 p-3 text-xs font-mono">
              {lastImportResult}
            </pre>
          </div>
        )}

        {watchResult && (
          <div className="space-y-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">{t("settings.watchFolderScan")}</p>
              <p className="text-xs text-muted-foreground">
                {t("settings.path")}: {watchResult.configuredPath}
               </p>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
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
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t("settings.currentScanResults")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {watchResult.items.length} {t(watchResult.items.length === 1 ? "settings.itemOne" : "settings.itemOther")}
                  </p>
                </div>
                <div className="space-y-2">
                  {watchResult.items.map((item) => (
                    <div
                      key={`${item.path}:${item.action}:${item.reason}`}
                      className="rounded-md border bg-background/60 p-3"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={watchFolderActionVariant(item.action)}>
                              {formatWatchFolderAction(item.action)}
                            </Badge>
                            <span className="break-all text-sm font-medium">{item.path}</span>
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span>{t("settings.reason")}: {formatWatchFolderReason(item.reason)}</span>
                            {item.mimeType && <span>MIME: {item.mimeType}</span>}
                            {item.destinationPath && (
                              <span>{t("settings.destination")}: {item.destinationPath}</span>
                            )}
                          </div>
                          {item.detail && (
                            <p className="text-xs text-muted-foreground">{item.detail}</p>
                          )}
                        </div>
                        {item.documentId && (
                          <div className="flex flex-col items-stretch gap-2 sm:items-end">
                            <Button asChild size="sm" variant="outline">
                              <Link
                                to="/documents/$documentId"
                                params={{ documentId: item.documentId }}
                              >
                                {t("settings.openDocument")}
                              </Link>
                            </Button>
                          </div>
                        )}
                      </div>
                      {item.documentId && (
                        <details className="mt-3 rounded-md border bg-muted/20 px-3 py-2">
                          <summary className="cursor-pointer text-sm font-medium text-foreground">
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
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("settings.currentScanIssues")}
                </p>
                <div className="space-y-2">
                  {watchProblemItems.map((item) => (
                    <div
                      key={`${item.path}:${item.reason}`}
                      className="rounded-md border bg-muted/30 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            item.action === "failed" || item.action === "unsupported"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {item.action}
                        </Badge>
                        <span className="text-sm font-medium">{item.path}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>{t("settings.reason")}: {formatWatchFolderReason(item.reason)}</span>
                        {item.failureCode && (
                          <span>{t("settings.code")}: {item.failureCode}</span>
                        )}
                        {item.mimeType && <span>MIME: {item.mimeType}</span>}
                        {item.destinationPath && (
                          <span>{t("settings.destination")}: {item.destinationPath}</span>
                        )}
                      </div>
                      {item.detail && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {item.detail}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {watchResult.history.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("settings.recentScans")}
                </p>
                <div className="space-y-2">
                  {watchResult.history.map((entry) => (
                    <div
                      key={entry.scannedAt}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          <span className="ok-num">{format(new Date(entry.scannedAt), "MMM d, yyyy HH:mm")}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {entry.dryRun ? t("settings.dryRunEnabled") : t("settings.liveScan")}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>I: {entry.imported}</span>
                        <span>D: {entry.duplicate}</span>
                        <span>U: {entry.unsupported}</span>
                        <span>F: {entry.failed}</span>
                        <span>P: {entry.planned}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {watchMutation.isError && (
          <p className="text-sm text-destructive">
            {watchMutation.error instanceof Error
              ? watchMutation.error.message
              : t("settings.failedToScanWatchFolder")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// --- Processing Activity & Queue Status ---
