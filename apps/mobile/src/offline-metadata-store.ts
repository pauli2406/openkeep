import * as SQLite from "expo-sqlite";
import type { ArchiveDocument, DashboardInsights, FacetsResponse } from "./lib";

const DB_NAME = "openkeep-offline.db";

type MetadataRow = {
  id: string;
  documentJson: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  reviewStatus: string;
  correspondentSlug: string | null;
  searchText: string;
  hasLocalFile: number;
  isPinnedOffline: number;
  lastViewedAt: string | null;
  syncedAt: string | null;
};

type LoadDocumentsOptions = {
  query?: string;
  status?: "all" | "pending" | "processing" | "ready" | "failed";
  reviewOnly?: boolean;
  correspondentSlug?: string;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function buildSearchText(document: ArchiveDocument) {
  return [
    document.title,
    document.correspondent?.name,
    document.documentType?.name,
    document.referenceNumber,
    document.holderName,
    document.issuingAuthority,
    ...document.tags.map((tag) => tag.name),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function rowToDocument(row: Pick<MetadataRow, "documentJson">) {
  return JSON.parse(row.documentJson) as ArchiveDocument;
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }

  const db = await dbPromise;
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS offline_documents (
      id TEXT PRIMARY KEY NOT NULL,
      document_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT NOT NULL,
      review_status TEXT NOT NULL,
      correspondent_slug TEXT,
      search_text TEXT NOT NULL,
      has_local_file INTEGER NOT NULL DEFAULT 0,
      is_pinned_offline INTEGER NOT NULL DEFAULT 0,
      last_viewed_at TEXT,
      synced_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_offline_documents_created_at ON offline_documents(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_offline_documents_status ON offline_documents(status);
    CREATE INDEX IF NOT EXISTS idx_offline_documents_review_status ON offline_documents(review_status);
    CREATE INDEX IF NOT EXISTS idx_offline_documents_correspondent_slug ON offline_documents(correspondent_slug);
    CREATE TABLE IF NOT EXISTS offline_state (
      key TEXT PRIMARY KEY NOT NULL,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

export async function setOfflineStateValue<T>(key: string, value: T) {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO offline_state (key, value_json, updated_at)
     VALUES (?, ?, ?)`,
    key,
    JSON.stringify(value),
    new Date().toISOString(),
  );
}

export async function getOfflineStateValue<T>(key: string) {
  const db = await getDb();
  const row = await db.getFirstAsync<{ valueJson: string }>(
    "SELECT value_json as valueJson FROM offline_state WHERE key = ?",
    key,
  );
  return row ? JSON.parse(row.valueJson) as T : null;
}

export async function upsertOfflineDocumentMetadata(
  document: ArchiveDocument,
  options?: {
    hasLocalFile?: boolean;
    isPinnedOffline?: boolean;
    lastViewedAt?: string | null;
    syncedAt?: string | null;
  },
) {
  const db = await getDb();
  const updatedAt = document.updatedAt ?? document.createdAt ?? new Date().toISOString();
  const existing = await db.getFirstAsync<Pick<MetadataRow, "hasLocalFile" | "isPinnedOffline" | "lastViewedAt" | "syncedAt">>(
    "SELECT has_local_file as hasLocalFile, is_pinned_offline as isPinnedOffline, last_viewed_at as lastViewedAt, synced_at as syncedAt FROM offline_documents WHERE id = ?",
    document.id,
  );

  await db.runAsync(
    `INSERT OR REPLACE INTO offline_documents (
      id,
      document_json,
      created_at,
      updated_at,
      status,
      review_status,
      correspondent_slug,
      search_text,
      has_local_file,
      is_pinned_offline,
      last_viewed_at,
      synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    document.id,
    JSON.stringify(document),
    document.createdAt,
    updatedAt,
    document.status,
    document.reviewStatus,
    document.correspondent?.slug ?? null,
    buildSearchText(document),
    options?.hasLocalFile ?? existing?.hasLocalFile ?? 0,
    options?.isPinnedOffline ?? existing?.isPinnedOffline ?? 0,
    options?.lastViewedAt ?? existing?.lastViewedAt ?? null,
    options?.syncedAt ?? existing?.syncedAt ?? null,
  );
}

export async function setOfflineDocumentFileState(
  documentId: string,
  values: { hasLocalFile?: boolean; isPinnedOffline?: boolean; lastViewedAt?: string | null; syncedAt?: string | null },
) {
  const db = await getDb();
  const existing = await db.getFirstAsync<MetadataRow>(
    `SELECT
      id,
      document_json as documentJson,
      created_at as createdAt,
      updated_at as updatedAt,
      status,
      review_status as reviewStatus,
      correspondent_slug as correspondentSlug,
      search_text as searchText,
      has_local_file as hasLocalFile,
      is_pinned_offline as isPinnedOffline,
      last_viewed_at as lastViewedAt,
      synced_at as syncedAt
     FROM offline_documents WHERE id = ?`,
    documentId,
  );
  if (!existing) {
    return;
  }

  await db.runAsync(
    `UPDATE offline_documents
      SET has_local_file = ?,
          is_pinned_offline = ?,
          last_viewed_at = ?,
          synced_at = ?
      WHERE id = ?`,
    values.hasLocalFile ?? existing.hasLocalFile,
    values.isPinnedOffline ?? existing.isPinnedOffline,
    values.lastViewedAt ?? existing.lastViewedAt,
    values.syncedAt ?? existing.syncedAt,
    documentId,
  );
}

export async function removeOfflineDocumentMetadata(documentId: string) {
  const db = await getDb();
  await db.runAsync("DELETE FROM offline_documents WHERE id = ?", documentId);
}

export async function getOfflineDocumentMetadata(documentId: string) {
  const db = await getDb();
  const row = await db.getFirstAsync<MetadataRow>(
    `SELECT
      id,
      document_json as documentJson,
      created_at as createdAt,
      updated_at as updatedAt,
      status,
      review_status as reviewStatus,
      correspondent_slug as correspondentSlug,
      search_text as searchText,
      has_local_file as hasLocalFile,
      is_pinned_offline as isPinnedOffline,
      last_viewed_at as lastViewedAt,
      synced_at as syncedAt
     FROM offline_documents WHERE id = ?`,
    documentId,
  );
  if (!row) {
    return null;
  }

  return {
    document: rowToDocument(row),
    hasLocalFile: Boolean(row.hasLocalFile),
    isPinnedOffline: Boolean(row.isPinnedOffline),
    lastViewedAt: row.lastViewedAt,
    syncedAt: row.syncedAt,
  };
}

export async function getOfflineDocumentsIndicatorMap(documentIds: string[]) {
  if (documentIds.length === 0) {
    return new Map<string, { hasLocalFile: boolean; isPinnedOffline: boolean }>();
  }

  const db = await getDb();
  const placeholders = documentIds.map(() => "?").join(", ");
  const rows = await db.getAllAsync<{
    id: string;
    hasLocalFile: number;
    isPinnedOffline: number;
  }>(
    `SELECT id, has_local_file as hasLocalFile, is_pinned_offline as isPinnedOffline
     FROM offline_documents
     WHERE id IN (${placeholders})`,
    ...documentIds,
  );

  return new Map(
    rows.map((row) => [
      row.id,
      {
        hasLocalFile: Boolean(row.hasLocalFile),
        isPinnedOffline: Boolean(row.isPinnedOffline),
      },
    ]),
  );
}

export async function queryOfflineDocuments(options?: LoadDocumentsOptions) {
  const db = await getDb();
  const clauses = ["1 = 1"];
  const params: Array<string> = [];

  if (options?.status && options.status !== "all") {
    clauses.push("status = ?");
    params.push(options.status);
  }

  if (options?.reviewOnly) {
    clauses.push("review_status = 'pending'");
  }

  if (options?.correspondentSlug) {
    clauses.push("correspondent_slug = ?");
    params.push(options.correspondentSlug);
  }

  if (options?.query?.trim()) {
    clauses.push("search_text LIKE ?");
    params.push(`%${options.query.trim().toLowerCase()}%`);
  }

  const rows = await db.getAllAsync<Pick<MetadataRow, "documentJson">>(
    `SELECT document_json as documentJson
     FROM offline_documents
     WHERE ${clauses.join(" AND ")}
     ORDER BY created_at DESC`,
    ...params,
  );

  return rows.map(rowToDocument);
}

export async function getOfflineDocumentStats() {
  const db = await getDb();
  const row = await db.getFirstAsync<{ documentCount: number; localFileCount: number }>(
    `SELECT COUNT(*) as documentCount,
            SUM(CASE WHEN has_local_file = 1 THEN 1 ELSE 0 END) as localFileCount
     FROM offline_documents`,
  );

  return {
    documentCount: row?.documentCount ?? 0,
    localFileCount: row?.localFileCount ?? 0,
  };
}

export async function listOfflineFileCandidatesForCleanup() {
  const db = await getDb();
  return db.getAllAsync<{
    id: string;
    createdAt: string;
    lastViewedAt: string | null;
    isPinnedOffline: number;
  }>(
    `SELECT
      id,
      created_at as createdAt,
      last_viewed_at as lastViewedAt,
      is_pinned_offline as isPinnedOffline
     FROM offline_documents
     WHERE has_local_file = 1
     ORDER BY created_at ASC`,
  );
}

export async function listOfflineDocumentsForSummary() {
  const db = await getDb();
  const rows = await db.getAllAsync<Pick<MetadataRow, "documentJson">>(
    "SELECT document_json as documentJson FROM offline_documents ORDER BY created_at DESC",
  );
  return rows.map(rowToDocument);
}

export async function loadOfflineDashboardState() {
  return getOfflineStateValue<DashboardInsights | null>("dashboard");
}

export async function saveOfflineDashboardState(value: DashboardInsights | null) {
  await setOfflineStateValue("dashboard", value);
}

export async function loadOfflineFacetsState() {
  return getOfflineStateValue<FacetsResponse | null>("facets");
}

export async function saveOfflineFacetsState(value: FacetsResponse | null) {
  await setOfflineStateValue("facets", value);
}

export async function loadOfflineSummaryState() {
  return getOfflineStateValue<{
    lastSyncedAt: string | null;
    retentionSettings: {
      mode: "full_mirror" | "smart_cache";
      maxFileStorageBytes: number | null;
      keepFilesForYears: number | null;
    };
  } | null>("summary");
}

export async function saveOfflineSummaryState(value: {
  lastSyncedAt: string | null;
  retentionSettings: {
    mode: "full_mirror" | "smart_cache";
    maxFileStorageBytes: number | null;
    keepFilesForYears: number | null;
  };
}) {
  await setOfflineStateValue("summary", value);
}

export async function hasCompletedOfflineMigration(migrationKey: string) {
  return (await getOfflineStateValue<boolean>(`migration:${migrationKey}`)) === true;
}

export async function markOfflineMigrationCompleted(migrationKey: string) {
  await setOfflineStateValue(`migration:${migrationKey}`, true);
}
