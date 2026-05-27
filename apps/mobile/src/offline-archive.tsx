import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import * as FileSystem from "expo-file-system/legacy";
import * as SQLite from "expo-sqlite";
import { Buffer } from "buffer";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  ArchiveDocument,
  DashboardInsights,
  DocumentHistoryResponse,
  DocumentTextResponse,
  FacetsResponse,
  SearchDocumentsResponse,
} from "./lib";
import {
  buildCachedDashboard,
  buildCachedFacets,
  clearCachedDocumentRows,
  getCacheStats,
  getCachedDocument,
  getCachedFileUris,
  queryCachedDocuments,
  upsertCachedDocument,
  type CachedDocumentRecord,
} from "./offline-metadata-store";

const CACHE_ROOT_DIR = `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? ""}openkeep-cache`;
const CACHE_FILES_DIR = `${CACHE_ROOT_DIR}/files`;
const LEGACY_OFFLINE_ROOT_DIR = `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? ""}openkeep-offline`;
const LEGACY_CLEANUP_KEY = "openkeep.mobile.cache.legacy-cleaned-v1";
const LEGACY_KEYS = [
  "openkeep.mobile.offline-archive-mode",
  "openkeep.mobile.offline-retention-settings",
];
const inFlightFileDownloads = new Map<string, Promise<{ uri: string; bytes: number }>>();

type LoadDocumentsOptions = {
  query?: string;
  status?: "all" | "pending" | "processing" | "ready" | "failed";
  reviewOnly?: boolean;
  correspondentSlug?: string;
};

type CacheSummary = {
  documentCount: number;
  fileStorageBytes: number;
  updatedAt: string | null;
};

type OfflineArchiveContextValue = {
  isConnected: boolean;
  shouldUseCache: boolean;
  isReady: boolean;
  cacheSummary: CacheSummary;
  cacheOpenedDocument: (
    authFetch: (path: string, init?: RequestInit) => Promise<Response>,
    documentId: string,
  ) => Promise<CachedDocumentRecord>;
  ensureCachedFile: (
    authFetch: (path: string, init?: RequestInit) => Promise<Response>,
    document: ArchiveDocument,
  ) => Promise<string>;
  loadCachedDocument: (documentId: string) => Promise<CachedDocumentRecord | null>;
  queryCachedDocuments: (options?: LoadDocumentsOptions) => Promise<SearchDocumentsResponse>;
  loadCachedDashboard: () => Promise<DashboardInsights>;
  loadCachedFacets: () => Promise<FacetsResponse>;
  clearCachedDocuments: () => Promise<void>;
  getCacheSummary: () => Promise<CacheSummary>;
};

const OfflineArchiveContext = createContext<OfflineArchiveContextValue | null>(null);

function extensionForMime(mimeType: string) {
  const map: Record<string, string> = {
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

  return map[mimeType] ?? ".bin";
}

async function ensureCacheDirs() {
  await FileSystem.makeDirectoryAsync(CACHE_ROOT_DIR, { intermediates: true });
  await FileSystem.makeDirectoryAsync(CACHE_FILES_DIR, { intermediates: true });
}

async function deleteIfExists(fileUri: string | null | undefined) {
  if (!fileUri) {
    return;
  }

  try {
    const info = await FileSystem.getInfoAsync(fileUri);
    if (info.exists) {
      await FileSystem.deleteAsync(fileUri, { idempotent: true });
    }
  } catch {
    // Best-effort cleanup only.
  }
}

async function fetchJson<T>(
  authFetch: (path: string, init?: RequestInit) => Promise<Response>,
  path: string,
) {
  const response = await authFetch(path);
  if (!response.ok) {
    throw new Error(`Request failed for ${path} (${response.status})`);
  }

  return (await response.json()) as T;
}

async function downloadDocumentFile(
  authFetch: (path: string, init?: RequestInit) => Promise<Response>,
  document: ArchiveDocument,
) {
  const existing = inFlightFileDownloads.get(document.id);
  if (existing) {
    return existing;
  }

  const download = (async () => {
    await ensureCacheDirs();
    const preferredMimeType = document.searchablePdfAvailable && document.mimeType === "application/pdf"
      ? "application/pdf"
      : document.mimeType;
    const endpoint = document.searchablePdfAvailable && document.mimeType === "application/pdf"
      ? `/api/documents/${document.id}/download/searchable`
      : `/api/documents/${document.id}/download`;
    const response = await authFetch(endpoint);
    if (!response.ok) {
      throw new Error(`Download failed (${response.status})`);
    }

    const extension = extensionForMime(preferredMimeType);
    const uri = `${CACHE_FILES_DIR}/${document.id}${extension}`;
    const tempUri = `${uri}.tmp`;
    const arrayBuffer = await response.arrayBuffer();
    await FileSystem.writeAsStringAsync(tempUri, Buffer.from(arrayBuffer).toString("base64"), {
      encoding: FileSystem.EncodingType.Base64,
    });
    await deleteIfExists(uri);
    await FileSystem.moveAsync({ from: tempUri, to: uri });

    return { uri, bytes: arrayBuffer.byteLength };
  })();

  inFlightFileDownloads.set(document.id, download);
  try {
    return await download;
  } finally {
    inFlightFileDownloads.delete(document.id);
  }
}

async function getFileSize(fileUri: string | null) {
  if (!fileUri) {
    return 0;
  }
  try {
    const info = await FileSystem.getInfoAsync(fileUri);
    if (info.exists && "size" in info && typeof info.size === "number") {
      return info.size;
    }
  } catch {
    // Missing files are reconciled on next refresh.
  }
  return 0;
}

export function OfflineArchiveProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [cacheSummary, setCacheSummary] = useState<CacheSummary>({
    documentCount: 0,
    fileStorageBytes: 0,
    updatedAt: null,
  });

  const refreshCacheSummary = useCallback(async () => {
    const stats = await getCacheStats();
    const next = {
      ...stats,
      updatedAt: new Date().toISOString(),
    };
    setCacheSummary(next);
    return next;
  }, []);

  const clearLegacyOfflineState = useCallback(async () => {
    const alreadyCleaned = await AsyncStorage.getItem(LEGACY_CLEANUP_KEY);
    if (alreadyCleaned === "true") {
      return;
    }

    await Promise.all(LEGACY_KEYS.map((key) => AsyncStorage.removeItem(key).catch(() => undefined)));
    await SQLite.deleteDatabaseAsync("openkeep-offline.db").catch(() => undefined);
    await deleteIfExists(LEGACY_OFFLINE_ROOT_DIR);
    await AsyncStorage.setItem(LEGACY_CLEANUP_KEY, "true");
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function bootstrap() {
      await ensureCacheDirs();
      await clearLegacyOfflineState();
      const next = await refreshCacheSummary();
      if (isMounted) {
        setCacheSummary(next);
        setIsReady(true);
      }
    }

    void bootstrap();
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      setIsConnected(Boolean(state.isConnected && state.isInternetReachable !== false));
    });

    void NetInfo.fetch().then((state: NetInfoState) => {
      if (isMounted) {
        setIsConnected(Boolean(state.isConnected && state.isInternetReachable !== false));
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [clearLegacyOfflineState, refreshCacheSummary]);

  const loadCachedDocument = useCallback(async (documentId: string) => {
    const cached = await getCachedDocument(documentId);
    if (!cached) {
      return null;
    }

    if (cached.fileUri) {
      const info = await FileSystem.getInfoAsync(cached.fileUri).catch(() => ({ exists: false }));
      if (!info.exists) {
        return {
          ...cached,
          fileUri: null,
          fileStorageBytes: 0,
        };
      }
    }

    return cached;
  }, []);

  const cacheOpenedDocument = useCallback(async (
    authFetch: (path: string, init?: RequestInit) => Promise<Response>,
    documentId: string,
  ) => {
    await ensureCacheDirs();
    const previous = await getCachedDocument(documentId);
    const now = new Date().toISOString();
    const document = await fetchJson<ArchiveDocument>(authFetch, `/api/documents/${documentId}`);
    const [text, history, file] = await Promise.all([
      fetchJson<DocumentTextResponse>(authFetch, `/api/documents/${documentId}/text`).catch(() => previous?.text ?? { documentId, blocks: [] }),
      fetchJson<DocumentHistoryResponse>(authFetch, `/api/documents/${documentId}/history`).catch(() => previous?.history ?? { documentId, items: [] }),
      downloadDocumentFile(authFetch, document).catch(() => null),
    ]);

    const fileUri = file?.uri ?? previous?.fileUri ?? null;
    const fileStorageBytes = file?.bytes ?? (await getFileSize(fileUri));
    const record: CachedDocumentRecord = {
      document,
      text,
      history,
      fileUri,
      cachedAt: now,
      lastViewedAt: now,
      fileStorageBytes,
    };

    await upsertCachedDocument(record);
    if (previous?.fileUri && file?.uri && previous.fileUri !== file.uri) {
      await deleteIfExists(previous.fileUri);
    }
    await refreshCacheSummary();
    return record;
  }, [refreshCacheSummary]);

  const ensureCachedFile = useCallback(async (
    authFetch: (path: string, init?: RequestInit) => Promise<Response>,
    document: ArchiveDocument,
  ) => {
    const previous = await getCachedDocument(document.id);
    if (previous?.fileUri) {
      const info = await FileSystem.getInfoAsync(previous.fileUri).catch(() => ({ exists: false }));
      if (info.exists) {
        return previous.fileUri;
      }
    }

    const file = await downloadDocumentFile(authFetch, document);
    const now = new Date().toISOString();
    const record: CachedDocumentRecord = {
      document: previous?.document ?? document,
      text: previous?.text ?? { documentId: document.id, blocks: [] },
      history: previous?.history ?? { documentId: document.id, items: [] },
      fileUri: file.uri,
      cachedAt: previous?.cachedAt ?? now,
      lastViewedAt: now,
      fileStorageBytes: file.bytes,
    };
    await upsertCachedDocument(record);
    await refreshCacheSummary();
    return file.uri;
  }, [refreshCacheSummary]);

  const queryCachedDocumentsResponse = useCallback(async (options?: LoadDocumentsOptions) => {
    const items = await queryCachedDocuments(options);
    const pageSize = options?.reviewOnly ? 25 : 30;
    return {
      items: items.slice(0, pageSize),
      total: items.length,
      page: 1,
      pageSize,
    } satisfies SearchDocumentsResponse;
  }, []);

  const clearCachedDocuments = useCallback(async () => {
    const fileUris = await getCachedFileUris();
    await Promise.all(fileUris.map((fileUri) => deleteIfExists(fileUri)));
    await clearCachedDocumentRows();
    await deleteIfExists(CACHE_FILES_DIR);
    await ensureCacheDirs();
    await refreshCacheSummary();
  }, [refreshCacheSummary]);

  const getCacheSummary = useCallback(async () => {
    const stats = await getCacheStats();
    return {
      ...stats,
      updatedAt: cacheSummary.updatedAt,
    };
  }, [cacheSummary.updatedAt]);

  const value = useMemo<OfflineArchiveContextValue>(
    () => ({
      isConnected,
      shouldUseCache: !isConnected,
      isReady,
      cacheSummary,
      cacheOpenedDocument,
      ensureCachedFile,
      loadCachedDocument,
      queryCachedDocuments: queryCachedDocumentsResponse,
      loadCachedDashboard: buildCachedDashboard,
      loadCachedFacets: buildCachedFacets,
      clearCachedDocuments,
      getCacheSummary,
    }),
    [
      cacheOpenedDocument,
      cacheSummary,
      clearCachedDocuments,
      ensureCachedFile,
      getCacheSummary,
      isConnected,
      isReady,
      loadCachedDocument,
      queryCachedDocumentsResponse,
    ],
  );

  return <OfflineArchiveContext.Provider value={value}>{children}</OfflineArchiveContext.Provider>;
}

export function useOfflineArchive() {
  const context = useContext(OfflineArchiveContext);
  if (!context) {
    throw new Error("useOfflineArchive must be used within OfflineArchiveProvider");
  }

  return context;
}
