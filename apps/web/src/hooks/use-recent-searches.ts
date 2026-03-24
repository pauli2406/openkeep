import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "openkeep.recent-searches";
const MAX_ITEMS = 8;

export type RecentSearch = {
  query: string;
  timestamp: number;
};

// ---------------------------------------------------------------------------
// External store so all consumers share the same reactive state
// ---------------------------------------------------------------------------

let listeners: Array<() => void> = [];

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function readFromStorage(): RecentSearch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item: unknown): item is RecentSearch =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as RecentSearch).query === "string" &&
        typeof (item as RecentSearch).timestamp === "number",
    );
  } catch {
    return [];
  }
}

function writeToStorage(items: RecentSearch[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  emitChange();
}

let snapshotCache: RecentSearch[] | null = null;
let snapshotRaw: string | null = null;

function getSnapshot(): RecentSearch[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (snapshotCache === null || raw !== snapshotRaw) {
    snapshotRaw = raw;
    snapshotCache = readFromStorage();
  }
  return snapshotCache;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRecentSearches() {
  const recentSearches = useSyncExternalStore(subscribe, getSnapshot, () => []);

  const addSearch = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const current = readFromStorage();
    const filtered = current.filter(
      (item) => item.query.toLowerCase() !== trimmed.toLowerCase(),
    );
    const next = [{ query: trimmed, timestamp: Date.now() }, ...filtered].slice(
      0,
      MAX_ITEMS,
    );
    writeToStorage(next);
  }, []);

  const removeSearch = useCallback((query: string) => {
    const current = readFromStorage();
    const next = current.filter(
      (item) => item.query.toLowerCase() !== query.toLowerCase(),
    );
    writeToStorage(next);
  }, []);

  const clearAll = useCallback(() => {
    writeToStorage([]);
  }, []);

  return { recentSearches, addSearch, removeSearch, clearAll };
}
