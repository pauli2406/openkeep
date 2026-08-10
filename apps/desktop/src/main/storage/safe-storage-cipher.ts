import type { CredentialCipher } from "./types";

export type LinuxSecureStorageBackend =
  | "basic_text"
  | "gnome_libsecret"
  | "kwallet"
  | "kwallet5"
  | "kwallet6"
  | "unknown";

export interface ElectronSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(ciphertext: Buffer): string;
  getSelectedStorageBackend(): LinuxSecureStorageBackend;
}

export class SecureStorageUnavailableError extends Error {
  constructor() {
    super(
      "Secure credential storage is unavailable. On Linux, install and unlock a Secret Service/libsecret or KWallet keyring.",
    );
    this.name = "SecureStorageUnavailableError";
  }
}

const secureLinuxBackends = new Set<LinuxSecureStorageBackend>([
  "gnome_libsecret",
  "kwallet",
  "kwallet5",
  "kwallet6",
]);

export function createSafeStorageCipher(
  safeStorage: ElectronSafeStorage,
  platform: NodeJS.Platform = process.platform,
): CredentialCipher {
  const assertSecureStorageAvailable = () => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new SecureStorageUnavailableError();
    }

    if (
      platform === "linux" &&
      !secureLinuxBackends.has(safeStorage.getSelectedStorageBackend())
    ) {
      throw new SecureStorageUnavailableError();
    }
  };

  return {
    encrypt(plaintext) {
      assertSecureStorageAvailable();
      return safeStorage.encryptString(plaintext);
    },
    decrypt(ciphertext) {
      assertSecureStorageAvailable();
      return safeStorage.decryptString(Buffer.from(ciphertext));
    },
  };
}
