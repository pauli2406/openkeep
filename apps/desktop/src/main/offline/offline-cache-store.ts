import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable, type Writable } from "node:stream";
import { randomUUID } from "node:crypto";
import type { OfflineCacheSummary } from "@openkeep/types";
import { OFFLINE_CACHE_DEFAULT_MAX_BYTES } from "../../shared/desktop-api";
import type { CredentialCipher } from "../storage/types";
import {
  createEncryptStream,
  decryptBuffer,
  decryptFileBuffer,
  encryptBuffer,
  loadOrCreateCacheKey,
} from "./cache-cipher";

/**
 * The offline document cache: per-profile, encrypted, versioned.
 *
 * The semantics are the mobile app's lazy read-through model — the cache is
 * last-opened state, refreshed whole on the next online open — with the
 * departures recorded in docs/technical: the cache is keyed by profile UUID
 * instead of being one shared pool, everything on disk is encrypted, the
 * schema carries a version from the first release, and issue/due dates are
 * queryable columns so offline filters never need to reopen full records.
 *
 * Layout under the store root (0700 directories, 0600 files):
 *   key              data key, wrapped by the operating-system store
 *   index            encrypted column index over all records
 *   records/<id>     encrypted JSON: document metadata + OCR text + history
 *   files/<id>       encrypted preview/searchable file bytes
 */

/**
 * Cache schema version. History:
 *   1 — initial release: column index without tag identities.
 *   2 — tag identity triples joined the column index (offline facets/search).
 * Old versions upgrade in place on open; see `migrateIndexRows`.
 */
export const OFFLINE_CACHE_VERSION = 2 as const;
const OLDEST_MIGRATABLE_VERSION = 1;


export type OfflineCachedKind = "original" | "searchable";

/** The queryable columns; everything else stays inside the sealed record. */
export type OfflineCacheColumns = {
  id: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  issueDate: string | null;
  dueDate: string | null;
  status: string | null;
  reviewStatus: string | null;
  correspondentId: string | null;
  correspondentName: string | null;
  correspondentSlug: string | null;
  documentTypeId: string | null;
  documentTypeName: string | null;
  documentTypeSlug: string | null;
  mimeType: string | null;
  /** Tag identity triples, for offline facets and tag search. */
  tags: Array<{ id: string; name: string; slug: string }>;
  cachedAt: number;
  lastViewedAt: number;
  hasDocument: boolean;
  hasText: boolean;
  hasHistory: boolean;
  fileBytes: number;
  fileKind: OfflineCachedKind | null;
};

type StoredRecord = {
  version: number;
  document: unknown | null;
  text: unknown | null;
  history: unknown | null;
};

export type OfflineCacheFileSystem = {
  mkdir(directory: string): Promise<unknown>;
  readFile(filePath: string): Promise<Buffer>;
  writeFile(filePath: string, contents: Buffer): Promise<unknown>;
  rename(from: string, to: string): Promise<unknown>;
  readdir(directory: string): Promise<string[]>;
  unlink(filePath: string): Promise<unknown>;
  createWriteStream(filePath: string): Writable;
};

export function nodeOfflineCacheFileSystem(): OfflineCacheFileSystem {
  return {
    mkdir: (directory) => fs.mkdir(directory, { recursive: true, mode: 0o700 }),
    readFile: (filePath) => fs.readFile(filePath),
    writeFile: (filePath, contents) =>
      fs.writeFile(filePath, contents, { mode: 0o600 }),
    rename: (from, to) => fs.rename(from, to),
    readdir: (directory) => fs.readdir(directory),
    unlink: (filePath) => fs.unlink(filePath),
    createWriteStream: (filePath) => createWriteStream(filePath, { mode: 0o600 }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function tagList(value: unknown): Array<{ id: string; name: string; slug: string }> {
  if (!Array.isArray(value)) return [];
  const tags: Array<{ id: string; name: string; slug: string }> = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const id = stringOrNull(entry.id);
    const name = stringOrNull(entry.name);
    if (id && name) {
      tags.push({ id, name, slug: stringOrNull(entry.slug) ?? id });
    }
  }
  return tags;
}

function taxonomy(value: unknown): {
  id: string | null;
  name: string | null;
  slug: string | null;
} {
  if (!isRecord(value)) return { id: null, name: null, slug: null };
  return {
    id: stringOrNull(value.id),
    name: stringOrNull(value.name),
    slug: stringOrNull(value.slug),
  };
}

/**
 * Extracts the queryable columns from a document response. Defensive on
 * purpose: the cache must survive an archive that returns more or fewer
 * fields than this desktop version knows about.
 */
export function extractCacheColumns(
  document: unknown,
): Omit<
  OfflineCacheColumns,
  "cachedAt" | "lastViewedAt" | "hasDocument" | "hasText" | "hasHistory" | "fileBytes" | "fileKind"
> | null {
  if (!isRecord(document)) return null;
  const id = stringOrNull(document.id);
  if (!id) return null;
  const correspondent = taxonomy(document.correspondent);
  const documentType = taxonomy(document.documentType);
  return {
    id,
    title: stringOrNull(document.title) ?? "Untitled document",
    createdAt: stringOrNull(document.createdAt),
    updatedAt: stringOrNull(document.updatedAt),
    issueDate: stringOrNull(document.issueDate),
    dueDate: stringOrNull(document.dueDate),
    status: stringOrNull(document.status),
    reviewStatus: stringOrNull(document.reviewStatus),
    correspondentId: correspondent.id,
    correspondentName: correspondent.name,
    correspondentSlug: correspondent.slug,
    documentTypeId: documentType.id,
    documentTypeName: documentType.name,
    documentTypeSlug: documentType.slug,
    mimeType: stringOrNull(document.mimeType),
    tags: tagList(document.tags),
  };
}

/**
 * Upgrades index rows written by an older schema to the current shape. Each
 * version's delta is applied in order, so adding version N+1 means adding one
 * step here rather than rewriting the chain.
 */
export function migrateIndexRows(
  fromVersion: number,
  rows: unknown[],
): OfflineCacheColumns[] {
  let migrated = rows as Array<Record<string, unknown>>;
  if (fromVersion < 2) {
    // v1 → v2: tag identities joined the column index.
    migrated = migrated.map((row) => ({ ...row, tags: row.tags ?? [] }));
  }
  return migrated as unknown as OfflineCacheColumns[];
}

export function createOfflineCacheStore({
  rootDirectory,
  credentialCipher,
  fileSystem = nodeOfflineCacheFileSystem(),
  now = () => Date.now(),
  createTemporaryId = randomUUID,
}: {
  rootDirectory: string;
  credentialCipher: CredentialCipher;
  fileSystem?: OfflineCacheFileSystem;
  now?: () => number;
  createTemporaryId?: () => string;
}) {
  const recordsDir = path.join(rootDirectory, "records");
  const filesDir = path.join(rootDirectory, "files");
  const indexPath = path.join(rootDirectory, "index");
  const keyPath = path.join(rootDirectory, "key");
  const userPath = path.join(rootDirectory, "user");
  const settingsPath = path.join(rootDirectory, "settings");

  let key: Buffer | null = null;
  let columns = new Map<string, OfflineCacheColumns>();
  /** Rows dropped this session because their sealed content was damaged. */
  let quarantinedCount = 0;
  let maxBytes = OFFLINE_CACHE_DEFAULT_MAX_BYTES;
  let writes = Promise.resolve();
  const fileWritesInFlight = new Map<string, Promise<void>>();

  async function readOptional(filePath: string): Promise<Buffer | null> {
    try {
      return await fileSystem.readFile(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async function writeSealedAtomically(filePath: string, plaintext: Buffer) {
    const temporaryPath = `${filePath}.${createTemporaryId()}.tmp`;
    await fileSystem.writeFile(temporaryPath, encryptBuffer(key!, plaintext));
    await fileSystem.rename(temporaryPath, filePath);
  }

  function persistIndex() {
    const run = writes.then(() =>
      writeSealedAtomically(
        indexPath,
        Buffer.from(
          JSON.stringify({
            version: OFFLINE_CACHE_VERSION,
            rows: [...columns.values()],
          }),
        ),
      ),
    );
    // The stored chain must always settle: one failed index write must not
    // disable caching until restart. The caller still sees its own failure.
    writes = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function readRecord(
    documentId: string,
  ): Promise<StoredRecord | "damaged" | null> {
    const sealed = await readOptional(path.join(recordsDir, documentId));
    if (!sealed) return null;
    try {
      const parsed: unknown = JSON.parse(decryptBuffer(key!, sealed).toString("utf8"));
      if (
        !isRecord(parsed) ||
        typeof parsed.version !== "number" ||
        parsed.version < OLDEST_MIGRATABLE_VERSION ||
        parsed.version > OFFLINE_CACHE_VERSION
      ) {
        return "damaged";
      }
      // The record payload shape is identical across migratable versions; the
      // version travels with the next write.
      return parsed as StoredRecord;
    } catch {
      return "damaged";
    }
  }

  /**
   * Drops one document from the cache: record, file, and row together, with
   * the index persisted. Used when the archive deleted the document, and to
   * quarantine damage — one bad row must never disable offline browsing.
   */
  async function dropDocument(documentId: string, reason: "removed" | "damaged") {
    await fileSystem.unlink(path.join(recordsDir, documentId)).catch(() => undefined);
    await fileSystem.unlink(path.join(filesDir, documentId)).catch(() => undefined);
    const existed = columns.delete(documentId);
    if (reason === "damaged") quarantinedCount += 1;
    if (existed) {
      await persistIndex().catch(() => undefined);
    }
  }

  async function writeRecord(documentId: string, record: StoredRecord) {
    await writeSealedAtomically(
      path.join(recordsDir, documentId),
      Buffer.from(JSON.stringify(record)),
    );
  }

  async function rebuildIndexFromRecords() {
    columns = new Map();
    let names: string[] = [];
    try {
      names = await fileSystem.readdir(recordsDir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.includes(".tmp")) continue;
      const record = await readRecord(name);
      if (record === "damaged") {
        await dropDocument(name, "damaged");
        continue;
      }
      if (!record || !record.document) continue;
      const extracted = extractCacheColumns(record.document);
      if (!extracted || extracted.id !== name) continue;
      columns.set(name, {
        ...extracted,
        cachedAt: now(),
        lastViewedAt: now(),
        hasDocument: true,
        hasText: record.text !== null,
        hasHistory: record.history !== null,
        fileBytes: 0,
        fileKind: null,
      });
    }
  }

  function requireOpen() {
    if (!key) {
      throw new Error("The offline cache is not open.");
    }
  }

  /**
   * Opens the per-profile store. Throws `SecureStorageUnavailableError` when
   * the operating-system store cannot protect the data key — the caller
   * leaves the cache disabled rather than writing plaintext.
   */
  async function removeDirectoryContents(directory: string) {
    let names: string[] = [];
    try {
      names = await fileSystem.readdir(directory);
    } catch {
      return;
    }
    for (const name of names) {
      await fileSystem.unlink(path.join(directory, name)).catch(() => undefined);
    }
  }

  async function loadSettings() {
    const sealed = await readOptional(settingsPath);
    if (!sealed) return;
    try {
      const parsed: unknown = JSON.parse(decryptBuffer(key!, sealed).toString("utf8"));
      if (
        isRecord(parsed) &&
        typeof parsed.maxBytes === "number" &&
        Number.isFinite(parsed.maxBytes) &&
        parsed.maxBytes > 0
      ) {
        maxBytes = parsed.maxBytes;
      }
    } catch {
      // Unreadable settings fall back to the default limit, never to none.
    }
  }

  function totalFileBytes(): number {
    let total = 0;
    for (const row of columns.values()) total += row.fileBytes;
    return total;
  }

  /**
   * Enforces the disk cap by evicting least-recently-viewed documents —
   * record, file, and row together — until the cache fits. `last_viewed_at`
   * is the signal mobile indexes but never uses; here it earns its keep.
   */
  async function enforceLimit() {
    if (totalFileBytes() <= maxBytes) return;
    const evictable = [...columns.values()].sort(
      (a, b) => a.lastViewedAt - b.lastViewedAt,
    );
    for (const row of evictable) {
      if (totalFileBytes() <= maxBytes) break;
      await fileSystem.unlink(path.join(recordsDir, row.id)).catch(() => undefined);
      await fileSystem.unlink(path.join(filesDir, row.id)).catch(() => undefined);
      columns.delete(row.id);
    }
    await persistIndex().catch(() => undefined);
  }

  async function openStore() {
      await fileSystem.mkdir(recordsDir);
      await fileSystem.mkdir(filesDir);
      const loaded = await loadOrCreateCacheKey(credentialCipher, {
        read: () => readOptional(keyPath),
        write: async (wrapped) => {
          await fileSystem.writeFile(keyPath, wrapped);
        },
      });
      key = loaded.key;
      await loadSettings();
      if (loaded.recreated) {
        // The previous key is gone, so every sealed file is unrecoverable
        // ciphertext. Recover to an empty cache instead of a crash loop.
        await removeDirectoryContents(recordsDir);
        await removeDirectoryContents(filesDir);
        await fileSystem.unlink(indexPath).catch(() => undefined);
        await fileSystem.unlink(userPath).catch(() => undefined);
        columns = new Map();
        await persistIndex().catch(() => undefined);
        return;
      }

      const sealed = await readOptional(indexPath);
      if (sealed) {
        try {
          const parsed: unknown = JSON.parse(
            decryptBuffer(key, sealed).toString("utf8"),
          );
          if (
            isRecord(parsed) &&
            typeof parsed.version === "number" &&
            parsed.version >= OLDEST_MIGRATABLE_VERSION &&
            parsed.version <= OFFLINE_CACHE_VERSION &&
            Array.isArray(parsed.rows)
          ) {
            columns = new Map(
              migrateIndexRows(parsed.version, parsed.rows).map((row) => [
                row.id,
                row,
              ]),
            );
            if (parsed.version !== OFFLINE_CACHE_VERSION) {
              // Upgrade in place, so the next open reads the current shape.
              await persistIndex().catch(() => undefined);
            }
            return;
          }
        } catch {
          // Unreadable index: fall through to a rebuild from the records.
        }
      }
      await rebuildIndexFromRecords();
      await persistIndex().catch(() => undefined);
  }

  return {
    open: openStore,

    /** Called on each online document open; refreshes metadata last-open-wins. */
    async upsertDocument(document: unknown) {
      requireOpen();
      const extracted = extractCacheColumns(document);
      if (!extracted) return null;
      const existing = columns.get(extracted.id);
      const read = await readRecord(extracted.id);
      const previous = read === "damaged" ? null : read;
      await writeRecord(extracted.id, {
        version: OFFLINE_CACHE_VERSION,
        document,
        text: previous?.text ?? null,
        history: previous?.history ?? null,
      });
      columns.set(extracted.id, {
        ...extracted,
        cachedAt: now(),
        lastViewedAt: now(),
        hasDocument: true,
        hasText: previous?.text != null,
        hasHistory: previous?.history != null,
        fileBytes: existing?.fileBytes ?? 0,
        fileKind: existing?.fileKind ?? null,
      });
      await persistIndex();
      return extracted.id;
    },

    async attachText(documentId: string, text: unknown) {
      requireOpen();
      const read = await readRecord(documentId);
      const previous = read === "damaged" ? null : read;
      await writeRecord(documentId, {
        version: OFFLINE_CACHE_VERSION,
        document: previous?.document ?? null,
        text,
        history: previous?.history ?? null,
      });
      const existing = columns.get(documentId);
      if (existing) {
        columns.set(documentId, { ...existing, hasText: true });
        await persistIndex();
      }
    },

    async attachHistory(documentId: string, history: unknown) {
      requireOpen();
      const read = await readRecord(documentId);
      const previous = read === "damaged" ? null : read;
      await writeRecord(documentId, {
        version: OFFLINE_CACHE_VERSION,
        document: previous?.document ?? null,
        text: previous?.text ?? null,
        history,
      });
      const existing = columns.get(documentId);
      if (existing) {
        columns.set(documentId, { ...existing, hasHistory: true });
        await persistIndex();
      }
    },

    /**
     * Streams one document file into the cache. A searchable copy is preferred
     * over the original (mobile's rule); an original never replaces a cached
     * searchable copy. Concurrent writes for one document collapse into the
     * first one.
     */
    cacheFileStream(
      documentId: string,
      kind: OfflineCachedKind,
      body: ReadableStream<Uint8Array>,
    ): Promise<void> {
      requireOpen();
      const existing = columns.get(documentId);
      if (existing?.fileKind === "searchable" && kind === "original") {
        return body.cancel().catch(() => undefined) as Promise<void>;
      }
      const inFlight = fileWritesInFlight.get(documentId);
      if (inFlight) {
        return body.cancel().catch(() => undefined) as Promise<void>;
      }

      const write = (async () => {
        const finalPath = path.join(filesDir, documentId);
        const temporaryPath = `${finalPath}.${createTemporaryId()}.tmp`;
        const { header, cipher, trailer } = createEncryptStream(key!);
        const sink = fileSystem.createWriteStream(temporaryPath);
        const writeChunk = (chunk: Buffer) =>
          new Promise<void>((resolve, reject) => {
            sink.write(chunk, (error) => (error ? reject(error) : resolve()));
          });
        let bytes = 0;

        try {
          await writeChunk(header);
          for await (const chunk of Readable.fromWeb(body as never)) {
            const buffer = Buffer.from(chunk as Uint8Array);
            bytes += buffer.length;
            await writeChunk(cipher.update(buffer));
          }
          cipher.final();
          await writeChunk(trailer());
          await new Promise<void>((resolve, reject) => {
            sink.end((error?: Error | null) => (error ? reject(error) : resolve()));
          });
          await fileSystem.rename(temporaryPath, finalPath);
          const row = columns.get(documentId);
          if (row) {
            columns.set(documentId, { ...row, fileBytes: bytes, fileKind: kind });
            await persistIndex();
          }
          await enforceLimit();
        } catch (error) {
          sink.destroy();
          await fileSystem.unlink(temporaryPath).catch(() => undefined);
          throw error;
        }
      })().finally(() => {
        fileWritesInFlight.delete(documentId);
      });

      fileWritesInFlight.set(documentId, write);
      return write;
    },

    /**
     * The verified archive user, cached so an offline session has an identity
     * to present. Refreshed whenever `/api/auth/me` flows through the proxy.
     */
    async setUser(user: unknown) {
      requireOpen();
      if (!isRecord(user) || typeof user.id !== "string") return;
      await writeSealedAtomically(
        userPath,
        Buffer.from(JSON.stringify({ version: OFFLINE_CACHE_VERSION, user })),
      );
    },

    async getUser(): Promise<unknown | null> {
      requireOpen();
      const sealed = await readOptional(userPath);
      if (!sealed) return null;
      try {
        const parsed: unknown = JSON.parse(decryptBuffer(key!, sealed).toString("utf8"));
        if (!isRecord(parsed) || parsed.version !== OFFLINE_CACHE_VERSION) return null;
        return parsed.user ?? null;
      } catch {
        return null;
      }
    },

    /** Sealed record back out; damage is quarantined on sight. */
    async loadRecord(documentId: string) {
      requireOpen();
      const record = await readRecord(documentId);
      if (record === "damaged") {
        await dropDocument(documentId, "damaged");
        return null;
      }
      return record;
    },

    /** The archive no longer has this document; neither should the copy. */
    async removeDocument(documentId: string) {
      requireOpen();
      await dropDocument(documentId, "removed");
    },

    /**
     * The cached file, decrypted. Buffered rather than streamed: cached files
     * are preview-sized PDFs, and streaming GCM decryption needs the trailing
     * tag before the final block — a complication the bounded-cache story can
     * take on if profiling ever demands it.
     */
    async readFile(documentId: string): Promise<Buffer | null> {
      requireOpen();
      const sealed = await readOptional(path.join(filesDir, documentId));
      const row = columns.get(documentId);
      if (!sealed) {
        // The file vanished under the row: correct the accounting so the
        // summary stops over-reporting (mobile keeps the stale bytes).
        if (row && row.fileBytes > 0) {
          columns.set(documentId, { ...row, fileBytes: 0, fileKind: null });
          await persistIndex().catch(() => undefined);
        }
        return null;
      }
      try {
        return decryptFileBuffer(key!, sealed);
      } catch {
        // Truncated or tampered bytes are useless; drop them and the pointer.
        quarantinedCount += 1;
        await fileSystem.unlink(path.join(filesDir, documentId)).catch(() => undefined);
        if (row) {
          columns.set(documentId, { ...row, fileBytes: 0, fileKind: null });
          await persistIndex().catch(() => undefined);
        }
        return null;
      }
    },

    /** Rows or files dropped this session because their content was damaged. */
    quarantinedThisSession(): number {
      return quarantinedCount;
    },

    limit(): number {
      return maxBytes;
    },

    async setLimit(nextMaxBytes: number) {
      requireOpen();
      if (!Number.isFinite(nextMaxBytes) || nextMaxBytes <= 0) {
        throw new Error("Choose a positive offline copy size limit.");
      }
      maxBytes = Math.floor(nextMaxBytes);
      await writeSealedAtomically(
        settingsPath,
        Buffer.from(JSON.stringify({ version: OFFLINE_CACHE_VERSION, maxBytes })),
      );
      await enforceLimit();
    },

    listColumns(): OfflineCacheColumns[] {
      requireOpen();
      return [...columns.values()].map((row) => ({ ...row }));
    },

    summary(): OfflineCacheSummary {
      requireOpen();
      const rows = [...columns.values()].filter((row) => row.hasDocument);
      return {
        documentCount: rows.length,
        fileStorageBytes: rows.reduce((total, row) => total + row.fileBytes, 0),
        lastCachedAt: rows.length
          ? rows.reduce((latest, row) => Math.max(latest, row.cachedAt), 0)
          : null,
      };
    },

    /**
     * Deletes everything this archive's copy holds — records, files, index,
     * cached identity, and the wrapped data key (a fresh key is minted on the
     * next write). Local only by construction: nothing here can reach an
     * archive. Other profiles' caches are untouched because each store owns
     * exactly one profile directory.
     */
    async clear() {
      requireOpen();
      await Promise.allSettled([...fileWritesInFlight.values()]);
      await writes;
      await removeDirectoryContents(recordsDir);
      await removeDirectoryContents(filesDir);
      for (const filePath of [indexPath, userPath, keyPath, settingsPath]) {
        await fileSystem.unlink(filePath).catch(() => undefined);
      }
      maxBytes = OFFLINE_CACHE_DEFAULT_MAX_BYTES;
      columns = new Map();
      // The key file is gone; reopen mints a fresh key before the next write.
      key = null;
      await openStore();
    },

    async idle() {
      await writes;
      await Promise.allSettled([...fileWritesInFlight.values()]);
    },
  };
}

export type OfflineCacheStore = ReturnType<typeof createOfflineCacheStore>;
