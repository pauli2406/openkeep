export const DESKTOP_STORAGE_VERSION = 1 as const;

export interface ArchiveProfile {
  id: string;
  archiveUrl: string;
  label?: string;
  allowInsecureHttp: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ArchiveProfileInput {
  id?: string;
  archiveUrl: string;
  label?: string;
  allowInsecureHttp?: boolean;
}

export interface ArchiveCredentials {
  apiToken: string;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
}

export interface ArchiveProfileWithCredentials {
  profile: ArchiveProfile;
  credentials: ArchiveCredentials;
}

export interface StoredDesktopStateV1 {
  version: typeof DESKTOP_STORAGE_VERSION;
  lastActiveProfileId: string | null;
  profiles: Record<string, ArchiveProfile>;
  credentialBlobs: Record<string, string>;
}

export interface DesktopStorageSnapshot {
  lastActiveProfileId: string | null;
  profiles: ArchiveProfile[];
}

export interface CredentialCipher {
  assertAvailable?(): Promise<void> | void;
  encrypt(plaintext: string): Promise<Uint8Array> | Uint8Array;
  decrypt(ciphertext: Uint8Array): Promise<string> | string;
}

export interface StorageFileSystem {
  mkdir(
    path: string,
    options: { recursive: true; mode: number },
  ): Promise<string | undefined | void>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeFile(
    path: string,
    data: string,
    options: { encoding: "utf8"; mode: number; flag: "wx" },
  ): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}
