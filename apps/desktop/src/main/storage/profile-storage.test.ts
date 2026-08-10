import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DesktopCredentialError,
  DesktopStorageError,
  ProfileStorage,
} from "./profile-storage";
import {
  createSafeStorageCipher,
  SecureStorageUnavailableError,
} from "./safe-storage-cipher";
import type { CredentialCipher, StorageFileSystem } from "./types";

const PROFILE_ID = "c6315ec9-9b56-45f3-a04d-8f4bc371fbef";
const TEMP_ID = "209057a9-17a5-4608-bdc4-5746722459ca";
const API_TOKEN = "openkeep-secret-token";
const CF_CLIENT_ID = "cloudflare-client-id";
const CF_CLIENT_SECRET = "cloudflare-client-secret";

const createdDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function createTestPath(): Promise<string> {
  const directory = await fs.mkdtemp(join(tmpdir(), "openkeep-storage-test-"));
  createdDirectories.push(directory);
  return join(directory, "nested", "profiles.json");
}

function xorCipher(): CredentialCipher {
  return {
    encrypt(plaintext) {
      return Buffer.from(plaintext).map((byte) => byte ^ 0xa5);
    },
    decrypt(ciphertext) {
      return Buffer.from(
        Buffer.from(ciphertext).map((byte) => byte ^ 0xa5),
      ).toString("utf8");
    },
  };
}

describe("ProfileStorage", () => {
  it("roundtrips a multi-profile-ready active profile with encrypted credentials", async () => {
    const filePath = await createTestPath();
    const storage = new ProfileStorage({
      filePath,
      cipher: xorCipher(),
      createId: () => PROFILE_ID,
      now: () => new Date("2026-08-10T08:00:00.000Z"),
    });

    const profile = await storage.saveProfile(
      { archiveUrl: "https://keep.example.test", label: "Home" },
      {
        apiToken: API_TOKEN,
        cfAccessClientId: CF_CLIENT_ID,
        cfAccessClientSecret: CF_CLIENT_SECRET,
      },
    );

    expect(profile).toEqual({
      id: PROFILE_ID,
      archiveUrl: "https://keep.example.test",
      label: "Home",
      createdAt: "2026-08-10T08:00:00.000Z",
      updatedAt: "2026-08-10T08:00:00.000Z",
    });
    await expect(storage.snapshot()).resolves.toEqual({
      lastActiveProfileId: PROFILE_ID,
      profiles: [profile],
    });
    await expect(storage.getActiveProfile()).resolves.toEqual({
      profile,
      credentials: {
        apiToken: API_TOKEN,
        cfAccessClientId: CF_CLIENT_ID,
        cfAccessClientSecret: CF_CLIENT_SECRET,
      },
    });
  });

  it("does not persist raw credential values and creates the state file with mode 0600", async () => {
    const filePath = await createTestPath();
    const storage = new ProfileStorage({
      filePath,
      cipher: xorCipher(),
      createId: () => PROFILE_ID,
    });

    await storage.saveProfile(
      { archiveUrl: "https://keep.example.test" },
      {
        apiToken: API_TOKEN,
        cfAccessClientId: CF_CLIENT_ID,
        cfAccessClientSecret: CF_CLIENT_SECRET,
      },
    );

    const serialized = await fs.readFile(filePath, "utf8");
    expect(serialized).not.toContain(API_TOKEN);
    expect(serialized).not.toContain(CF_CLIENT_ID);
    expect(serialized).not.toContain(CF_CLIENT_SECRET);
    expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it("preserves a profile's stable id and creation time when updating it", async () => {
    const filePath = await createTestPath();
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date("2026-08-10T08:00:00.000Z"))
      .mockReturnValueOnce(new Date("2026-08-10T09:00:00.000Z"));
    const storage = new ProfileStorage({
      filePath,
      cipher: xorCipher(),
      createId: () => PROFILE_ID,
      now,
    });

    const original = await storage.saveProfile(
      { archiveUrl: "https://keep.example.test" },
      { apiToken: API_TOKEN },
    );
    const updated = await storage.saveProfile(
      {
        id: original.id,
        archiveUrl: "https://new.example.test",
      },
      { apiToken: "replacement-token" },
    );

    expect(updated.id).toBe(original.id);
    expect(updated.createdAt).toBe(original.createdAt);
    expect(updated.updatedAt).toBe("2026-08-10T09:00:00.000Z");
  });

  it.each([
    ["invalid JSON", "not-json"],
    [
      "an unknown version",
      JSON.stringify({
        version: 2,
        lastActiveProfileId: null,
        profiles: {},
        credentialBlobs: {},
      }),
    ],
    [
      "a credential blob without a matching profile",
      JSON.stringify({
        version: 1,
        lastActiveProfileId: null,
        profiles: {},
        credentialBlobs: { [PROFILE_ID]: "ZW5jcnlwdGVk" },
      }),
    ],
  ])("fails closed for %s", async (_case, serialized) => {
    const filePath = await createTestPath();
    await fs.mkdir(join(filePath, ".."), { recursive: true });
    await fs.writeFile(filePath, serialized, { mode: 0o600 });
    const storage = new ProfileStorage({ filePath, cipher: xorCipher() });

    await expect(storage.snapshot()).rejects.toBeInstanceOf(
      DesktopStorageError,
    );
  });

  it("fails closed when a credential blob cannot be decrypted", async () => {
    const filePath = await createTestPath();
    const writer = new ProfileStorage({
      filePath,
      cipher: xorCipher(),
      createId: () => PROFILE_ID,
    });
    await writer.saveProfile(
      { archiveUrl: "https://keep.example.test" },
      { apiToken: API_TOKEN },
    );
    const reader = new ProfileStorage({
      filePath,
      cipher: {
        encrypt: vi.fn(),
        decrypt: () => {
          throw new Error(API_TOKEN);
        },
      },
    });

    await expect(reader.getCredentials(PROFILE_ID)).rejects.toEqual(
      new DesktopCredentialError(),
    );
  });

  it("writes a unique temporary file before atomically renaming it", async () => {
    const calls: string[] = [];
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    const fileSystem: StorageFileSystem = {
      mkdir: vi.fn(async () => {
        calls.push("mkdir");
      }),
      readFile: vi.fn(async () => {
        throw missing;
      }),
      writeFile: vi.fn(async (_path, _data, options) => {
        calls.push(`write:${options.mode.toString(8)}:${options.flag}`);
      }),
      rename: vi.fn(async () => {
        calls.push("rename");
      }),
      unlink: vi.fn(async () => {
        calls.push("unlink");
      }),
    };
    const storage = new ProfileStorage({
      filePath: "/test/openkeep/profiles.json",
      cipher: xorCipher(),
      fileSystem,
      createId: vi
        .fn<() => string>()
        .mockReturnValueOnce(PROFILE_ID)
        .mockReturnValueOnce(TEMP_ID),
    });

    await storage.saveProfile(
      { archiveUrl: "https://keep.example.test" },
      { apiToken: API_TOKEN },
    );

    expect(calls).toEqual(["mkdir", "write:600:wx", "rename"]);
    expect(fileSystem.writeFile).toHaveBeenCalledWith(
      `/test/openkeep/profiles.json.${TEMP_ID}.tmp`,
      expect.any(String),
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    expect(fileSystem.rename).toHaveBeenCalledWith(
      `/test/openkeep/profiles.json.${TEMP_ID}.tmp`,
      "/test/openkeep/profiles.json",
    );
  });

  it("deletes the last profile and its credential state", async () => {
    const filePath = await createTestPath();
    const storage = new ProfileStorage({
      filePath,
      cipher: xorCipher(),
      createId: () => PROFILE_ID,
    });
    await storage.saveProfile(
      { archiveUrl: "https://keep.example.test" },
      { apiToken: API_TOKEN },
    );

    await storage.deleteProfile(PROFILE_ID);

    await expect(fs.stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(storage.getCredentials(PROFILE_ID)).resolves.toBeNull();
    await expect(storage.snapshot()).resolves.toEqual({
      lastActiveProfileId: null,
      profiles: [],
    });
  });

  it("requires Cloudflare Access credentials as a complete pair", async () => {
    const storage = new ProfileStorage({
      filePath: await createTestPath(),
      cipher: xorCipher(),
      createId: () => PROFILE_ID,
    });

    await expect(
      storage.saveProfile(
        { archiveUrl: "https://keep.example.test" },
        { apiToken: API_TOKEN, cfAccessClientId: CF_CLIENT_ID },
      ),
    ).rejects.toEqual(
      new DesktopCredentialError("Desktop credentials are incomplete."),
    );
  });

  it("preserves the actionable Linux keyring error without writing state", async () => {
    const filePath = await createTestPath();
    const storage = new ProfileStorage({
      filePath,
      cipher: createSafeStorageCipher(
        {
          isEncryptionAvailable: () => true,
          getSelectedStorageBackend: () => "basic_text",
          encryptString: vi.fn(),
          decryptString: vi.fn(),
        },
        "linux",
      ),
      createId: () => PROFILE_ID,
    });

    await expect(
      storage.saveProfile(
        { archiveUrl: "https://keep.example.test" },
        { apiToken: API_TOKEN },
      ),
    ).rejects.toBeInstanceOf(SecureStorageUnavailableError);
    await expect(fs.stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
