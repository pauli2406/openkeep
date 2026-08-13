/**
 * The byte budget for one archive's copy, and what gets evicted when it is
 * exceeded.
 *
 * `last_viewed_at` has been written and indexed since the cache was first
 * built, and until now nothing read it except an ORDER BY. This is what it was
 * for: the documents you opened longest ago are the ones to drop.
 */
import {
  OFFLINE_CACHE_DEFAULT_MAX_BYTES,
  OFFLINE_CACHE_LIMIT_CHOICES,
  createOfflineMetadataStore,
} from "../offline-metadata-store";
import { createTestDatabase, testDocument, testRecord } from "./offline-test-doubles";

function createStore() {
  const database = createTestDatabase();
  return { store: createOfflineMetadataStore({ openDatabase: async () => database }), database };
}

/** Three documents, oldest-viewed first, one megabyte of file each. */
async function seedThree(store: ReturnType<typeof createStore>["store"]) {
  const rows = [
    ["oldest", "2026-03-01T09:00:00.000Z"],
    ["middle", "2026-03-05T09:00:00.000Z"],
    ["newest", "2026-03-09T09:00:00.000Z"],
  ] as const;
  for (const [index, [title, lastViewedAt]] of rows.entries()) {
    await store.upsertCachedDocument(
      testRecord(
        testDocument({ id: `aaaaaaaa-0000-4000-8000-00000000000${index + 1}`, title }),
        {
          lastViewedAt,
          fileUri: `file:///cache/${title}.pdf`,
          fileStorageBytes: 1024 * 1024,
        },
      ),
    );
  }
}

describe("the limit", () => {
  it("defaults to a size a phone can live with", async () => {
    const { store } = createStore();
    expect(await store.getLimit()).toBe(OFFLINE_CACHE_DEFAULT_MAX_BYTES);
    expect(OFFLINE_CACHE_LIMIT_CHOICES).toContain(OFFLINE_CACHE_DEFAULT_MAX_BYTES);
  });

  it("remembers a chosen limit", async () => {
    const { store } = createStore();
    await store.setLimit(64 * 1024 * 1024);
    expect(await store.getLimit()).toBe(64 * 1024 * 1024);
  });

  it("falls back to the default when the stored value is nonsense", async () => {
    const { store, database } = createStore();
    await store.getLimit();
    await database.runAsync(
      "INSERT OR REPLACE INTO cache_settings (key, value) VALUES (?, ?)",
      "maxBytes",
      "not-a-number",
    );
    // Never to "no limit": unbounded growth is what this prevents.
    expect(await store.getLimit()).toBe(OFFLINE_CACHE_DEFAULT_MAX_BYTES);
  });

  it("refuses a limit that is not a size", async () => {
    const { store } = createStore();
    await expect(store.setLimit(0)).rejects.toThrow();
    await expect(store.setLimit(-1)).rejects.toThrow();
    expect(await store.getLimit()).toBe(OFFLINE_CACHE_DEFAULT_MAX_BYTES);
  });
});

describe("eviction", () => {
  it("does nothing while the copy fits", async () => {
    const { store } = createStore();
    await seedThree(store);

    const result = await store.enforceLimit();

    expect(result.evicted).toEqual([]);
    expect((await store.getCacheStats()).documentCount).toBe(3);
  });

  it("drops the least recently viewed until the copy fits", async () => {
    const { store } = createStore();
    await seedThree(store);

    // Two megabytes of budget for three megabytes of files.
    await store.setLimit(2 * 1024 * 1024);

    const remaining = await store.listCachedDocuments();
    expect(remaining.map((document) => document.title).sort()).toEqual(["middle", "newest"]);
    expect((await store.getCacheStats()).fileStorageBytes).toBe(2 * 1024 * 1024);
  });

  it("reports the files to delete with the rows", async () => {
    const { store } = createStore();
    await seedThree(store);

    const result = await store.setLimit(1024 * 1024);

    expect(result.evicted).toHaveLength(2);
    expect(result.files.sort()).toEqual([
      "file:///cache/middle.pdf",
      "file:///cache/oldest.pdf",
    ]);
  });

  it("takes effect the moment the limit is lowered", async () => {
    const { store } = createStore();
    await seedThree(store);
    await store.setLimit(3 * 1024 * 1024);
    expect((await store.getCacheStats()).documentCount).toBe(3);

    await store.setLimit(1024 * 1024);

    expect((await store.getCacheStats()).documentCount).toBe(1);
  });

  it("counts only file bytes, so metadata-only rows are never evicted", async () => {
    const { store } = createStore();
    await seedThree(store);
    // A document whose file was never cached: listing it costs almost nothing,
    // and evicting it would lose the ability to show what is in the copy.
    await store.upsertCachedDocument(
      testRecord(testDocument({ id: "bbbbbbbb-0000-4000-8000-000000000009", title: "nur Metadaten" }), {
        lastViewedAt: "2020-01-01T00:00:00.000Z",
        fileStorageBytes: 0,
      }),
    );

    await store.setLimit(1024 * 1024);

    const titles = (await store.listCachedDocuments()).map((document) => document.title);
    expect(titles).toContain("nur Metadaten");
  });

  it("keeps a document that is read offline", async () => {
    const { store } = createStore();
    await seedThree(store);
    // Reading the oldest copy offline makes it the newest view, so the budget
    // takes the others first. Without markViewed this document would always be
    // first out, however often it was actually used.
    await store.markViewed("aaaaaaaa-0000-4000-8000-000000000001", "2026-03-20T09:00:00.000Z");

    await store.setLimit(1024 * 1024);

    expect((await store.listCachedDocuments()).map((d) => d.title)).toEqual(["oldest"]);
  });
});
