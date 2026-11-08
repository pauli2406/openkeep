import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CircleCheckBig,
  CloudOff,
  Copy,
  File as FileIcon,
  FileText,
  FolderSync,
  ScanText,
  Search,
  Sparkles,
  Upload as UploadIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  IMPORT_MAX_BYTES,
  importExtensions,
  importMimeTypes,
} from "@openkeep/types";
import { IconTile, Page, PageHeader } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { api, authFetch } from "@/lib/api";
import {
  useHostImports,
  type HostImportDelivery,
} from "@/lib/host-imports";
import { useOfflineReadOnly } from "@/lib/host-shell";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/upload")({
  component: ImportPage,
});

const ACCEPTED_EXTENSIONS = importExtensions.join(",");
const ACCEPTED_EXTENSION_SET = new Set<string>(importExtensions);
const ACCEPTED_TYPE_SET = new Set<string>(importMimeTypes);

/** Upload → OCR → Extract → Embed, plus the terminal states. */
type Stage = "upload" | "ocr" | "extract" | "embed" | "done" | "duplicate" | "failed";

interface QueuedFile {
  id: string;
  file: File;
  stage: Stage;
  documentId: string | null;
  /** set once the document is ready */
  typeName: string | null;
  needsReview: boolean;
  pageCount: number | null;
  /** set when the same content was already in the archive (#92) */
  duplicateOfId?: string;
  errorMessage?: string;
}

const STAGE_ORDER: Stage[] = ["upload", "ocr", "extract", "embed"];

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function isFinished(stage: Stage): boolean {
  return stage === "done" || stage === "duplicate" || stage === "failed";
}

/** How far along a file is, or what became of it. */
function RowStatus({ item }: { item: QueuedFile }) {
  const { t } = useI18n();
  const labels: Record<"upload" | "ocr" | "extract" | "embed", string> = {
    upload: t("import.stageUpload"),
    ocr: t("import.stageOcr"),
    extract: t("import.stageExtract"),
    embed: t("import.stageEmbed"),
  };

  if (item.stage === "duplicate") {
    return (
      <p className="mt-1 text-xs text-warning">
        {t("import.alreadyInArchive")}
        {item.duplicateOfId ? (
          <>
            {" · "}
            <Link
              to="/documents/$documentId"
              params={{ documentId: item.duplicateOfId }}
              className="font-medium underline underline-offset-2"
            >
              {t("import.openOriginal")}
            </Link>
          </>
        ) : null}
      </p>
    );
  }
  if (item.stage === "failed") {
    return (
      <p className="mt-1 text-xs break-words text-danger">
        {item.errorMessage ?? t("import.failed")}
      </p>
    );
  }
  if (item.stage === "done") {
    return item.typeName ? (
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {`${t("import.filedAs")} ${item.typeName}`}
      </p>
    ) : null;
  }

  const stepIndex = STAGE_ORDER.indexOf(item.stage);
  return (
    <div className="mt-2 flex items-center gap-2.5">
      <Progress
        value={((stepIndex + 0.5) / STAGE_ORDER.length) * 100}
        aria-label={labels[item.stage]}
        className="h-1.5 flex-1"
      />
      <span className="w-14 shrink-0 text-right text-xs text-muted-foreground">
        {labels[item.stage]}
      </span>
    </div>
  );
}

/** The tile at the head of a row carries the row's outcome at a glance. */
function RowIcon({ stage }: { stage: Stage }) {
  if (stage === "done") {
    return (
      <IconTile className="bg-success-soft text-success">
        <CircleCheckBig />
      </IconTile>
    );
  }
  if (stage === "failed") {
    return (
      <IconTile className="bg-danger-soft text-danger">
        <AlertTriangle />
      </IconTile>
    );
  }
  if (stage === "duplicate") {
    return (
      <IconTile className="bg-warning-soft text-warning">
        <Copy />
      </IconTile>
    );
  }
  return (
    <IconTile>
      <FileIcon />
    </IconTile>
  );
}

function PipelineStep({
  icon: Icon,
  title,
  hint,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
}) {
  return (
    <li className="flex min-w-0 items-start gap-3 sm:flex-col sm:gap-2.5">
      <IconTile size="sm">
        <Icon />
      </IconTile>
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
    </li>
  );
}

function ImportPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hostImports = useHostImports();
  const offlineReadOnly = useOfflineReadOnly();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  // Bumped by "Cancel all". Workers compare the generation they started in
  // against this before taking the next file, so clearing the list actually
  // stops the uploads instead of only hiding their rows.
  const generationRef = useRef(0);

  // Read-only status (#91). This used to run a dry-run scan, which walked the
  // folder and wrote an audit entry on every page load, then reported its own
  // dry run as the last scan. The dedicated endpoint has no side effects, so
  // it can simply be polled.
  const watchQuery = useQuery({
    queryKey: ["archive", "watch-folder", "status"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/archive/watch-folder");
      if (error) throw new Error("watch");
      return data as unknown as {
        configured: boolean;
        configuredPath: string | null;
        lastImport: { scannedAt: string; imported: number } | null;
        history: Array<{ scannedAt: string; imported: number; dryRun: boolean }>;
      };
    },
    staleTime: 60_000,
    retry: false,
  });

  const patch = useCallback((id: string, changes: Partial<QueuedFile>) => {
    setQueue((current) =>
      current.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    );
  }, []);

  const uploadOne = useCallback(
    async (item: QueuedFile) => {
      patch(item.id, { stage: "upload", errorMessage: undefined });
      try {
        const formData = new FormData();
        formData.append("file", item.file);
        const response = await authFetch("/api/documents", {
          method: "POST",
          body: formData,
        });
        // A 409 is a real storage conflict, not a duplicate: re-uploading
        // existing content returns 201 with `duplicateOf` set (#92).
        if (!response.ok) {
          const body = await response.text();
          let message = `Upload failed (${response.status})`;
          try {
            const parsed = JSON.parse(body);
            if (parsed.message) {
              message =
                typeof parsed.message === "string"
                  ? parsed.message
                  : parsed.message.join(", ");
            }
          } catch {
            if (body) message = body;
          }
          throw new Error(message);
        }
        const created = (await response.json()) as {
          id: string;
          duplicateOf: { id: string; title: string } | null;
        };
        // Tell a desktop host about the document so it can report the outcome
        // even after this route is gone.
        hostImports?.reportCreated?.([{ documentId: created.id, name: item.file.name }]);
        if (created.duplicateOf) {
          // Same bytes are already filed. The document was still created —
          // that is deliberate server-side — but say so rather than letting it
          // look like a fresh import.
          patch(item.id, {
            stage: "duplicate",
            documentId: created.id,
            duplicateOfId: created.duplicateOf.id,
          });
          return;
        }
        patch(item.id, { stage: "ocr", documentId: created.id });
      } catch (err) {
        patch(item.id, {
          stage: "failed",
          errorMessage: err instanceof Error ? err.message : "Upload failed",
        });
      }
    },
    [patch, hostImports],
  );

  /**
   * Retry after a failure. Once the document exists, the failure was in
   * processing, not transfer — re-POSTing the binary would leave the failed
   * document in the archive and add a second one beside it, because the
   * upload API deliberately creates a new document even when the file record
   * is deduplicated by checksum. Reprocess that document instead.
   */
  const retry = useCallback(
    async (item: QueuedFile) => {
      if (!item.documentId) {
        await uploadOne(item);
        return;
      }
      patch(item.id, { stage: "ocr", errorMessage: undefined });
      try {
        const response = await authFetch(
          `/api/documents/${item.documentId}/reprocess`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
        );
        if (!response.ok) throw new Error(await response.text());
      } catch (err) {
        patch(item.id, {
          stage: "failed",
          errorMessage: err instanceof Error ? err.message : t("import.failed"),
        });
      }
    },
    [patch, uploadOne, t],
  );

  const enqueueFiles = useCallback(
    (
      accepted: File[],
      rejected: Array<{ id: string; name: string; message: string }> = [],
    ) => {
      const items: QueuedFile[] = accepted.map((file) => ({
        id: crypto.randomUUID(),
        file,
        stage: "upload",
        documentId: null,
        typeName: null,
        needsReview: false,
        pageCount: null,
      }));
      const rejectedItems: QueuedFile[] = rejected.map((entry) => ({
        id: entry.id,
        file: new File([], entry.name),
        stage: "failed",
        documentId: null,
        typeName: null,
        needsReview: false,
        pageCount: null,
        errorMessage: entry.message,
      }));
      if (items.length === 0 && rejectedItems.length === 0) return;
      setQueue((current) => [...current, ...items, ...rejectedItems]);
      // Bounded concurrency: three uploads in flight.
      const work = [...items];
      const generation = generationRef.current;
      void Promise.all(
        Array.from({ length: Math.min(3, work.length) }, async () => {
          for (let item = work.shift(); item; item = work.shift()) {
            if (generationRef.current !== generation) return;
            await uploadOne(item);
          }
        }),
      ).then(() => {
        queryClient.invalidateQueries({ queryKey: ["documents"] });
      });
    },
    [uploadOne, queryClient],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const accepted: File[] = [];
      const rejected: Array<{ id: string; name: string; message: string }> = [];
      for (const file of Array.from(files)) {
        const extension = `.${file.name.toLowerCase().split(".").at(-1) ?? ""}`;
        if (!ACCEPTED_TYPE_SET.has(file.type) && !ACCEPTED_EXTENSION_SET.has(extension)) {
          rejected.push({
            id: crypto.randomUUID(),
            name: file.name,
            message: t("import.unsupportedFormat"),
          });
        } else if (file.size > IMPORT_MAX_BYTES) {
          rejected.push({
            id: crypto.randomUUID(),
            name: file.name,
            message: t("import.oversized"),
          });
        } else {
          accepted.push(file);
        }
      }
      enqueueFiles(accepted, rejected);
    },
    [enqueueFiles, t],
  );

  const addHostDelivery = useCallback(
    (delivery: HostImportDelivery) => {
      const files = delivery.files.map((entry) => {
        const bytes =
          entry.bytes instanceof Uint8Array
            ? entry.bytes
            : new Uint8Array(entry.bytes);
        const ownedBytes = Uint8Array.from(bytes);
        return new File([ownedBytes.buffer], entry.name, {
          type: entry.mimeType,
          lastModified: Date.now(),
        });
      });
      enqueueFiles(files, delivery.rejected);
    },
    [enqueueFiles],
  );

  useEffect(() => {
    if (!hostImports) return;
    const takePending = () => addHostDelivery(hostImports.takePending());
    takePending();
    return hostImports.subscribe(takePending);
  }, [addHostDelivery, hostImports]);

  // Poll in-flight documents so each row progresses independently.
  useEffect(() => {
    const interval = setInterval(async () => {
      const inFlight = queueRef.current.filter(
        (item) => item.documentId && !isFinished(item.stage),
      );
      if (inFlight.length === 0) return;
      await Promise.all(
        inFlight.map(async (item) => {
          try {
            const response = await authFetch(`/api/documents/${item.documentId}`);
            if (!response.ok) return;
            const doc = (await response.json()) as {
              status: string;
              embeddingStatus: string;
              reviewStatus: string;
              documentType: { name: string } | null;
              metadata?: { pageCount?: number };
              lastProcessingError: string | null;
            };
            if (doc.status === "failed") {
              patch(item.id, {
                stage: "failed",
                errorMessage: doc.lastProcessingError ?? t("import.failed"),
              });
            } else if (doc.status === "ready") {
              // The API's embedding vocabulary is not_configured | queued |
              // indexing | ready | stale | failed. Checking for "pending" or
              // "processing" matched nothing, so the row jumped to done and
              // stopped polling before the Embed stage was ever shown.
              const embedding =
                doc.embeddingStatus === "queued" || doc.embeddingStatus === "indexing";
              const embeddingFailed = doc.embeddingStatus === "failed";
              patch(item.id, {
                stage: embeddingFailed ? "failed" : embedding ? "embed" : "done",
                errorMessage: embeddingFailed ? t("import.embeddingFailed") : undefined,
                typeName: doc.documentType?.name ?? null,
                needsReview: doc.reviewStatus === "pending",
                pageCount: doc.metadata?.pageCount ?? null,
              });
            } else if (doc.status === "processing") {
              patch(item.id, { stage: "extract" });
            }
          } catch {
            // transient poll failure — keep the current stage
          }
        }),
      );
    }, 2000);
    return () => clearInterval(interval);
  }, [patch, t]);

  const counts = {
    processing: queue.filter((item) => !isFinished(item.stage)).length,
    done: queue.filter((item) => item.stage === "done").length,
    duplicate: queue.filter((item) => item.stage === "duplicate").length,
    failed: queue.filter((item) => item.stage === "failed").length,
  };

  // The API already excludes dry runs from lastImport.
  const lastScan = watchQuery.data?.lastImport ?? null;
  const pickedUpToday = (watchQuery.data?.history ?? [])
    .filter(
      (entry) =>
        !entry.dryRun &&
        new Date(entry.scannedAt).toDateString() === new Date().toDateString(),
    )
    .reduce((sum, entry) => sum + entry.imported, 0);

  return (
    <Page width="narrow">
      <PageHeader
        icon={<UploadIcon />}
        title={t("import.title")}
        description={t("import.subtitle")}
      />

      {/* Drop zone — replaced by a notice while the archive is an offline copy */}
      {offlineReadOnly ? (
        <div
          role="status"
          className="flex min-h-64 w-full flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed bg-muted/50 p-8 text-center"
        >
          <IconTile size="lg">
            <CloudOff />
          </IconTile>
          <p className="max-w-md text-sm text-muted-foreground">
            {t("offline.uploadDisabled")}
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            if (hostImports) {
              void hostImports.pickFiles().then(addHostDelivery);
            } else {
              fileInputRef.current?.click();
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setIsDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            if (event.dataTransfer.files.length > 0) addFiles(event.dataTransfer.files);
          }}
          className={cn(
            // Children ignore the pointer, or crossing them fires dragleave and the zone flickers.
            "group flex min-h-64 w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-8 text-center transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-72 [&>*]:pointer-events-none",
            isDragging
              ? "border-primary bg-brand-soft shadow-raised"
              : "border-brand/25 bg-gradient-wash hover:border-brand/60 hover:shadow-card",
          )}
        >
          <IconTile
            tone="solid"
            className={cn(
              "size-14 rounded-2xl transition-transform [&_svg]:size-7",
              isDragging ? "scale-110" : "group-hover:-translate-y-0.5",
            )}
          >
            <UploadIcon />
          </IconTile>
          <span className="flex flex-col gap-1">
            <span className="text-lg font-medium tracking-tight">
              {t("import.dropHere")}{" "}
              <span className="text-brand underline-offset-4 group-hover:underline">
                {t("import.browse")}
              </span>
            </span>
            <span className="text-sm text-muted-foreground">{t("import.dropHint")}</span>
          </span>
        </button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_EXTENSIONS}
        onChange={(event) => {
          if (event.target.files?.length) {
            addFiles(event.target.files);
            event.target.value = "";
          }
        }}
        className="hidden"
      />

      {watchQuery.data?.configuredPath ? (
        <Card size="sm" className="flex-row items-center gap-3 px-4 shadow-card">
          <IconTile>
            <FolderSync />
          </IconTile>
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              {t("import.watchNote")}{" "}
              <span className="font-mono text-xs break-all">
                {watchQuery.data.configuredPath}
              </span>{" "}
              {t("import.watchNoteTail")}
            </p>
            {lastScan || pickedUpToday > 0 ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {lastScan ? (
                  <>
                    {t("import.lastScan")}{" "}
                    <span className="num">
                      {new Date(lastScan.scannedAt).toLocaleTimeString("de-DE", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </>
                ) : null}
                {lastScan && pickedUpToday > 0 ? " · " : null}
                {pickedUpToday > 0 ? (
                  <>
                    <span className="num">{pickedUpToday}</span> {t("import.pickedUpToday")}
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* Queue */}
      {queue.length > 0 ? (
        <>
          <Card className="gap-0 py-0 shadow-card">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-3">
              <h2 className="font-medium">{t("import.queue")}</h2>
              <Badge variant="secondary" className="num">
                {queue.length}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {[
                  counts.processing
                    ? `${counts.processing} ${t("import.processing").toLowerCase()}`
                    : null,
                  counts.done ? `${counts.done} ${t("import.done").toLowerCase()}` : null,
                  counts.duplicate
                    ? `${counts.duplicate} ${t("import.duplicate").toLowerCase()}`
                    : null,
                  counts.failed
                    ? `${counts.failed} ${t("import.failed").toLowerCase()}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {counts.done + counts.duplicate > 0 ? (
                <Button
                  variant="ghost"
                  size="xs"
                  className="ml-auto"
                  onClick={() =>
                    setQueue((current) =>
                      current.filter((item) => !isFinished(item.stage) || item.stage === "failed"),
                    )
                  }
                >
                  {t("import.clearFinished")}
                </Button>
              ) : null}
            </div>

            <ul className="divide-y">
              {queue.map((item) => (
                <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                  <RowIcon stage={item.stage} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        {item.documentId &&
                        (item.stage === "done" || item.stage === "duplicate") ? (
                          <Link
                            to="/documents/$documentId"
                            params={{ documentId: item.documentId }}
                            className="block truncate text-sm font-medium hover:underline"
                          >
                            {item.file.name}
                          </Link>
                        ) : (
                          <p className="truncate text-sm font-medium">{item.file.name}</p>
                        )}
                        <p className="num text-xs text-muted-foreground">
                          {formatFileSize(item.file.size)}
                          {item.pageCount != null ? (
                            <>
                              {" · "}
                              {item.pageCount}{" "}
                              {item.pageCount === 1 ? t("import.page") : t("import.pages")}
                            </>
                          ) : null}
                        </p>
                      </div>
                      <div className="shrink-0">
                        {item.stage === "failed" ? (
                          <Button variant="outline" size="sm" onClick={() => void retry(item)}>
                            {t("import.retry")}
                          </Button>
                        ) : item.stage === "done" && item.needsReview ? (
                          <Badge variant="warning" asChild>
                            <Link to="/review">{t("import.review")}</Link>
                          </Badge>
                        ) : item.stage === "done" ? (
                          <Badge variant="success">{t("import.done")}</Badge>
                        ) : item.stage === "duplicate" ? (
                          <Badge variant="warning">{t("import.duplicate")}</Badge>
                        ) : (
                          <Badge variant="secondary">
                            <Spinner aria-hidden="true" />
                            {t("import.processing")}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <RowStatus item={item} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                generationRef.current += 1;
                setQueue([]);
              }}
            >
              {t("import.cancelAll")}
            </Button>
            <Button onClick={() => navigate({ to: "/documents" })}>
              {t("import.done")}
            </Button>
          </div>
        </>
      ) : offlineReadOnly ? null : (
        <section aria-label={t("import.stepsTitle")}>
          <ol className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <PipelineStep
              icon={FileText}
              title={t("import.stageUpload")}
              hint={t("import.stepUploadHint")}
            />
            <PipelineStep
              icon={ScanText}
              title={t("import.stageOcr")}
              hint={t("import.stepOcrHint")}
            />
            <PipelineStep
              icon={Sparkles}
              title={t("import.stageExtract")}
              hint={t("import.stepExtractHint")}
            />
            <PipelineStep
              icon={Search}
              title={t("import.stageEmbed")}
              hint={t("import.stepEmbedHint")}
            />
          </ol>
        </section>
      )}
    </Page>
  );
}
