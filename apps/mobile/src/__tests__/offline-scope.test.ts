/**
 * Which archive and account an offline copy belongs to.
 *
 * The cache was global: one database name, no owner column, and cached query
 * keys that left the archive URL out. Change the URL or sign in as someone else
 * without signing out first and the offline surfaces served the previous
 * account's documents — titles, recognised text, file bytes. These tests hold
 * the isolation to its contract, and the important one is `getCachedDocument`
 * returning null across a scope change: not a filtered-out row, no row at all.
 */
import { createOfflineFileCache } from "../offline-file-cache";
import {
  createOfflineMetadataStore,
  getCacheStats,
  getCachedDocument,
  offlineCacheScopeInUse,
  resetOfflineStores,
  searchCachedDocuments,
  setOfflineCacheScope,
  upsertCachedDocument,
} from "../offline-metadata-store";
import {
  offlineCacheDatabaseName,
  offlineCacheDirectoryName,
  offlineCacheScope,
} from "../offline-scope";
import {
  createTestDatabase,
  createTestFileSystem,
  testDocument,
  testRecord,
} from "./offline-test-doubles";

describe("naming a scope", () => {
  it("separates two accounts on the same archive", () => {
    const first = offlineCacheScope({
      apiUrl: "https://archive.example",
      userId: "11111111-1111-4111-8111-111111111111",
    });
    const second = offlineCacheScope({
      apiUrl: "https://archive.example",
      userId: "22222222-2222-4222-8222-222222222222",
    });

    expect(first).not.toBe(second);
    expect(offlineCacheDatabaseName(first!)).not.toBe(offlineCacheDatabaseName(second!));
  });

  it("separates the same account on two archives", () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    expect(offlineCacheScope({ apiUrl: "https://one.example", userId })).not.toBe(
      offlineCacheScope({ apiUrl: "https://two.example", userId })
    );
  });

  it("treats an archive URL as the same archive however it was typed", () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    expect(offlineCacheScope({ apiUrl: "https://Archive.Example", userId })).toBe(
      offlineCacheScope({ apiUrl: "https://archive.example", userId }),
    );
  });

  it("has no scope without both an archive and an account", () => {
    expect(offlineCacheScope({ apiUrl: "https://archive.example", userId: null })).toBeNull();
    expect(offlineCacheScope({ apiUrl: null, userId: "user" })).toBeNull();
    expect(offlineCacheScope({ apiUrl: "", userId: "" })).toBeNull();
  });

  it("keeps the scope usable as a file name", () => {
    const scope = offlineCacheScope({
      apiUrl: "https://archive.example:8443/base",
      userId: "11111111-1111-4111-8111-111111111111",
    })!;
    expect(scope).toMatch(/^[a-z0-9-]+$/);
    expect(offlineCacheDatabaseName(scope)).toMatch(/^openkeep-cache-[a-z0-9-]+\.db$/);
    expect(offlineCacheDirectoryName(scope)).toBe(`openkeep-cache/${scope}`);
  });
});

describe("reading across a scope change", () => {
  const alice = "aaaaaaaa-1111-4111-8111-111111111111--archive-example";
  const bob = "bbbbbbbb-2222-4222-8222-222222222222--archive-example";
  const databases = new Map<string, ReturnType<typeof createTestDatabase>>();

  beforeEach(() => {
    // One database per scope, as the app gets from `expo-sqlite` — the scope is
    // in the file name, so there is nothing to filter.
    databases.clear();
    resetOfflineStores();
    for (const scope of [alice, bob]) {
      databases.set(offlineCacheDatabaseName(scope), createTestDatabase());
    }
  });

  function storeFor(scope: string) {
    const database = databases.get(offlineCacheDatabaseName(scope))!;
    return createOfflineMetadataStore({ openDatabase: async () => database });
  }

  it("does not return one account's document to another", async () => {
    const document = testDocument({ title: "Alice's Kontoauszug" });
    await storeFor(alice).upsertCachedDocument(testRecord(document, { fileStorageBytes: 4096 }));

    const bobStore = storeFor(bob);
    expect(await bobStore.getCachedDocument(document.id)).toBeNull();
    expect(await bobStore.getCacheStats()).toMatchObject({
      documentCount: 0,
      fileStorageBytes: 0,
    });
    expect((await bobStore.searchCachedDocuments()).items).toEqual([]);
  });

  it("keeps each account's copy intact", async () => {
    await storeFor(alice).upsertCachedDocument(
      testRecord(testDocument({ id: "aaaaaaaa-0000-4000-8000-000000000001", title: "Alice" })),
    );
    await storeFor(bob).upsertCachedDocument(
      testRecord(testDocument({ id: "bbbbbbbb-0000-4000-8000-000000000002", title: "Bob" })),
    );

    expect((await storeFor(alice).listCachedDocuments()).map((d) => d.title)).toEqual(["Alice"]);
    expect((await storeFor(bob).listCachedDocuments()).map((d) => d.title)).toEqual(["Bob"]);
  });

  it("puts each account's files in its own directory", () => {
    const files = createTestFileSystem();
    const aliceCache = createOfflineFileCache({ files, scope: alice });
    const bobCache = createOfflineFileCache({ files, scope: bob });

    expect(aliceCache.filesDir).not.toBe(bobCache.filesDir);
    expect(aliceCache.filesDir).toContain(alice);
    // The unscoped directory this replaced is remembered only to delete it.
    expect(aliceCache.legacyFilesDir).toBe(`${aliceCache.rootDir}/files`);
  });
});

describe("with no account signed in", () => {
  beforeEach(() => {
    resetOfflineStores();
  });

  it("reads an empty cache rather than a shared one", async () => {
    setOfflineCacheScope(null);
    expect(offlineCacheScopeInUse()).toBeNull();

    expect(await getCachedDocument("11111111-1111-4111-8111-111111111111")).toBeNull();
    expect(await getCacheStats()).toEqual({
      documentCount: 0,
      fileStorageBytes: 0,
      lastCachedAt: null,
    });
    expect(await searchCachedDocuments()).toMatchObject({ items: [], total: 0 });
  });

  it("refuses to write, rather than write somewhere unattributable", async () => {
    setOfflineCacheScope(null);
    await expect(upsertCachedDocument(testRecord(testDocument()))).resolves.toBeUndefined();
    expect(await getCacheStats()).toMatchObject({ documentCount: 0 });
  });
});
