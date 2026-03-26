import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import * as FileSystem from "expo-file-system/legacy";
import { Buffer } from "buffer";
import {
  createContext,
  useRef,
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
  getOfflineDocumentsIndicatorMap,
  getOfflineDocumentMetadata,
  getOfflineDocumentStats,
  hasCompletedOfflineMigration,
  listOfflineDocumentsForSummary,
  listOfflineFileCandidatesForCleanup,
  loadOfflineDashboardState,
  loadOfflineFacetsState,
  loadOfflineSummaryState,
  markOfflineMigrationCompleted,
  queryOfflineDocuments,
  removeOfflineDocumentMetadata,
  saveOfflineDashboardState,
  saveOfflineFacetsState,
  saveOfflineSummaryState,
  setOfflineDocumentFileState,
  upsertOfflineDocumentMetadata,
} from "./offline-metadata-store";

const OFFLINE_MODE_KEY = "openkeep.mobile.offline-archive-mode";
const OFFLINE_RETENTION_SETTINGS_KEY = "openkeep.mobile.offline-retention-settings";
const OFFLINE_ROOT_DIR = `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? ""}openkeep-offline`;
const OFFLINE_DOCUMENTS_DIR = `${OFFLINE_ROOT_DIR}/documents`;
const OFFLINE_FILES_DIR = `${OFFLINE_ROOT_DIR}/files`;
const OFFLINE_INDEX_PATH = `${OFFLINE_ROOT_DIR}/index.json`;
const RECENTLY_VIEWED_GRACE_DAYS = 30;
const LEGACY_INDEX_MIGRATION_KEY = "legacy-index-json-v1";

export type OfflineFileRetentionMode = "full_mirror" | "smart_cache";
export type OfflineAvailability = "available_offline" | "metadata_only" | "syncing";

export type OfflineRetentionSettings = {
  mode: OfflineFileRetentionMode;
  maxFileStorageBytes: number | null;
  keepFilesForYears: number | null;
};

const DEFAULT_RETENTION_SETTINGS: OfflineRetentionSettings = {
  mode: "full_mirror",
  maxFileStorageBytes: null,
  keepFilesForYears: null,
};

type OfflineArchiveIndex = {
  version: 3;
  lastSyncedAt: string | null;
  documentCount: number;
  localFileCount: number;
  metadataBytes: number;
  fileStorageBytes: number;
  storageBytes: number;
  documents: ArchiveDocument[];
  dashboard: DashboardInsights | null;
  facets: FacetsResponse | null;
  retentionSettings: OfflineRetentionSettings;
};

type OfflineDocumentRecord = {
  document: ArchiveDocument;
  text: DocumentTextResponse | null;
  history: DocumentHistoryResponse | null;
  fileUri: string | null;
  hasLocalFile: boolean;
  isPinnedOffline: boolean;
  availability: OfflineAvailability;
  lastViewedAt: string | null;
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
  retentionSettings: OfflineRetentionSettings;
  setOfflineModeEnabled: (value: boolean) => Promise<void>;
  setRetentionSettings: (value: OfflineRetentionSettings) => Promise<void>;
  cleanupRetainedFiles: () => Promise<{ removedFiles: number; fileStorageBytes: number }>;
  checkArchiveReachability: (probe: (value: string) => Promise<void>, apiUrl: string) => Promise<boolean>;
  syncArchive: (
    authFetch: (path: string, init?: RequestInit) => Promise<Response>,
    options?: SyncArchiveOptions,
  ) => Promise<SyncResult>;
  persistViewedDocument: (
    authFetch: (path: string, init?: RequestInit) => Promise<Response>,
    document: ArchiveDocument,
  ) => Promise<void>;
  ensureDocumentFileAvailable: (
    authFetch: (path: string, init?: RequestInit) => Promise<Response>,
    document: ArchiveDocument,
  ) => Promise<string>;
  setDocumentPinnedOffline: (
    authFetch: (path: string, init?: RequestInit) => Promise<Response>,
    document: ArchiveDocument,
    pinned: boolean,
  ) => Promise<void>;
  getDocumentAvailability: (documentId: string) => Promise<OfflineAvailability>;
  getDocumentIndicators: (documentIds: string[]) => Promise<Map<string, { hasLocalFile: boolean; isPinnedOffline: boolean }>>;
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
  const tempUri = `${uri}.tmp`;
  const arrayBuffer = await response.arrayBuffer();
  await FileSystem.writeAsStringAsync(tempUri, Buffer.from(arrayBuffer).toString("base64"), {
    encoding: FileSystem.EncodingType.Base64,
  });
  await deleteIfExists(uri);
  await FileSystem.moveAsync({ from: tempUri, to: uri });

  return { uri, bytes: arrayBuffer.byteLength };
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

function normalizeRetentionSettings(
  value: OfflineRetentionSettings | null | undefined,
): OfflineRetentionSettings {
  return {
    mode: value?.mode === "smart_cache" ? "smart_cache" : "full_mirror",
    maxFileStorageBytes:
      typeof value?.maxFileStorageBytes === "number" && value.maxFileStorageBytes > 0
        ? value.maxFileStorageBytes
        : null,
    keepFilesForYears:
      typeof value?.keepFilesForYears === "number" && value.keepFilesForYears > 0
        ? value.keepFilesForYears
        : null,
  };
}

function documentAgeCutoffIso(years: number | null) {
  if (!years) {
    return null;
  }

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - years);
  return cutoff.toISOString();
}

function recentlyViewedCutoffIso() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RECENTLY_VIEWED_GRACE_DAYS);
  return cutoff.toISOString();
}

async function readAllDocumentRecords() {
  await ensureOfflineDirs();
  const entries = await FileSystem.readDirectoryAsync(OFFLINE_DOCUMENTS_DIR).catch(() => [] as string[]);
  const records = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => readJsonFile<OfflineDocumentRecord>(`${OFFLINE_DOCUMENTS_DIR}/${entry}`)),
  );
  return records.filter(Boolean) as OfflineDocumentRecord[];
}

async function calculateStorageStats(records: OfflineDocumentRecord[]) {
  let metadataBytes = 0;
  let fileStorageBytes = 0;

  for (const record of records) {
    metadataBytes += Buffer.byteLength(JSON.stringify(record), "utf8");
    if (record.fileUri && record.hasLocalFile) {
      try {
        const info = await FileSystem.getInfoAsync(record.fileUri);
        if (info.exists && "size" in info && typeof info.size === "number") {
          fileStorageBytes += info.size;
        }
      } catch {
        // ignore size lookup failures
      }
    }
  }

  return {
    metadataBytes,
    fileStorageBytes,
    storageBytes: metadataBytes + fileStorageBytes,
  };
}

async function writeDocumentRecord(record: OfflineDocumentRecord) {
  await writeJsonFile(buildDocumentRecordPath(record.document.id), record);
}

async function backfillLegacyOfflineState(
  legacySummary: OfflineArchiveIndex | null,
) {
  if (!legacySummary?.documents?.length) {
    return false;
  }

  for (const document of legacySummary.documents) {
    const record = await readJsonFile<OfflineDocumentRecord>(buildDocumentRecordPath(document.id));
    await upsertOfflineDocumentMetadata(document, {
      hasLocalFile: record?.hasLocalFile ?? false,
      isPinnedOffline: record?.isPinnedOffline ?? false,
      lastViewedAt: record?.lastViewedAt ?? null,
      syncedAt: record?.syncedAt ?? legacySummary.lastSyncedAt,
    });
  }

  await saveOfflineDashboardState(legacySummary.dashboard ?? null);
  await saveOfflineFacetsState(legacySummary.facets ?? null);
  await saveOfflineSummaryState({
    lastSyncedAt: legacySummary.lastSyncedAt,
    retentionSettings: legacySummary.retentionSettings,
  });

  return true;
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
  const [retentionSettings, setRetentionSettingsState] = useState<OfflineRetentionSettings>(DEFAULT_RETENTION_SETTINGS);
  const legacyIndexBackfilledRef = useRef(false);

  const refreshSummary = useCallback(async (overrides?: Partial<OfflineArchiveIndex>) => {
    const [sqliteSummaryState, dashboardState, facetsState, records, documents, docStats] = await Promise.all([
      loadOfflineSummaryState(),
      loadOfflineDashboardState(),
      loadOfflineFacetsState(),
      readAllDocumentRecords(),
      listOfflineDocumentsForSummary(),
      getOfflineDocumentStats(),
    ]);
    const stats = await calculateStorageStats(records);
    const nextSummary: OfflineArchiveIndex = {
      version: 3,
      lastSyncedAt: overrides?.lastSyncedAt ?? sqliteSummaryState?.lastSyncedAt ?? null,
      documentCount: docStats.documentCount,
      localFileCount: docStats.localFileCount,
      metadataBytes: stats.metadataBytes,
      fileStorageBytes: stats.fileStorageBytes,
      storageBytes: stats.storageBytes,
      documents: overrides?.documents ?? documents,
      dashboard: overrides?.dashboard ?? dashboardState ?? null,
      facets: overrides?.facets ?? facetsState ?? null,
      retentionSettings: overrides?.retentionSettings ?? sqliteSummaryState?.retentionSettings ?? retentionSettings,
    };
    await saveOfflineSummaryState({
      lastSyncedAt: nextSummary.lastSyncedAt,
      retentionSettings: nextSummary.retentionSettings,
    });
    await saveOfflineDashboardState(nextSummary.dashboard);
    await saveOfflineFacetsState(nextSummary.facets);
    setSummary(nextSummary);
    return nextSummary;
  }, [retentionSettings]);

  const cleanupRetainedFiles = useCallback(async () => {
    const settings = retentionSettings;
    if (settings.mode !== "smart_cache") {
      const nextSummary = await refreshSummary({ retentionSettings: settings });
      return { removedFiles: 0, fileStorageBytes: nextSummary.fileStorageBytes };
    }

    const candidates = await listOfflineFileCandidatesForCleanup();
    const cutoffIso = documentAgeCutoffIso(settings.keepFilesForYears);
    const recentViewCutoffIso = recentlyViewedCutoffIso();
    let removedFiles = 0;

    for (const candidate of candidates) {
      if (candidate.isPinnedOffline) {
        continue;
      }
      if (candidate.lastViewedAt && candidate.lastViewedAt >= recentViewCutoffIso) {
        continue;
      }
      if (cutoffIso && candidate.createdAt >= cutoffIso) {
        continue;
      }
      const record = await readJsonFile<OfflineDocumentRecord>(buildDocumentRecordPath(candidate.id));
      if (!record?.fileUri) {
        continue;
      }
      await deleteIfExists(record.fileUri);
      record.fileUri = null;
      record.hasLocalFile = false;
      record.availability = "metadata_only";
      await writeDocumentRecord(record);
      await setOfflineDocumentFileState(candidate.id, { hasLocalFile: false });
      removedFiles += 1;
    }

    if (settings.maxFileStorageBytes) {
      let currentStats = await calculateStorageStats(await readAllDocumentRecords());
      const removable = (await listOfflineFileCandidatesForCleanup())
        .filter((candidate) => !candidate.isPinnedOffline)
        .sort((left, right) => {
          const leftViewed = left.lastViewedAt ? new Date(left.lastViewedAt).getTime() : 0;
          const rightViewed = right.lastViewedAt ? new Date(right.lastViewedAt).getTime() : 0;
          if (leftViewed !== rightViewed) {
            return leftViewed - rightViewed;
          }
          return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
        });

      for (const candidate of removable) {
        if (currentStats.fileStorageBytes <= settings.maxFileStorageBytes) {
          break;
        }
        const record = await readJsonFile<OfflineDocumentRecord>(buildDocumentRecordPath(candidate.id));
        if (!record?.fileUri) {
          continue;
        }
        await deleteIfExists(record.fileUri);
        record.fileUri = null;
        record.hasLocalFile = false;
        record.availability = "metadata_only";
        await writeDocumentRecord(record);
        await setOfflineDocumentFileState(candidate.id, { hasLocalFile: false });
        removedFiles += 1;
        currentStats = await calculateStorageStats(await readAllDocumentRecords());
      }
    }

    const nextSummary = await refreshSummary({ retentionSettings: settings });
    return { removedFiles, fileStorageBytes: nextSummary.fileStorageBytes };
  }, [refreshSummary, retentionSettings]);

  useEffect(() => {
    let isMounted = true;

    async function bootstrap() {
      await ensureOfflineDirs();
      const migrationCompleted = await hasCompletedOfflineMigration(LEGACY_INDEX_MIGRATION_KEY);
      const [storedMode, storedSummary, storedRetentionSettings] = await Promise.all([
        AsyncStorage.getItem(OFFLINE_MODE_KEY),
        migrationCompleted || legacyIndexBackfilledRef.current
          ? Promise.resolve(null)
          : readJsonFile<OfflineArchiveIndex>(OFFLINE_INDEX_PATH),
        AsyncStorage.getItem(OFFLINE_RETENTION_SETTINGS_KEY),
      ]);

      if (!isMounted) {
        return;
      }

      const nextRetentionSettings = normalizeRetentionSettings(
        storedRetentionSettings ? JSON.parse(storedRetentionSettings) as OfflineRetentionSettings : storedSummary?.retentionSettings,
      );
      if (!migrationCompleted && !legacyIndexBackfilledRef.current) {
        const migratedLegacyIndex = await backfillLegacyOfflineState(storedSummary);
        if (migratedLegacyIndex) {
          await deleteIfExists(OFFLINE_INDEX_PATH);
          await markOfflineMigrationCompleted(LEGACY_INDEX_MIGRATION_KEY);
        }
        legacyIndexBackfilledRef.current = true;
      } else if (migrationCompleted) {
        legacyIndexBackfilledRef.current = true;
      }
      setIsOfflineModeEnabledState(storedMode === "true");
      setRetentionSettingsState(nextRetentionSettings);
      await refreshSummary({ retentionSettings: nextRetentionSettings });
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
  }, [refreshSummary]);

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

  const setRetentionSettings = useCallback(async (value: OfflineRetentionSettings) => {
    const normalized = normalizeRetentionSettings(value);
    setRetentionSettingsState(normalized);
    await AsyncStorage.setItem(OFFLINE_RETENTION_SETTINGS_KEY, JSON.stringify(normalized));
    await refreshSummary({ retentionSettings: normalized });
  }, [refreshSummary]);

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

  const getDocumentAvailability = useCallback(async (documentId: string) => {
    const metadata = await getOfflineDocumentMetadata(documentId);
    if (!metadata) {
      return "syncing" as const;
    }
    return metadata.hasLocalFile ? "available_offline" as const : "metadata_only" as const;
  }, []);

  const loadDocumentRecord = useCallback(async (documentId: string) => {
    const record = await readJsonFile<OfflineDocumentRecord>(buildDocumentRecordPath(documentId));
    const metadata = await getOfflineDocumentMetadata(documentId);
    if (!metadata && !record) {
      return null;
    }

    const baseDocument = record?.document ?? metadata?.document;
    if (!baseDocument) {
      return null;
    }

    let nextFileUri = record?.fileUri ?? null;
    let hasLocalFile = metadata?.hasLocalFile ?? record?.hasLocalFile ?? false;
    if (nextFileUri) {
      const info = await FileSystem.getInfoAsync(nextFileUri).catch(() => ({ exists: false }));
      if (!info.exists) {
        nextFileUri = null;
        hasLocalFile = false;
      }
    }

    const nextRecord: OfflineDocumentRecord = {
      document: baseDocument,
      text: record?.text ?? null,
      history: record?.history ?? null,
      fileUri: nextFileUri,
      hasLocalFile,
      isPinnedOffline: metadata?.isPinnedOffline ?? false,
      availability: hasLocalFile ? "available_offline" : "metadata_only",
      lastViewedAt: metadata?.lastViewedAt ?? record?.lastViewedAt ?? null,
      syncedAt: metadata?.syncedAt ?? record?.syncedAt ?? new Date().toISOString(),
    };

    await writeDocumentRecord(nextRecord);
    await upsertOfflineDocumentMetadata(baseDocument, {
      hasLocalFile,
      isPinnedOffline: nextRecord.isPinnedOffline,
      lastViewedAt: nextRecord.lastViewedAt,
      syncedAt: nextRecord.syncedAt,
    });

    return nextRecord;
  }, []);

  const loadDashboard = useCallback(async () => {
    return loadOfflineDashboardState();
  }, []);

  const loadFacets = useCallback(async () => {
    return loadOfflineFacetsState();
  }, []);

  const getDocumentIndicators = useCallback(async (documentIds: string[]) => {
    return getOfflineDocumentsIndicatorMap(documentIds);
  }, []);

  const loadDocuments = useCallback(async (options?: LoadDocumentsOptions) => {
    const items = await queryOfflineDocuments(options);
    return {
      items: items.slice(0, options?.reviewOnly ? 25 : 30),
      total: items.length,
      page: 1,
      pageSize: options?.reviewOnly ? 25 : 30,
    } satisfies SearchDocumentsResponse;
  }, []);

  const persistViewedDocument = useCallback(async (
    authFetch: (path: string, init?: RequestInit) => Promise<Response>,
    document: ArchiveDocument,
  ) => {
    await ensureOfflineDirs();
    const previousRecord = await loadDocumentRecord(document.id);
    const now = new Date().toISOString();
    const [detail, file] = await Promise.all([
      fetchJson<ArchiveDocument>(authFetch, `/api/documents/${document.id}`).catch(() => document),
      downloadDocumentFile(authFetch, document).catch(() => null),
    ]);
    const nextRecord: OfflineDocumentRecord = {
      document: detail,
      text: previousRecord?.text ?? null,
      history: previousRecord?.history ?? null,
      fileUri: file?.uri ?? previousRecord?.fileUri ?? null,
      hasLocalFile: Boolean(file?.uri ?? previousRecord?.hasLocalFile),
      isPinnedOffline: previousRecord?.isPinnedOffline ?? false,
      availability: file?.uri ?? previousRecord?.hasLocalFile ? "available_offline" : "metadata_only",
      lastViewedAt: now,
      syncedAt: previousRecord?.syncedAt ?? now,
    };
    await writeDocumentRecord(nextRecord);
    await upsertOfflineDocumentMetadata(detail, {
      hasLocalFile: nextRecord.hasLocalFile,
      isPinnedOffline: nextRecord.isPinnedOffline,
      lastViewedAt: nextRecord.lastViewedAt,
      syncedAt: nextRecord.syncedAt,
    });
    await refreshSummary();
    if (retentionSettings.mode === "smart_cache") {
      await cleanupRetainedFiles();
    }
  }, [cleanupRetainedFiles, loadDocumentRecord, refreshSummary, retentionSettings.mode]);

  const ensureDocumentFileAvailable = useCallback(async (
    authFetch: (path: string, init?: RequestInit) => Promise<Response>,
    document: ArchiveDocument,
  ) => {
    const existingRecord = await loadDocumentRecord(document.id);
    if (existingRecord?.fileUri && existingRecord.hasLocalFile) {
      const info = await FileSystem.getInfoAsync(existingRecord.fileUri).catch(() => ({ exists: false }));
      if (info.exists) {
        return existingRecord.fileUri;
      }
    }

    const file = await downloadDocumentFile(authFetch, document);
    const now = new Date().toISOString();
    const nextRecord: OfflineDocumentRecord = {
      document: existingRecord?.document ?? document,
      text: existingRecord?.text ?? null,
      history: existingRecord?.history ?? null,
      fileUri: file.uri,
      hasLocalFile: true,
      isPinnedOffline: existingRecord?.isPinnedOffline ?? false,
      availability: "available_offline",
      lastViewedAt: now,
      syncedAt: existingRecord?.syncedAt ?? now,
    };
    await writeDocumentRecord(nextRecord);
    await upsertOfflineDocumentMetadata(nextRecord.document, {
      hasLocalFile: true,
      isPinnedOffline: nextRecord.isPinnedOffline,
      lastViewedAt: now,
      syncedAt: nextRecord.syncedAt,
    });
    await refreshSummary();
    return file.uri;
  }, [loadDocumentRecord, refreshSummary]);

  const setDocumentPinnedOffline = useCallback(async (
    authFetch: (path: string, init?: RequestInit) => Promise<Response>,
    document: ArchiveDocument,
    pinned: boolean,
  ) => {
    const record = await loadDocumentRecord(document.id);
    if (pinned) {
      await ensureDocumentFileAvailable(authFetch, document);
    }

    const nextRecord: OfflineDocumentRecord = {
      document: record?.document ?? document,
      text: record?.text ?? null,
      history: record?.history ?? null,
      fileUri: record?.fileUri ?? null,
      hasLocalFile: record?.hasLocalFile ?? false,
      isPinnedOffline: pinned,
      availability: record?.hasLocalFile ? "available_offline" : "metadata_only",
      lastViewedAt: record?.lastViewedAt ?? null,
      syncedAt: record?.syncedAt ?? new Date().toISOString(),
    };
    await writeDocumentRecord(nextRecord);
    await upsertOfflineDocumentMetadata(nextRecord.document, {
      hasLocalFile: nextRecord.hasLocalFile,
      isPinnedOffline: pinned,
      lastViewedAt: nextRecord.lastViewedAt,
      syncedAt: nextRecord.syncedAt,
    });
    await refreshSummary();
  }, [ensureDocumentFileAvailable, loadDocumentRecord, refreshSummary]);

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

        const existingDocuments = new Map((summary?.documents ?? []).map((document) => [document.id, document]));
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
          const existingRecord = await loadDocumentRecord(document.id);
          if (!options?.forceFull && !shouldRefreshDocument(existingDocuments.get(document.id), document) && existingRecord) {
            reusedDocuments += 1;
            await upsertOfflineDocumentMetadata(existingRecord.document, {
              hasLocalFile: existingRecord.hasLocalFile,
              isPinnedOffline: existingRecord.isPinnedOffline,
              lastViewedAt: existingRecord.lastViewedAt,
              syncedAt: existingRecord.syncedAt,
            });
            continue;
          }

          await upsertOfflineDocumentMetadata(document, {
            hasLocalFile: existingRecord?.hasLocalFile ?? false,
            isPinnedOffline: existingRecord?.isPinnedOffline ?? false,
            lastViewedAt: existingRecord?.lastViewedAt ?? null,
            syncedAt,
          });
        }

        for (const [index, document] of documentsToSync.entries()) {
          setSyncProgress({
            completed: index,
            total: documentsToSync.length,
            label: document.title || `Document ${index + 1}`,
          });

          try {
            const previousRecord = await loadDocumentRecord(document.id);
            const detail = await fetchJson<ArchiveDocument>(authFetch, `/api/documents/${document.id}`);
            const shouldStoreFile = retentionSettings.mode === "full_mirror" || options?.forceFull || previousRecord?.isPinnedOffline;
            const file = shouldStoreFile
              ? await downloadDocumentFile(authFetch, detail).catch(async () => {
                  if (previousRecord?.fileUri) {
                    return { uri: previousRecord.fileUri, bytes: 0 };
                  }
                  return null;
                })
              : null;

            const record: OfflineDocumentRecord = {
              document: detail,
              text: previousRecord?.text ?? null,
              history: previousRecord?.history ?? null,
              fileUri: file?.uri ?? previousRecord?.fileUri ?? null,
              hasLocalFile: Boolean(file?.uri ?? previousRecord?.hasLocalFile),
              isPinnedOffline: previousRecord?.isPinnedOffline ?? false,
              availability: file?.uri ?? previousRecord?.hasLocalFile ? "available_offline" : "metadata_only",
              lastViewedAt: previousRecord?.lastViewedAt ?? null,
              syncedAt,
            };
            await writeDocumentRecord(record);
            await upsertOfflineDocumentMetadata(detail, {
              hasLocalFile: record.hasLocalFile,
              isPinnedOffline: record.isPinnedOffline,
              lastViewedAt: record.lastViewedAt,
              syncedAt,
            });
            if (previousRecord?.fileUri && record.fileUri && previousRecord.fileUri !== record.fileUri) {
              await deleteIfExists(previousRecord.fileUri);
            }
            syncedDocuments += 1;
          } catch {
            failedDocuments += 1;
          }
        }

        for (const existingDocument of existingDocuments.values()) {
          if (!incomingIds.has(existingDocument.id)) {
            const existingRecord = await loadDocumentRecord(existingDocument.id);
            await deleteIfExists(existingRecord?.fileUri);
            await deleteIfExists(buildDocumentRecordPath(existingDocument.id));
            await removeOfflineDocumentMetadata(existingDocument.id);
            removedDocuments += 1;
          }
        }

        await refreshSummary({
          lastSyncedAt: syncedAt,
          dashboard,
          facets,
          retentionSettings,
        });
        if (retentionSettings.mode === "smart_cache") {
          await cleanupRetainedFiles();
        }
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
          documentCount: documents.length,
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
    [cleanupRetainedFiles, loadDocumentRecord, refreshSummary, retentionSettings],
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
      retentionSettings,
      setOfflineModeEnabled,
      setRetentionSettings,
      cleanupRetainedFiles,
      checkArchiveReachability,
      syncArchive,
      persistViewedDocument,
      ensureDocumentFileAvailable,
      setDocumentPinnedOffline,
      getDocumentAvailability,
      getDocumentIndicators,
      loadDocuments,
      loadDocumentRecord,
      loadDashboard,
      loadFacets,
    }),
    [
      archiveReachability,
      checkArchiveReachability,
      cleanupRetainedFiles,
      ensureDocumentFileAvailable,
      getDocumentAvailability,
      getDocumentIndicators,
      isConnected,
      isOfflineModeEnabled,
      isReady,
      isSyncing,
      lastReachabilityCheckedAt,
      loadDashboard,
      loadDocumentRecord,
      loadDocuments,
      loadFacets,
      persistViewedDocument,
      retentionSettings,
      setDocumentPinnedOffline,
      setOfflineModeEnabled,
      setRetentionSettings,
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
