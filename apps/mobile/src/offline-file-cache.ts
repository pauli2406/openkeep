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
  makeDirectory(uri: string): Promise<void>;
  info(uri: string): Promise<{ exists: boolean; size?: number }>;
  writeBase64(uri: string, base64: string): Promise<void>;
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
    makeDirectory: (uri) => FileSystem.makeDirectoryAsync(uri, { intermediates: true }),
    info: async (uri) => {
      const info = await FileSystem.getInfoAsync(uri);
      return info.exists && "size" in info && typeof info.size === "number"
        ? { exists: true, size: info.size }
        : { exists: info.exists };
    },
    writeBase64: (uri, base64) =>
      FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 }),
    move: (from, to) => FileSystem.moveAsync({ from, to }),
    delete: (uri) => FileSystem.deleteAsync(uri, { idempotent: true }),
  };
}

export function createOfflineFileCache({ files }: { files: OfflineFileSystem }) {
  const rootDir = `${files.rootDirectory}openkeep-cache`;
  const filesDir = `${rootDir}/files`;
  const legacyRootDir = `${files.rootDirectory}openkeep-offline`;
  // Two viewers opening the same document must not race for the same file.
  const inFlight = new Map<string, Promise<{ uri: string; bytes: number }>>();

  async function ensureDirs() {
    await files.makeDirectory(rootDir);
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
      const uri = `${filesDir}/${document.id}${extension}`;
      const tempUri = `${uri}.tmp`;
      const arrayBuffer = await response.arrayBuffer();
      await files.writeBase64(tempUri, Buffer.from(arrayBuffer).toString("base64"));
      await deleteIfExists(uri);
      await files.move(tempUri, uri);

      return { uri, bytes: arrayBuffer.byteLength };
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
