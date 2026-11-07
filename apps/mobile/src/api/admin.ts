/**
 * Everything the Settings screen asks the server: health, processing activity,
 * providers, archive portability, the ingest sources and the taxonomy tables.
 * The endpoints are the web client's.
 */
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import type { FacetsResponse } from "../lib";
import { failureMessage, type AuthFetch } from "./account";

async function getJson<T>(authFetch: AuthFetch, path: string, fallback: string): Promise<T> {
  const response = await authFetch(path);
  if (!response.ok) throw new Error(await failureMessage(response, fallback));
  return (await response.json()) as T;
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// ---------------------------------------------------------------------------
// Health and processing
// ---------------------------------------------------------------------------

export type ProviderConfig = {
  activeParseProvider: string;
  fallbackParseProvider?: string | null;
  activeChatProvider?: string | null;
  activeEmbeddingProvider?: string | null;
  openaiModel?: string;
  geminiModel?: string;
  mistralModel?: string;
  hasOpenAiKey: boolean;
  hasGeminiKey: boolean;
  hasMistralKey: boolean;
  hasVoyageKey: boolean;
  hasGoogleCloudConfig: boolean;
  hasAwsTextractConfig: boolean;
  hasAzureDocumentIntelligenceConfig: boolean;
  hasMistralOcrConfig: boolean;
  hasMistralEmbeddingConfig: boolean;
};

export type HealthResponse = { status: string; provider: ProviderConfig };
export type ReadinessResponse = {
  status: "ok" | "degraded";
  checks: Record<string, boolean>;
};
export type HealthProviders = {
  activeParseProvider: string;
  fallbackParseProvider: string | null;
  activeChatProvider: string | null;
  activeEmbeddingProvider: string | null;
  parseProviders: Array<{ id: string; available: boolean }>;
  embeddingProviders: Array<{ id: string; available: boolean; model: string | null }>;
};
export type ProcessingJob = {
  id: string;
  documentId: string;
  queueName: string;
  status: "queued" | "running" | "completed" | "failed";
  attempts: number;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};
export type ProcessingStatus = {
  queues: { processing: { depth: number }; embedding: { depth: number } };
  documents: { byStatus: Record<string, number>; pendingReview: number };
  recentJobs: ProcessingJob[];
};

export const fetchHealth = (authFetch: AuthFetch, fallback: string) =>
  getJson<HealthResponse>(authFetch, "/api/health", fallback);
export const fetchReadiness = (authFetch: AuthFetch, fallback: string) =>
  getJson<ReadinessResponse>(authFetch, "/api/health/ready", fallback);
export const fetchProviders = (authFetch: AuthFetch, fallback: string) =>
  getJson<HealthProviders>(authFetch, "/api/health/providers", fallback);
export const fetchProcessingStatus = (authFetch: AuthFetch, fallback: string) =>
  getJson<ProcessingStatus>(authFetch, "/api/health/status", fallback);

// ---------------------------------------------------------------------------
// Archive portability
// ---------------------------------------------------------------------------

export type ArchiveImportMode = "replace" | "merge";
export type ArchiveImportResult = {
  imported: true;
  mode: ArchiveImportMode;
  documentCount: number;
  fileCount: number;
};

/** What the import sends: the parsed file, plus what the confirmation needs to say. */
export type ParsedSnapshot = { snapshot: Record<string, unknown>; documentCount: number };

/**
 * Reads a picked file as a snapshot, or returns null. Better to refuse a holiday
 * photo here than to offer to replace the archive with it and let the server say
 * no; the server still validates the real shape.
 */
export function parseArchiveSnapshot(text: string): ParsedSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const snapshot = parsed as Record<string, unknown>;
  if (!Array.isArray(snapshot.documents)) return null;
  return { snapshot, documentCount: snapshot.documents.length };
}

export async function importArchiveSnapshot(
  authFetch: AuthFetch,
  input: { mode: ArchiveImportMode; snapshot: Record<string, unknown> },
  fallback: string,
): Promise<ArchiveImportResult> {
  const response = await authFetch("/api/archive/import", jsonRequest("POST", input));
  if (!response.ok) throw new Error(await failureMessage(response, fallback));
  return (await response.json()) as ArchiveImportResult;
}

export const ARCHIVE_EXPORT_FILENAME = "openkeep-archive-export.json";

/**
 * Writes the snapshot to a temporary file and offers it through the share sheet,
 * the phone's answer to a browser download. The file holds the whole archive's
 * metadata, so it goes away again once the sheet has closed.
 */
export async function shareArchiveExport(
  authFetch: AuthFetch,
  messages: { failed: string; shareUnavailable: string; dialogTitle: string },
) {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error(messages.shareUnavailable);
  }
  const response = await authFetch("/api/archive/export");
  if (!response.ok) throw new Error(await failureMessage(response, messages.failed));
  const uri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}${ARCHIVE_EXPORT_FILENAME}`;
  await FileSystem.writeAsStringAsync(uri, await response.text());
  try {
    await Sharing.shareAsync(uri, {
      mimeType: "application/json",
      UTI: "public.json",
      dialogTitle: messages.dialogTitle,
    });
  } finally {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Ingest sources
// ---------------------------------------------------------------------------

export type WatchFolderHistoryItem = {
  scannedAt: string;
  dryRun: boolean;
  imported: number;
  duplicate: number;
  unsupported: number;
  failed: number;
  planned: number;
};
export type WatchFolderStatus = {
  configured: boolean;
  configuredPath: string | null;
  lastScan: WatchFolderHistoryItem | null;
  lastImport: WatchFolderHistoryItem | null;
  history: WatchFolderHistoryItem[];
};
export type WatchFolderAction = "imported" | "duplicate" | "unsupported" | "failed" | "planned";
export type WatchFolderScanItem = {
  path: string;
  action: WatchFolderAction;
  destinationPath: string | null;
  documentId: string | null;
  reason: string;
  mimeType: string | null;
  failureCode: string | null;
  detail: string | null;
};
export type WatchFolderScan = {
  configuredPath: string;
  dryRun: boolean;
  summary: {
    total: number;
    imported: number;
    duplicate: number;
    unsupported: number;
    failed: number;
    planned: number;
  };
  items: WatchFolderScanItem[];
  history: WatchFolderHistoryItem[];
};
export type EmailIngestStatus = {
  configured: boolean;
  mailbox: { host: string; folder: string; user: string } | null;
  lastPoll: Record<string, unknown> | null;
  counts: { imported: number; skipped: number; rejected: number };
  recentRejections: Array<{
    fromAddress: string;
    subject: string | null;
    status: string;
    reason: string | null;
    createdAt: string;
  }>;
};

export const fetchWatchFolderStatus = (authFetch: AuthFetch, fallback: string) =>
  getJson<WatchFolderStatus>(authFetch, "/api/archive/watch-folder", fallback);

export async function scanWatchFolder(
  authFetch: AuthFetch,
  dryRun: boolean,
  fallback: string,
): Promise<WatchFolderScan> {
  const response = await authFetch(
    "/api/archive/watch-folder/scan",
    jsonRequest("POST", { dryRun }),
  );
  if (!response.ok) throw new Error(await failureMessage(response, fallback));
  return (await response.json()) as WatchFolderScan;
}

export const fetchEmailIngestStatus = (authFetch: AuthFetch, fallback: string) =>
  getJson<EmailIngestStatus>(authFetch, "/api/email-ingest/status", fallback);

export async function pollEmailInbox(authFetch: AuthFetch, fallback: string) {
  const response = await authFetch("/api/email-ingest/poll", { method: "POST" });
  if (!response.ok) throw new Error(await failureMessage(response, fallback));
}

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

export type TaxonomyKind = "tags" | "correspondents" | "document-types" | "categories";

export type TaxonomyEntry = {
  id: string;
  name: string;
  slug: string;
  builtin?: boolean;
  categoryId?: string | null;
  categoryName?: string | null;
};

export const fetchTaxonomyEntries = (authFetch: AuthFetch, kind: TaxonomyKind, fallback: string) =>
  getJson<TaxonomyEntry[]>(authFetch, `/api/taxonomies/${kind}`, fallback);

export const fetchFacets = (authFetch: AuthFetch, fallback: string) =>
  getJson<FacetsResponse>(authFetch, "/api/documents/facets", fallback);

async function taxonomyWrite(
  authFetch: AuthFetch,
  path: string,
  init: RequestInit,
  fallback: string,
) {
  const response = await authFetch(path, init);
  if (!response.ok) throw new Error(await failureMessage(response, fallback));
}

export const createTaxonomyEntry = (
  authFetch: AuthFetch,
  kind: TaxonomyKind,
  name: string,
  fallback: string,
) => taxonomyWrite(authFetch, `/api/taxonomies/${kind}`, jsonRequest("POST", { name }), fallback);

export const renameTaxonomyEntry = (
  authFetch: AuthFetch,
  kind: TaxonomyKind,
  id: string,
  name: string,
  fallback: string,
) =>
  taxonomyWrite(
    authFetch,
    `/api/taxonomies/${kind}/${encodeURIComponent(id)}`,
    jsonRequest("PATCH", { name }),
    fallback,
  );

export const deleteTaxonomyEntry = (
  authFetch: AuthFetch,
  kind: TaxonomyKind,
  id: string,
  fallback: string,
) =>
  taxonomyWrite(
    authFetch,
    `/api/taxonomies/${kind}/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    fallback,
  );

export const mergeTaxonomyEntry = (
  authFetch: AuthFetch,
  kind: TaxonomyKind,
  id: string,
  targetId: string,
  fallback: string,
) =>
  taxonomyWrite(
    authFetch,
    `/api/taxonomies/${kind}/${encodeURIComponent(id)}/merge`,
    jsonRequest("POST", { targetId }),
    fallback,
  );
