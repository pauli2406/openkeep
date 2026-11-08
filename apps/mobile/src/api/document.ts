/**
 * The calls the document detail screen makes, against the same endpoints as the
 * web client. Each takes `authFetch`, so nothing here knows about the session or
 * about whether the app is offline: the screen decides that before it calls.
 */
import { Buffer } from "buffer";
import {
  responseToMessage,
  saveDownloadToFile,
  titleForDocument,
  type ArchiveDocument,
  type DocumentAskCitation,
  type ManualOverrideField,
  type ParseProvider,
  type QaHistoryEntry,
  type TaxonomyOption,
} from "../lib";

export type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>;

export type DownloadVariant = "original" | "searchable";

/** Only the fields that changed: a field in a PATCH body gets pinned against reprocessing. */
export type DocumentPatch = {
  title?: string;
  issueDate?: string | null;
  dueDate?: string | null;
  expiryDate?: string | null;
  amount?: number | null;
  currency?: string | null;
  referenceNumber?: string | null;
  holderName?: string | null;
  issuingAuthority?: string | null;
  correspondentId?: string | null;
  documentTypeId?: string | null;
  tagIds?: string[];
};

/**
 * What the API sends beyond the mobile type. `index` is the number behind an
 * answer's `[n]` marker and `used` whether the answer leaned on the excerpt;
 * entries saved before either existed carry neither.
 */
export type QaCitation = DocumentAskCitation & { index?: number; used?: boolean };

const JSON_HEADERS = { "Content-Type": "application/json" };

async function ensureOk(response: Response) {
  if (!response.ok) {
    throw new Error(await responseToMessage(response));
  }
  return response;
}

function post(authFetch: AuthFetch, path: string, body: object = {}) {
  return authFetch(path, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  }).then(ensureOk);
}

export async function updateDocument(authFetch: AuthFetch, documentId: string, patch: DocumentPatch) {
  const response = await authFetch(`/api/documents/${documentId}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  });
  await ensureOk(response);
}

/** Gives the fields back to the AI: the next reprocess may overwrite them again. */
export async function clearLockedFields(
  authFetch: AuthFetch,
  documentId: string,
  clearLockedFields: ManualOverrideField[],
) {
  const response = await authFetch(`/api/documents/${documentId}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ clearLockedFields }),
  });
  await ensureOk(response);
}

export async function createTag(authFetch: AuthFetch, name: string) {
  const response = await post(authFetch, "/api/taxonomies/tags", { name });
  return (await response.json()) as TaxonomyOption;
}

export async function createCorrespondent(authFetch: AuthFetch, name: string) {
  const response = await post(authFetch, "/api/taxonomies/correspondents", { name });
  return (await response.json()) as TaxonomyOption;
}

export async function resolveReview(authFetch: AuthFetch, documentId: string) {
  await post(authFetch, `/api/documents/${documentId}/review/resolve`);
}

export async function requeueDocument(authFetch: AuthFetch, documentId: string) {
  await post(authFetch, `/api/documents/${documentId}/review/requeue`, { force: true });
}

export async function reprocessDocument(
  authFetch: AuthFetch,
  documentId: string,
  parseProvider?: ParseProvider,
) {
  await post(
    authFetch,
    `/api/documents/${documentId}/reprocess`,
    parseProvider ? { parseProvider } : {},
  );
}

export async function deleteDocument(authFetch: AuthFetch, documentId: string) {
  const response = await authFetch(`/api/documents/${documentId}`, { method: "DELETE" });
  await ensureOk(response);
}

export async function fetchQaHistory(authFetch: AuthFetch, documentId: string) {
  const response = await authFetch(`/api/documents/${documentId}/qa-history`);
  await ensureOk(response);
  return (await response.json()) as QaHistoryEntry[];
}

export async function clearQaHistory(authFetch: AuthFetch, documentId: string) {
  const response = await authFetch(`/api/documents/${documentId}/qa-history`, {
    method: "DELETE",
  });
  await ensureOk(response);
}

const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
  "image/svg+xml": ".svg",
  "text/plain": ".txt",
  "text/html": ".html",
  "text/csv": ".csv",
  "text/markdown": ".md",
  "application/json": ".json",
  "application/xml": ".xml",
  "text/xml": ".xml",
  "application/zip": ".zip",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "video/mp4": ".mp4",
  "audio/mpeg": ".mp3",
};

/** Spellings of one extension, so `scan.jpeg` does not become `scan.jpeg.jpg`. */
const EXTENSION_ALIASES: Record<string, string[]> = {
  ".jpg": [".jpg", ".jpeg"],
  ".tiff": [".tiff", ".tif"],
  ".html": [".html", ".htm"],
};

const MAX_NAME_BYTES = 200;

/**
 * The name a downloaded document gets, which is the one the share sheet shows and
 * the one the receiving app saves it under. Built from the title because the
 * previous `openkeep-<uuid>` had no extension, so a receiving app could not tell
 * a PDF from anything else.
 */
export function downloadFilename(
  title: string | null | undefined,
  mimeType: string,
  variant: DownloadVariant = "original",
) {
  const extension =
    variant === "searchable"
      ? ".pdf"
      : MIME_EXTENSIONS[mimeType.split(";")[0].trim().toLowerCase()];

  const safe = (title ?? "")
    // Path separators and what the common file systems refuse.
    .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, " ")
    // What is left of `../` once its slash is gone.
    .replace(/(^|\s)\.+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // A leading dot hides the file; a trailing one is dropped by Windows.
    .replace(/^\.+|\.+$/g, "")
    .trim();

  if (!extension) {
    // An unknown type: a title that already names its file knows better than we do.
    if (/\.[a-z0-9]{2,5}$/i.test(safe)) {
      return truncateName(safe);
    }
    return `${truncateName(safe) || "document"}.bin`;
  }

  const spellings = EXTENSION_ALIASES[extension] ?? [extension];
  const lower = safe.toLowerCase();
  const present = spellings.find((spelling) => lower.endsWith(spelling));
  const stem = present ? safe.slice(0, -present.length).trimEnd() : safe;
  return `${truncateName(stem) || "document"}${extension}`;
}

/** File names are limited in bytes, and an umlaut is two of them. */
function truncateName(name: string) {
  let characters = Array.from(name);
  while (Buffer.byteLength(characters.join(""), "utf8") > MAX_NAME_BYTES) {
    characters = characters.slice(0, -1);
  }
  return characters.join("").trimEnd();
}

/**
 * Downloads one variant into the cache directory and returns its URI, ready for
 * the share sheet. The name goes in percent-encoded because it ends up in a
 * `file://` URI and a title usually has a space in it; the file itself is called
 * by the decoded name.
 */
export async function downloadDocumentToFile(
  authFetch: AuthFetch,
  document: ArchiveDocument,
  variant: DownloadVariant,
) {
  const response = await authFetch(
    variant === "searchable"
      ? `/api/documents/${document.id}/download/searchable`
      : `/api/documents/${document.id}/download`,
  );
  await ensureOk(response);
  const name = downloadFilename(titleForDocument(document), document.mimeType, variant);
  return saveDownloadToFile(response, encodeURIComponent(name));
}
