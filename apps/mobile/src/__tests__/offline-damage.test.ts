/**
 * What the offline copy does when it is damaged, when a file has gone missing,
 * and when the archive says a document no longer exists.
 *
 * The load-bearing test is the first one: `JSON.parse` inside a `rows.map(...)`
 * used to throw out of the whole read, so a single undecodable row took the
 * list, the dashboard, the facets and search down together. One bad row must
 * never disable offline browsing.
 */
import { createOfflineMetadataStore } from "../offline-metadata-store";
import { createTestDatabase, testDocument, testRecord } from "./offline-test-doubles";

function createStore() {
  const database = createTestDatabase();
  const store = createOfflineMetadataStore({ openDatabase: async () => database });
  return { store, database };
}

async function seedGoodAndBad() {
  const { store, database } = createStore();
  const good = testDocument({ id: "aaaaaaaa-0000-4000-8000-000000000001", title: "Lesbar" });
  await store.upsertCachedDocument(testRecord(good, { fileStorageBytes: 100 }));

  const broken = testDocument({ id: "bbbbbbbb-0000-4000-8000-000000000002", title: "Kaputt" });
  await store.upsertCachedDocument(testRecord(broken, { fileStorageBytes: 200 }));
  // Truncated JSON, as a half-finished write or a corrupt page would leave it.
  await database.runAsync(
    "UPDATE cached_documents SET document_json = ? WHERE id = ?",
    '{"id":"bbbbbbbb-0000-4000-8000-000000000002","tit',
    broken.id,
  );

  return { store, database, good, broken };
}

describe("a row that cannot be decoded", () => {
  it("leaves the rest of the list readable", async () => {
    const { store, good } = await seedGoodAndBad();

    const page = await store.searchCachedDocuments();

    expect(page.items.map((document) => document.title)).toEqual(["Lesbar"]);
    expect(page.items.map((document) => document.id)).toEqual([good.id]);
  });

  it("leaves the dashboard, the facets and search working", async () => {
    const { store } = await seedGoodAndBad();

    expect((await store.buildCachedDashboard()).stats.totalDocuments).toBe(1);
    expect((await store.buildCachedFacets()).statuses).toEqual([{ status: "ready", count: 1 }]);
    expect((await store.searchCachedDocuments({ query: "lesbar" })).items).toHaveLength(1);
  });

  it("drops the row, so the next read does not trip over it again", async () => {
    const { store, broken } = await seedGoodAndBad();

    await store.searchCachedDocuments();

    expect(await store.getCachedDocument(broken.id)).toBeNull();
    expect((await store.getCacheStats()).documentCount).toBe(1);
    expect(store.quarantinedCount()).toBe(1);
  });

  it("counts what it dropped, so a gap in the copy is explainable", async () => {
    const { store } = await seedGoodAndBad();
    expect(store.quarantinedCount()).toBe(0);
    await store.searchCachedDocuments();
    expect(store.quarantinedCount()).toBe(1);
  });

  it("drops a row whose document is valid JSON but the wrong shape", async () => {
    const { store, database } = createStore();
    const document = testDocument();
    await store.upsertCachedDocument(testRecord(document));
    // A contract change would look like this: parses, but is not a document.
    await database.runAsync(
      "UPDATE cached_documents SET document_json = ? WHERE id = ?",
      '{"unexpected":"shape"}',
      document.id,
    );

    expect((await store.searchCachedDocuments()).items).toEqual([]);
    expect(store.quarantinedCount()).toBe(1);
  });

  it("keeps a document whose text or history is unreadable", async () => {
    // Text and history are detail, not identity: emptying them beats dropping
    // the document and its file.
    const { store, database } = createStore();
    const document = testDocument({ title: "Noch da" });
    await store.upsertCachedDocument(testRecord(document, { text: ["Zählernummer 4711"] }));
    await database.runAsync(
      "UPDATE cached_documents SET text_json = ?, history_json = ? WHERE id = ?",
      "{not json",
      "{not json",
      document.id,
    );

    const cached = await store.getCachedDocument(document.id);
    expect(cached?.document.title).toBe("Noch da");
    expect(cached?.text.blocks).toEqual([]);
    expect(cached?.history.items).toEqual([]);
    expect(store.quarantinedCount()).toBe(0);
  });
});

describe("a document the archive no longer has", () => {
  it("is forgotten, and reports the file to delete with it", async () => {
    const { store } = createStore();
    const document = testDocument();
    await store.upsertCachedDocument(
      testRecord(document, { fileUri: "file:///cache/doc.pdf", fileStorageBytes: 512 }),
    );

    const fileUri = await store.removeCachedDocument(document.id);

    expect(fileUri).toBe("file:///cache/doc.pdf");
    expect(await store.getCachedDocument(document.id)).toBeNull();
    expect(await store.getCacheStats()).toMatchObject({ documentCount: 0, fileStorageBytes: 0 });
  });

  it("is a no-op for a document that was never cached", async () => {
    const { store } = createStore();
    await expect(store.removeCachedDocument("11111111-1111-4111-8111-111111111111")).resolves.toBeNull();
  });
});

describe("a file that has gone missing", () => {
  it("stops the copy reporting storage that was already freed", async () => {
    const { store } = createStore();
    const document = testDocument();
    await store.upsertCachedDocument(
      testRecord(document, { fileUri: "file:///cache/gone.pdf", fileStorageBytes: 4096 }),
    );
    expect((await store.getCacheStats()).fileStorageBytes).toBe(4096);

    await store.correctFileAccounting(document.id);

    expect(await store.getCacheStats()).toMatchObject({
      documentCount: 1,
      fileStorageBytes: 0,
    });
    // The document itself stays: its metadata and text are still worth having.
    expect((await store.getCachedDocument(document.id))?.fileUri).toBeNull();
  });
});
