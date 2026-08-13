import * as SQLite from "expo-sqlite";
import { parseArchiveDate } from "./lib";
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
  issueDate: string | null;
  dueDate: string | null;
  expiryDate: string | null;
};

export type CachedSortField = "createdAt" | "issueDate" | "dueDate" | "title";

type LoadDocumentsOptions = {
  query?: string;
  status?: "all" | "pending" | "processing" | "ready" | "failed";
  reviewOnly?: boolean;
  correspondentSlug?: string;
  /** Year of the issue date, or of the created date where there is none. */
  year?: number;
  dateFrom?: string;
  dateTo?: string;
  dueDateFrom?: string;
  dueDateTo?: string;
  sort?: CachedSortField;
  direction?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

const MAX_PAGE_SIZE = 100;

/**
 * The date a document is filed under: its issue date, or the day it was created
 * where it has none. `localtime` is what keeps this agreeing with the year and
 * month the derived surfaces report — a UTC date part would disagree with them
 * for anyone west of Greenwich, which is the same defect in a different place.
 */
const FILED_DATE_SQL = "coalesce(issue_date, date(created_at, 'localtime'))";

const ORDER_COLUMNS: Record<CachedSortField, string> = {
  createdAt: "created_at",
  issueDate: "issue_date",
  dueDate: "due_date",
  title: "title",
};

/**
 * Cache schema version. History:
 *   1 — the shape shipped before versioning existed: one row per cached
 *       document, denormalized columns for the filters the app offers.
 *   2 — issue, due and expiry dates as queryable columns, so the offline list
 *       can filter and sort by them instead of hiding the controls.
 *
 * A database from before this constant carries `user_version = 0` and is
 * already shape 1, so it is adopted rather than migrated. Versions above the
 * current one, or below the oldest we can migrate, are discarded: the cache is
 * a convenience copy of the archive, so re-caching is always safe and is safer
 * than reading a shape that no longer exists.
 */
export const OFFLINE_CACHE_SCHEMA_VERSION = 2;
const OLDEST_MIGRATABLE_VERSION = 1;
/** The shape a database written before `user_version` was recorded is in. */
const PRE_VERSIONING_SHAPE = 1;

/**
 * Ordered forward steps, one per version. Each `apply` upgrades a database at
 * `to - 1` to `to`, and may add columns and backfill them from `document_json`,
 * which holds the whole document. The chain is empty while the current version
 * is also the oldest; #208 adds the first real step.
 */
export type OfflineCacheMigration = {
  to: number;
  apply(db: OfflineDatabase): Promise<void>;
};

export const OFFLINE_CACHE_MIGRATIONS: OfflineCacheMigration[] = [
  {
    to: 2,
    // Backfilled from `document_json`, which already holds these values — an
    // existing cache gains working date filters without re-downloading a thing.
    apply: async (db) => {
      for (const [column, field] of [
        ["issue_date", "issueDate"],
        ["due_date", "dueDate"],
        ["expiry_date", "expiryDate"],
      ] as const) {
        await db.execAsync(`ALTER TABLE cached_documents ADD COLUMN ${column} TEXT`);
        await db.execAsync(
          `UPDATE cached_documents SET ${column} = json_extract(document_json, '$.${field}')`,
        );
      }
      await db.execAsync(DATE_INDEXES);
    },
  },
];

const SCHEMA_TABLE = `
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
      file_storage_bytes INTEGER NOT NULL DEFAULT 0,
      issue_date TEXT,
      due_date TEXT,
      expiry_date TEXT
    );
  `;

/**
 * Indexes are owned by the version that introduced their columns: a fresh
 * database gets all of them, because `SCHEMA_TABLE` creates every column, while
 * an existing one gets each version's from the step that adds those columns.
 * Indexing a column before its step has run is the failure this shape avoids.
 */
const BASE_INDEXES = `
    CREATE INDEX IF NOT EXISTS idx_cached_documents_last_viewed_at ON cached_documents(last_viewed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cached_documents_created_at ON cached_documents(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cached_documents_status ON cached_documents(status);
    CREATE INDEX IF NOT EXISTS idx_cached_documents_review_status ON cached_documents(review_status);
    CREATE INDEX IF NOT EXISTS idx_cached_documents_correspondent_slug ON cached_documents(correspondent_slug);
  `;

const DATE_INDEXES = `
    CREATE INDEX IF NOT EXISTS idx_cached_documents_issue_date ON cached_documents(issue_date);
    CREATE INDEX IF NOT EXISTS idx_cached_documents_due_date ON cached_documents(due_date);
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
      file_storage_bytes as fileStorageBytes,
      issue_date as issueDate,
      due_date as dueDate,
      expiry_date as expiryDate`;

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

/**
 * Date-only values (`YYYY-MM-DD`) mean a day, not an instant. `parseArchiveDate`
 * reads them as local days — feeding them to `new Date()` would place them at
 * UTC midnight, which is the previous day for every user west of Greenwich.
 * The display layer has always gone through it; these are the offline data
 * paths that did not.
 */
function localDate(value: string | null | undefined) {
  return parseArchiveDate(value);
}

/** The day a local date falls on, as a count of days, so DST cannot shift it. */
function dayNumber(date: Date) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

/**
 * Whole calendar days from today to `value`, counted between local day starts.
 * The millisecond difference this replaces made "due today" flip to overdue as
 * the day wore on, before any timezone was involved.
 */
function calendarDaysUntil(value: string, now: Date) {
  const due = localDate(value);
  return due ? dayNumber(due) - dayNumber(now) : null;
}

async function readSchemaVersion(db: OfflineDatabase) {
  const row = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  return row?.user_version ?? 0;
}

async function writeSchemaVersion(db: OfflineDatabase, version: number) {
  // Pragmas take no parameters, so the value is interpolated — hence the guard.
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`Refusing to record a non-integer cache schema version: ${version}`);
  }
  await db.execAsync(`PRAGMA user_version = ${version}`);
}

async function hasCacheTable(db: OfflineDatabase) {
  const row = await db.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cached_documents'",
  );
  return Boolean(row);
}

/**
 * Brings the database to the current schema version, and records it — so the
 * next open reads the current shape instead of migrating again. `CREATE TABLE
 * IF NOT EXISTS` alone can never do this: on an existing database it is a
 * no-op, which is why a column added without a migration would silently never
 * appear.
 */
export async function migrateOfflineCache(
  db: OfflineDatabase,
  {
    migrations = OFFLINE_CACHE_MIGRATIONS,
    // Always the current version in the app. Tests set it so the chain's
    // behaviour — order, and which steps are skipped — can be exercised while
    // the shipped chain is still empty.
    targetVersion = OFFLINE_CACHE_SCHEMA_VERSION,
  }: { migrations?: OfflineCacheMigration[]; targetVersion?: number } = {},
) {
  const existing = await hasCacheTable(db);
  const recorded = await readSchemaVersion(db);
  // A database written before versioning existed carries 0 and is shape 1 —
  // that specific shape, not merely "the oldest we still migrate". Conflating
  // the two would silently mislabel a version 1 database once support for it is
  // dropped, and migrate it as though it were newer than it is.
  const version = existing && recorded === 0 ? PRE_VERSIONING_SHAPE : recorded;

  const unusable =
    existing && (version > targetVersion || version < OLDEST_MIGRATABLE_VERSION);
  if (unusable) {
    await db.execAsync("DROP TABLE IF EXISTS cached_documents");
  }

  await db.execAsync(SCHEMA_TABLE);
  await db.execAsync(BASE_INDEXES);

  // A database created or replaced just now already has every column, so it
  // takes the current indexes directly instead of walking the chain.
  if (!existing || unusable) {
    await db.execAsync(DATE_INDEXES);
  }

  if (!unusable && existing) {
    for (const migration of [...migrations].sort((left, right) => left.to - right.to)) {
      if (migration.to > version && migration.to <= targetVersion) {
        await migration.apply(db);
      }
    }
  }

  await writeSchemaVersion(db, targetVersion);
  return { discarded: unusable, from: existing ? version : null };
}

export function createOfflineMetadataStore({
  openDatabase,
  migrations = OFFLINE_CACHE_MIGRATIONS,
  // "Today" decides what counts as overdue, so it is an argument rather than a
  // call to the clock inside the derivation.
  now = () => new Date(),
}: {
  openDatabase: () => Promise<OfflineDatabase>;
  migrations?: OfflineCacheMigration[];
  now?: () => Date;
}) {
  let ready: Promise<OfflineDatabase> | null = null;

  // Runs once per store rather than on every call, so a second open does no
  // migration work.
  function getDb() {
    ready ??= (async () => {
      const db = await openDatabase();
      await migrateOfflineCache(db, { migrations });
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
      file_storage_bytes,
      issue_date,
      due_date,
      expiry_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      document.issueDate ?? null,
      document.dueDate ?? null,
      document.expiryDate ?? null,
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

  function buildWhere(options?: LoadDocumentsOptions) {
    const clauses = ["1 = 1"];
    const params: OfflineSqlParam[] = [];

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

    if (options?.year) {
      clauses.push(`substr(${FILED_DATE_SQL}, 1, 4) = ?`);
      params.push(String(options.year));
    }

    // Date-only values compare correctly as strings, so this needs no parsing
    // and carries no timezone of its own.
    if (options?.dateFrom) {
      clauses.push(`${FILED_DATE_SQL} >= ?`);
      params.push(options.dateFrom);
    }

    if (options?.dateTo) {
      clauses.push(`${FILED_DATE_SQL} <= ?`);
      params.push(options.dateTo);
    }

    if (options?.dueDateFrom) {
      clauses.push("due_date >= ?");
      params.push(options.dueDateFrom);
    }

    if (options?.dueDateTo) {
      clauses.push("due_date <= ?");
      params.push(options.dueDateTo);
    }

    return { where: clauses.join(" AND "), params };
  }

  function buildOrder(options?: LoadDocumentsOptions) {
    // Without an explicit sort the list stays in the order the offline mirror
    // has always used: what you opened most recently.
    if (!options?.sort) {
      return "last_viewed_at DESC, created_at DESC, id DESC";
    }
    const column = ORDER_COLUMNS[options.sort];
    const direction = options.direction === "asc" ? "ASC" : "DESC";
    // SQLite sorts NULLs first ascending, Postgres sorts them last. Being
    // explicit is what keeps a document with no due date in the same place
    // offline as online.
    const nulls = direction === "ASC" ? "NULLS LAST" : "NULLS FIRST";
    return `${column} ${direction} ${nulls}, id DESC`;
  }

  /** One page of the offline mirror, in the shape the online endpoint returns. */
  async function searchCachedDocuments(options?: LoadDocumentsOptions) {
    const db = await getDb();
    const { where, params } = buildWhere(options);
    const page = Math.max(1, Math.trunc(options?.page ?? 1));
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(options?.pageSize ?? 30)));

    const totals = await db.getFirstAsync<{ total: number }>(
      `SELECT COUNT(*) as total FROM cached_documents WHERE ${where}`,
      ...params,
    );
    const rows = await db.getAllAsync<Pick<CachedDocumentRow, "documentJson">>(
      `SELECT document_json as documentJson
     FROM cached_documents
     WHERE ${where}
     ORDER BY ${buildOrder(options)}
     LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      (page - 1) * pageSize,
    );

    return {
      items: rows.map(rowToDocument),
      total: totals?.total ?? 0,
      page,
      pageSize,
    };
  }

  async function queryCachedDocuments(options?: LoadDocumentsOptions) {
    const db = await getDb();
    const { where, params } = buildWhere(options);
    const rows = await db.getAllAsync<Pick<CachedDocumentRow, "documentJson">>(
      `SELECT document_json as documentJson
     FROM cached_documents
     WHERE ${where}
     ORDER BY ${buildOrder(options)}`,
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
      const issued = localDate(document.issueDate ?? document.createdAt);
      if (issued) {
        const year = issued.getFullYear();
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
      // Sorting these as strings compared `YYYY-MM-DD` against full ISO
      // timestamps, so the "latest" was whichever happened to sort last.
      const latestDocDate = docs
        .map((document) => document.issueDate ?? document.createdAt)
        .reduce<string | null>((latest, value) => {
          const candidate = localDate(value);
          if (!candidate) return latest;
          const current = localDate(latest);
          return !current || candidate.getTime() > current.getTime() ? value : latest;
        }, null);

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

    const today = now();
    const deadlineItems = documents
      .filter((document) => document.dueDate && !document.taskCompletedAt)
      .map((document) => {
        const daysUntilDue = calendarDaysUntil(document.dueDate!, today) ?? 0;
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
      .sort(
        (left, right) =>
          (localDate(left.dueDate)?.getTime() ?? 0) - (localDate(right.dueDate)?.getTime() ?? 0),
      );

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
    searchCachedDocuments,
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
    const date = localDate(document.issueDate ?? document.createdAt);
    if (!date) {
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

export function searchCachedDocuments(options?: LoadDocumentsOptions) {
  return store().searchCachedDocuments(options);
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
