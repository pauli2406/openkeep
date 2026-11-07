import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * What the device keeps about conversations outside the encrypted offline copy.
 * Answers and quoted passages are document content, so they leave with the session.
 */
const PREFIXES = ["openkeep.chat-conversations", "openkeep.mobile.recent-searches"];

export async function clearLocalHistory() {
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys.filter((key) => PREFIXES.some((p) => key.startsWith(p))));
}
