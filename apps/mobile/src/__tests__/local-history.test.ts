import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearLocalHistory, onLocalHistoryCleared } from "../local-history";

describe("clearing local history", () => {
  it("removes the stored conversations and recent questions, and nothing else", async () => {
    await AsyncStorage.multiSet([
      ["openkeep.chat-conversations:scope", "[]"],
      ["openkeep.mobile.recent-searches:scope", "[]"],
      ["openkeep.appearance", "dark"],
    ]);

    await clearLocalHistory();

    expect(await AsyncStorage.getItem("openkeep.chat-conversations:scope")).toBeNull();
    expect(await AsyncStorage.getItem("openkeep.mobile.recent-searches:scope")).toBeNull();
    expect(await AsyncStorage.getItem("openkeep.appearance")).toBe("dark");
  });

  it("tells the stores holding it in memory", async () => {
    const cleared = jest.fn();
    const stop = onLocalHistoryCleared(cleared);
    await clearLocalHistory();
    expect(cleared).toHaveBeenCalledTimes(1);

    stop();
    await clearLocalHistory();
    expect(cleared).toHaveBeenCalledTimes(1);
  });
});
