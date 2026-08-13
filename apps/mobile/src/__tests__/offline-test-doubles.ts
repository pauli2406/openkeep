/**
 * Test doubles for the offline layer.
 *
 * `createTestDatabase` is not a mock: it runs the store's real SQL through
 * Node's own SQLite, so a filter, an ordering, or a schema mistake fails here
 * the same way it would on a device. Only the binding differs from
 * `expo-sqlite` — hence the thin adapter.
 *
 * `createTestFileSystem` is an in-memory stand-in for `expo-file-system`, which
 * has no Node equivalent. What it verifies is the cache's own flow — temporary
 * name then move, byte accounting, concurrent-download collapsing — not the
 * platform's file API.
 */
import { DatabaseSync } from "node:sqlite";
import type { ArchiveDocument } from "../lib";
import type { OfflineFileSystem } from "../offline-file-cache";
import type {
  CachedDocumentRecord,
  OfflineDatabase,
  OfflineSqlParam,
} from "../offline-metadata-store";

export function createTestDatabase(): OfflineDatabase & { close(): void } {
  const db = new DatabaseSync(":memory:");
  return {
    async execAsync(source: string) {
      db.exec(source);
    },
    async runAsync(source: string, ...params: OfflineSqlParam[]) {
      return db.prepare(source).run(...params);
    },
    async getFirstAsync<T>(source: string, ...params: OfflineSqlParam[]) {
      const row = db.prepare(source).get(...params);
      // `node:sqlite` returns null-prototype objects; spreading gives plain
      // ones so `toEqual` compares them as the store's callers see them.
      return row ? ({ ...row } as T) : null;
    },
    async getAllAsync<T>(source: string, ...params: OfflineSqlParam[]) {
      return db
        .prepare(source)
        .all(...params)
        .map((row) => ({ ...row }) as T);
    },
    close() {
      db.close();
    },
  };
}

export type TestFileSystem = OfflineFileSystem & {
  entries: Map<string, number>;
  seed(uri: string, size: number): void;
};

export function createTestFileSystem(rootDirectory = "file:///cache/"): TestFileSystem {
  const entries = new Map<string, number>();

  return {
    rootDirectory,
    entries,
    seed(uri, size) {
      entries.set(uri, size);
    },
    async makeDirectory(uri) {
      entries.set(uri, 0);
    },
    async info(uri) {
      const size = entries.get(uri);
      return size === undefined ? { exists: false } : { exists: true, size };
    },
    async writeBase64(uri, base64) {
      entries.set(uri, Buffer.from(base64, "base64").byteLength);
    },
    async move(from, to) {
      const size = entries.get(from);
      if (size === undefined) {
        throw new Error(`move: ${from} does not exist`);
      }
      entries.delete(from);
      entries.set(to, size);
    },
    async delete(uri) {
      entries.delete(uri);
      // Deleting a directory takes what is under it, as on a device.
      for (const key of [...entries.keys()]) {
        if (key.startsWith(`${uri}/`)) {
          entries.delete(key);
        }
      }
    },
  };
}

export function testDocument(overrides: Partial<ArchiveDocument> = {}): ArchiveDocument {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Stromrechnung",
    mimeType: "application/pdf",
    status: "ready",
    createdAt: "2026-03-04T09:00:00.000Z",
    issueDate: "2026-03-01",
    dueDate: null,
    taskCompletedAt: null,
    expiryDate: null,
    amount: null,
    currency: null,
    referenceNumber: null,
    holderName: null,
    issuingAuthority: null,
    correspondent: null,
    documentType: null,
    tags: [],
    confidence: null,
    reviewStatus: "resolved",
    reviewReasons: [],
    reviewedAt: null,
    reviewNote: null,
    searchablePdfAvailable: false,
    parseProvider: null,
    chunkCount: 0,
    embeddingStatus: "pending",
    embeddingProvider: null,
    embeddingModel: null,
    embeddingsStale: false,
    lastProcessingError: null,
    latestProcessingJob: null,
    metadata: {},
    processedAt: null,
    updatedAt: "2026-03-04T09:00:00.000Z",
    ...overrides,
  } as ArchiveDocument;
}

export function testRecord(
  document: ArchiveDocument,
  overrides: {
    cachedAt?: string;
    lastViewedAt?: string;
    fileUri?: string | null;
    fileStorageBytes?: number;
    text?: string[];
  } = {},
): CachedDocumentRecord {
  return {
    document,
    text: {
      documentId: document.id,
      blocks: (overrides.text ?? []).map((text, lineIndex) => ({
        documentId: document.id,
        page: 1,
        lineIndex,
        text,
      })),
    },
    history: { documentId: document.id, items: [] },
    fileUri: overrides.fileUri ?? null,
    cachedAt: overrides.cachedAt ?? "2026-03-04T09:00:00.000Z",
    lastViewedAt: overrides.lastViewedAt ?? "2026-03-04T09:00:00.000Z",
    fileStorageBytes: overrides.fileStorageBytes ?? 0,
  };
}
