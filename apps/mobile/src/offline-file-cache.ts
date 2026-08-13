/**
 * The file half of the offline copy: downloading a document's bytes, writing
 * them where the viewer can open them, and cleaning up after itself.
 *
 * It reaches the device through an injected `OfflineFileSystem` rather than
 * `expo-file-system` directly, so the download flow — preferring the searchable
 * PDF, writing to a temporary name before moving into place, collapsing
 * concurrent downloads of the same document — is testable without a device.
 */
import * as FileSystem from "expo-file-system/legacy";
import { Buffer } from "buffer";
import type { ArchiveDocument } from "./lib";

export type OfflineFileSystem = {
  /** Where the cache lives; `documentDirectory` on a device. */
  rootDirectory: string;
  /** Evictable scratch space, excluded from backups; `cacheDirectory`. */
  scratchDirectory: string;
  makeDirectory(uri: string): Promise<void>;
  info(uri: string): Promise<{ exists: boolean; size?: number }>;
  writeBase64(uri: string, base64: string): Promise<void>;
  /** Appends raw bytes, replacing the file when `first` is set. */
  appendBytes(uri: string, bytes: Uint8Array, first: boolean): Promise<void>;
  move(from: string, to: string): Promise<void>;
  delete(uri: string): Promise<void>;
};

export type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>;

const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
  "text/plain": ".txt",
  "text/html": ".html",
  "text/csv": ".csv",
  "application/json": ".json",
  "application/xml": ".xml",
};

export function extensionForMime(mimeType: string) {
  return MIME_EXTENSIONS[mimeType] ?? ".bin";
}

export function createExpoOfflineFileSystem(): OfflineFileSystem {
  return {
    rootDirectory: FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? "",
    scratchDirectory: FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "",
    makeDirectory: (uri) => FileSystem.makeDirectoryAsync(uri, { intermediates: true }),
    info: async (uri) => {
      const info = await FileSystem.getInfoAsync(uri);
      return info.exists && "size" in info && typeof info.size === "number"
        ? { exists: true, size: info.size }
        : { exists: info.exists };
    },
    writeBase64: (uri, base64) =>
      FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 }),
    appendBytes: async (uri, bytes, first) => {
      // `expo-file-system/legacy` writes base64, so each chunk is encoded on its
      // own rather than the whole file at once — the point of chunking.
      const base64 = Buffer.from(bytes).toString("base64");
      if (first) {
        await FileSystem.writeAsStringAsync(uri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        return;
      }
      const existing = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await FileSystem.writeAsStringAsync(
        uri,
        Buffer.concat([Buffer.from(existing, "base64"), Buffer.from(bytes)]).toString("base64"),
        { encoding: FileSystem.EncodingType.Base64 },
      );
    },
    move: (from, to) => FileSystem.moveAsync({ from, to }),
    delete: (uri) => FileSystem.deleteAsync(uri, { idempotent: true }),
  };
}

export function createOfflineFileCache({
  files,
  scope,
}: {
  files: OfflineFileSystem;
  /**
   * Which archive and account these bytes belong to. The scope is part of the
   * path, so one account's files cannot be read through another's cache — the
   * same reason the database name carries it.
   */
  scope?: string | null;
}) {
  const rootDir = `${files.rootDirectory}openkeep-cache`;
  const filesDir = scope ? `${rootDir}/${scope}/files` : `${rootDir}/files`;
  const legacyRootDir = `${files.rootDirectory}openkeep-offline`;
  const legacyFilesDir = `${rootDir}/files`;
  // Two viewers opening the same document must not race for the same file.
  const inFlight = new Map<
    string,
    Promise<{ bytes: Uint8Array; extension: string; byteLength: number }>
  >();

  async function ensureDirs() {
    await files.makeDirectory(rootDir);
    if (scope) {
      await files.makeDirectory(`${rootDir}/${scope}`);
    }
    await files.makeDirectory(filesDir);
  }

  async function deleteIfExists(fileUri: string | null | undefined) {
    if (!fileUri) {
      return;
    }

    try {
      const info = await files.info(fileUri);
      if (info.exists) {
        await files.delete(fileUri);
      }
    } catch {
      // Best-effort cleanup only.
    }
  }

  async function exists(fileUri: string | null | undefined) {
    if (!fileUri) {
      return false;
    }
    const info = await files.info(fileUri).catch(() => ({ exists: false }));
    return info.exists;
  }

  async function fileSize(fileUri: string | null) {
    if (!fileUri) {
      return 0;
    }
    try {
      const info = await files.info(fileUri);
      if (info.exists && typeof info.size === "number") {
        return info.size;
      }
    } catch {
      // Missing files are reconciled on next refresh.
    }
    return 0;
  }

  function download(authFetch: AuthFetch, document: ArchiveDocument) {
    const existing = inFlight.get(document.id);
    if (existing) {
      return existing;
    }

    const searchable = Boolean(document.searchablePdfAvailable) && document.mimeType === "application/pdf";
    const run = (async () => {
      await ensureDirs();
      const endpoint = searchable
        ? `/api/documents/${document.id}/download/searchable`
        : `/api/documents/${document.id}/download`;
      const response = await authFetch(endpoint);
      if (!response.ok) {
        throw new Error(`Download failed (${response.status})`);
      }

      const extension = extensionForMime(searchable ? "application/pdf" : document.mimeType);
      const arrayBuffer = await response.arrayBuffer();
      // The bytes go to the caller, which puts them in the encrypted store. They
      // are deliberately not written to a file here: a plaintext copy on disk is
      // what this story exists to remove.
      return { bytes: new Uint8Array(arrayBuffer), extension, byteLength: arrayBuffer.byteLength };
    })();

    inFlight.set(document.id, run);
    return run.finally(() => {
      inFlight.delete(document.id);
    });
  }

  return {
    rootDir,
    filesDir,
    legacyRootDir,
    legacyFilesDir,
    ensureDirs,
    deleteIfExists,
    exists,
    fileSize,
    download,
    /** Removes the files directory itself, then recreates it empty. */
    async resetFiles() {
      await deleteIfExists(filesDir);
      await ensureDirs();
    },
  };
}

export type OfflineFileCache = ReturnType<typeof createOfflineFileCache>;
