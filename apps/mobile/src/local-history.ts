import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * What the device keeps about conversations outside the encrypted offline copy.
 * Answers and quoted passages are document content, so they leave with the session.
 */
const PREFIXES = ["openkeep.chat-conversations", "openkeep.mobile.recent-searches"];

/**
 * Stores that hold this history in memory. Clearing only the disk would leave them
 * showing it, and the next write would put it straight back.
 */
let listeners: Array<() => void> = [];

export function onLocalHistoryCleared(listener: () => void) {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((entry) => entry !== listener);
  };
}

export async function clearLocalHistory() {
  for (const listener of listeners) listener();
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys.filter((key) => PREFIXES.some((p) => key.startsWith(p))));
}
