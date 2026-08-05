type ProcessingJobLike = {
  status: string;
} | null | undefined;

type ProcessableDocumentLike = {
  status: string;
  latestProcessingJob?: ProcessingJobLike;
} | null | undefined;

export const DOCUMENT_PROCESSING_POLL_INTERVAL_MS = 4_000;

function isActiveJobStatus(status: string | null | undefined) {
  return status === "queued" || status === "running";
}

export function isDocumentProcessing(document: ProcessableDocumentLike) {
  if (!document) {
    return false;
  }

  return (
    document.status === "pending" ||
    document.status === "processing" ||
    isActiveJobStatus(document.latestProcessingJob?.status)
  );
}

export function hasProcessingDocuments(documents: ProcessableDocumentLike[] | null | undefined) {
  return (documents ?? []).some((document) => isDocumentProcessing(document));
}

export function processingRefetchInterval<T>(
  data: T | undefined,
  select: (value: T | undefined) => ProcessableDocumentLike | ProcessableDocumentLike[] | null | undefined,
) {
  const selected = select(data);
  if (Array.isArray(selected)) {
    return hasProcessingDocuments(selected) ? DOCUMENT_PROCESSING_POLL_INTERVAL_MS : false;
  }

  return isDocumentProcessing(selected) ? DOCUMENT_PROCESSING_POLL_INTERVAL_MS : false;
}

/**
 * What a document's row looks like (#120). `processing` gets a pulsing dot and
 * `wird verarbeitet` where its metadata would be; `failed` gets a red tint and
 * a reprocess action. Callers map these to strings themselves — this module
 * has no access to the i18n dictionary.
 */
export type DocumentRowState = "queued" | "processing" | "failed" | "ready";

export function documentRowState(document: ProcessableDocumentLike): DocumentRowState {
  if (!document) {
    return "ready";
  }

  if (document.status === "failed" || document.latestProcessingJob?.status === "failed") {
    return "failed";
  }

  if (document.latestProcessingJob?.status === "queued" || document.status === "pending") {
    return "queued";
  }

  if (isDocumentProcessing(document)) {
    return "processing";
  }

  return "ready";
}

/** A document has no metadata worth tapping into until it has been parsed. */
export function hasParsedMetadata(document: ProcessableDocumentLike) {
  const state = documentRowState(document);
  return state === "ready";
}
