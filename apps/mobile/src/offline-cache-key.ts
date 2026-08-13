/**
 * The key that encrypts one archive's offline copy.
 *
 * The copy holds document metadata, every recognised word, and the file bytes
 * themselves. iOS sandboxing and Data Protection cover a locked device, but the
 * copy also lands in device backups and is readable on an extracted or rooted
 * one — and the app already had a keystore it simply was not using for this.
 *
 * The rule is desktop's: refuse rather than degrade. Without a keystore there is
 * no key, and without a key there is no cache. Falling back to plaintext would
 * turn a missing keystore into a silent downgrade, which is the failure mode this
 * exists to prevent.
 */

export class SecureStoreUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("The device keystore is unavailable, so the offline copy stays disabled.");
    this.name = "SecureStoreUnavailableError";
    this.cause = cause;
  }
}

/** The slice of `expo-secure-store` this needs, named so tests can supply it. */
export type SecureKeyStore = {
  isAvailableAsync(): Promise<boolean>;
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

export type RandomBytes = (byteCount: number) => Uint8Array;

/** 256 bits, as SQLCipher expects for a raw key. */
export const CACHE_KEY_BYTES = 32;

function toHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isValidKey(value: string | null): value is string {
  return typeof value === "string" && new RegExp(`^[0-9a-f]{${CACHE_KEY_BYTES * 2}}$`).test(value);
}

function keyNameFor(scope: string) {
  // SecureStore keys allow only word characters, dots and dashes.
  return `openkeep.cache-key.${scope}`.replace(/[^\w.-]/g, "-");
}

/**
 * The key for `scope`, minted on first use.
 *
 * `recreated` reports that a key existed and was unusable — a keystore reset, a
 * restored backup on a new device. The ciphertext it protected is unrecoverable,
 * so the caller starts an empty cache rather than retrying a database it can
 * never open.
 */
export async function loadOrCreateCacheKey({
  scope,
  store,
  randomBytes,
}: {
  scope: string;
  store: SecureKeyStore;
  randomBytes: RandomBytes;
}): Promise<{ key: string; recreated: boolean }> {
  let available: boolean;
  try {
    available = await store.isAvailableAsync();
  } catch (error) {
    throw new SecureStoreUnavailableError(error);
  }
  if (!available) {
    throw new SecureStoreUnavailableError();
  }

  const name = keyNameFor(scope);
  let existing: string | null = null;
  let readFailed = false;
  try {
    existing = await store.getItemAsync(name);
  } catch {
    // A key that cannot be read is a key that is gone, as far as the data it
    // protected is concerned.
    readFailed = true;
  }

  if (isValidKey(existing)) {
    return { key: existing, recreated: false };
  }

  const key = toHex(randomBytes(CACHE_KEY_BYTES));
  try {
    await store.setItemAsync(name, key);
  } catch (error) {
    // A keystore that will not hold the key cannot protect the cache either.
    throw new SecureStoreUnavailableError(error);
  }

  // A key that was present but unusable means the old ciphertext is lost; a
  // first-run mint is not a recreation.
  return { key, recreated: readFailed || existing !== null };
}

export async function forgetCacheKey({
  scope,
  store,
}: {
  scope: string;
  store: SecureKeyStore;
}) {
  await store.deleteItemAsync(keyNameFor(scope)).catch(() => undefined);
}
