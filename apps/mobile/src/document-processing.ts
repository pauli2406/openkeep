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

export function getDocumentProcessingLabel(document: ProcessableDocumentLike) {
  if (!document) {
    return null;
  }

  if (document.latestProcessingJob?.status === "queued" || document.status === "pending") {
    return "Queued";
  }

  if (isDocumentProcessing(document)) {
    return "Processing";
  }

  return null;
}
