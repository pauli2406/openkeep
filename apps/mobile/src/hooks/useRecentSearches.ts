import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "openkeep.mobile.recent-searches";
const MAX_ITEMS = 8;

export type RecentSearch = {
  query: string;
  timestamp: number;
};

export function useRecentSearches() {
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);

  // Load on mount
  useEffect(() => {
    async function load() {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setRecentSearches(
            parsed.filter(
              (item: unknown): item is RecentSearch =>
                typeof item === "object" &&
                item !== null &&
                typeof (item as RecentSearch).query === "string" &&
                typeof (item as RecentSearch).timestamp === "number",
            ),
          );
        }
      } catch {
        // ignore
      }
    }
    void load();
  }, []);

  const persist = useCallback(async (items: RecentSearch[]) => {
    setRecentSearches(items);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, []);

  const addSearch = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) return;

      const filtered = recentSearches.filter(
        (item) => item.query.toLowerCase() !== trimmed.toLowerCase(),
      );
      const next = [{ query: trimmed, timestamp: Date.now() }, ...filtered].slice(0, MAX_ITEMS);
      await persist(next);
    },
    [recentSearches, persist],
  );

  const removeSearch = useCallback(
    async (query: string) => {
      const next = recentSearches.filter(
        (item) => item.query.toLowerCase() !== query.toLowerCase(),
      );
      await persist(next);
    },
    [recentSearches, persist],
  );

  const clearAll = useCallback(async () => {
    await persist([]);
  }, [persist]);

  return { recentSearches, addSearch, removeSearch, clearAll };
}
