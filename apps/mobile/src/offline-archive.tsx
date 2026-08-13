import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import * as SQLite from "expo-sqlite";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  createExpoOfflineFileSystem,
  createOfflineFileCache,
  type AuthFetch,
} from "./offline-file-cache";
import {
  buildCachedDashboard,
  buildCachedFacets,
  clearCachedDocumentRows,
  getCacheStats,
  getCachedDocument,
  getCachedFileUris,
  searchCachedDocuments,
  upsertCachedDocument,
  type CachedDocumentRecord,
  type CachedSortField,
} from "./offline-metadata-store";

const LEGACY_CLEANUP_KEY = "openkeep.mobile.cache.legacy-cleaned-v1";
const LEGACY_KEYS = [
  "openkeep.mobile.offline-archive-mode",
  "openkeep.mobile.offline-retention-settings",
];

const fileCache = createOfflineFileCache({ files: createExpoOfflineFileSystem() });

type LoadDocumentsOptions = {
  query?: string;
  status?: "all" | "pending" | "processing" | "ready" | "failed";
  reviewOnly?: boolean;
  correspondentSlug?: string;
  year?: number;
  dateFrom?: string;
  dateTo?: string;
  dueDateFrom?: string;
  dueDateTo?: string;
  sort?: CachedSortField;
  direction?: "asc" | "desc";
  page?: number;
  pageSize?: number;
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
    authFetch: AuthFetch,
    documentId: string,
  ) => Promise<CachedDocumentRecord>;
  ensureCachedFile: (
    authFetch: AuthFetch,
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

async function fetchJson<T>(authFetch: AuthFetch, path: string) {
  const response = await authFetch(path);
  if (!response.ok) {
    throw new Error(`Request failed for ${path} (${response.status})`);
  }

  return (await response.json()) as T;
}

export function OfflineArchiveProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [cacheSummary, setCacheSummary] = useState<CacheSummary>({
    documentCount: 0,
    fileStorageBytes: 0,
    updatedAt: null,
  });
  const cacheSummaryRef = useRef(cacheSummary);

  const refreshCacheSummary = useCallback(async () => {
    const stats = await getCacheStats();
    const current = cacheSummaryRef.current;
    // `updatedAt` feeds query keys, so only move it when the cache really changed. Bumping it on
    // every housekeeping call would re-key live queries and unmount whatever they render.
    const unchanged =
      current.updatedAt !== null &&
      current.documentCount === stats.documentCount &&
      current.fileStorageBytes === stats.fileStorageBytes;
    const next = unchanged ? current : { ...stats, updatedAt: new Date().toISOString() };
    cacheSummaryRef.current = next;
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
    await fileCache.deleteIfExists(fileCache.legacyRootDir);
    await AsyncStorage.setItem(LEGACY_CLEANUP_KEY, "true");
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function bootstrap() {
      await fileCache.ensureDirs();
      await clearLegacyOfflineState();
      await refreshCacheSummary();
      if (isMounted) {
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
      if (!(await fileCache.exists(cached.fileUri))) {
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
    authFetch: AuthFetch,
    documentId: string,
  ) => {
    await fileCache.ensureDirs();
    const previous = await getCachedDocument(documentId);
    const now = new Date().toISOString();
    const document = await fetchJson<ArchiveDocument>(authFetch, `/api/documents/${documentId}`);
    const [text, history, file] = await Promise.all([
      fetchJson<DocumentTextResponse>(authFetch, `/api/documents/${documentId}/text`).catch(() => previous?.text ?? { documentId, blocks: [] }),
      fetchJson<DocumentHistoryResponse>(authFetch, `/api/documents/${documentId}/history`).catch(() => previous?.history ?? { documentId, items: [] }),
      fileCache.download(authFetch, document).catch(() => null),
    ]);

    const fileUri = file?.uri ?? previous?.fileUri ?? null;
    const fileStorageBytes = file?.bytes ?? (await fileCache.fileSize(fileUri));
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
      await fileCache.deleteIfExists(previous.fileUri);
    }
    await refreshCacheSummary();
    return record;
  }, [refreshCacheSummary]);

  const ensureCachedFile = useCallback(async (
    authFetch: AuthFetch,
    document: ArchiveDocument,
  ) => {
    const previous = await getCachedDocument(document.id);
    if (previous?.fileUri && (await fileCache.exists(previous.fileUri))) {
      return previous.fileUri;
    }

    const file = await fileCache.download(authFetch, document);
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
    // Paged in SQL, so `total` counts every match while `items` is the page that
    // was asked for. Slicing in JavaScript made those two disagree, and left
    // every page after the first unreachable.
    return (await searchCachedDocuments({
      pageSize: options?.reviewOnly ? 25 : 30,
      ...options,
    })) satisfies SearchDocumentsResponse;
  }, []);

  const clearCachedDocuments = useCallback(async () => {
    const fileUris = await getCachedFileUris();
    await Promise.all(fileUris.map((fileUri) => fileCache.deleteIfExists(fileUri)));
    await clearCachedDocumentRows();
    await fileCache.resetFiles();
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
