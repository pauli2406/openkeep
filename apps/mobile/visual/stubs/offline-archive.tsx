/**
 * Stands in for `src/offline-archive` in the visual build only. The cache is
 * SQLite plus the document directory, neither of which exists in a browser, so
 * the fixture archive answers the cached reads instead. `?offline=1` switches the
 * app into the read-only state so those screens can be captured too.
 */
import type { ReactNode } from "react";
import { DASHBOARD, DOCUMENTS, FACETS, HISTORY, TEXT } from "../fixtures";

function offline() {
  return typeof window !== "undefined" && window.location.search.includes("offline=1");
}

export function OfflineArchiveProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useOfflineArchive() {
  const cached = DOCUMENTS.filter((document) => document.status === "ready");

  return {
    isConnected: !offline(),
    shouldUseCache: offline(),
    isReady: true,
    cacheSummary: {
      documentCount: cached.length,
      fileStorageBytes: 18_452_119,
      lastCachedAt: "2026-03-20T08:12:00.000Z",
      revision: "2026-03-20T08:12:00.000Z",
    },
    cacheOpenedDocument: async () => record(),
    ensureCachedFile: async () => "file:///cache/d-2.pdf",
    loadCachedDocument: async () => record(),
    queryCachedDocuments: async (options?: { reviewOnly?: boolean; query?: string }) => {
      let items = cached;
      if (options?.reviewOnly) {
        items = items.filter((document) => document.reviewStatus === "pending");
      }
      if (options?.query) {
        const needle = options.query.toLowerCase();
        items = items.filter((document) => (document.title ?? "").toLowerCase().includes(needle));
      }
      return { items, total: items.length, page: 1, pageSize: 25 };
    },
    loadCachedDashboard: async () => DASHBOARD,
    loadCachedFacets: async () => FACETS,
    clearCachedDocuments: async () => {},
    getCacheSummary: async () => ({
      documentCount: cached.length,
      fileStorageBytes: 18_452_119,
      lastCachedAt: "2026-03-20T08:12:00.000Z",
      revision: "2026-03-20T08:12:00.000Z",
    }),
  };
}

function record() {
  return {
    document: DOCUMENTS[1],
    text: TEXT,
    history: HISTORY,
    fileUri: null,
    cachedAt: "2026-03-19T16:05:00.000Z",
    lastViewedAt: "2026-03-20T08:12:00.000Z",
    fileStorageBytes: 2_918_402,
  };
}
