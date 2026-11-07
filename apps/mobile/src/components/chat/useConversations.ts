import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth";
import { offlineCacheScope } from "../../offline-scope";
import {
  CONVERSATIONS_KEY,
  MAX_CONVERSATIONS,
  parseConversations,
  type Conversation,
} from "./conversations";

/**
 * Conversations hold quotes from documents, so they belong to one account on one
 * archive, the way the offline copy does. The web's localStorage gets this from
 * its origin; a phone that signs in elsewhere has to do it in the key. Without an
 * identity nothing is read or written.
 */
export function useConversations() {
  const auth = useAuth();
  const scope = offlineCacheScope({ apiUrl: auth.apiUrl, userId: auth.user?.id });
  const key = scope ? `${CONVERSATIONS_KEY}:${scope}` : null;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setConversations([]);
    if (!key) {
      setLoaded(true);
      return;
    }
    void AsyncStorage.getItem(key)
      .then((raw) => {
        if (!cancelled) setConversations(parseConversations(raw));
      })
      .catch(() => {
        // unreadable storage costs the history, not the screen
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const commit = useCallback((next: Conversation[]) => {
    setConversations(next);
    if (keyRef.current) {
      void AsyncStorage.setItem(
        keyRef.current,
        JSON.stringify(next.slice(0, MAX_CONVERSATIONS)),
      ).catch(() => {
        // storage full or unavailable: the session still works in memory
      });
    }
  }, []);

  return { conversations, loaded, commit };
}
