/**
 * Opening one archive's encrypted offline copy.
 *
 * `op-sqlite` is built with SQLCipher (see the `op-sqlite` block in
 * package.json), so the whole database file is ciphertext: metadata, recognised
 * text, and the `search_text` column offline search runs `LIKE` against. Field
 * level encryption would have cost that column — every search would have had to
 * decrypt every row — which is why the cipher sits under the database rather
 * than over the values.
 *
 * The previous unencrypted database is not migrated. It is plaintext by
 * definition, its documents re-cache as they are opened, and carrying plaintext
 * into a sealed store would be work in service of nothing.
 */
import { open, type DB } from "@op-engineering/op-sqlite";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import {
  SecureStoreUnavailableError,
  loadOrCreateCacheKey,
  type RandomBytes,
  type SecureKeyStore,
} from "./offline-cache-key";
import type { OfflineDatabase, OfflineSqlParam } from "./offline-metadata-store";

/** Encrypted databases carry their own name, so the plaintext one is never opened. */
export function encryptedDatabaseName(scope: string) {
  return `openkeep-cache-enc-${scope}.db`;
}

type OpRow = Record<string, unknown>;

/**
 * Adapts op-sqlite to the handle the store already speaks. The store was written
 * against an interface for exactly this reason: the binding underneath it can
 * change without touching a single query.
 */
export function adaptOpSqlite(db: DB): OfflineDatabase & { closeSync(): void } {
  return {
    async execAsync(source: string) {
      // op-sqlite runs one statement per call; the schema arrives as a script.
      for (const statement of source.split(";")) {
        const trimmed = statement.trim();
        if (trimmed) {
          await db.execute(trimmed);
        }
      }
    },
    async runAsync(source: string, ...params: OfflineSqlParam[]) {
      return db.execute(source, params as never[]);
    },
    async getFirstAsync<T>(source: string, ...params: OfflineSqlParam[]) {
      const result = await db.execute(source, params as never[]);
      const rows = (result.rows ?? []) as OpRow[];
      return rows.length > 0 ? (rows[0] as T) : null;
    },
    async getAllAsync<T>(source: string, ...params: OfflineSqlParam[]) {
      const result = await db.execute(source, params as never[]);
      return ((result.rows ?? []) as OpRow[]) as T[];
    },
    closeSync() {
      db.close();
    },
  };
}

const expoSecureStore: SecureKeyStore = {
  isAvailableAsync: () => SecureStore.isAvailableAsync(),
  getItemAsync: (key) => SecureStore.getItemAsync(key),
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value),
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
};

const expoRandomBytes: RandomBytes = (byteCount) => Crypto.getRandomBytes(byteCount);

/**
 * Opens the encrypted database for `scope`, minting its key on first use.
 *
 * Throws `SecureStoreUnavailableError` when there is no keystore to hold the key
 * — the caller leaves the cache disabled for the session rather than writing
 * anything readable to disk.
 */
export async function openEncryptedDatabase({
  scope,
  store = expoSecureStore,
  randomBytes = expoRandomBytes,
  openDatabase = open,
}: {
  scope: string;
  store?: SecureKeyStore;
  randomBytes?: RandomBytes;
  openDatabase?: typeof open;
}): Promise<OfflineDatabase> {
  const { key, recreated } = await loadOrCreateCacheKey({ scope, store, randomBytes });
  const name = encryptedDatabaseName(scope);

  if (recreated) {
    // The key that sealed this file is gone, so every byte in it is
    // unrecoverable ciphertext. Recover to an empty cache instead of failing to
    // open the same file forever.
    try {
      openDatabase({ name, encryptionKey: key }).delete();
    } catch {
      // Nothing to delete, which is the same outcome.
    }
  }

  const db = openDatabase({ name, encryptionKey: key });
  return adaptOpSqlite(db);
}

export { SecureStoreUnavailableError };
