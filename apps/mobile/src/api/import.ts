/**
 * The import queue, without a screen: what may be uploaded, what an upload's
 * response means, how a document's status reads as a stage. The screen holds the
 * list and the timers; everything that can be wrong about an upload is here.
 */
import { responseToMessage } from "../lib";

export type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>;

/** The same table as `importFormats` in `@openkeep/types`, which mobile does not depend on. */
const IMPORT_FORMATS = [
  { mimeType: "application/pdf", extensions: [".pdf"] },
  { mimeType: "image/jpeg", extensions: [".jpg", ".jpeg"] },
  { mimeType: "image/png", extensions: [".png"] },
  { mimeType: "image/tiff", extensions: [".tif", ".tiff"] },
  { mimeType: "image/heic", extensions: [".heic"] },
] as const;

export const IMPORT_MIME_TYPES: string[] = IMPORT_FORMATS.map((format) => format.mimeType);

/** The upload limit clients enforce before transferring anything. 64 MiB. */
export const IMPORT_MAX_BYTES = 67_108_864;

/** Three uploads in flight, as on the web. */
export const IMPORT_CONCURRENCY = 3;

export const IMPORT_POLL_INTERVAL_MS = 2_000;

export type PickedFile = {
  uri: string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
};

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

/** Either the type or the extension will do: a cloud provider often omits the type. */
export function classifyFile(file: PickedFile): "ok" | "unsupported" | "oversized" {
  const extension = extensionOf(file.name);
  const known = IMPORT_FORMATS.some(
    (format) =>
      format.mimeType === file.mimeType ||
      (format.extensions as readonly string[]).includes(extension),
  );
  if (!known) {
    return "unsupported";
  }
  return (file.size ?? 0) > IMPORT_MAX_BYTES ? "oversized" : "ok";
}

/** What to declare in the multipart part when the picker did not say. */
export function mimeTypeFor(file: PickedFile) {
  if (file.mimeType) {
    return file.mimeType;
  }
  const extension = extensionOf(file.name);
  return (
    IMPORT_FORMATS.find((format) => (format.extensions as readonly string[]).includes(extension))
      ?.mimeType ?? "application/octet-stream"
  );
}

export function formatFileSize(bytes: number) {
  if (bytes === 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 0 ? 1 : 0)} ${units[index]}`;
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

/** Upload → OCR → Extract → Embed, plus the terminal states. */
export type ImportStage = "upload" | "ocr" | "extract" | "embed" | "done" | "duplicate" | "failed";

const STAGE_ORDER: ImportStage[] = ["upload", "ocr", "extract", "embed"];

export type ImportSource =
  | { kind: "file"; file: PickedFile }
  /** Scanned or picked images, which become one PDF when their turn comes. */
  | { kind: "pages"; uris: string[] };

export type ImportItem = {
  id: string;
  name: string;
  size: number | null;
  /** `null` for a file rejected up front: there is nothing to send again. */
  source: ImportSource | null;
  title: string | null;
  stage: ImportStage;
  documentId: string | null;
  typeName: string | null;
  needsReview: boolean;
  pageCount: number | null;
  /** Set when the same content was already in the archive. */
  duplicateOfId?: string;
  errorMessage?: string;
};

export type ImportPatch = Partial<ImportItem>;

let nextItemId = 0;

export function createItem(
  fields: Pick<ImportItem, "name" | "source"> & Partial<ImportItem>,
): ImportItem {
  nextItemId += 1;
  return {
    id: `import-${nextItemId}`,
    size: null,
    title: null,
    stage: "upload",
    documentId: null,
    typeName: null,
    needsReview: false,
    pageCount: null,
    ...fields,
  };
}

export function isFinished(stage: ImportStage) {
  return stage === "done" || stage === "duplicate" || stage === "failed";
}

/** Has a document on the server whose progress is still worth asking about. */
export function isInFlight(item: ImportItem) {
  return Boolean(item.documentId) && !isFinished(item.stage);
}

/** How far along the bar a stage sits: the middle of its quarter. */
export function stageProgress(stage: ImportStage) {
  return (STAGE_ORDER.indexOf(stage) + 0.5) / STAGE_ORDER.length;
}

export function isRetryable(item: ImportItem) {
  return item.stage === "failed" && item.source !== null;
}

export function queueCounts(queue: ImportItem[]) {
  return {
    processing: queue.filter((item) => !isFinished(item.stage)).length,
    done: queue.filter((item) => item.stage === "done").length,
    duplicate: queue.filter((item) => item.stage === "duplicate").length,
    failed: queue.filter((item) => item.stage === "failed").length,
  };
}

/**
 * Finished and dealt with. A failure stays until someone has retried it, unless it
 * was refused up front, in which case retrying can never help.
 */
export function clearFinished(queue: ImportItem[]) {
  return queue.filter((item) => !isFinished(item.stage) || isRetryable(item));
}

export function canClearFinished(queue: ImportItem[]) {
  return clearFinished(queue).length < queue.length;
}

export function applyPatch(queue: ImportItem[], id: string, patch: ImportPatch) {
  return queue.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

/** Runs `worker` over `items`, at most `limit` at a time, until `shouldStop` says so. */
export async function runBounded<T>(
  items: T[],
  limit: number,
  shouldStop: () => boolean,
  worker: (item: T) => Promise<void>,
) {
  const work = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, work.length) }, async () => {
      for (let item = work.shift(); item !== undefined; item = work.shift()) {
        if (shouldStop()) {
          return;
        }
        await worker(item);
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Uploading
// ---------------------------------------------------------------------------

export type CreatedDocument = {
  id: string;
  duplicateOf: { id: string; title: string; createdAt?: string } | null;
};

export async function uploadDocument(
  authFetch: AuthFetch,
  file: PickedFile,
  title: string | null,
  signal?: AbortSignal,
) {
  const formData = new FormData();
  formData.append("file", {
    uri: file.uri,
    name: file.name,
    type: mimeTypeFor(file),
  } as unknown as Blob);
  if (title?.trim()) {
    formData.append("title", title.trim());
  }
  const response = await authFetch("/api/documents", {
    method: "POST",
    body: formData,
    signal,
  });
  // A 409 is a real storage conflict, not a duplicate: re-uploading existing
  // content returns 201 with `duplicateOf` set (#92).
  if (!response.ok) {
    throw new Error(await responseToMessage(response));
  }
  return (await response.json()) as CreatedDocument;
}

/**
 * Same bytes already filed: the document was still created, deliberately, but
 * saying so is the point, so it does not read as a fresh import (#284).
 */
export function outcomeOfUpload(created: CreatedDocument): ImportPatch {
  return created.duplicateOf
    ? { stage: "duplicate", documentId: created.id, duplicateOfId: created.duplicateOf.id }
    : { stage: "ocr", documentId: created.id };
}

export async function reprocessDocument(authFetch: AuthFetch, documentId: string) {
  const response = await authFetch(`/api/documents/${documentId}/reprocess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(await responseToMessage(response));
  }
}

export type ImportDeps = {
  authFetch: AuthFetch;
  /** Turns draft pages into one PDF, returning where it was written. */
  buildPdf: (uris: string[]) => Promise<string>;
  failedMessage: string;
  signal?: AbortSignal;
};

/**
 * One attempt at one row, for its first run and for a retry alike. Once a document
 * exists the failure was in processing, not transfer — re-POSTing the binary would
 * leave the failed document in the archive and add a second one beside it, because
 * the upload API deliberately creates a new document even when the file record is
 * deduplicated by checksum. So that reprocesses instead.
 */
export async function processItem(item: ImportItem, deps: ImportDeps): Promise<ImportPatch> {
  let source = item.source;
  try {
    if (item.documentId) {
      await reprocessDocument(deps.authFetch, item.documentId);
      return { stage: "ocr", errorMessage: undefined };
    }
    if (!source) {
      return { stage: "failed", errorMessage: item.errorMessage ?? deps.failedMessage };
    }
    if (source.kind === "pages") {
      const uri = await deps.buildPdf(source.uris);
      source = { kind: "file", file: { uri, name: item.name, mimeType: "application/pdf" } };
    }
    const created = await uploadDocument(deps.authFetch, source.file, item.title, deps.signal);
    return { ...outcomeOfUpload(created), source, errorMessage: undefined };
  } catch (error) {
    return {
      // Kept on the row, so retrying a failed upload does not build the PDF twice.
      source,
      stage: "failed",
      errorMessage: error instanceof Error ? error.message : deps.failedMessage,
    };
  }
}

// ---------------------------------------------------------------------------
// Following a document through the pipeline
// ---------------------------------------------------------------------------

export type PolledDocument = {
  status: string;
  embeddingStatus?: string | null;
  reviewStatus?: string | null;
  documentType?: { name: string } | null;
  metadata?: { pageCount?: number } | null;
  lastProcessingError?: string | null;
  latestProcessingJob?: { status: string } | null;
};

/**
 * Where a polled document is. `null` means no news.
 *
 * An active job wins over the row's status: reprocessing a failure queues a job
 * while `documents.status` stays `failed` until the worker picks it up, and reading
 * the status first would flip a row the user just retried straight back to failed.
 */
export function patchFromDocument(
  document: PolledDocument,
  messages: { failed: string; embeddingFailed: string },
): ImportPatch | null {
  const job = document.latestProcessingJob?.status;
  if (job === "queued") {
    return { stage: "ocr" };
  }
  if (job === "running" || document.status === "processing") {
    return { stage: "extract" };
  }
  if (document.status === "failed") {
    return {
      stage: "failed",
      errorMessage: document.lastProcessingError ?? messages.failed,
    };
  }
  if (document.status !== "ready") {
    return null;
  }
  // The API's embedding vocabulary is not_configured | queued | indexing | ready |
  // stale | failed.
  const embedding = document.embeddingStatus === "queued" || document.embeddingStatus === "indexing";
  const embeddingFailed = document.embeddingStatus === "failed";
  return {
    stage: embeddingFailed ? "failed" : embedding ? "embed" : "done",
    errorMessage: embeddingFailed ? messages.embeddingFailed : undefined,
    typeName: document.documentType?.name ?? null,
    needsReview: document.reviewStatus === "pending",
    pageCount: document.metadata?.pageCount ?? null,
  };
}

export async function fetchDocumentStatus(authFetch: AuthFetch, documentId: string) {
  const response = await authFetch(`/api/documents/${documentId}`);
  return response.ok ? ((await response.json()) as PolledDocument) : null;
}

// ---------------------------------------------------------------------------
// The watch folder
// ---------------------------------------------------------------------------

export type WatchFolderStatus = {
  configured: boolean;
  configuredPath: string | null;
  lastImport: { scannedAt: string; imported: number } | null;
  history: Array<{ scannedAt: string; imported: number; dryRun: boolean }>;
};

/** Read-only: unlike the scan endpoint it does not walk the folder or audit anything. */
export async function fetchWatchFolder(authFetch: AuthFetch): Promise<WatchFolderStatus> {
  const response = await authFetch("/api/archive/watch-folder");
  if (!response.ok) {
    throw new Error(await responseToMessage(response));
  }
  return (await response.json()) as WatchFolderStatus;
}

/** The API already excludes dry runs from `lastImport`, but not from `history`. */
export function pickedUpToday(status: WatchFolderStatus, now = new Date()) {
  return (status.history ?? [])
    .filter(
      (entry) =>
        !entry.dryRun && new Date(entry.scannedAt).toDateString() === now.toDateString(),
    )
    .reduce((sum, entry) => sum + entry.imported, 0);
}
