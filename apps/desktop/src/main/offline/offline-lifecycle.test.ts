import { PassThrough, type Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { SecureStorageUnavailableError } from "../storage/safe-storage-cipher";
import type { CredentialCipher } from "../storage/types";
import { encryptBuffer } from "./cache-cipher";
import { OFFLINE_CACHE_DEFAULT_MAX_BYTES } from "../../shared/desktop-api";
import {
  createOfflineCacheStore,
  migrateIndexRows,
  OFFLINE_CACHE_VERSION,
  type OfflineCacheFileSystem,
} from "./offline-cache-store";
import { createOfflineReadThrough } from "./read-through";

const DOC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DOC_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function fakeCredentialCipher(available = true): CredentialCipher {
  return {
    assertAvailable: () => {
      if (!available) throw new SecureStorageUnavailableError();
    },
    encrypt: (plaintext) => Buffer.from([...Buffer.from(plaintext)].reverse()),
    decrypt: (ciphertext) => Buffer.from([...ciphertext].reverse()).toString(),
  };
}

function memoryFileSystem() {
  const files = new Map<string, Buffer>();
  const fileSystem: OfflineCacheFileSystem = {
    mkdir: async () => undefined,
    readFile: async (filePath) => {
      const contents = files.get(filePath);
      if (!contents) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return contents;
    },
    writeFile: async (filePath, contents) => {
      files.set(filePath, Buffer.from(contents));
    },
    rename: async (from, to) => {
      files.set(to, files.get(from)!);
      files.delete(from);
    },
    readdir: async (directory) => {
      const prefix = `${directory}/`;
      return [...files.keys()]
        .filter((name) => name.startsWith(prefix))
        .map((name) => name.slice(prefix.length))
        .filter((name) => !name.includes("/"));
    },
    unlink: async (filePath) => {
      files.delete(filePath);
    },
    createWriteStream: (filePath): Writable => {
      const chunks: Buffer[] = [];
      const sink = new PassThrough();
      sink.on("data", (chunk: Buffer) => chunks.push(chunk));
      sink.on("finish", () => files.set(filePath, Buffer.concat(chunks)));
      return sink;
    },
  };
  return { files, fileSystem };
}

function document(id: string, title = "Dokument") {
  return {
    id,
    title,
    createdAt: "2026-08-01T10:00:00.000Z",
    issueDate: "2026-08-01",
    status: "ready",
    reviewStatus: "not_required",
    mimeType: "application/pdf",
    correspondent: { id: "c-1", name: "Stadtwerke", slug: "stadtwerke" },
    documentType: { id: "t-1", name: "Invoice", slug: "invoice" },
  };
}

async function createOpenStore(fileSystem?: OfflineCacheFileSystem) {
  const memory = memoryFileSystem();
  let sequence = 0;
  let clock = 1_000;
  const store = createOfflineCacheStore({
    rootDirectory: "/cache/profile-home",
    credentialCipher: fakeCredentialCipher(),
    fileSystem: fileSystem ?? memory.fileSystem,
    now: () => clock,
    createTemporaryId: () => `tmp-${++sequence}`,
  });
  await store.open();
  return {
    store,
    memory,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

function webStream(content: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.from(content));
      controller.close();
    },
  });
}

describe("disk limit and eviction", () => {
  it("defaults to a real limit rather than unbounded growth", async () => {
    const { store } = await createOpenStore();
    expect(store.limit()).toBe(OFFLINE_CACHE_DEFAULT_MAX_BYTES);
  });

  it("evicts least-recently-viewed documents, record and file together", async () => {
    const { store, advance } = await createOpenStore();
    // Three documents, opened in order A, B, C — A is the coldest.
    for (const [id, delay] of [
      [DOC_A, 0],
      [DOC_B, 1_000],
      [DOC_C, 1_000],
    ] as const) {
      advance(delay);
      await store.upsertDocument(document(id));
      await store.cacheFileStream(id, "original", webStream("x".repeat(400)));
    }
    expect(store.summary().fileStorageBytes).toBe(1_200);

    await store.setLimit(900);

    const remaining = store.listColumns().map((row) => row.id);
    expect(remaining).not.toContain(DOC_A);
    expect(remaining).toContain(DOC_C);
    expect(store.summary().fileStorageBytes).toBeLessThanOrEqual(900);
    await expect(store.loadRecord(DOC_A)).resolves.toBeNull();
  });

  it("enforces the limit as new files arrive", async () => {
    const { store, advance } = await createOpenStore();
    await store.setLimit(700);
    await store.upsertDocument(document(DOC_A));
    await store.cacheFileStream(DOC_A, "original", webStream("x".repeat(400)));
    advance(1_000);
    await store.upsertDocument(document(DOC_B));
    await store.cacheFileStream(DOC_B, "original", webStream("y".repeat(400)));

    // A alone no longer fits beside B; the colder A was evicted.
    expect(store.listColumns().map((row) => row.id)).toEqual([DOC_B]);
    expect(store.summary().fileStorageBytes).toBe(400);
  });

  it("persists the limit across restarts and resets it with a clear", async () => {
    const memory = memoryFileSystem();
    const first = await createOpenStore(memory.fileSystem);
    await first.store.setLimit(512 * 1024 * 1024);
    await first.store.idle();

    const second = await createOpenStore(memory.fileSystem);
    expect(second.store.limit()).toBe(512 * 1024 * 1024);

    await second.store.clear();
    expect(second.store.limit()).toBe(OFFLINE_CACHE_DEFAULT_MAX_BYTES);
  });
});

describe("corruption recovery", () => {
  it("quarantines a damaged record on sight and keeps browsing alive", async () => {
    const memory = memoryFileSystem();
    const { store } = await createOpenStore(memory.fileSystem);
    await store.upsertDocument(document(DOC_A));
    await store.upsertDocument(document(DOC_B, "Zweites"));
    memory.files.set(`/cache/profile-home/records/${DOC_A}`, Buffer.from("rot"));

    await expect(store.loadRecord(DOC_A)).resolves.toBeNull();

    // Row, record, and file are gone together; the rest is untouched.
    expect(store.listColumns().map((row) => row.id)).toEqual([DOC_B]);
    expect(store.quarantinedThisSession()).toBe(1);
    expect(memory.files.has(`/cache/profile-home/records/${DOC_A}`)).toBe(false);
  });

  it("corrects the accounting when file bytes vanish or rot", async () => {
    const memory = memoryFileSystem();
    const { store } = await createOpenStore(memory.fileSystem);
    await store.upsertDocument(document(DOC_A));
    await store.cacheFileStream(DOC_A, "original", webStream("%PDF-bytes"));
    expect(store.summary().fileStorageBytes).toBeGreaterThan(0);

    memory.files.delete(`/cache/profile-home/files/${DOC_A}`);
    await expect(store.readFile(DOC_A)).resolves.toBeNull();
    expect(store.summary().fileStorageBytes).toBe(0);

    await store.cacheFileStream(DOC_A, "original", webStream("%PDF-bytes"));
    memory.files.set(`/cache/profile-home/files/${DOC_A}`, Buffer.from("rot"));
    await expect(store.readFile(DOC_A)).resolves.toBeNull();
    expect(store.summary().fileStorageBytes).toBe(0);
    expect(store.quarantinedThisSession()).toBe(1);
  });

  it("recovers to an empty cache when the wrapped key is lost", async () => {
    const memory = memoryFileSystem();
    const first = await createOpenStore(memory.fileSystem);
    await first.store.upsertDocument(document(DOC_A));
    await first.store.idle();

    // Simulate an OS keychain reset: the wrapped key no longer unwraps.
    memory.files.set("/cache/profile-home/key", Buffer.from("unwrappable"));
    const cipher: CredentialCipher = {
      ...fakeCredentialCipher(),
      decrypt: (ciphertext) => {
        const text = Buffer.from([...ciphertext].reverse()).toString();
        if (!/^[A-Za-z0-9+/=]+$/.test(text)) throw new Error("keychain reset");
        return text;
      },
    };
    const store = createOfflineCacheStore({
      rootDirectory: "/cache/profile-home",
      credentialCipher: cipher,
      fileSystem: memory.fileSystem,
    });

    // No crash loop: the store opens empty and caching resumes.
    await store.open();
    expect(store.summary().documentCount).toBe(0);
    await store.upsertDocument(document(DOC_B));
    expect(store.summary().documentCount).toBe(1);
  });
});

describe("schema migration", () => {
  it("upgrades a version-1 index in place", async () => {
    const memory = memoryFileSystem();
    const first = await createOpenStore(memory.fileSystem);
    await first.store.upsertDocument(document(DOC_A));
    await first.store.idle();

    // Rewrite the index as version 1: rows without the tags column.
    const key = Buffer.from(
      Buffer.from(
        [...memory.files.get("/cache/profile-home/key")!].reverse(),
      ).toString(),
      "base64",
    );
    const rows = first.store.listColumns().map((row) => {
      const { tags: _tags, ...v1Row } = row;
      return v1Row;
    });
    memory.files.set(
      "/cache/profile-home/index",
      encryptBuffer(key, Buffer.from(JSON.stringify({ version: 1, rows }))),
    );

    const second = await createOpenStore(memory.fileSystem);
    const [row] = second.store.listColumns();
    expect(row).toMatchObject({ id: DOC_A, tags: [] });

    // The upgrade happened on disk, not just in memory: a third open reads
    // the current version directly.
    const third = await createOpenStore(memory.fileSystem);
    expect(third.store.listColumns()[0]).toMatchObject({ id: DOC_A, tags: [] });
  });

  it("applies each version delta in order", () => {
    const rows = migrateIndexRows(1, [{ id: DOC_A, title: "Alt" }]);
    expect(rows[0]).toMatchObject({ id: DOC_A, tags: [] });
    expect(OFFLINE_CACHE_VERSION).toBeGreaterThan(1);
  });
});

describe("server-side deletion", () => {
  it("drops a cached document the archive no longer has", async () => {
    const { store } = await createOpenStore();
    await store.upsertDocument(document(DOC_A));
    const readThrough = createOfflineReadThrough({ store });

    readThrough.observe(
      "GET",
      `/api/documents/${DOC_A}`,
      new Response("gone", { status: 404 }),
    );

    await vi.waitFor(() => {
      expect(store.listColumns()).toEqual([]);
    });
    await expect(store.loadRecord(DOC_A)).resolves.toBeNull();
  });

  it("does not drop a document on a transient failure", async () => {
    const { store } = await createOpenStore();
    await store.upsertDocument(document(DOC_A));
    const readThrough = createOfflineReadThrough({ store });

    readThrough.observe(
      "GET",
      `/api/documents/${DOC_A}`,
      new Response("busy", { status: 503 }),
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.listColumns()).toHaveLength(1);
  });
});
