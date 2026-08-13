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
import { useAuth } from "./auth";
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
  LEGACY_UNSCOPED_DATABASE,
  offlineCacheScope,
} from "./offline-scope";
import {
  buildCachedDashboard,
  buildCachedFacets,
  clearCachedDocumentRows,
  getCacheStats,
  getCachedDocument,
  getCachedFileUris,
  searchCachedDocuments,
  setOfflineCacheScope,
  upsertCachedDocument,
  type CachedDocumentRecord,
  type CachedSortField,
} from "./offline-metadata-store";

// v2 also removes the unscoped cache this replaced. Its documents cannot be
// attributed to an account, so they are deleted rather than shown to whoever
// signs in next.
const LEGACY_CLEANUP_KEY = "openkeep.mobile.cache.legacy-cleaned-v2";
const LEGACY_KEYS = [
  "openkeep.mobile.offline-archive-mode",
  "openkeep.mobile.offline-retention-settings",
];

const deviceFiles = createExpoOfflineFileSystem();

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
  /** When a document was last written to the cache, read from the rows. */
  lastCachedAt: string | null;
  /**
   * Opaque token the cached queries are keyed by. Deliberately not the
   * timestamp above: conflating the two is what left the reported figure
   * meaning "when the app last counted", and left a re-cache at an unchanged
   * size invisible to every query that reads the cache.
   */
  revision: string | null;
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
  const auth = useAuth();
  // The archive and the account this copy belongs to. Null before sign-in, and
  // the cache stays shut rather than falling back to a shared one.
  const scope = offlineCacheScope({ apiUrl: auth.apiUrl, userId: auth.user?.id });
  const fileCache = useMemo(
    () => createOfflineFileCache({ files: deviceFiles, scope }),
    [scope],
  );
  const [isConnected, setIsConnected] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [cacheSummary, setCacheSummary] = useState<CacheSummary>({
    documentCount: 0,
    fileStorageBytes: 0,
    lastCachedAt: null,
    revision: null,
  });
  const cacheSummaryRef = useRef(cacheSummary);

  const refreshCacheSummary = useCallback(async () => {
    const stats = await getCacheStats();
    const current = cacheSummaryRef.current;
    // The revision only moves when the cache really changed; bumping it on every
    // housekeeping call would re-key live queries and unmount whatever they
    // render. `lastCachedAt` is part of that comparison, so re-caching a
    // document at an unchanged size still refreshes what reads it.
    //
    // The scope is part of the revision, not just the comparison: two accounts
    // whose copies happen to hold the same count and bytes would otherwise
    // produce an identical revision, and every cached query would keep serving
    // the previous account's render.
    const scopeTag = scope ?? "none";
    const unchanged =
      current.revision !== null &&
      current.revision.startsWith(`${scopeTag}#`) &&
      current.documentCount === stats.documentCount &&
      current.fileStorageBytes === stats.fileStorageBytes &&
      current.lastCachedAt === stats.lastCachedAt;
    const next = unchanged
      ? current
      : { ...stats, revision: `${scopeTag}#${new Date().toISOString()}` };
    cacheSummaryRef.current = next;
    setCacheSummary(next);
    return next;
  }, [scope]);

  const clearLegacyOfflineState = useCallback(async () => {
    const alreadyCleaned = await AsyncStorage.getItem(LEGACY_CLEANUP_KEY);
    if (alreadyCleaned === "true") {
      return;
    }

    await Promise.all(LEGACY_KEYS.map((key) => AsyncStorage.removeItem(key).catch(() => undefined)));
    await SQLite.deleteDatabaseAsync("openkeep-offline.db").catch(() => undefined);
    await SQLite.deleteDatabaseAsync(LEGACY_UNSCOPED_DATABASE).catch(() => undefined);
    await fileCache.deleteIfExists(fileCache.legacyRootDir);
    await fileCache.deleteIfExists(fileCache.legacyFilesDir);
    await AsyncStorage.setItem(LEGACY_CLEANUP_KEY, "true");
  }, []);

  // Set synchronously on render rather than in an effect: a screen must never
  // get one paint's worth of the previous scope's documents.
  setOfflineCacheScope(scope);

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
    // `scope` is a dependency: signing in as someone else, or repointing the
    // app at another archive, has to re-read the summary from that copy rather
    // than keep reporting the previous one.
  }, [clearLegacyOfflineState, fileCache, refreshCacheSummary, scope]);

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
      revision: cacheSummary.revision,
    };
  }, [cacheSummary.revision]);

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
