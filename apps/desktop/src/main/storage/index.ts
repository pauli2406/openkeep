export { ProfileStorage } from "./profile-storage";
export { createArchiveProfileRepository } from "./archive-profile-repository";
export { DesktopCredentialError, DesktopStorageError } from "./profile-storage";
export {
  createSafeStorageCipher,
  SecureStorageUnavailableError,
} from "./safe-storage-cipher";
export type {
  ElectronSafeStorage,
  LinuxSecureStorageBackend,
} from "./safe-storage-cipher";
export type {
  ArchiveCredentials,
  ArchiveProfile,
  ArchiveProfileInput,
  ArchiveProfileWithCredentials,
  CredentialCipher,
  DesktopStorageSnapshot,
  StorageFileSystem,
  StoredDesktopStateV1,
} from "./types";
export type { ProfileStorageOptions } from "./profile-storage";
export { DESKTOP_STORAGE_VERSION } from "./types";
