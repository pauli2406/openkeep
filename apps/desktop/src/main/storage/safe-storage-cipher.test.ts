import { describe, expect, it, vi } from "vitest";

import {
  createSafeStorageCipher,
  type ElectronSafeStorage,
  type LinuxSecureStorageBackend,
  SecureStorageUnavailableError,
} from "./safe-storage-cipher";

function safeStorageStub(
  options: {
    available?: boolean;
    backend?: LinuxSecureStorageBackend;
  } = {},
): ElectronSafeStorage {
  return {
    isEncryptionAvailable: vi.fn(() => options.available ?? true),
    getSelectedStorageBackend: vi.fn(
      () => options.backend ?? "gnome_libsecret",
    ),
    encryptString: vi.fn((plaintext) => Buffer.from(`encrypted:${plaintext}`)),
    decryptString: vi.fn((ciphertext) =>
      Buffer.from(ciphertext).toString("utf8").replace("encrypted:", ""),
    ),
  };
}

describe("createSafeStorageCipher", () => {
  it("uses Electron safeStorage without a plaintext fallback", async () => {
    const safeStorage = safeStorageStub();
    const cipher = createSafeStorageCipher(safeStorage, "linux");

    const ciphertext = await cipher.encrypt("secret");
    await expect(Promise.resolve(cipher.decrypt(ciphertext))).resolves.toBe(
      "secret",
    );
    expect(safeStorage.encryptString).toHaveBeenCalledWith("secret");
  });

  it("rejects Linux when encryption is unavailable", async () => {
    const safeStorage = safeStorageStub({ available: false });
    const cipher = createSafeStorageCipher(safeStorage, "linux");

    expect(() => cipher.encrypt("secret")).toThrow(
      SecureStorageUnavailableError,
    );
    expect(safeStorage.encryptString).not.toHaveBeenCalled();
  });

  it.each(["basic_text", "unknown"] as const)(
    "rejects the insecure Linux %s backend",
    async (backend) => {
      const safeStorage = safeStorageStub({ backend });
      const cipher = createSafeStorageCipher(safeStorage, "linux");

      expect(() => cipher.encrypt("secret")).toThrow(
        SecureStorageUnavailableError,
      );
      expect(() => cipher.decrypt(Buffer.from("encrypted"))).toThrow(
        SecureStorageUnavailableError,
      );
      expect(safeStorage.encryptString).not.toHaveBeenCalled();
      expect(safeStorage.decryptString).not.toHaveBeenCalled();
    },
  );

  it("does not apply Linux backend names on macOS", async () => {
    const safeStorage = safeStorageStub({ backend: "unknown" });
    const cipher = createSafeStorageCipher(safeStorage, "darwin");

    await expect(Promise.resolve(cipher.encrypt("secret"))).resolves.toEqual(
      Buffer.from("encrypted:secret"),
    );
    expect(safeStorage.getSelectedStorageBackend).not.toHaveBeenCalled();
  });
});
