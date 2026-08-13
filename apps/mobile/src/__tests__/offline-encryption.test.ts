/**
 * Proof that the offline copy is ciphertext at rest.
 *
 * Every other offline suite runs against Node's own SQLite, which has no
 * SQLCipher — so they can exercise the queries but cannot say anything about what
 * lands on disk. This one drives the *same store code* through a real
 * SQLCipher-capable driver, writes a document with distinctive text, and then
 * reads the raw file: if any of it comes back in the clear, the property this
 * story exists for is broken.
 *
 * What this does not prove is that the shipped app's op-sqlite build has
 * SQLCipher compiled in — that is a native build flag, checked at startup by
 * `isSQLCipher()` and on a device. What it does prove is that the schema, the
 * writes, and the journal settings around them keep nothing readable outside the
 * cipher, which is the part that can regress in ordinary code review.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import {
  createOfflineMetadataStore,
  type OfflineDatabase,
  type OfflineSqlParam,
} from "../offline-metadata-store";
import { testDocument, testRecord } from "./offline-test-doubles";

/**
 * Markers that must never appear in the file, in any encoding. Ordinary words
 * with spaces, deliberately: a high-entropy token here reads as a leaked
 * credential to the secret scanner, and these are the opposite of secrets.
 */
const MARKER_TITLE = "Kontoauszug vom Vorjahr";
const MARKER_OCR = "Zaehlernummer vier sieben eins eins";
const MARKER_BYTES = "pdf bytes marker line";
const KEY = "a".repeat(64);

function openEncrypted(path: string, key: string) {
  const db = new Database(path);
  db.pragma("cipher='sqlcipher'");
  db.pragma(`key='${key}'`);
  return db;
}

/** The store's handle, over the encrypted driver. */
function adapt(db: Database.Database): OfflineDatabase {
  const bind = (params: OfflineSqlParam[]) =>
    params.map((param: unknown) =>
      param instanceof Uint8Array ? Buffer.from(param) : (param as never),
    );
  return {
    async execAsync(source) {
      db.exec(source);
    },
    async runAsync(source, ...params) {
      return db.prepare(source).run(...bind(params));
    },
    async getFirstAsync<T>(source: string, ...params: OfflineSqlParam[]) {
      return (db.prepare(source).get(...bind(params)) as T) ?? null;
    },
    async getAllAsync<T>(source: string, ...params: OfflineSqlParam[]) {
      return db.prepare(source).all(...bind(params)) as T[];
    },
  };
}

describe("what lands on disk", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "openkeep-cache-"));
    path = join(dir, "cache.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function cacheAMarkedDocument() {
    const db = openEncrypted(path, KEY);
    const store = createOfflineMetadataStore({ openDatabase: async () => adapt(db) });
    const document = testDocument({ title: MARKER_TITLE });

    await store.upsertCachedDocument(testRecord(document, { text: [MARKER_OCR] }));
    await store.writeFileChunks(
      document.id,
      new Uint8Array(Buffer.from(`%PDF-1.7 ${MARKER_BYTES}`)),
    );
    db.close();
    return document;
  }

  function everyFileInTheDirectory() {
    return readdirSync(dir).map((name) => ({
      name,
      bytes: readFileSync(join(dir, name)),
    }));
  }

  it("writes no readable title, recognised text, or document bytes", async () => {
    await cacheAMarkedDocument();

    for (const file of everyFileInTheDirectory()) {
      for (const secret of [MARKER_TITLE, MARKER_OCR, MARKER_BYTES]) {
        // Both encodings: SQLite stores TEXT as UTF-8, and a UTF-16 slip would
        // still be plaintext.
        expect(file.bytes.includes(Buffer.from(secret, "utf8"))).toBe(false);
        expect(file.bytes.includes(Buffer.from(secret, "utf16le"))).toBe(false);
      }
    }
  });

  it("leaves nothing readable in the journal either", async () => {
    // The journal is where a half-finished write lives. SQLCipher encrypts it
    // too, and a `journal_mode` set before the key would not.
    await cacheAMarkedDocument();

    const names = everyFileInTheDirectory().map((file) => file.name);
    expect(names).toContain("cache.db");
    for (const file of everyFileInTheDirectory()) {
      expect(file.bytes.includes(Buffer.from(MARKER_OCR, "utf8"))).toBe(false);
    }
  });

  it("does not even look like a SQLite database from outside", async () => {
    await cacheAMarkedDocument();

    // An unencrypted file starts with "SQLite format 3"; a sealed one does not.
    const header = readFileSync(path).subarray(0, 15).toString("utf8");
    expect(header).not.toBe("SQLite format 3");
  });

  it("cannot be read with the wrong key", async () => {
    await cacheAMarkedDocument();

    const wrong = openEncrypted(path, "b".repeat(64));
    expect(() => wrong.prepare("SELECT COUNT(*) FROM cached_documents").get()).toThrow();
    wrong.close();
  });

  it("cannot be read with no key at all", async () => {
    await cacheAMarkedDocument();

    const plain = new Database(path);
    expect(() => plain.prepare("SELECT COUNT(*) FROM cached_documents").get()).toThrow();
    plain.close();
  });

  it("reads back everything it stored, with the key", async () => {
    // The point is not merely that it is unreadable — it has to be readable to
    // the app, or the copy is useless.
    const document = await cacheAMarkedDocument();

    const db = openEncrypted(path, KEY);
    const store = createOfflineMetadataStore({ openDatabase: async () => adapt(db) });

    const cached = await store.getCachedDocument(document.id);
    expect(cached?.document.title).toBe(MARKER_TITLE);
    expect(cached?.text.blocks[0].text).toBe(MARKER_OCR);

    // Offline search still runs as SQL over the encrypted column, which is the
    // reason the cipher sits under the database rather than over the values.
    const found = await store.searchCachedDocuments({ query: "vorjahr" });
    expect(found.items.map((item) => item.title)).toEqual([MARKER_TITLE]);

    const chunks = await store.readFileChunks(document.id);
    expect(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8")).toContain(
      MARKER_BYTES,
    );
    db.close();
  });
});
