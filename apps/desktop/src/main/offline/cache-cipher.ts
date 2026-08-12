import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCM,
} from "node:crypto";
import type { CredentialCipher } from "../storage/types";

/**
 * Encryption for the offline document cache.
 *
 * Cached documents can hold sensitive personal information, so nothing in the
 * cache — records, file bytes, or the index — is written in plaintext. Content
 * is encrypted with AES-256-GCM under a random per-profile data key, and only
 * that key is wrapped by the operating-system credential store, following the
 * credential-cipher pattern: `safeStorage` is good at protecting one small
 * secret, not at streaming megabytes of document bytes.
 *
 * When only an insecure keyring is available, the wrapped key cannot be
 * created or opened — `CredentialCipher` throws — and the cache stays
 * disabled rather than falling back to plaintext.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type CacheKeyFile = {
  read(): Promise<Buffer | null>;
  write(wrapped: Buffer): Promise<void>;
};

export async function loadOrCreateCacheKey(
  credentialCipher: CredentialCipher,
  keyFile: CacheKeyFile,
  createKey: () => Buffer = () => randomBytes(KEY_BYTES),
): Promise<{ key: Buffer; recreated: boolean }> {
  await credentialCipher.assertAvailable?.();
  const wrapped = await keyFile.read();
  if (wrapped) {
    try {
      const key = Buffer.from(await credentialCipher.decrypt(wrapped), "base64");
      if (key.length === KEY_BYTES) {
        return { key, recreated: false };
      }
    } catch {
      // The operating-system store can no longer unwrap this key — an OS
      // keychain reset, a migrated home directory. The sealed content is
      // unrecoverable either way; the caller wipes it and starts fresh
      // rather than wedging offline mode forever.
    }
  }
  const key = createKey();
  await keyFile.write(Buffer.from(await credentialCipher.encrypt(key.toString("base64"))));
  return { key, recreated: wrapped !== null };
}

export function encryptBuffer(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptBuffer(key: Buffer, sealed: Buffer): Buffer {
  if (sealed.length < IV_BYTES + TAG_BYTES) {
    throw new Error("The sealed cache entry is truncated.");
  }
  const iv = sealed.subarray(0, IV_BYTES);
  const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(sealed.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]);
}

/**
 * Streaming encryption for document files: the IV leads the stream and the
 * auth tag trails it, so a file of any size is encrypted chunk by chunk
 * without ever being resident in memory — mobile's whole-file base64 buffering
 * is exactly what this avoids.
 */
export function createEncryptStream(key: Buffer): {
  header: Buffer;
  cipher: CipherGCM;
  trailer(): Buffer;
} {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  return {
    header: iv,
    cipher,
    trailer: () => cipher.getAuthTag(),
  };
}

export function decryptFileBuffer(key: Buffer, sealed: Buffer): Buffer {
  if (sealed.length < IV_BYTES + TAG_BYTES) {
    throw new Error("The sealed cache file is truncated.");
  }
  const iv = sealed.subarray(0, IV_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(sealed.subarray(IV_BYTES, sealed.length - TAG_BYTES)),
    decipher.final(),
  ]);
}
