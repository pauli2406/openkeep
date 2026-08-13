/**
 * The file half of the offline copy, exercised against an in-memory filesystem.
 * What matters here is the cache's own flow: which endpoint it asks for, that
 * bytes land under a temporary name before moving into place, that byte counts
 * come from the response, and that two viewers opening one document download it
 * once.
 */
import { createOfflineFileCache, extensionForMime } from "../offline-file-cache";
import { createTestFileSystem, testDocument } from "./offline-test-doubles";

/** `count` bytes of body; ASCII, so one character is one byte. */
function bytes(count: number) {
  return "x".repeat(count);
}

function createCache() {
  const files = createTestFileSystem();
  return { files, cache: createOfflineFileCache({ files }) };
}

function respondWith(body: string, status = 200) {
  return jest.fn(async () => new Response(status === 200 ? body : null, { status }));
}

describe("download", () => {
  it("returns the document's bytes, and writes nothing to disk", async () => {
    const { files, cache } = createCache();
    const authFetch = respondWith(bytes(64));
    const document = testDocument();

    const result = await cache.download(authFetch, document);

    expect(authFetch).toHaveBeenCalledWith(`/api/documents/${document.id}/download`);
    expect(result.byteLength).toBe(64);
    expect(result.bytes.byteLength).toBe(64);
    expect(result.extension).toBe(".pdf");
    // The bytes go to the encrypted store; a plaintext file here is exactly what
    // #214 removed.
    expect([...files.entries.keys()].filter((key) => key.endsWith(".pdf"))).toEqual([]);
  });

  it("prefers the searchable PDF when the archive has one", async () => {
    const { cache } = createCache();
    const authFetch = respondWith(bytes(8));
    const document = testDocument({ searchablePdfAvailable: true, mimeType: "application/pdf" });

    await cache.download(authFetch, document);

    expect(authFetch).toHaveBeenCalledWith(`/api/documents/${document.id}/download/searchable`);
  });

  it("asks for the original when a searchable PDF exists but the document is not a PDF", async () => {
    const { cache } = createCache();
    const authFetch = respondWith(bytes(8));
    const document = testDocument({ searchablePdfAvailable: true, mimeType: "image/jpeg" });

    const result = await cache.download(authFetch, document);

    expect(authFetch).toHaveBeenCalledWith(`/api/documents/${document.id}/download`);
    expect(result.extension).toBe(".jpg");
  });

  it("names the file from the document's type, falling back to .bin", async () => {
    expect(extensionForMime("application/pdf")).toBe(".pdf");
    expect(extensionForMime("image/png")).toBe(".png");
    expect(extensionForMime("application/vnd.openkeep.unknown")).toBe(".bin");
  });

  it("reports the newest bytes when a document is downloaded again", async () => {
    const { cache } = createCache();
    const document = testDocument();
    await cache.download(respondWith(bytes(10)), document);

    expect((await cache.download(respondWith(bytes(20)), document)).byteLength).toBe(20);
  });

  it("fails without writing anything when the archive refuses", async () => {
    const { files, cache } = createCache();
    const document = testDocument();

    await expect(cache.download(respondWith(bytes(0), 503), document)).rejects.toThrow(
      "Download failed (503)",
    );
    expect([...files.entries.keys()].filter((key) => key.endsWith(".pdf"))).toEqual([]);
  });

  it("downloads once when two callers ask at the same time", async () => {
    const { cache } = createCache();
    const authFetch = respondWith(bytes(32));
    const document = testDocument();

    const [first, second] = await Promise.all([
      cache.download(authFetch, document),
      cache.download(authFetch, document),
    ]);

    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it("lets a later caller retry after a failed download", async () => {
    const { cache } = createCache();
    const document = testDocument();

    await expect(cache.download(respondWith(bytes(0), 500), document)).rejects.toThrow();
    await expect(cache.download(respondWith(bytes(4)), document)).resolves.toMatchObject({
      byteLength: 4,
    });
  });
});

describe("housekeeping", () => {
  it("reports a file's size, and zero when it is gone", async () => {
    const { files, cache } = createCache();
    files.seed("file:///cache/openkeep-cache/files/present.pdf", 512);

    expect(await cache.fileSize("file:///cache/openkeep-cache/files/present.pdf")).toBe(512);
    expect(await cache.fileSize("file:///cache/openkeep-cache/files/missing.pdf")).toBe(0);
    expect(await cache.fileSize(null)).toBe(0);
  });

  it("knows whether a file is there", async () => {
    const { files, cache } = createCache();
    files.seed("file:///present.pdf", 1);

    expect(await cache.exists("file:///present.pdf")).toBe(true);
    expect(await cache.exists("file:///absent.pdf")).toBe(false);
    expect(await cache.exists(null)).toBe(false);
  });

  it("deletes a file, and tolerates one that is already gone", async () => {
    const { files, cache } = createCache();
    files.seed("file:///doomed.pdf", 1);

    await cache.deleteIfExists("file:///doomed.pdf");
    await cache.deleteIfExists("file:///doomed.pdf");
    await cache.deleteIfExists(null);

    expect(files.entries.has("file:///doomed.pdf")).toBe(false);
  });

  it("keeps the files directory in place after a reset", async () => {
    const { files, cache } = createCache();
    await cache.ensureDirs();

    await cache.resetFiles();

    expect(files.entries.has(cache.filesDir)).toBe(true);
  });
});
