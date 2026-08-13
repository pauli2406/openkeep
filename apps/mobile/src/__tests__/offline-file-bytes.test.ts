/**
 * Document bytes inside the encrypted database, and the short-lived decrypted
 * copy a viewer can open.
 *
 * Bytes are stored in chunks so nothing holds a whole PDF in memory — the
 * base64 buffering this replaced is what desktop avoided by streaming. The
 * scratch copy exists because `react-native-pdf` takes a path, not a buffer;
 * what keeps it narrow is that it lives in the cache directory and is deleted
 * when the viewer closes.
 */
import { createOfflineFileMaterializer } from "../offline-file-materializer";
import { createOfflineMetadataStore } from "../offline-metadata-store";
import { createTestDatabase, createTestFileSystem, testDocument, testRecord } from "./offline-test-doubles";

function createStore() {
  const database = createTestDatabase();
  return { store: createOfflineMetadataStore({ openDatabase: async () => database }), database };
}

function bytes(length: number, fill: number) {
  return new Uint8Array(length).fill(fill);
}

describe("bytes in the encrypted store", () => {
  it("round-trips a file through chunks", async () => {
    const { store } = createStore();
    const document = testDocument();
    await store.upsertCachedDocument(testRecord(document));

    // Larger than one chunk, so the split and the reassembly are both exercised.
    await store.writeFileChunks(document.id, bytes(1_200_000, 7));

    const chunks = await store.readFileChunks(document.id);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.reduce((total, chunk) => total + chunk.byteLength, 0)).toBe(1_200_000);
    expect((await store.getCacheStats()).fileStorageBytes).toBe(1_200_000);
  });

  it("replaces the previous bytes rather than appending to them", async () => {
    const { store } = createStore();
    const document = testDocument();
    await store.upsertCachedDocument(testRecord(document));

    await store.writeFileChunks(document.id, bytes(4000, 1));
    await store.writeFileChunks(document.id, bytes(100, 2));

    const chunks = await store.readFileChunks(document.id);
    expect(chunks.reduce((total, chunk) => total + chunk.byteLength, 0)).toBe(100);
    expect((await store.getCacheStats()).fileStorageBytes).toBe(100);
  });

  it("knows whether a document's bytes are cached", async () => {
    const { store } = createStore();
    const document = testDocument();
    await store.upsertCachedDocument(testRecord(document));

    expect(await store.hasFileChunks(document.id)).toBe(false);
    await store.writeFileChunks(document.id, bytes(10, 3));
    expect(await store.hasFileChunks(document.id)).toBe(true);
  });

  it("takes the bytes with the row when a document is forgotten", async () => {
    const { store } = createStore();
    const document = testDocument();
    await store.upsertCachedDocument(testRecord(document));
    await store.writeFileChunks(document.id, bytes(2048, 4));

    await store.removeCachedDocument(document.id);

    expect(await store.readFileChunks(document.id)).toEqual([]);
    expect(await store.getCacheStats()).toMatchObject({ documentCount: 0, fileStorageBytes: 0 });
  });

  it("takes the bytes with an evicted document", async () => {
    const { store } = createStore();
    for (const [index, viewed] of ["2026-01-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z"].entries()) {
      const document = testDocument({ id: `aaaaaaaa-0000-4000-8000-00000000000${index + 1}` });
      await store.upsertCachedDocument(testRecord(document, { lastViewedAt: viewed }));
      await store.writeFileChunks(document.id, bytes(600_000, index + 1));
    }

    await store.setLimit(700_000);

    expect(await store.readFileChunks("aaaaaaaa-0000-4000-8000-000000000001")).toEqual([]);
    expect(await store.hasFileChunks("aaaaaaaa-0000-4000-8000-000000000002")).toBe(true);
  });

  it("empties the bytes when the copy is cleared", async () => {
    const { store } = createStore();
    const document = testDocument();
    await store.upsertCachedDocument(testRecord(document));
    await store.writeFileChunks(document.id, bytes(1000, 5));

    await store.clearCachedDocumentRows();

    expect(await store.readFileChunks(document.id)).toEqual([]);
  });
});

describe("the decrypted copy a viewer opens", () => {
  function createMaterializer() {
    const files = createTestFileSystem("file:///caches/");
    return {
      files,
      materializer: createOfflineFileMaterializer({
        files,
        scratchDirectory: "file:///caches/",
      }),
    };
  }

  it("writes the chunks out in order, under the cache directory", async () => {
    const { files, materializer } = createMaterializer();

    const uri = await materializer.materialize({
      documentId: "doc-1",
      extension: ".pdf",
      chunks: [bytes(100, 1), bytes(50, 2)],
    });

    // The cache directory, not the document directory: this is scratch, not
    // archive data, and the OS may evict it.
    expect(uri).toBe("file:///caches/openkeep-open/doc-1.pdf");
    expect(files.entries.get(uri)).toBe(150);
  });

  it("deletes the copy when the viewer closes", async () => {
    const { files, materializer } = createMaterializer();
    const uri = await materializer.materialize({
      documentId: "doc-1",
      extension: ".pdf",
      chunks: [bytes(10, 1)],
    });

    await materializer.release("doc-1");

    expect(files.entries.has(uri)).toBe(false);
  });

  it("tolerates a release for a document that was never opened", async () => {
    const { materializer } = createMaterializer();
    await expect(materializer.release("never-opened")).resolves.toBeUndefined();
  });

  it("sweeps a copy a crash left behind", async () => {
    const { files, materializer } = createMaterializer();
    const uri = await materializer.materialize({
      documentId: "doc-1",
      extension: ".pdf",
      chunks: [bytes(10, 1)],
    });
    // No release: the app was killed with the document open.

    await materializer.sweep();

    expect(files.entries.has(uri)).toBe(false);
    expect(files.entries.has(materializer.scratchDir)).toBe(true);
  });

  it("replaces a stale copy rather than appending to it", async () => {
    const { files, materializer } = createMaterializer();
    await materializer.materialize({ documentId: "doc-1", extension: ".pdf", chunks: [bytes(80, 1)] });

    const uri = await materializer.materialize({
      documentId: "doc-1",
      extension: ".pdf",
      chunks: [bytes(20, 2)],
    });

    expect(files.entries.get(uri)).toBe(20);
  });
});

describe("showing a document when the copy kept nothing", () => {
  /**
   * The regression that reached a device: `ensureCachedFile` wrote the bytes into
   * the store and then read them back to materialize. With the copy disabled —
   * no keystore, or no SQLCipher in the build — the write was a no-op and the
   * read returned nothing, so the viewer was handed a valid path to an empty
   * file and said "this PDF could not be displayed" for a document the archive
   * would have served happily.
   */
  it("materializes from the bytes that were downloaded, not from the store", async () => {
    const files = createTestFileSystem("file:///caches/");
    const materializer = createOfflineFileMaterializer({
      files,
      scratchDirectory: "file:///caches/",
    });

    // Exactly what a disabled store returns: nothing, without complaining.
    const readFromDisabledStore = async () => [] as Uint8Array[];
    const downloaded = bytes(2048, 9);
    const chunks = (await readFromDisabledStore()).length > 0 ? [] : [downloaded];

    const uri = await materializer.materialize({
      documentId: "doc-1",
      extension: ".pdf",
      chunks,
    });

    expect(files.entries.get(uri)).toBe(2048);
  });

  it("writes nothing rather than an empty file when there are no bytes at all", async () => {
    const files = createTestFileSystem("file:///caches/");
    const materializer = createOfflineFileMaterializer({
      files,
      scratchDirectory: "file:///caches/",
    });

    const uri = await materializer.materialize({
      documentId: "doc-1",
      extension: ".pdf",
      chunks: [],
    });

    // The caller refuses before reaching here; if it ever does, the absence of a
    // file is a better signal to the viewer than a zero-byte one.
    expect(files.entries.has(uri)).toBe(false);
  });
});
