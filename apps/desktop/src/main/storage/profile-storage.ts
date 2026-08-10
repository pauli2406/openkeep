import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { promises as fs } from "node:fs";

import {
  DESKTOP_STORAGE_VERSION,
  type ArchiveCredentials,
  type ArchiveProfile,
  type ArchiveProfileInput,
  type CredentialCipher,
  type DesktopStorageSnapshot,
  type StorageFileSystem,
  type StoredDesktopStateV1,
} from "./types";
import { SecureStorageUnavailableError } from "./safe-storage-cipher";

const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class DesktopStorageError extends Error {
  constructor(
    message = "Desktop credential storage could not be read safely.",
  ) {
    super(message);
    this.name = "DesktopStorageError";
  }
}

export class DesktopCredentialError extends Error {
  constructor(
    message = "Stored desktop credentials could not be read safely.",
  ) {
    super(message);
    this.name = "DesktopCredentialError";
  }
}

export interface ProfileStorageOptions {
  filePath: string;
  cipher: CredentialCipher;
  fileSystem?: StorageFileSystem;
  createId?: () => string;
  now?: () => Date;
}

const nodeFileSystem: StorageFileSystem = {
  mkdir: (path, options) => fs.mkdir(path, options),
  readFile: (path, encoding) => fs.readFile(path, encoding),
  writeFile: (path, data, options) => fs.writeFile(path, data, options),
  rename: (from, to) => fs.rename(from, to),
  unlink: (path) => fs.unlink(path),
};

function emptyState(): StoredDesktopStateV1 {
  return {
    version: DESKTOP_STORAGE_VERSION,
    lastActiveProfileId: null,
    profiles: {},
    credentialBlobs: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function isValidTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function isSafeArchiveUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function parseProfile(value: unknown, expectedId: string): ArchiveProfile {
  if (!isRecord(value)) {
    throw new DesktopStorageError();
  }

  const { id, archiveUrl, label, allowInsecureHttp, createdAt, updatedAt } = value;
  if (
    typeof id !== "string" ||
    id !== expectedId ||
    !UUID_PATTERN.test(id) ||
    !isSafeArchiveUrl(archiveUrl) ||
    (label !== undefined && typeof label !== "string") ||
    (allowInsecureHttp !== undefined && typeof allowInsecureHttp !== "boolean") ||
    !isValidTimestamp(createdAt) ||
    !isValidTimestamp(updatedAt)
  ) {
    throw new DesktopStorageError();
  }

  return {
    id,
    archiveUrl,
    ...(label === undefined ? {} : { label }),
    allowInsecureHttp: allowInsecureHttp ?? false,
    createdAt,
    updatedAt,
  };
}

function parseState(serialized: string): StoredDesktopStateV1 {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new DesktopStorageError();
  }

  if (!isRecord(value) || value.version !== DESKTOP_STORAGE_VERSION) {
    throw new DesktopStorageError();
  }

  const { lastActiveProfileId, profiles, credentialBlobs } = value;
  if (
    (lastActiveProfileId !== null && typeof lastActiveProfileId !== "string") ||
    !isRecord(profiles) ||
    !isRecord(credentialBlobs)
  ) {
    throw new DesktopStorageError();
  }

  const parsedProfiles: Record<string, ArchiveProfile> = {};
  const profileIds = Object.keys(profiles);
  const blobIds = Object.keys(credentialBlobs);

  for (const id of profileIds) {
    parsedProfiles[id] = parseProfile(profiles[id], id);
  }

  if (
    profileIds.length !== blobIds.length ||
    profileIds.some(
      (id) =>
        typeof credentialBlobs[id] !== "string" ||
        credentialBlobs[id].length === 0,
    ) ||
    blobIds.some((id) => !(id in parsedProfiles)) ||
    (lastActiveProfileId !== null && !(lastActiveProfileId in parsedProfiles))
  ) {
    throw new DesktopStorageError();
  }

  return {
    version: DESKTOP_STORAGE_VERSION,
    lastActiveProfileId,
    profiles: parsedProfiles,
    credentialBlobs: credentialBlobs as Record<string, string>,
  };
}

function normalizeCredentials(
  credentials: ArchiveCredentials,
): ArchiveCredentials {
  const hasClientId =
    typeof credentials.cfAccessClientId === "string" &&
    credentials.cfAccessClientId.length > 0;
  const hasClientSecret =
    typeof credentials.cfAccessClientSecret === "string" &&
    credentials.cfAccessClientSecret.length > 0;

  if (
    typeof credentials.apiToken !== "string" ||
    credentials.apiToken.length === 0 ||
    hasClientId !== hasClientSecret
  ) {
    throw new DesktopCredentialError("Desktop credentials are incomplete.");
  }

  return {
    apiToken: credentials.apiToken,
    ...(hasClientId
      ? {
          cfAccessClientId: credentials.cfAccessClientId,
          cfAccessClientSecret: credentials.cfAccessClientSecret,
        }
      : {}),
  };
}

function parseCredentials(serialized: string): ArchiveCredentials {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new DesktopCredentialError();
  }

  if (
    !isRecord(value) ||
    (value.cfAccessClientId !== undefined &&
      typeof value.cfAccessClientId !== "string") ||
    (value.cfAccessClientSecret !== undefined &&
      typeof value.cfAccessClientSecret !== "string")
  ) {
    throw new DesktopCredentialError();
  }

  try {
    return normalizeCredentials({
      apiToken: value.apiToken as string,
      cfAccessClientId: value.cfAccessClientId as string | undefined,
      cfAccessClientSecret: value.cfAccessClientSecret as string | undefined,
    });
  } catch {
    throw new DesktopCredentialError();
  }
}

export class ProfileStorage {
  readonly #filePath: string;
  readonly #cipher: CredentialCipher;
  readonly #fileSystem: StorageFileSystem;
  readonly #createId: () => string;
  readonly #now: () => Date;

  constructor(options: ProfileStorageOptions) {
    this.#filePath = options.filePath;
    this.#cipher = options.cipher;
    this.#fileSystem = options.fileSystem ?? nodeFileSystem;
    this.#createId = options.createId ?? randomUUID;
    this.#now = options.now ?? (() => new Date());
  }

  async assertSecureStorageAvailable(): Promise<void> {
    await this.#cipher.assertAvailable?.();
  }

  async snapshot(): Promise<DesktopStorageSnapshot> {
    const state = await this.#readState();
    return {
      lastActiveProfileId: state.lastActiveProfileId,
      profiles: Object.values(state.profiles),
    };
  }

  async getCredentials(profileId: string): Promise<ArchiveCredentials | null> {
    const state = await this.#readState();
    const blob = state.credentialBlobs[profileId];
    if (blob === undefined) {
      return null;
    }

    try {
      const encrypted = Buffer.from(blob, "base64");
      if (encrypted.length === 0 || encrypted.toString("base64") !== blob) {
        throw new DesktopCredentialError();
      }
      const plaintext = await this.#cipher.decrypt(encrypted);
      return parseCredentials(plaintext);
    } catch (error) {
      if (error instanceof DesktopCredentialError) {
        throw error;
      }
      if (error instanceof SecureStorageUnavailableError) {
        throw error;
      }
      throw new DesktopCredentialError();
    }
  }

  async getActiveProfile(): Promise<{
    profile: ArchiveProfile;
    credentials: ArchiveCredentials;
  } | null> {
    const state = await this.#readState();
    if (state.lastActiveProfileId === null) {
      return null;
    }

    const credentials = await this.getCredentials(state.lastActiveProfileId);
    if (credentials === null) {
      throw new DesktopCredentialError();
    }

    return {
      profile: state.profiles[state.lastActiveProfileId],
      credentials,
    };
  }

  async saveProfile(
    input: ArchiveProfileInput,
    credentials: ArchiveCredentials,
  ): Promise<ArchiveProfile> {
    if (!isSafeArchiveUrl(input.archiveUrl)) {
      throw new DesktopStorageError("Archive URL is invalid.");
    }
    if (input.label !== undefined && typeof input.label !== "string") {
      throw new DesktopStorageError("Archive profile metadata is invalid.");
    }

    const normalizedCredentials = normalizeCredentials(credentials);
    const state = await this.#readState();
    const id = input.id ?? this.#createId();
    if (!UUID_PATTERN.test(id)) {
      throw new DesktopStorageError("Archive profile identifier is invalid.");
    }

    const existing = state.profiles[id];
    const timestamp = this.#now().toISOString();
    const profile: ArchiveProfile = {
      id,
      archiveUrl: input.archiveUrl,
      ...(input.label === undefined ? {} : { label: input.label }),
      allowInsecureHttp: input.allowInsecureHttp ?? existing?.allowInsecureHttp ?? false,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    let encrypted: Uint8Array;
    try {
      encrypted = await this.#cipher.encrypt(
        JSON.stringify(normalizedCredentials),
      );
    } catch (error) {
      if (error instanceof SecureStorageUnavailableError) {
        throw error;
      }
      throw new DesktopCredentialError(
        "Desktop credentials could not be encrypted securely.",
      );
    }
    if (encrypted.length === 0) {
      throw new DesktopCredentialError(
        "Desktop credentials could not be encrypted securely.",
      );
    }

    state.profiles[id] = profile;
    state.credentialBlobs[id] = Buffer.from(encrypted).toString("base64");
    state.lastActiveProfileId = id;
    await this.#writeState(state);

    return profile;
  }

  async setActiveProfile(profileId: string): Promise<void> {
    const state = await this.#readState();
    if (!(profileId in state.profiles)) {
      throw new DesktopStorageError("Archive profile was not found.");
    }
    state.lastActiveProfileId = profileId;
    await this.#writeState(state);
  }

  async deleteProfile(profileId: string): Promise<void> {
    const state = await this.#readState();
    if (!(profileId in state.profiles)) {
      return;
    }

    delete state.profiles[profileId];
    delete state.credentialBlobs[profileId];
    if (state.lastActiveProfileId === profileId) {
      state.lastActiveProfileId = Object.keys(state.profiles)[0] ?? null;
    }

    if (Object.keys(state.profiles).length === 0) {
      try {
        await this.#fileSystem.unlink(this.#filePath);
      } catch (error) {
        if (!isFileNotFound(error)) {
          throw new DesktopStorageError(
            "Desktop credential storage could not be cleared safely.",
          );
        }
      }
      return;
    }

    await this.#writeState(state);
  }

  async #readState(): Promise<StoredDesktopStateV1> {
    let serialized: string;
    try {
      serialized = await this.#fileSystem.readFile(this.#filePath, "utf8");
    } catch (error) {
      if (isFileNotFound(error)) {
        return emptyState();
      }
      throw new DesktopStorageError();
    }
    return parseState(serialized);
  }

  async #writeState(state: StoredDesktopStateV1): Promise<void> {
    const temporaryPath = `${this.#filePath}.${this.#createId()}.tmp`;
    try {
      await this.#fileSystem.mkdir(dirname(this.#filePath), {
        recursive: true,
        mode: DIRECTORY_MODE,
      });
      await this.#fileSystem.writeFile(temporaryPath, JSON.stringify(state), {
        encoding: "utf8",
        mode: FILE_MODE,
        flag: "wx",
      });
      await this.#fileSystem.rename(temporaryPath, this.#filePath);
    } catch {
      try {
        await this.#fileSystem.unlink(temporaryPath);
      } catch {
        // Best-effort cleanup only; never replace the original failure with details.
      }
      throw new DesktopStorageError(
        "Desktop credential storage could not be written safely.",
      );
    }
  }
}
