import * as SQLite from "expo-sqlite";
import { parseArchiveDate } from "./lib";
import { offlineCacheDatabaseName } from "./offline-scope";
import type {
  ArchiveDocument,
  DashboardInsights,
  DocumentHistoryResponse,
  DocumentTextResponse,
  FacetsResponse,
} from "./lib";

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
 * Default byte budget for one archive's copy. A phone is tighter than a laptop,
 * so this is not desktop's 1 GiB: 256 MiB holds a few hundred ordinary documents
 * and is a size a user is unlikely to notice.
 */
export const OFFLINE_CACHE_DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

export const OFFLINE_CACHE_LIMIT_CHOICES = [
  64 * 1024 * 1024,
  256 * 1024 * 1024,
  1024 * 1024 * 1024,
] as const;

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
    CREATE TABLE IF NOT EXISTS cache_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
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

/**
 * A row that cannot be decoded, told apart from one that decoded to nothing.
 * `JSON.parse` inside a `rows.map(...)` used to throw out of the whole read, so
 * one bad row took the list, the dashboard, the facets and search with it. The
 * cache is a convenience copy: dropping the row and carrying on is strictly
 * better than going dark.
 */
const DAMAGED = Symbol("damaged-cache-row");

/**
 * Enough of a shape check that a changed document contract is noticed rather
 * than rendered as undefined everywhere. It deliberately checks only what every
 * offline surface needs — id, title, and the two collections they iterate.
 */
function looksLikeDocument(value: unknown): value is ArchiveDocument {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ArchiveDocument>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    Array.isArray(candidate.tags)
  );
}

function decodeDocument(documentJson: string): ArchiveDocument | typeof DAMAGED {
  try {
    const parsed = JSON.parse(documentJson) as unknown;
    return looksLikeDocument(parsed) ? parsed : DAMAGED;
  } catch {
    return DAMAGED;
  }
}

/** Text and history are optional detail: a bad one is emptied, not fatal. */
function decodeDetail<T>(json: string, fallback: T): T {
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function rowToRecord(
  row: Pick<CachedDocumentRow, "documentJson" | "textJson" | "historyJson" | "fileUri" | "cachedAt" | "lastViewedAt" | "fileStorageBytes">,
): CachedDocumentRecord | typeof DAMAGED {
  const document = decodeDocument(row.documentJson);
  if (document === DAMAGED) {
    return DAMAGED;
  }
  return {
    document,
    text: decodeDetail<DocumentTextResponse>(row.textJson, {
      documentId: document.id,
      blocks: [],
    }),
    history: decodeDetail<DocumentHistoryResponse>(row.historyJson, {
      documentId: document.id,
      items: [],
    }),
    fileUri: row.fileUri,
    cachedAt: row.cachedAt,
    lastViewedAt: row.lastViewedAt,
    fileStorageBytes: row.fileStorageBytes,
  };
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

  let quarantined = 0;

  /**
   * Removes a row the app cannot read. The file it pointed at goes too — the
   * caller owns the filesystem, so it is reported rather than deleted here, and
   * the row is gone either way so the read can carry on.
   */
  async function quarantineRow(documentId: string) {
    quarantined += 1;
    const db = await getDb();
    const row = await db.getFirstAsync<{ fileUri: string | null }>(
      "SELECT file_uri as fileUri FROM cached_documents WHERE id = ?",
      documentId,
    );
    await db.runAsync("DELETE FROM cached_documents WHERE id = ?", documentId);
    return row?.fileUri ?? null;
  }

  /** How many rows this session had to drop, for the Offline screen's note. */
  function quarantinedCount() {
    return quarantined;
  }

  async function getCachedDocument(documentId: string) {
    const db = await getDb();
    const row = await db.getFirstAsync<CachedDocumentRow>(
      `SELECT${SELECT_ROW_COLUMNS}
     FROM cached_documents WHERE id = ?`,
      documentId,
    );
    if (!row) {
      return null;
    }
    const record = rowToRecord(row);
    if (record === DAMAGED) {
      await quarantineRow(documentId);
      return null;
    }
    return record;
  }

  /**
   * Decodes a page of rows, dropping any the app cannot read. The read that
   * triggered this still returns the documents that were fine, which is the
   * whole point: one bad row must never disable offline browsing.
   */
  async function decodeRows(rows: Array<Pick<CachedDocumentRow, "id" | "documentJson">>) {
    const documents: ArchiveDocument[] = [];
    const damaged: string[] = [];
    for (const row of rows) {
      const document = decodeDocument(row.documentJson);
      if (document === DAMAGED) {
        damaged.push(row.id);
      } else {
        documents.push(document);
      }
    }
    for (const id of damaged) {
      await quarantineRow(id);
    }
    return documents;
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
    const rows = await db.getAllAsync<Pick<CachedDocumentRow, "id" | "documentJson">>(
      `SELECT id, document_json as documentJson
     FROM cached_documents
     WHERE ${where}
     ORDER BY ${buildOrder(options)}
     LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      (page - 1) * pageSize,
    );

    return {
      items: await decodeRows(rows),
      total: totals?.total ?? 0,
      page,
      pageSize,
    };
  }

  async function queryCachedDocuments(options?: LoadDocumentsOptions) {
    const db = await getDb();
    const { where, params } = buildWhere(options);
    const rows = await db.getAllAsync<Pick<CachedDocumentRow, "id" | "documentJson">>(
      `SELECT id, document_json as documentJson
     FROM cached_documents
     WHERE ${where}
     ORDER BY ${buildOrder(options)}`,
      ...params,
    );

    return decodeRows(rows);
  }

  async function listCachedDocuments() {
    return queryCachedDocuments();
  }

  /**
   * `lastCachedAt` is read from the rows, not stamped when this runs: it is when
   * a document was last written to the cache, which survives a restart and moves
   * when a document is re-cached at the same size. Reporting the clock at read
   * time instead is what made the figure reset on every cold start.
   */
  async function getCacheStats() {
    const db = await getDb();
    const row = await db.getFirstAsync<{
      documentCount: number;
      fileStorageBytes: number;
      lastCachedAt: string | null;
    }>(
      `SELECT COUNT(*) as documentCount,
            COALESCE(SUM(file_storage_bytes), 0) as fileStorageBytes,
            MAX(cached_at) as lastCachedAt
     FROM cached_documents`,
    );

    return {
      documentCount: row?.documentCount ?? 0,
      fileStorageBytes: row?.fileStorageBytes ?? 0,
      lastCachedAt: row?.lastCachedAt ?? null,
    };
  }

  async function getCachedFileUris() {
    const db = await getDb();
    const rows = await db.getAllAsync<{ fileUri: string | null }>(
      "SELECT file_uri as fileUri FROM cached_documents WHERE file_uri IS NOT NULL",
    );
    return rows.map((row) => row.fileUri).filter(Boolean) as string[];
  }

  /**
   * Forgets a document the archive no longer has. Returns the file that has to
   * go with it, since the filesystem belongs to the caller.
   */
  async function removeCachedDocument(documentId: string) {
    const db = await getDb();
    const row = await db.getFirstAsync<{ fileUri: string | null }>(
      "SELECT file_uri as fileUri FROM cached_documents WHERE id = ?",
      documentId,
    );
    await db.runAsync("DELETE FROM cached_documents WHERE id = ?", documentId);
    return row?.fileUri ?? null;
  }

  /**
   * Zeroes the recorded bytes for a file that is no longer on disk. The read
   * path already noticed and told the caller the file was gone, but the row kept
   * its byte count, so the Offline screen went on reporting storage that had
   * been freed.
   */
  async function correctFileAccounting(documentId: string) {
    const db = await getDb();
    await db.runAsync(
      "UPDATE cached_documents SET file_uri = NULL, file_storage_bytes = 0 WHERE id = ?",
      documentId,
    );
  }

  const MAX_BYTES_KEY = "maxBytes";

  /**
   * The byte budget for this copy. An unreadable or nonsensical stored value
   * falls back to the default, never to no limit — unbounded growth is the
   * failure this exists to prevent.
   */
  async function getLimit() {
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM cache_settings WHERE key = ?",
      MAX_BYTES_KEY,
    );
    const parsed = Number.parseInt(row?.value ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : OFFLINE_CACHE_DEFAULT_MAX_BYTES;
  }

  async function setLimit(maxBytes: number) {
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
      throw new Error(`Refusing a cache limit of ${maxBytes} bytes`);
    }
    const db = await getDb();
    await db.runAsync(
      "INSERT OR REPLACE INTO cache_settings (key, value) VALUES (?, ?)",
      MAX_BYTES_KEY,
      String(Math.trunc(maxBytes)),
    );
    // Lowering the limit has to take effect now, not at the next download.
    return enforceLimit();
  }

  /**
   * Evicts least-recently-viewed documents until the copy fits its budget, and
   * reports the files the caller has to delete. `last_viewed_at` is the signal
   * the schema has always recorded and never used; this is what it is for.
   *
   * Only file bytes count against the limit — row JSON is small, and a limit
   * that evicted metadata would lose the ability to list what was cached.
   */
  async function enforceLimit() {
    const db = await getDb();
    const maxBytes = await getLimit();
    const totals = await db.getFirstAsync<{ total: number }>(
      "SELECT COALESCE(SUM(file_storage_bytes), 0) as total FROM cached_documents",
    );
    let used = totals?.total ?? 0;
    if (used <= maxBytes) {
      return { evicted: [] as string[], files: [] as string[] };
    }

    const candidates = await db.getAllAsync<{
      id: string;
      fileUri: string | null;
      fileStorageBytes: number;
    }>(
      `SELECT id, file_uri as fileUri, file_storage_bytes as fileStorageBytes
       FROM cached_documents
       WHERE file_storage_bytes > 0
       ORDER BY last_viewed_at ASC, created_at ASC`,
    );

    const evicted: string[] = [];
    const files: string[] = [];
    for (const candidate of candidates) {
      if (used <= maxBytes) {
        break;
      }
      await db.runAsync("DELETE FROM cached_documents WHERE id = ?", candidate.id);
      used -= candidate.fileStorageBytes;
      evicted.push(candidate.id);
      if (candidate.fileUri) {
        files.push(candidate.fileUri);
      }
    }

    return { evicted, files };
  }

  /** Records that a document was actually looked at, which is what eviction reads. */
  async function markViewed(documentId: string, viewedAt: string) {
    const db = await getDb();
    await db.runAsync(
      "UPDATE cached_documents SET last_viewed_at = ? WHERE id = ?",
      viewedAt,
      documentId,
    );
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
    quarantineRow,
    quarantinedCount,
    removeCachedDocument,
    correctFileAccounting,
    getLimit,
    setLimit,
    enforceLimit,
    markViewed,
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

/**
 * One store per scope, over the device database. Everything above is reachable
 * with any handle; this is the single place that names `expo-sqlite`.
 *
 * Without a scope there is no store — not a shared one. An unscoped fallback is
 * exactly what let one account read another's documents, so the reads below
 * answer empty instead, and the writes refuse.
 */
const stores = new Map<string, OfflineMetadataStore>();
let currentScope: string | null = null;

export function setOfflineCacheScope(scope: string | null) {
  currentScope = scope;
}

export function offlineCacheScopeInUse() {
  return currentScope;
}

/** Forgets the in-memory handles; the databases themselves are untouched. */
export function resetOfflineStores() {
  stores.clear();
  currentScope = null;
}

function store(): OfflineMetadataStore | null {
  if (!currentScope) {
    return null;
  }
  let scoped = stores.get(currentScope);
  if (!scoped) {
    const name = offlineCacheDatabaseName(currentScope);
    scoped = createOfflineMetadataStore({
      openDatabase: () => SQLite.openDatabaseAsync(name),
    });
    stores.set(currentScope, scoped);
  }
  return scoped;
}

const EMPTY_STATS = { documentCount: 0, fileStorageBytes: 0, lastCachedAt: null };
const EMPTY_PAGE = { items: [], total: 0, page: 1, pageSize: 30 };
const EMPTY_FACETS: FacetsResponse = {
  correspondents: [],
  documentTypes: [],
  tags: [],
  statuses: [],
  years: [],
};
const EMPTY_DASHBOARD: DashboardInsights = {
  stats: {
    totalDocuments: 0,
    pendingReview: 0,
    documentTypesCount: 0,
    correspondentsCount: 0,
  },
  recentDocuments: [],
  topCorrespondents: [],
  upcomingDeadlines: [],
  overdueItems: [],
  monthlyActivity: [],
};

export function upsertCachedDocument(record: CachedDocumentRecord) {
  // Refusing beats writing into a cache nobody can attribute to an account.
  return store()?.upsertCachedDocument(record) ?? Promise.resolve();
}

export function getCachedDocument(documentId: string) {
  return store()?.getCachedDocument(documentId) ?? Promise.resolve(null);
}

export function searchCachedDocuments(options?: LoadDocumentsOptions) {
  return store()?.searchCachedDocuments(options) ?? Promise.resolve(EMPTY_PAGE);
}

export function queryCachedDocuments(options?: LoadDocumentsOptions) {
  return store()?.queryCachedDocuments(options) ?? Promise.resolve([]);
}

export function listCachedDocuments() {
  return store()?.listCachedDocuments() ?? Promise.resolve([]);
}

export function getCacheStats() {
  return store()?.getCacheStats() ?? Promise.resolve(EMPTY_STATS);
}

export function getCachedFileUris() {
  return store()?.getCachedFileUris() ?? Promise.resolve([]);
}

export function removeCachedDocument(documentId: string) {
  return store()?.removeCachedDocument(documentId) ?? Promise.resolve(null);
}

export function correctFileAccounting(documentId: string) {
  return store()?.correctFileAccounting(documentId) ?? Promise.resolve();
}

export function getCacheLimit() {
  return store()?.getLimit() ?? Promise.resolve(OFFLINE_CACHE_DEFAULT_MAX_BYTES);
}

export function setCacheLimit(maxBytes: number) {
  return (
    store()?.setLimit(maxBytes) ?? Promise.resolve({ evicted: [] as string[], files: [] as string[] })
  );
}

export function enforceCacheLimit() {
  return (
    store()?.enforceLimit() ?? Promise.resolve({ evicted: [] as string[], files: [] as string[] })
  );
}

export function markCachedDocumentViewed(documentId: string, viewedAt: string) {
  return store()?.markViewed(documentId, viewedAt) ?? Promise.resolve();
}

export function quarantinedCount() {
  return store()?.quarantinedCount() ?? 0;
}

export function clearCachedDocumentRows() {
  return store()?.clearCachedDocumentRows() ?? Promise.resolve();
}

export function buildCachedFacets() {
  return store()?.buildCachedFacets() ?? Promise.resolve(EMPTY_FACETS);
}

export function buildCachedDashboard() {
  return store()?.buildCachedDashboard() ?? Promise.resolve(EMPTY_DASHBOARD);
}
