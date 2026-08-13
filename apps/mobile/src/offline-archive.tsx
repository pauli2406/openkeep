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
  extensionForMime,
  type AuthFetch,
} from "./offline-file-cache";
import { createOfflineFileMaterializer } from "./offline-file-materializer";
import {
  LEGACY_UNSCOPED_DATABASE,
  offlineCacheDatabaseName,
  offlineCacheScope,
} from "./offline-scope";
import {
  buildCachedDashboard,
  buildCachedFacets,
  clearCachedDocumentRows,
  OFFLINE_CACHE_DEFAULT_MAX_BYTES,
  correctFileAccounting,
  enforceCacheLimit,
  getCacheLimit,
  getCacheStats,
  getCachedDocument,
  getCachedFileUris,
  hasCachedFileBytes,
  markCachedDocumentViewed,
  quarantinedCount,
  readCachedFileBytes,
  removeCachedDocument,
  setCacheLimit,
  searchCachedDocuments,
  setOfflineCacheScope,
  writeCachedFileBytes,
  upsertCachedDocument,
  type CachedDocumentRecord,
  type CachedSortField,
} from "./offline-metadata-store";

// v2 also removes the unscoped cache this replaced. Its documents cannot be
// attributed to an account, so they are deleted rather than shown to whoever
// signs in next.
// v3 also removes the unencrypted per-scope database and its plaintext files.
// They are plaintext by definition, so they are deleted rather than migrated;
// documents re-cache as they are opened.
const LEGACY_CLEANUP_KEY = "openkeep.mobile.cache.legacy-cleaned-v3";
const LEGACY_KEYS = [
  "openkeep.mobile.offline-archive-mode",
  "openkeep.mobile.offline-retention-settings",
];

const deviceFiles = createExpoOfflineFileSystem();
const materializer = createOfflineFileMaterializer({
  files: deviceFiles,
  scratchDirectory: deviceFiles.scratchDirectory,
});

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
  releaseCachedFile: (documentId: string) => Promise<void>;
  loadCachedDocument: (documentId: string) => Promise<CachedDocumentRecord | null>;
  queryCachedDocuments: (options?: LoadDocumentsOptions) => Promise<SearchDocumentsResponse>;
  loadCachedDashboard: () => Promise<DashboardInsights>;
  loadCachedFacets: () => Promise<FacetsResponse>;
  clearCachedDocuments: () => Promise<void>;
  getCacheSummary: () => Promise<CacheSummary>;
  /** Byte budget for this archive's copy, and the choices offered for it. */
  maxBytes: number;
  setMaxBytes: (bytes: number) => Promise<void>;
  /** Rows dropped this session because they could not be read. */
  quarantinedCount: number;
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
  // Rows the store had to drop because they could not be decoded. Surfaced so an
  // unexplained gap in the copy is explainable rather than mysterious.
  const [quarantinedRows, setQuarantinedRows] = useState(0);
  const [maxBytes, setMaxBytesState] = useState(OFFLINE_CACHE_DEFAULT_MAX_BYTES);

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
    setQuarantinedRows(quarantinedCount());
    return next;
  }, [scope]);

  /**
   * Deletes the files eviction just dropped rows for. The store owns the rows
   * and reports the files, because the filesystem belongs to this layer.
   */
  const applyEviction = useCallback(
    async (result: { files: string[] }) => {
      for (const fileUri of result.files) {
        await fileCache.deleteIfExists(fileUri);
      }
      return result;
    },
    [fileCache],
  );

  const setMaxBytes = useCallback(
    async (bytes: number) => {
      await applyEviction(await setCacheLimit(bytes));
      setMaxBytesState(bytes);
      await refreshCacheSummary();
    },
    [applyEviction, refreshCacheSummary],
  );

  const clearLegacyOfflineState = useCallback(async () => {
    const alreadyCleaned = await AsyncStorage.getItem(LEGACY_CLEANUP_KEY);
    if (alreadyCleaned === "true") {
      return;
    }

    await Promise.all(LEGACY_KEYS.map((key) => AsyncStorage.removeItem(key).catch(() => undefined)));
    await SQLite.deleteDatabaseAsync("openkeep-offline.db").catch(() => undefined);
    await SQLite.deleteDatabaseAsync(LEGACY_UNSCOPED_DATABASE).catch(() => undefined);
    if (scope) {
      await SQLite.deleteDatabaseAsync(offlineCacheDatabaseName(scope)).catch(() => undefined);
      await fileCache.deleteIfExists(fileCache.filesDir);
    }
    await fileCache.deleteIfExists(fileCache.legacyRootDir);
    await fileCache.deleteIfExists(fileCache.legacyFilesDir);
    await AsyncStorage.setItem(LEGACY_CLEANUP_KEY, "true");
  }, [fileCache, scope]);

  // Set synchronously on render rather than in an effect: a screen must never
  // get one paint's worth of the previous scope's documents.
  setOfflineCacheScope(scope);

  useEffect(() => {
    let isMounted = true;

    async function bootstrap() {
      await fileCache.ensureDirs();
      // A kill or a crash skips `releaseCachedFile`, and a decrypted document
      // must not survive that.
      await materializer.sweep();
      await clearLegacyOfflineState();
      if (isMounted) {
        setMaxBytesState(await getCacheLimit());
      }
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

    // Opening a document offline is still using it. Without this, eviction would
    // rank documents only by when they were cached, and the copy a user reads
    // every week offline would be the first to go.
    await markCachedDocumentViewed(cached.document.id, new Date().toISOString());

    if (cached.fileUri && !(await fileCache.exists(cached.fileUri))) {
      // The row kept its byte count while the file was gone, so the Offline
      // screen reported storage that had already been freed. Correct the row,
      // not just the answer.
      await correctFileAccounting(cached.document.id);
      await refreshCacheSummary();
      return { ...cached, fileUri: null, fileStorageBytes: 0 };
    }

    return cached;
  }, [fileCache, refreshCacheSummary]);

  /**
   * Forgets a document the archive says is gone. Only 404 and 410 qualify: a 500
   * or a timeout means the archive could not answer, and evicting on those would
   * throw away a perfectly good copy exactly when it is most needed.
   */
  const forgetDeletedDocument = useCallback(async (documentId: string) => {
    const fileUri = await removeCachedDocument(documentId);
    await fileCache.deleteIfExists(fileUri);
    await refreshCacheSummary();
  }, [fileCache, refreshCacheSummary]);

  const cacheOpenedDocument = useCallback(async (
    authFetch: AuthFetch,
    documentId: string,
  ) => {
    await fileCache.ensureDirs();
    const previous = await getCachedDocument(documentId);
    const now = new Date().toISOString();
    const response = await authFetch(`/api/documents/${documentId}`);
    if (response.status === 404 || response.status === 410) {
      await forgetDeletedDocument(documentId);
      throw new Error(`Request failed for /api/documents/${documentId} (${response.status})`);
    }
    if (!response.ok) {
      throw new Error(`Request failed for /api/documents/${documentId} (${response.status})`);
    }
    const document = (await response.json()) as ArchiveDocument;
    const [text, history, file] = await Promise.all([
      fetchJson<DocumentTextResponse>(authFetch, `/api/documents/${documentId}/text`).catch(() => previous?.text ?? { documentId, blocks: [] }),
      fetchJson<DocumentHistoryResponse>(authFetch, `/api/documents/${documentId}/history`).catch(() => previous?.history ?? { documentId, items: [] }),
      fileCache.download(authFetch, document).catch(() => null),
    ]);

    const record: CachedDocumentRecord = {
      document,
      text,
      history,
      // Bytes live in the encrypted database now, so a row carries no path.
      fileUri: null,
      cachedAt: now,
      lastViewedAt: now,
      fileStorageBytes: file?.byteLength ?? previous?.fileStorageBytes ?? 0,
    };

    await upsertCachedDocument(record);
    if (file) {
      await writeCachedFileBytes(document.id, file.bytes);
    }
    // Enforced here rather than on a timer: the cache only grows when a file
    // lands, so this is the moment it can exceed its budget.
    await applyEviction(await enforceCacheLimit());
    await refreshCacheSummary();
    return record;
  }, [applyEviction, fileCache, forgetDeletedDocument, refreshCacheSummary]);

  /**
   * A URI the viewer can open. The bytes are decrypted into the scratch
   * directory for as long as the document is open — a viewer takes a path, not a
   * buffer — and `releaseCachedFile` deletes that copy when it closes.
   */
  const ensureCachedFile = useCallback(async (
    authFetch: AuthFetch,
    document: ArchiveDocument,
  ) => {
    const now = new Date().toISOString();
    if (!(await hasCachedFileBytes(document.id))) {
      const file = await fileCache.download(authFetch, document);
      const previous = await getCachedDocument(document.id);
      await upsertCachedDocument({
        document: previous?.document ?? document,
        text: previous?.text ?? { documentId: document.id, blocks: [] },
        history: previous?.history ?? { documentId: document.id, items: [] },
        fileUri: null,
        cachedAt: previous?.cachedAt ?? now,
        lastViewedAt: now,
        fileStorageBytes: file.byteLength,
      });
      await writeCachedFileBytes(document.id, file.bytes);
      await applyEviction(await enforceCacheLimit());
      await refreshCacheSummary();
    }

    return materializer.materialize({
      documentId: document.id,
      extension: extensionForMime(
        document.searchablePdfAvailable && document.mimeType === "application/pdf"
          ? "application/pdf"
          : document.mimeType,
      ),
      chunks: await readCachedFileBytes(document.id),
    });
  }, [applyEviction, fileCache, refreshCacheSummary]);

  /** Deletes the decrypted scratch copy; the encrypted original stays. */
  const releaseCachedFile = useCallback(async (documentId: string) => {
    await materializer.release(documentId);
  }, []);

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
      releaseCachedFile,
      loadCachedDocument,
      queryCachedDocuments: queryCachedDocumentsResponse,
      loadCachedDashboard: buildCachedDashboard,
      loadCachedFacets: buildCachedFacets,
      clearCachedDocuments,
      getCacheSummary,
      quarantinedCount: quarantinedRows,
      maxBytes,
      setMaxBytes,
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
      maxBytes,
      releaseCachedFile,
      setMaxBytes,
      quarantinedRows,
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
