import * as SQLite from "expo-sqlite";
import type {
  ArchiveDocument,
  DashboardInsights,
  DocumentHistoryResponse,
  DocumentTextResponse,
  FacetsResponse,
} from "./lib";

const DB_NAME = "openkeep-cache.db";

/**
 * The slice of a SQLite handle this store uses. Naming it is what makes the
 * store testable: production passes the `expo-sqlite` database, and tests pass
 * an adapter over Node's own SQLite, so the real SQL — the filters, the
 * ordering, the schema — is exercised without a device or an Expo runtime.
 */
export type OfflineSqlParam = string | number | null;

export type OfflineDatabase = {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, ...params: OfflineSqlParam[]): Promise<unknown>;
  getFirstAsync<T>(source: string, ...params: OfflineSqlParam[]): Promise<T | null>;
  getAllAsync<T>(source: string, ...params: OfflineSqlParam[]): Promise<T[]>;
};

export type CachedDocumentRecord = {
  document: ArchiveDocument;
  text: DocumentTextResponse;
  history: DocumentHistoryResponse;
  fileUri: string | null;
  cachedAt: string;
  lastViewedAt: string;
  fileStorageBytes: number;
};

type CachedDocumentRow = {
  id: string;
  documentJson: string;
  textJson: string;
  historyJson: string;
  fileUri: string | null;
  cachedAt: string;
  lastViewedAt: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  reviewStatus: string;
  correspondentId: string | null;
  correspondentName: string | null;
  correspondentSlug: string | null;
  documentTypeId: string | null;
  documentTypeName: string | null;
  documentTypeSlug: string | null;
  searchText: string;
  fileStorageBytes: number;
};

type LoadDocumentsOptions = {
  query?: string;
  status?: "all" | "pending" | "processing" | "ready" | "failed";
  reviewOnly?: boolean;
  correspondentSlug?: string;
};

const SCHEMA = `
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS cached_documents (
      id TEXT PRIMARY KEY NOT NULL,
      document_json TEXT NOT NULL,
      text_json TEXT NOT NULL,
      history_json TEXT NOT NULL,
      file_uri TEXT,
      cached_at TEXT NOT NULL,
      last_viewed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT NOT NULL,
      review_status TEXT NOT NULL,
      correspondent_id TEXT,
      correspondent_name TEXT,
      correspondent_slug TEXT,
      document_type_id TEXT,
      document_type_name TEXT,
      document_type_slug TEXT,
      search_text TEXT NOT NULL,
      file_storage_bytes INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_cached_documents_last_viewed_at ON cached_documents(last_viewed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cached_documents_created_at ON cached_documents(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cached_documents_status ON cached_documents(status);
    CREATE INDEX IF NOT EXISTS idx_cached_documents_review_status ON cached_documents(review_status);
    CREATE INDEX IF NOT EXISTS idx_cached_documents_correspondent_slug ON cached_documents(correspondent_slug);
  `;

const SELECT_ROW_COLUMNS = `
      id,
      document_json as documentJson,
      text_json as textJson,
      history_json as historyJson,
      file_uri as fileUri,
      cached_at as cachedAt,
      last_viewed_at as lastViewedAt,
      created_at as createdAt,
      updated_at as updatedAt,
      status,
      review_status as reviewStatus,
      correspondent_id as correspondentId,
      correspondent_name as correspondentName,
      correspondent_slug as correspondentSlug,
      document_type_id as documentTypeId,
      document_type_name as documentTypeName,
      document_type_slug as documentTypeSlug,
      search_text as searchText,
      file_storage_bytes as fileStorageBytes`;

function buildSearchText(document: ArchiveDocument, text: DocumentTextResponse) {
  return [
    document.title,
    document.correspondent?.name,
    document.documentType?.name,
    document.referenceNumber,
    document.holderName,
    document.issuingAuthority,
    ...document.tags.map((tag) => tag.name),
    ...text.blocks.map((block) => block.text),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function rowToRecord(row: Pick<CachedDocumentRow, "documentJson" | "textJson" | "historyJson" | "fileUri" | "cachedAt" | "lastViewedAt" | "fileStorageBytes">): CachedDocumentRecord {
  return {
    document: JSON.parse(row.documentJson) as ArchiveDocument,
    text: JSON.parse(row.textJson) as DocumentTextResponse,
    history: JSON.parse(row.historyJson) as DocumentHistoryResponse,
    fileUri: row.fileUri,
    cachedAt: row.cachedAt,
    lastViewedAt: row.lastViewedAt,
    fileStorageBytes: row.fileStorageBytes,
  };
}

function rowToDocument(row: Pick<CachedDocumentRow, "documentJson">) {
  return JSON.parse(row.documentJson) as ArchiveDocument;
}

export function createOfflineMetadataStore({
  openDatabase,
}: {
  openDatabase: () => Promise<OfflineDatabase>;
}) {
  let ready: Promise<OfflineDatabase> | null = null;

  // The schema runs once per store rather than on every call. It is still
  // `IF NOT EXISTS`, so opening an existing database is unchanged.
  function getDb() {
    ready ??= (async () => {
      const db = await openDatabase();
      await db.execAsync(SCHEMA);
      return db;
    })();
    return ready;
  }

  async function upsertCachedDocument(record: CachedDocumentRecord) {
    const db = await getDb();
    const document = record.document;
    const updatedAt = document.updatedAt ?? document.createdAt ?? record.cachedAt;

    await db.runAsync(
      `INSERT OR REPLACE INTO cached_documents (
      id,
      document_json,
      text_json,
      history_json,
      file_uri,
      cached_at,
      last_viewed_at,
      created_at,
      updated_at,
      status,
      review_status,
      correspondent_id,
      correspondent_name,
      correspondent_slug,
      document_type_id,
      document_type_name,
      document_type_slug,
      search_text,
      file_storage_bytes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      document.id,
      JSON.stringify(document),
      JSON.stringify(record.text),
      JSON.stringify(record.history),
      record.fileUri,
      record.cachedAt,
      record.lastViewedAt,
      document.createdAt,
      updatedAt,
      document.status,
      document.reviewStatus,
      document.correspondent?.id ?? null,
      document.correspondent?.name ?? null,
      document.correspondent?.slug ?? null,
      document.documentType?.id ?? null,
      document.documentType?.name ?? null,
      document.documentType?.slug ?? null,
      buildSearchText(document, record.text),
      record.fileStorageBytes,
    );
  }

  async function getCachedDocument(documentId: string) {
    const db = await getDb();
    const row = await db.getFirstAsync<CachedDocumentRow>(
      `SELECT${SELECT_ROW_COLUMNS}
     FROM cached_documents WHERE id = ?`,
      documentId,
    );
    return row ? rowToRecord(row) : null;
  }

  async function queryCachedDocuments(options?: LoadDocumentsOptions) {
    const db = await getDb();
    const clauses = ["1 = 1"];
    const params: string[] = [];

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

    const rows = await db.getAllAsync<Pick<CachedDocumentRow, "documentJson">>(
      `SELECT document_json as documentJson
     FROM cached_documents
     WHERE ${clauses.join(" AND ")}
     ORDER BY last_viewed_at DESC, created_at DESC`,
      ...params,
    );

    return rows.map(rowToDocument);
  }

  async function listCachedDocuments() {
    return queryCachedDocuments();
  }

  async function getCacheStats() {
    const db = await getDb();
    const row = await db.getFirstAsync<{ documentCount: number; fileStorageBytes: number }>(
      `SELECT COUNT(*) as documentCount,
            COALESCE(SUM(file_storage_bytes), 0) as fileStorageBytes
     FROM cached_documents`,
    );

    return {
      documentCount: row?.documentCount ?? 0,
      fileStorageBytes: row?.fileStorageBytes ?? 0,
    };
  }

  async function getCachedFileUris() {
    const db = await getDb();
    const rows = await db.getAllAsync<{ fileUri: string | null }>(
      "SELECT file_uri as fileUri FROM cached_documents WHERE file_uri IS NOT NULL",
    );
    return rows.map((row) => row.fileUri).filter(Boolean) as string[];
  }

  async function clearCachedDocumentRows() {
    const db = await getDb();
    await db.runAsync("DELETE FROM cached_documents");
  }

  async function buildCachedFacets(): Promise<FacetsResponse> {
    const documents = await listCachedDocuments();
    const correspondents = new Map<string, { id: string; name: string; slug: string; count: number }>();
    const documentTypes = new Map<string, { id: string; name: string; slug: string; count: number }>();
    const tags = new Map<string, { id: string; name: string; slug: string; count: number }>();
    const statuses = new Map<string, number>();
    const years = new Map<number, number>();

    for (const document of documents) {
      statuses.set(document.status, (statuses.get(document.status) ?? 0) + 1);
      const year = new Date(document.issueDate ?? document.createdAt).getFullYear();
      if (Number.isFinite(year)) {
        years.set(year, (years.get(year) ?? 0) + 1);
      }
      if (document.correspondent) {
        const current = correspondents.get(document.correspondent.id);
        correspondents.set(document.correspondent.id, {
          ...document.correspondent,
          count: (current?.count ?? 0) + 1,
        });
      }
      if (document.documentType) {
        const current = documentTypes.get(document.documentType.id);
        documentTypes.set(document.documentType.id, {
          id: document.documentType.id,
          name: document.documentType.name,
          slug: document.documentType.slug,
          count: (current?.count ?? 0) + 1,
        });
      }
      for (const tag of document.tags) {
        const current = tags.get(tag.id);
        tags.set(tag.id, {
          ...tag,
          count: (current?.count ?? 0) + 1,
        });
      }
    }

    return {
      correspondents: [...correspondents.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      documentTypes: [...documentTypes.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      tags: [...tags.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      statuses: [...statuses.entries()].map(([status, count]) => ({ status, count })),
      years: [...years.entries()]
        .map(([year, count]) => ({ year, count }))
        .sort((a, b) => b.year - a.year),
    };
  }

  async function buildCachedDashboard(): Promise<DashboardInsights> {
    const documents = await listCachedDocuments();
    const facets = await buildCachedFacets();
    const topCorrespondents = facets.correspondents.slice(0, 6).map((correspondent) => {
      const docs = documents.filter((document) => document.correspondent?.id === correspondent.id);
      const totals = docs.reduce<{ amount: number; currency: string | null }>(
        (acc, document) => {
          if (typeof document.amount === "number") {
            acc.amount += document.amount;
            acc.currency = acc.currency ?? document.currency;
          }
          return acc;
        },
        { amount: 0, currency: null },
      );
      const latestDocDate = docs
        .map((document) => document.issueDate ?? document.createdAt)
        .sort()
        .at(-1) ?? null;

      return {
        id: correspondent.id,
        name: correspondent.name,
        slug: correspondent.slug,
        documentCount: correspondent.count,
        totalAmount: totals.amount > 0 ? totals.amount : null,
        currency: totals.currency,
        latestDocDate,
      };
    });

    const now = new Date();
    const deadlineItems = documents
      .filter((document) => document.dueDate && !document.taskCompletedAt)
      .map((document) => {
        const due = new Date(document.dueDate!);
        const daysUntilDue = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
        return {
          documentId: document.id,
          title: document.title,
          referenceNumber: document.referenceNumber,
          dueDate: document.dueDate!,
          amount: document.amount,
          currency: document.currency,
          correspondentName: document.correspondent?.name ?? null,
          documentTypeName: document.documentType?.name ?? null,
          taskLabel: document.title,
          daysUntilDue,
          isOverdue: daysUntilDue < 0,
        };
      })
      .sort((left, right) => new Date(left.dueDate).getTime() - new Date(right.dueDate).getTime());

    return {
      stats: {
        totalDocuments: documents.length,
        pendingReview: documents.filter((document) => document.reviewStatus === "pending").length,
        documentTypesCount: facets.documentTypes.length,
        correspondentsCount: facets.correspondents.length,
      },
      recentDocuments: documents.slice(0, 5),
      topCorrespondents,
      upcomingDeadlines: deadlineItems.filter((item) => !item.isOverdue).slice(0, 6),
      overdueItems: deadlineItems.filter((item) => item.isOverdue).slice(0, 6),
      monthlyActivity: buildMonthlyActivity(documents),
    };
  }

  return {
    upsertCachedDocument,
    getCachedDocument,
    queryCachedDocuments,
    listCachedDocuments,
    getCacheStats,
    getCachedFileUris,
    clearCachedDocumentRows,
    buildCachedFacets,
    buildCachedDashboard,
  };
}

export type OfflineMetadataStore = ReturnType<typeof createOfflineMetadataStore>;

function buildMonthlyActivity(documents: ArchiveDocument[]) {
  const counts = new Map<string, number>();
  for (const document of documents) {
    const date = new Date(document.issueDate ?? document.createdAt);
    if (!Number.isFinite(date.getTime())) {
      continue;
    }
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-12)
    .map(([month, count]) => ({ month, count }));
}

// The app's one store, over the device database. Everything above is reachable
// with any handle; this is the single place that names `expo-sqlite`.
let defaultStore: OfflineMetadataStore | null = null;

function store() {
  defaultStore ??= createOfflineMetadataStore({
    openDatabase: () => SQLite.openDatabaseAsync(DB_NAME),
  });
  return defaultStore;
}

export function upsertCachedDocument(record: CachedDocumentRecord) {
  return store().upsertCachedDocument(record);
}

export function getCachedDocument(documentId: string) {
  return store().getCachedDocument(documentId);
}

export function queryCachedDocuments(options?: LoadDocumentsOptions) {
  return store().queryCachedDocuments(options);
}

export function listCachedDocuments() {
  return store().listCachedDocuments();
}

export function getCacheStats() {
  return store().getCacheStats();
}

export function getCachedFileUris() {
  return store().getCachedFileUris();
}

export function clearCachedDocumentRows() {
  return store().clearCachedDocumentRows();
}

export function buildCachedFacets() {
  return store().buildCachedFacets();
}

export function buildCachedDashboard() {
  return store().buildCachedDashboard();
}
