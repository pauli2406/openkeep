import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import * as FileSystem from "expo-file-system/legacy";
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

const OFFLINE_MODE_KEY = "openkeep.mobile.offline-archive-mode";
const OFFLINE_ROOT_DIR = `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? ""}openkeep-offline`;
const OFFLINE_DOCUMENTS_DIR = `${OFFLINE_ROOT_DIR}/documents`;
const OFFLINE_FILES_DIR = `${OFFLINE_ROOT_DIR}/files`;
const OFFLINE_INDEX_PATH = `${OFFLINE_ROOT_DIR}/index.json`;

type OfflineArchiveIndex = {
  version: 1;
  lastSyncedAt: string | null;
  documentCount: number;
  storageBytes: number;
  documents: ArchiveDocument[];
  dashboard: DashboardInsights | null;
  facets: FacetsResponse | null;
};

type OfflineDocumentRecord = {
  document: ArchiveDocument;
  text: DocumentTextResponse | null;
  history: DocumentHistoryResponse | null;
  fileUri: string | null;
  syncedAt: string;
};

type SyncProgress = {
  completed: number;
  total: number;
  label: string;
};

type SyncResult = {
  documentCount: number;
  failedDocuments: number;
  syncedDocuments: number;
  reusedDocuments: number;
  removedDocuments: number;
};

type SyncArchiveOptions = {
  forceFull?: boolean;
};

type ArchiveReachability = "unknown" | "checking" | "reachable" | "unreachable";

type LoadDocumentsOptions = {
  query?: string;
  status?: "all" | "pending" | "processing" | "ready" | "failed";
  reviewOnly?: boolean;
  correspondentSlug?: string;
};

type OfflineArchiveContextValue = {
  isOfflineModeEnabled: boolean;
  isConnected: boolean;
  shouldUseOffline: boolean;
  isReady: boolean;
  isSyncing: boolean;
  archiveReachability: ArchiveReachability;
  lastReachabilityCheckedAt: string | null;
  syncProgress: SyncProgress | null;
  summary: OfflineArchiveIndex | null;
  setOfflineModeEnabled: (value: boolean) => Promise<void>;
  checkArchiveReachability: (probe: (value: string) => Promise<void>, apiUrl: string) => Promise<boolean>;
  syncArchive: (
    authFetch: (path: string, init?: RequestInit) => Promise<Response>,
    options?: SyncArchiveOptions,
  ) => Promise<SyncResult>;
  loadDocuments: (options?: LoadDocumentsOptions) => Promise<SearchDocumentsResponse>;
  loadDocumentRecord: (documentId: string) => Promise<OfflineDocumentRecord | null>;
  loadDashboard: () => Promise<DashboardInsights | null>;
  loadFacets: () => Promise<FacetsResponse | null>;
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

async function ensureOfflineDirs() {
  await FileSystem.makeDirectoryAsync(OFFLINE_ROOT_DIR, { intermediates: true });
  await FileSystem.makeDirectoryAsync(OFFLINE_DOCUMENTS_DIR, { intermediates: true });
  await FileSystem.makeDirectoryAsync(OFFLINE_FILES_DIR, { intermediates: true });
}

async function readJsonFile<T>(fileUri: string): Promise<T | null> {
  try {
    const info = await FileSystem.getInfoAsync(fileUri);
    if (!info.exists) {
      return null;
    }

    const raw = await FileSystem.readAsStringAsync(fileUri);
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(fileUri: string, value: unknown) {
  await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(value));
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
    // ignore cleanup failures
  }
}

function buildDocumentRecordPath(documentId: string) {
  return `${OFFLINE_DOCUMENTS_DIR}/${documentId}.json`;
}

async function fetchJson<T>(authFetch: (path: string, init?: RequestInit) => Promise<Response>, path: string) {
  const response = await authFetch(path);
  if (!response.ok) {
    throw new Error(`Request failed for ${path} (${response.status})`);
  }

  return (await response.json()) as T;
}

async function fetchAllDocuments(authFetch: (path: string, init?: RequestInit) => Promise<Response>) {
  const pageSize = 100;
  const items: ArchiveDocument[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;

  while (items.length < total) {
    const response = await fetchJson<SearchDocumentsResponse>(
      authFetch,
      `/api/documents?page=${page}&pageSize=${pageSize}`,
    );
    items.push(...response.items);
    total = response.total;
    page += 1;
    if (response.items.length === 0) {
      break;
    }
  }

  return items;
}

async function downloadDocumentFile(
  authFetch: (path: string, init?: RequestInit) => Promise<Response>,
  document: ArchiveDocument,
) {
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
  const uri = `${OFFLINE_FILES_DIR}/${document.id}${extension}`;
  const arrayBuffer = await response.arrayBuffer();
  await FileSystem.writeAsStringAsync(uri, Buffer.from(arrayBuffer).toString("base64"), {
    encoding: FileSystem.EncodingType.Base64,
  });

  return { uri, bytes: arrayBuffer.byteLength };
}

function includesQuery(document: ArchiveDocument, normalizedQuery: string) {
  if (!normalizedQuery) {
    return true;
  }

  const haystack = [
    document.title,
    document.correspondent?.name,
    document.documentType?.name,
    document.referenceNumber,
    document.holderName,
    document.issuingAuthority,
    ...document.tags.map((tag) => tag.name),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

function compareByCreatedAtDesc(a: ArchiveDocument, b: ArchiveDocument) {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function shouldRefreshDocument(existing: ArchiveDocument | undefined, incoming: ArchiveDocument) {
  if (!existing) {
    return true;
  }

  return (
    existing.updatedAt !== incoming.updatedAt ||
    existing.status !== incoming.status ||
    existing.searchablePdfAvailable !== incoming.searchablePdfAvailable ||
    existing.mimeType !== incoming.mimeType
  );
}

async function calculateStorageBytes(records: OfflineDocumentRecord[]) {
  let total = 0;

  for (const record of records) {
    total += JSON.stringify(record).length;

    if (record.fileUri) {
      try {
        const info = await FileSystem.getInfoAsync(record.fileUri);
        if (info.exists && "size" in info && typeof info.size === "number") {
          total += info.size;
        }
      } catch {
        // ignore size lookup failures
      }
    }
  }

  return total;
}

export function OfflineArchiveProvider({ children }: { children: ReactNode }) {
  const [isOfflineModeEnabled, setIsOfflineModeEnabledState] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [archiveReachability, setArchiveReachability] = useState<ArchiveReachability>("unknown");
  const [lastReachabilityCheckedAt, setLastReachabilityCheckedAt] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [summary, setSummary] = useState<OfflineArchiveIndex | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function bootstrap() {
      await ensureOfflineDirs();
      const [storedMode, storedSummary] = await Promise.all([
        AsyncStorage.getItem(OFFLINE_MODE_KEY),
        readJsonFile<OfflineArchiveIndex>(OFFLINE_INDEX_PATH),
      ]);

      if (!isMounted) {
        return;
      }

      setIsOfflineModeEnabledState(storedMode === "true");
      setSummary(storedSummary);
      setIsReady(true);
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
  }, []);

  useEffect(() => {
    if (!isConnected) {
      setArchiveReachability("unreachable");
      setLastReachabilityCheckedAt(new Date().toISOString());
    }
  }, [isConnected]);

  const setOfflineModeEnabled = useCallback(async (value: boolean) => {
    setIsOfflineModeEnabledState(value);
    await AsyncStorage.setItem(OFFLINE_MODE_KEY, String(value));
  }, []);

  const checkArchiveReachability = useCallback(async (
    probe: (value: string) => Promise<void>,
    apiUrl: string,
  ) => {
    if (!apiUrl || !isConnected) {
      setArchiveReachability("unreachable");
      setLastReachabilityCheckedAt(new Date().toISOString());
      return false;
    }

    setArchiveReachability("checking");
    try {
      await probe(apiUrl);
      setArchiveReachability("reachable");
      setLastReachabilityCheckedAt(new Date().toISOString());
      return true;
    } catch {
      setArchiveReachability("unreachable");
      setLastReachabilityCheckedAt(new Date().toISOString());
      return false;
    }
  }, [isConnected]);

  const loadDocumentRecord = useCallback(async (documentId: string) => {
    return readJsonFile<OfflineDocumentRecord>(buildDocumentRecordPath(documentId));
  }, []);

  const loadDashboard = useCallback(async () => {
    const index = await readJsonFile<OfflineArchiveIndex>(OFFLINE_INDEX_PATH);
    return index?.dashboard ?? null;
  }, []);

  const loadFacets = useCallback(async () => {
    const index = await readJsonFile<OfflineArchiveIndex>(OFFLINE_INDEX_PATH);
    return index?.facets ?? null;
  }, []);

  const loadDocuments = useCallback(async (options?: LoadDocumentsOptions) => {
    const index = await readJsonFile<OfflineArchiveIndex>(OFFLINE_INDEX_PATH);
    const normalizedQuery = options?.query?.trim().toLowerCase() ?? "";
    const items = (index?.documents ?? [])
      .filter((document) => (options?.status && options.status !== "all" ? document.status === options.status : true))
      .filter((document) => (options?.reviewOnly ? document.reviewStatus === "pending" : true))
      .filter((document) => (options?.correspondentSlug ? document.correspondent?.slug === options.correspondentSlug : true))
      .filter((document) => includesQuery(document, normalizedQuery))
      .sort(compareByCreatedAtDesc);

    return {
      items: items.slice(0, options?.reviewOnly ? 25 : 30),
      total: items.length,
      page: 1,
      pageSize: options?.reviewOnly ? 25 : 30,
    } satisfies SearchDocumentsResponse;
  }, []);

  const syncArchive = useCallback(
    async (
      authFetch: (path: string, init?: RequestInit) => Promise<Response>,
      options?: SyncArchiveOptions,
    ) => {
      setIsSyncing(true);
      setSyncProgress({
        completed: 0,
        total: 1,
        label: options?.forceFull ? "Preparing full offline resync" : "Preparing offline archive",
      });

      try {
        await ensureOfflineDirs();

        const existingSummary = await readJsonFile<OfflineArchiveIndex>(OFFLINE_INDEX_PATH);
        const existingDocuments = new Map((existingSummary?.documents ?? []).map((document) => [document.id, document]));
        const [documents, dashboard, facets] = await Promise.all([
          fetchAllDocuments(authFetch),
          fetchJson<DashboardInsights>(authFetch, "/api/dashboard/insights").catch(() => null),
          fetchJson<FacetsResponse>(authFetch, "/api/documents/facets").catch(() => null),
        ]);

        const syncedAt = new Date().toISOString();
        let failedDocuments = 0;
        let syncedDocuments = 0;
        let reusedDocuments = 0;
        let removedDocuments = 0;
        const nextRecordMap = new Map<string, OfflineDocumentRecord>();
        const incomingIds = new Set(documents.map((document) => document.id));
        const documentsToSync = options?.forceFull
          ? documents
          : documents.filter((document) => shouldRefreshDocument(existingDocuments.get(document.id), document));

        setSyncProgress({
          completed: 0,
          total: Math.max(documentsToSync.length, 1),
          label: documentsToSync.length > 0
            ? options?.forceFull
              ? "Refreshing all cached documents"
              : "Syncing changed documents"
            : "Archive already up to date",
        });

        for (const document of documents) {
          if (!options?.forceFull && !shouldRefreshDocument(existingDocuments.get(document.id), document)) {
            const existingRecord = await readJsonFile<OfflineDocumentRecord>(buildDocumentRecordPath(document.id));
            if (existingRecord) {
              nextRecordMap.set(document.id, existingRecord);
              reusedDocuments += 1;
            }
          }
        }

        for (const [index, document] of documentsToSync.entries()) {
          setSyncProgress({
            completed: index,
            total: documentsToSync.length,
            label: document.title || `Document ${index + 1}`,
          });

          try {
            const previousRecord = await readJsonFile<OfflineDocumentRecord>(buildDocumentRecordPath(document.id));
            const [detail, text, history, file] = await Promise.all([
              fetchJson<ArchiveDocument>(authFetch, `/api/documents/${document.id}`),
              fetchJson<DocumentTextResponse>(authFetch, `/api/documents/${document.id}/text`).catch(() => null),
              fetchJson<DocumentHistoryResponse>(authFetch, `/api/documents/${document.id}/history`).catch(() => null),
              downloadDocumentFile(authFetch, document).catch(async () => {
                if (previousRecord?.fileUri) {
                  return { uri: previousRecord.fileUri, bytes: 0 };
                }
                return null;
              }),
            ]);

            const record: OfflineDocumentRecord = {
              document: detail,
              text,
              history,
              fileUri: file?.uri ?? null,
              syncedAt,
            };
            nextRecordMap.set(document.id, record);
            await writeJsonFile(buildDocumentRecordPath(document.id), record);
            if (previousRecord?.fileUri && previousRecord.fileUri !== record.fileUri) {
              await deleteIfExists(previousRecord.fileUri);
            }
            syncedDocuments += 1;
          } catch {
            failedDocuments += 1;

            const existingRecord = await readJsonFile<OfflineDocumentRecord>(buildDocumentRecordPath(document.id));
            if (existingRecord) {
              nextRecordMap.set(document.id, existingRecord);
              reusedDocuments += 1;
            }
          }
        }

        for (const existingDocument of existingDocuments.values()) {
          if (!incomingIds.has(existingDocument.id)) {
            const existingRecord = await readJsonFile<OfflineDocumentRecord>(buildDocumentRecordPath(existingDocument.id));
            await deleteIfExists(existingRecord?.fileUri);
            await deleteIfExists(buildDocumentRecordPath(existingDocument.id));
            removedDocuments += 1;
          }
        }

        const finalRecords = Array.from(nextRecordMap.values()).sort((left, right) => compareByCreatedAtDesc(left.document, right.document));
        const storageBytes = await calculateStorageBytes(finalRecords);

        const nextSummary: OfflineArchiveIndex = {
          version: 1,
          lastSyncedAt: syncedAt,
          documentCount: finalRecords.length,
          storageBytes,
          documents: finalRecords.map((record) => record.document),
          dashboard,
          facets,
        };
        await writeJsonFile(OFFLINE_INDEX_PATH, nextSummary);
        setSummary(nextSummary);
        setSyncProgress({
          completed: documentsToSync.length,
          total: Math.max(documentsToSync.length, 1),
          label: documentsToSync.length > 0
            ? options?.forceFull
              ? "Offline archive fully refreshed"
              : "Offline archive updated"
            : "Offline archive already up to date",
        });

        return {
          documentCount: finalRecords.length,
          failedDocuments,
          syncedDocuments,
          reusedDocuments,
          removedDocuments,
        } satisfies SyncResult;
      } finally {
        setIsSyncing(false);
        setTimeout(() => setSyncProgress(null), 1200);
      }
    },
    [],
  );

  const value = useMemo<OfflineArchiveContextValue>(
    () => ({
      isOfflineModeEnabled,
      isConnected,
      shouldUseOffline: isOfflineModeEnabled || !isConnected,
      isReady,
      isSyncing,
      archiveReachability,
      lastReachabilityCheckedAt,
      syncProgress,
      summary,
      setOfflineModeEnabled,
      checkArchiveReachability,
      syncArchive,
      loadDocuments,
      loadDocumentRecord,
      loadDashboard,
      loadFacets,
    }),
    [
      isConnected,
      isOfflineModeEnabled,
      isReady,
      isSyncing,
      archiveReachability,
      checkArchiveReachability,
      lastReachabilityCheckedAt,
      loadDashboard,
      loadDocumentRecord,
      loadDocuments,
      loadFacets,
      setOfflineModeEnabled,
      summary,
      syncArchive,
      syncProgress,
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
