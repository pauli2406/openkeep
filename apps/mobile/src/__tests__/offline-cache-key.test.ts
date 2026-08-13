/**
 * The key that encrypts one archive's offline copy.
 *
 * The rule under test is desktop's, and it is the one that matters: refuse
 * rather than degrade. Without a keystore there is no key, and without a key
 * there is no cache — falling back to plaintext would turn a missing keystore
 * into a silent downgrade, which is the failure this exists to prevent.
 */
import {
  CACHE_KEY_BYTES,
  SecureStoreUnavailableError,
  forgetCacheKey,
  loadOrCreateCacheKey,
  type SecureKeyStore,
} from "../offline-cache-key";

function createKeyStore(options: {
  available?: boolean;
  entries?: Record<string, string>;
  failRead?: boolean;
  failWrite?: boolean;
  failAvailability?: boolean;
} = {}) {
  const entries = new Map(Object.entries(options.entries ?? {}));
  const store: SecureKeyStore = {
    isAvailableAsync: async () => {
      if (options.failAvailability) {
        throw new Error("keystore exploded");
      }
      return options.available ?? true;
    },
    getItemAsync: async (key) => {
      if (options.failRead) {
        throw new Error("cannot read");
      }
      return entries.get(key) ?? null;
    },
    setItemAsync: async (key, value) => {
      if (options.failWrite) {
        throw new Error("cannot write");
      }
      entries.set(key, value);
    },
    deleteItemAsync: async (key) => {
      entries.delete(key);
    },
  };
  return { store, entries };
}

/** Deterministic bytes; randomness is the platform's job, not this test's. */
const fixedBytes = (byteCount: number) => new Uint8Array(byteCount).fill(0xab);

describe("minting a key", () => {
  it("creates one on first use, of the length SQLCipher expects", async () => {
    const { store, entries } = createKeyStore();

    const result = await loadOrCreateCacheKey({
      scope: "user--archive-example",
      store,
      randomBytes: fixedBytes,
    });

    expect(result.key).toHaveLength(CACHE_KEY_BYTES * 2);
    expect(result.key).toMatch(/^[0-9a-f]+$/);
    // A first-run mint is not a recreation: there was nothing to lose.
    expect(result.recreated).toBe(false);
    expect([...entries.values()]).toEqual([result.key]);
  });

  it("returns the same key on the next open", async () => {
    const { store } = createKeyStore();
    const first = await loadOrCreateCacheKey({
      scope: "user--archive-example",
      store,
      randomBytes: fixedBytes,
    });
    const second = await loadOrCreateCacheKey({
      scope: "user--archive-example",
      store,
      randomBytes: () => new Uint8Array(CACHE_KEY_BYTES).fill(0x01),
    });

    expect(second.key).toBe(first.key);
    expect(second.recreated).toBe(false);
  });

  it("keeps each scope's key apart", async () => {
    const { store, entries } = createKeyStore();
    let seed = 1;
    const bytes = () => new Uint8Array(CACHE_KEY_BYTES).fill(seed++);

    const alice = await loadOrCreateCacheKey({ scope: "alice--archive", store, randomBytes: bytes });
    const bob = await loadOrCreateCacheKey({ scope: "bob--archive", store, randomBytes: bytes });

    expect(alice.key).not.toBe(bob.key);
    expect(entries.size).toBe(2);
  });

  it("keeps the keystore name usable whatever the scope contains", async () => {
    const { store, entries } = createKeyStore();
    await loadOrCreateCacheKey({
      scope: "user--archive.example:8443/base",
      store,
      randomBytes: fixedBytes,
    });

    expect([...entries.keys()][0]).toMatch(/^[\w.-]+$/);
  });
});

describe("without a keystore", () => {
  it("refuses rather than returning a key", async () => {
    const { store } = createKeyStore({ available: false });

    await expect(
      loadOrCreateCacheKey({ scope: "user--archive", store, randomBytes: fixedBytes }),
    ).rejects.toBeInstanceOf(SecureStoreUnavailableError);
  });

  it("refuses when asking whether it exists throws", async () => {
    const { store } = createKeyStore({ failAvailability: true });

    await expect(
      loadOrCreateCacheKey({ scope: "user--archive", store, randomBytes: fixedBytes }),
    ).rejects.toBeInstanceOf(SecureStoreUnavailableError);
  });

  it("refuses when the key cannot be stored", async () => {
    // A keystore that will not hold the key cannot protect the copy either.
    const { store } = createKeyStore({ failWrite: true });

    await expect(
      loadOrCreateCacheKey({ scope: "user--archive", store, randomBytes: fixedBytes }),
    ).rejects.toBeInstanceOf(SecureStoreUnavailableError);
  });
});

describe("when the previous key is gone", () => {
  it("reports a recreation, so the unreadable copy can be discarded", async () => {
    // A keystore reset or a backup restored onto another device: the ciphertext
    // that key sealed is unrecoverable, so the caller starts empty rather than
    // reopening a database it can never read.
    const { store } = createKeyStore({ failRead: true });

    const result = await loadOrCreateCacheKey({
      scope: "user--archive",
      store,
      randomBytes: fixedBytes,
    });

    expect(result.recreated).toBe(true);
    expect(result.key).toHaveLength(CACHE_KEY_BYTES * 2);
  });

  it("replaces a stored value that is not a key", async () => {
    const { store } = createKeyStore({
      entries: { "openkeep.cache-key.user--archive": "truncated" },
    });

    const result = await loadOrCreateCacheKey({
      scope: "user--archive",
      store,
      randomBytes: fixedBytes,
    });

    expect(result.recreated).toBe(true);
    expect(result.key).not.toBe("truncated");
  });

  it("forgets a key when asked", async () => {
    const { store, entries } = createKeyStore();
    await loadOrCreateCacheKey({ scope: "user--archive", store, randomBytes: fixedBytes });

    await forgetCacheKey({ scope: "user--archive", store });

    expect(entries.size).toBe(0);
  });
});
