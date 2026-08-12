import { PassThrough, type Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { parseDateOnlyLocal } from "@openkeep/types";
import { SecureStorageUnavailableError } from "../storage/safe-storage-cipher";
import type { CredentialCipher } from "../storage/types";
import {
  decryptBuffer,
  decryptFileBuffer,
  encryptBuffer,
  loadOrCreateCacheKey,
} from "./cache-cipher";
import {
  createOfflineCacheStore,
  extractCacheColumns,
  type OfflineCacheFileSystem,
} from "./offline-cache-store";
import { classifyReadThrough, createOfflineReadThrough } from "./read-through";

/** Reverses the plaintext — enough to prove wrapping actually happens. */
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
  const modes: string[] = [];
  const fileSystem: OfflineCacheFileSystem = {
    mkdir: async (directory) => {
      modes.push(`mkdir:${directory}`);
    },
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

const DOC_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function document(overrides: Record<string, unknown> = {}) {
  return {
    id: DOC_ID,
    title: "Strom Jahresabrechnung",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-02T10:00:00.000Z",
    issueDate: "2026-01-01",
    dueDate: "2026-08-15",
    status: "ready",
    reviewStatus: "not_required",
    mimeType: "application/pdf",
    correspondent: { id: "c-1", name: "Stadtwerke", slug: "stadtwerke" },
    documentType: { id: "t-1", name: "Invoice", slug: "invoice" },
    ...overrides,
  };
}

async function createOpenStore(
  options: {
    fileSystem?: OfflineCacheFileSystem;
    root?: string;
    available?: boolean;
  } = {},
) {
  const memory = memoryFileSystem();
  const fileSystem = options.fileSystem ?? memory.fileSystem;
  let sequence = 0;
  let clock = 1_000;
  const store = createOfflineCacheStore({
    rootDirectory: options.root ?? "/cache/profile-home",
    credentialCipher: fakeCredentialCipher(options.available ?? true),
    fileSystem,
    now: () => clock,
    createTemporaryId: () => `tmp-${++sequence}`,
  });
  await store.open();
  return {
    store,
    fileSystem,
    memory,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

function webStream(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Buffer.from(chunk));
      controller.close();
    },
  });
}

describe("date-only parsing", () => {
  it("keeps a date-only value on its own day in every timezone", () => {
    const parsed = parseDateOnlyLocal("2026-01-01")!;
    expect([parsed.getFullYear(), parsed.getMonth(), parsed.getDate()]).toEqual([
      2026, 0, 1,
    ]);
    expect(parseDateOnlyLocal("not a date")).toBeNull();
  });
});

describe("cache cipher", () => {
  it("round-trips sealed buffers and detects tampering", () => {
    const key = Buffer.alloc(32, 7);
    const sealed = encryptBuffer(key, Buffer.from("cached document"));
    expect(decryptBuffer(key, sealed).toString()).toBe("cached document");
    sealed[sealed.length - 1] ^= 0xff;
    expect(() => decryptBuffer(key, sealed)).toThrow();
  });

  it("stream-encrypts to a format the file decryptor accepts", async () => {
    const key = Buffer.alloc(32, 9);
    const { createEncryptStream } = await import("./cache-cipher");
    const { header, cipher, trailer } = createEncryptStream(key);
    const sealed = Buffer.concat([
      header,
      cipher.update(Buffer.from("%PDF-first ")),
      cipher.update(Buffer.from("second chunk")),
      (cipher.final(), Buffer.alloc(0)),
      trailer(),
    ]);
    expect(decryptFileBuffer(key, sealed).toString()).toBe("%PDF-first second chunk");
  });

  it("refuses to produce a key without a secure operating-system store", async () => {
    await expect(
      loadOrCreateCacheKey(fakeCredentialCipher(false), {
        read: async () => null,
        write: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(SecureStorageUnavailableError);
  });

  it("wraps a stable key and unwraps the same one next time", async () => {
    let stored: Buffer | null = null;
    const keyFile = {
      read: async () => stored,
      write: async (wrapped: Buffer) => {
        stored = wrapped;
      },
    };
    const cipher = fakeCredentialCipher();
    const first = await loadOrCreateCacheKey(cipher, keyFile);
    const second = await loadOrCreateCacheKey(cipher, keyFile);
    expect(second.equals(first)).toBe(true);
    expect(stored!.equals(first)).toBe(false);
  });
});

describe("offline cache store", () => {
  it("stores an opened document with queryable date columns and true freshness", async () => {
    const { store, advance } = await createOpenStore();
    await store.upsertDocument(document());
    advance(5_000);

    const [row] = store.listColumns();
    expect(row).toMatchObject({
      id: DOC_ID,
      issueDate: "2026-01-01",
      dueDate: "2026-08-15",
      correspondentSlug: "stadtwerke",
      hasDocument: true,
      hasText: false,
      cachedAt: 1_000,
    });
    expect(store.summary()).toEqual({
      documentCount: 1,
      fileStorageBytes: 0,
      lastCachedAt: 1_000,
    });
  });

  it("attaches OCR text and history without losing the metadata", async () => {
    const { store } = await createOpenStore();
    await store.upsertDocument(document());
    await store.attachText(DOC_ID, { blocks: [{ text: "OCR-Zeile" }] });
    await store.attachHistory(DOC_ID, [{ event: "created" }]);

    const record = await store.loadRecord(DOC_ID);
    expect(record).toMatchObject({
      document: { id: DOC_ID },
      text: { blocks: [{ text: "OCR-Zeile" }] },
      history: [{ event: "created" }],
    });
    expect(store.listColumns()[0]).toMatchObject({ hasText: true, hasHistory: true });
  });

  it("survives a text payload arriving before its document", async () => {
    const { store } = await createOpenStore();
    await store.attachText(DOC_ID, { blocks: [] });
    expect(store.summary().documentCount).toBe(0);

    await store.upsertDocument(document());
    const record = await store.loadRecord(DOC_ID);
    expect(record?.text).toEqual({ blocks: [] });
    expect(store.summary().documentCount).toBe(1);
  });

  it("writes nothing readable to disk", async () => {
    const { store, memory } = await createOpenStore();
    await store.upsertDocument(document({ title: "Geheime Diagnose" }));
    await store.attachText(DOC_ID, { blocks: [{ text: "vertraulicher Befund" }] });
    await store.idle();

    for (const [name, contents] of memory.files) {
      const readable = contents.toString("latin1");
      expect(readable, name).not.toContain("Geheime");
      expect(readable, name).not.toContain("vertraulich");
      expect(readable, name).not.toContain("Stadtwerke");
    }
  });

  it("streams file bytes encrypted, atomically, and deduplicates concurrent writes", async () => {
    const { store, memory } = await createOpenStore();
    await store.upsertDocument(document());

    await Promise.all([
      store.cacheFileStream(DOC_ID, "original", webStream("%PDF-", "1.4 body")),
      store.cacheFileStream(DOC_ID, "original", webStream("%PDF-", "1.4 body")),
    ]);

    const sealed = memory.files.get(`/cache/profile-home/files/${DOC_ID}`)!;
    expect(sealed.toString("latin1")).not.toContain("%PDF-");
    expect([...memory.files.keys()].filter((k) => k.includes(".tmp"))).toEqual([]);
    expect(store.listColumns()[0]).toMatchObject({
      fileBytes: "%PDF-1.4 body".length,
      fileKind: "original",
    });
  });

  it("prefers a searchable copy and never downgrades to the original", async () => {
    const { store } = await createOpenStore();
    await store.upsertDocument(document());
    await store.cacheFileStream(DOC_ID, "searchable", webStream("searchable pdf"));
    await store.cacheFileStream(DOC_ID, "original", webStream("original bytes"));

    expect(store.listColumns()[0]).toMatchObject({
      fileKind: "searchable",
      fileBytes: "searchable pdf".length,
    });
  });

  it("keeps two profiles fully apart", async () => {
    const memory = memoryFileSystem();
    const home = await createOpenStore({
      fileSystem: memory.fileSystem,
      root: "/cache/profile-home",
    });
    const work = await createOpenStore({
      fileSystem: memory.fileSystem,
      root: "/cache/profile-work",
    });
    await home.store.upsertDocument(document());

    expect(work.store.listColumns()).toEqual([]);
    expect(work.store.summary().documentCount).toBe(0);
    expect(home.store.summary().documentCount).toBe(1);
  });

  it("reopens from the persisted index across a restart", async () => {
    const memory = memoryFileSystem();
    const first = await createOpenStore({ fileSystem: memory.fileSystem });
    await first.store.upsertDocument(document());
    await first.store.idle();

    const second = await createOpenStore({ fileSystem: memory.fileSystem });
    expect(second.store.listColumns()[0]).toMatchObject({ id: DOC_ID });
    expect(second.store.summary().lastCachedAt).toBe(1_000);
  });

  it("rebuilds the index from records when the index is damaged", async () => {
    const memory = memoryFileSystem();
    const first = await createOpenStore({ fileSystem: memory.fileSystem });
    await first.store.upsertDocument(document());
    await first.store.idle();
    memory.files.set("/cache/profile-home/index", Buffer.from("garbage"));

    const second = await createOpenStore({ fileSystem: memory.fileSystem });
    expect(second.store.listColumns()[0]).toMatchObject({
      id: DOC_ID,
      hasDocument: true,
    });
  });

  it("skips a damaged record instead of failing the whole store", async () => {
    const memory = memoryFileSystem();
    const first = await createOpenStore({ fileSystem: memory.fileSystem });
    await first.store.upsertDocument(document());
    await first.store.upsertDocument(
      document({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", title: "Zweites" }),
    );
    await first.store.idle();
    memory.files.set(`/cache/profile-home/records/${DOC_ID}`, Buffer.from("junk"));
    memory.files.delete("/cache/profile-home/index");

    const second = await createOpenStore({ fileSystem: memory.fileSystem });
    expect(second.store.listColumns().map((row) => row.id)).toEqual([
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ]);
  });

  it("stays disabled without a secure operating-system store", async () => {
    const memory = memoryFileSystem();
    const store = createOfflineCacheStore({
      rootDirectory: "/cache/profile-home",
      credentialCipher: fakeCredentialCipher(false),
      fileSystem: memory.fileSystem,
    });
    await expect(store.open()).rejects.toBeInstanceOf(SecureStorageUnavailableError);
    expect([...memory.files.keys()].filter((k) => k.includes("records/"))).toEqual([]);
  });
});

describe("cached archive user", () => {
  it("stores the verified user sealed and returns it for the offline session", async () => {
    const { store, memory } = await createOpenStore();
    await store.setUser({ id: "user-1", email: "owner@example.com", isOwner: true });

    await expect(store.getUser()).resolves.toMatchObject({ id: "user-1" });
    for (const [name, contents] of memory.files) {
      expect(contents.toString("latin1"), name).not.toContain("owner@example.com");
    }
  });

  it("rejects a malformed user and survives a damaged user file", async () => {
    const { store, memory } = await createOpenStore();
    await store.setUser("not a user");
    await expect(store.getUser()).resolves.toBeNull();

    await store.setUser({ id: "user-1" });
    memory.files.set("/cache/profile-home/user", Buffer.from("junk"));
    await expect(store.getUser()).resolves.toBeNull();
  });

  it("is captured from /api/auth/me by the read-through", async () => {
    const { store } = await createOpenStore();
    const readThrough = createOfflineReadThrough({ store });
    const observed = readThrough.observe(
      "GET",
      "/api/auth/me",
      new Response(JSON.stringify({ id: "user-1", isOwner: true }), { status: 200 }),
    );
    await observed.text();
    await vi.waitFor(async () => {
      await expect(store.getUser()).resolves.toMatchObject({ id: "user-1" });
    });
  });
});

describe("read-through classification", () => {
  it("targets exactly the document endpoints the detail view reads", () => {
    expect(classifyReadThrough("GET", `/api/documents/${DOC_ID}`)).toEqual({
      kind: "document",
      documentId: DOC_ID,
    });
    expect(classifyReadThrough("GET", `/api/documents/${DOC_ID}/text`)).toEqual({
      kind: "text",
      documentId: DOC_ID,
    });
    expect(classifyReadThrough("GET", `/api/documents/${DOC_ID}/history`)).toEqual({
      kind: "history",
      documentId: DOC_ID,
    });
    expect(classifyReadThrough("GET", `/api/documents/${DOC_ID}/download`)).toEqual({
      kind: "file",
      documentId: DOC_ID,
      fileKind: "original",
    });
    expect(
      classifyReadThrough("GET", `/api/documents/${DOC_ID}/download/searchable`),
    ).toEqual({ kind: "file", documentId: DOC_ID, fileKind: "searchable" });
  });

  it("ignores lists, searches, mutations, and unrelated endpoints", () => {
    expect(classifyReadThrough("GET", "/api/documents")).toBeNull();
    expect(classifyReadThrough("GET", "/api/documents/facets")).toBeNull();
    expect(classifyReadThrough("POST", `/api/documents/${DOC_ID}`)).toBeNull();
    expect(classifyReadThrough("DELETE", `/api/documents/${DOC_ID}`)).toBeNull();
    expect(classifyReadThrough("GET", `/api/documents/${DOC_ID}/preview/1`)).toBeNull();
    expect(classifyReadThrough("GET", "/api/auth/me")).toEqual({ kind: "user" });
    expect(classifyReadThrough("POST", "/api/auth/me")).toBeNull();
  });
});

describe("read-through observer", () => {
  it("hands the renderer the full body while the cache receives a copy", async () => {
    const { store } = await createOpenStore();
    const readThrough = createOfflineReadThrough({ store });
    const payload = JSON.stringify(document());

    const observed = readThrough.observe(
      "GET",
      `/api/documents/${DOC_ID}`,
      new Response(payload, { status: 200 }),
    );

    await expect(observed.text()).resolves.toBe(payload);
    await vi.waitFor(() => {
      expect(store.summary().documentCount).toBe(1);
    });
  });

  it("never breaks online viewing when caching fails", async () => {
    const readThrough = createOfflineReadThrough({
      store: {
        upsertDocument: vi.fn(async () => {
          throw new Error("disk full");
        }),
        attachText: vi.fn(),
        attachHistory: vi.fn(),
        cacheFileStream: vi.fn(),
        setUser: vi.fn(),
      },
      reportError: vi.fn(),
    });

    const observed = readThrough.observe(
      "GET",
      `/api/documents/${DOC_ID}`,
      new Response(JSON.stringify(document()), { status: 200 }),
    );

    await expect(observed.json()).resolves.toMatchObject({ id: DOC_ID });
  });

  it("passes failed responses through untouched", async () => {
    const store = {
      upsertDocument: vi.fn(),
      attachText: vi.fn(),
      attachHistory: vi.fn(),
      cacheFileStream: vi.fn(),
      setUser: vi.fn(),
    };
    const readThrough = createOfflineReadThrough({ store });
    const response = new Response("denied", { status: 403 });

    expect(readThrough.observe("GET", `/api/documents/${DOC_ID}`, response)).toBe(
      response,
    );
    expect(store.upsertDocument).not.toHaveBeenCalled();
  });

  it("tees file downloads into the encrypted cache", async () => {
    const { store, memory } = await createOpenStore();
    await store.upsertDocument(document());
    const readThrough = createOfflineReadThrough({ store });

    const observed = readThrough.observe(
      "GET",
      `/api/documents/${DOC_ID}/download/searchable`,
      new Response(webStream("%PDF-1.4 searchable"), { status: 200 }),
    );

    await expect(observed.text()).resolves.toBe("%PDF-1.4 searchable");
    await store.idle();
    await vi.waitFor(() => {
      expect(store.listColumns()[0]).toMatchObject({ fileKind: "searchable" });
    });
    const sealed = memory.files.get(`/cache/profile-home/files/${DOC_ID}`)!;
    expect(sealed.toString("latin1")).not.toContain("searchable");
  });
});
