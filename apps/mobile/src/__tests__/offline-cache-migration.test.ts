/**
 * The cache schema's version and migration chain.
 *
 * `CREATE TABLE IF NOT EXISTS` is a no-op on a database that already has the
 * table, so before this existed a new column would simply never appear on an
 * upgraded install — the failure being that offline filters would go on missing
 * data with no error anywhere. These tests hold the chain to its contract:
 * upgrade in place, record the version, run once, and discard rather than guess
 * at a shape it does not know.
 */
import {
  OFFLINE_CACHE_SCHEMA_VERSION,
  createOfflineMetadataStore,
  migrateOfflineCache,
  type OfflineCacheMigration,
  type OfflineDatabase,
} from "../offline-metadata-store";
import { createTestDatabase, testDocument } from "./offline-test-doubles";

/** The shape the app shipped before versioning: no `user_version`, no `tags` column. */
const PRE_VERSIONING_SCHEMA = `
  CREATE TABLE cached_documents (
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
`;

async function version(db: OfflineDatabase) {
  const row = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  return row?.user_version ?? 0;
}

async function seedExistingInstall(db: OfflineDatabase, title = "Stromrechnung") {
  await db.execAsync(PRE_VERSIONING_SCHEMA);
  const document = testDocument({ title });
  await db.runAsync(
    `INSERT INTO cached_documents (
      id, document_json, text_json, history_json, file_uri, cached_at, last_viewed_at,
      created_at, updated_at, status, review_status, search_text, file_storage_bytes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    document.id,
    JSON.stringify(document),
    JSON.stringify({ documentId: document.id, blocks: [] }),
    JSON.stringify({ documentId: document.id, items: [] }),
    null,
    "2026-03-04T09:00:00.000Z",
    "2026-03-04T09:00:00.000Z",
    document.createdAt,
    document.updatedAt,
    document.status,
    document.reviewStatus,
    title.toLowerCase(),
    0,
  );
  return document;
}

describe("opening a database", () => {
  it("records the current version on a fresh install", async () => {
    const db = createTestDatabase();
    await migrateOfflineCache(db);
    expect(await version(db)).toBe(OFFLINE_CACHE_SCHEMA_VERSION);
  });

  it("adopts a database written before versioning, keeping what it cached", async () => {
    const db = createTestDatabase();
    const document = await seedExistingInstall(db);
    expect(await version(db)).toBe(0);

    const result = await migrateOfflineCache(db);

    expect(result).toEqual({ discarded: false, from: 1 });
    expect(await version(db)).toBe(OFFLINE_CACHE_SCHEMA_VERSION);
    const store = createOfflineMetadataStore({ openDatabase: async () => db });
    expect((await store.getCachedDocument(document.id))?.document.title).toBe("Stromrechnung");
  });

  it("migrates once, and not again on the next open", async () => {
    const db = createTestDatabase();
    await seedExistingInstall(db);
    const applied: number[] = [];
    const migrations: OfflineCacheMigration[] = [
      { to: 1, apply: async () => void applied.push(1) },
    ];

    const store = createOfflineMetadataStore({ openDatabase: async () => db, migrations });
    await store.getCacheStats();
    await store.getCacheStats();
    await migrateOfflineCache(db, { migrations });

    // Version 1 is what the database already is, so its step never runs — and a
    // second open finds the version recorded and has nothing to do.
    expect(applied).toEqual([]);
    expect(await version(db)).toBe(OFFLINE_CACHE_SCHEMA_VERSION);
  });

  it("discards a database from a newer version of the app", async () => {
    const db = createTestDatabase();
    const document = await seedExistingInstall(db);
    await db.execAsync("PRAGMA user_version = 99");

    const result = await migrateOfflineCache(db);

    expect(result).toEqual({ discarded: true, from: 99 });
    expect(await version(db)).toBe(OFFLINE_CACHE_SCHEMA_VERSION);
    const store = createOfflineMetadataStore({ openDatabase: async () => db });
    // Nothing was read out of a shape this version cannot know; the copy is
    // simply gone, and re-caches as documents are opened.
    expect(await store.getCachedDocument(document.id)).toBeNull();
    expect(await store.getCacheStats()).toEqual({ documentCount: 0, fileStorageBytes: 0 });
  });
});

describe("the migration chain", () => {
  it("runs the steps a database is behind, in order, and no others", async () => {
    const db = createTestDatabase();
    await seedExistingInstall(db);
    await db.execAsync("PRAGMA user_version = 1");
    const applied: number[] = [];
    const migrations: OfflineCacheMigration[] = [
      { to: 4, apply: async () => void applied.push(4) },
      { to: 2, apply: async () => void applied.push(2) },
      { to: 3, apply: async () => void applied.push(3) },
    ];

    await migrateOfflineCache(db, { migrations, targetVersion: 3 });

    // Declaration order does not matter; version order does. The step for 4 is
    // ahead of this build and must not run early.
    expect(applied).toEqual([2, 3]);
    expect(await version(db)).toBe(3);
  });

  it("skips a step a database already has", async () => {
    const db = createTestDatabase();
    await seedExistingInstall(db);
    await db.execAsync("PRAGMA user_version = 2");
    const applied: number[] = [];

    await migrateOfflineCache(db, {
      migrations: [
        { to: 2, apply: async () => void applied.push(2) },
        { to: 3, apply: async () => void applied.push(3) },
      ],
      targetVersion: 3,
    });

    expect(applied).toEqual([3]);
  });

  it("adds a column and backfills it from the cached document", async () => {
    // The shape of the step #208 will ship: add a column, populate it from
    // `document_json`, and leave the cache readable.
    const db = createTestDatabase();
    const document = await seedExistingInstall(db);
    const migrations: OfflineCacheMigration[] = [
      {
        to: 2,
        apply: async (database) => {
          await database.execAsync("ALTER TABLE cached_documents ADD COLUMN issue_date TEXT");
          await database.execAsync(
            "UPDATE cached_documents SET issue_date = json_extract(document_json, '$.issueDate')",
          );
        },
      },
    ];

    await migrateOfflineCache(db, { migrations, targetVersion: 2 });

    const row = await db.getFirstAsync<{ issueDate: string | null }>(
      "SELECT issue_date as issueDate FROM cached_documents WHERE id = ?",
      document.id,
    );
    expect(row?.issueDate).toBe(document.issueDate);
    expect(await version(db)).toBe(2);

    // A second open must not try to add the column again.
    await expect(migrateOfflineCache(db, { migrations, targetVersion: 2 })).resolves.toEqual({
      discarded: false,
      from: 2,
    });
  });

  it("keeps a cache the app can no longer read out of the app's hands", async () => {
    const db = createTestDatabase();
    await seedExistingInstall(db);
    await db.execAsync("PRAGMA user_version = 1");

    // A build whose oldest migratable version has moved past 1 discards it
    // rather than migrate from a shape it no longer describes. Simulated here
    // by asking for a target below what the database claims.
    const result = await migrateOfflineCache(db, { targetVersion: 0 });

    expect(result.discarded).toBe(true);
    expect(await version(db)).toBe(0);
  });
});
