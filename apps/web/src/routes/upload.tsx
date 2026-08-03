import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { File as FileIcon, Loader2, Upload as UploadIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, authFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/upload")({
  component: ImportPage,
});

const ACCEPTED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/heic",
];

const ACCEPTED_EXTENSIONS = ".pdf,.jpg,.jpeg,.png,.tiff,.tif,.heic";

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

/** The four-segment stage bar; the active stage carries the accent. */
function StageBar({ item }: { item: QueuedFile }) {
  const { t } = useI18n();
  const labels: Record<"upload" | "ocr" | "extract" | "embed", string> = {
    upload: t("import.stageUpload"),
    ocr: t("import.stageOcr"),
    extract: t("import.stageExtract"),
    embed: t("import.stageEmbed"),
  };

  if (item.stage === "duplicate") {
    return (
      <div className="w-44">
        <div className="h-[3px] rounded-[var(--r-pill)] bg-[var(--ok-amber)]" />
        <p className="mt-1 text-xs text-muted-foreground">
          {t("import.alreadyInArchive")}
        </p>
      </div>
    );
  }
  if (item.stage === "failed") {
    return (
      <div className="w-44">
        <div className="h-[3px] rounded-[var(--r-pill)] bg-[var(--ok-red)]" />
        <p className="mt-1 truncate text-xs text-[var(--ok-red)]" title={item.errorMessage}>
          {item.errorMessage ?? t("import.failed")}
        </p>
      </div>
    );
  }
  if (item.stage === "done") {
    return (
      <div className="w-44">
        <div className="h-[3px] rounded-[var(--r-pill)] bg-[var(--ok-green)]" />
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {item.typeName
            ? `${t("import.filedAs")} ${item.typeName}`
            : t("import.done")}
        </p>
      </div>
    );
  }

  const activeIndex = STAGE_ORDER.indexOf(item.stage);
  return (
    <div className="w-44">
      <div className="flex gap-0.5">
        {STAGE_ORDER.map((stage, index) => (
          <span
            key={stage}
            className={cn(
              "h-[3px] flex-1 rounded-[var(--r-pill)]",
              index < activeIndex
                ? "bg-[var(--ok-accent)]/45"
                : index === activeIndex
                  ? "bg-[var(--ok-accent)]"
                  : "bg-[var(--ok-border)]",
            )}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{labels[item.stage]}</p>
    </div>
  );
}

function ImportPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  // Bumped by "Cancel all". Workers compare the generation they started in
  // against this before taking the next file, so clearing the list actually
  // stops the uploads instead of only hiding their rows.
  const generationRef = useRef(0);

  // Dry-run scan: read-only plan, used for the watch-folder status line.
  // There is no side-effect-free way to read watch-folder status: the only
  // endpoint is the scan itself, and even a dry run walks the folder and
  // writes an `archive.watch_folder_scanned` audit entry. So run it at most
  // once per mount, never on refocus, and ignore dry runs when reporting
  // what the watch folder has actually imported. Tracked in #91.
  const watchQuery = useQuery({
    queryKey: ["archive", "watch-folder", "status"],
    queryFn: async () => {
      const { data, error } = await api.POST("/api/archive/watch-folder/scan", {
        body: { dryRun: true },
      });
      if (error) throw new Error("watch");
      return data as unknown as {
        configuredPath: string;
        history?: Array<{ scannedAt: string; imported: number; dryRun: boolean }>;
      };
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
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
        // Note: re-uploading content already in the archive does NOT 409.
        // The API deduplicates the stored file by checksum but deliberately
        // creates a second document, so a duplicate arrives as a normal 201.
        // A 409 here is a real storage conflict and belongs in the failed
        // branch below. Surfacing duplicates needs an API signal — see #92.
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
        const created = (await response.json()) as { id: string };
        patch(item.id, { stage: "ocr", documentId: created.id });
      } catch (err) {
        patch(item.id, {
          stage: "failed",
          errorMessage: err instanceof Error ? err.message : "Upload failed",
        });
      }
    },
    [patch],
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

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const accepted = Array.from(files).filter(
        (file) =>
          ACCEPTED_TYPES.includes(file.type) ||
          file.name.toLowerCase().endsWith(".heic"),
      );
      const items: QueuedFile[] = accepted.map((file) => ({
        id: crypto.randomUUID(),
        file,
        stage: "upload",
        documentId: null,
        typeName: null,
        needsReview: false,
        pageCount: null,
      }));
      if (items.length === 0) return;
      setQueue((current) => [...current, ...items]);
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

  // history[0] is the dry run this page just triggered, which says nothing
  // about the watch folder — report the last real scan.
  const lastScan = (watchQuery.data?.history ?? []).find((entry) => !entry.dryRun);
  const pickedUpToday = (watchQuery.data?.history ?? [])
    .filter(
      (entry) =>
        !entry.dryRun &&
        new Date(entry.scannedAt).toDateString() === new Date().toDateString(),
    )
    .reduce((sum, entry) => sum + entry.imported, 0);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="ok-page-title">{t("import.title")}</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">{t("import.subtitle")}</p>

      {/* Drop zone */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
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
          "mt-4 flex h-40 w-full flex-col items-center justify-center gap-1.5 rounded-[var(--r-lg)] border border-dashed transition-colors",
          isDragging
            ? "border-[var(--ok-accent)] bg-accent"
            : "border-[var(--ok-border-strong)] bg-[var(--ok-bar)] hover:border-[var(--ok-accent)]/50",
        )}
      >
        <UploadIcon className="h-5 w-5 text-[var(--ok-accent)]" />
        <p className="text-sm font-semibold">
          {t("import.dropHere")}{" "}
          <span className="text-[var(--ok-accent)]">{t("import.browse")}</span>
        </p>
        {watchQuery.data?.configuredPath ? (
          <p className="text-xs text-muted-foreground">
            {t("import.watchNote")}{" "}
            <span className="ok-num">{watchQuery.data.configuredPath}</span>{" "}
            {t("import.watchNoteTail")}
            {lastScan ? (
              <>
                {" · "}
                {t("import.lastScan")}{" "}
                <span className="ok-num">
                  {new Date(lastScan.scannedAt).toLocaleTimeString("de-DE", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </>
            ) : null}
            {pickedUpToday > 0 ? (
              <>
                {" · "}
                <span className="ok-num">{pickedUpToday}</span>{" "}
                {t("import.pickedUpToday")}
              </>
            ) : null}
          </p>
        ) : null}
      </button>
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

      {/* Queue */}
      {queue.length > 0 ? (
        <>
          <div className="mt-4 overflow-hidden rounded-[var(--r-lg)] border">
            <div className="flex items-center gap-2 border-b bg-[var(--ok-bar)] px-3 py-2">
              <span className="ok-eyebrow">{t("import.queue")}</span>
              <span className="ok-num text-xs text-muted-foreground">
                {queue.length}
              </span>
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
                <button
                  type="button"
                  onClick={() =>
                    setQueue((current) =>
                      current.filter((item) => !isFinished(item.stage) || item.stage === "failed"),
                    )
                  }
                  className="ml-auto text-xs font-semibold text-foreground hover:underline"
                >
                  {t("import.clearFinished")}
                </button>
              ) : null}
            </div>

            {queue.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-4 border-b border-[var(--ok-border-soft)] px-3 py-2.5 last:border-b-0"
              >
                <FileIcon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  {item.documentId && item.stage === "done" ? (
                    <Link
                      to="/documents/$documentId"
                      params={{ documentId: item.documentId }}
                      className="block truncate text-sm text-foreground hover:underline"
                    >
                      {item.file.name}
                    </Link>
                  ) : (
                    <p className="truncate text-sm text-foreground">{item.file.name}</p>
                  )}
                  <p className="ok-num text-xs text-muted-foreground">
                    {formatFileSize(item.file.size)}
                  </p>
                </div>
                {item.pageCount != null ? (
                  <span className="ok-num hidden flex-shrink-0 text-sm text-muted-foreground sm:block">
                    {item.pageCount}{" "}
                    {item.pageCount === 1 ? t("import.page") : t("import.pages")}
                  </span>
                ) : null}
                <StageBar item={item} />
                <div className="w-24 flex-shrink-0 text-right">
                  {item.stage === "failed" ? (
                    <Button variant="outline" size="sm" onClick={() => void retry(item)}>
                      {t("import.retry")}
                    </Button>
                  ) : item.stage === "done" && item.needsReview ? (
                    <Link to="/review">
                      <Badge variant="warn">{t("import.review")}</Badge>
                    </Link>
                  ) : item.stage === "done" ? (
                    <Badge variant="soft">{t("import.done")}</Badge>
                  ) : item.stage === "duplicate" ? (
                    <Badge variant="warn">{t("import.duplicate")}</Badge>
                  ) : (
                    <Badge variant="secondary">
                      <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" />
                      {t("import.processing")}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-end gap-2">
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
      ) : null}
    </div>
  );
}
