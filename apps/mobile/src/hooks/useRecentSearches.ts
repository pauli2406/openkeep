import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useAuth } from "../auth";
import { offlineCacheScope } from "../offline-scope";

const STORAGE_KEY = "openkeep.mobile.recent-searches";
const MAX_ITEMS = 8;

export type RecentSearch = {
  query: string;
  timestamp: number;
};

// ---------------------------------------------------------------------------
// One store for every consumer. Chat and the omnibar both ask questions, and two
// private copies of this list would overwrite each other's entries.
//
// Questions say a lot about an archive, so the list belongs to one account on one
// server, the way the offline copy does. The old global key is removed on load:
// nothing in it says whose questions those were.
// ---------------------------------------------------------------------------

const EMPTY: RecentSearch[] = [];
let activeScope: string | null = null;
let items: RecentSearch[] = EMPTY;
let listeners: Array<() => void> = [];

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((entry) => entry !== listener);
  };
}

function getSnapshot() {
  return items;
}

function parse(raw: string | null): RecentSearch[] {
  if (!raw) {
    return EMPTY;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return EMPTY;
    }
    return parsed.filter(
      (item: unknown): item is RecentSearch =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as RecentSearch).query === "string" &&
        typeof (item as RecentSearch).timestamp === "number",
    );
  } catch {
    return EMPTY;
  }
}

function activate(scope: string | null) {
  if (scope === activeScope) {
    return;
  }
  activeScope = scope;
  items = EMPTY;
  emitChange();
  if (!scope) {
    return;
  }
  void AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  void AsyncStorage.getItem(`${STORAGE_KEY}:${scope}`)
    .then((raw) => {
      // Signed in elsewhere while this was loading: not this list any more.
      if (activeScope === scope) {
        items = parse(raw);
        emitChange();
      }
    })
    .catch(() => {});
}

function write(next: RecentSearch[]) {
  items = next;
  emitChange();
  if (activeScope) {
    void AsyncStorage.setItem(`${STORAGE_KEY}:${activeScope}`, JSON.stringify(next)).catch(() => {});
  }
}

export function useRecentSearches() {
  const auth = useAuth();
  const scope = offlineCacheScope({ apiUrl: auth.apiUrl, userId: auth.user?.id });
  const recentSearches = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    activate(scope);
  }, [scope]);

  const addSearch = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const filtered = items.filter((item) => item.query.toLowerCase() !== trimmed.toLowerCase());
    write([{ query: trimmed, timestamp: Date.now() }, ...filtered].slice(0, MAX_ITEMS));
  }, []);

  const removeSearch = useCallback((query: string) => {
    write(items.filter((item) => item.query.toLowerCase() !== query.toLowerCase()));
  }, []);

  const clearAll = useCallback(() => {
    write([]);
  }, []);

  return { recentSearches, addSearch, removeSearch, clearAll };
}
