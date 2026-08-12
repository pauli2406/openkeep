import { describe, expect, it, vi } from "vitest";
import {
  DESKTOP_SHELL_PARTITION,
  clearProfilePartitionData,
  createProfilePartition,
  shouldResetProfilePartition,
} from "./profile-partition";

const PROFILE_ID = "2f5d2ab5-8477-4ce6-9bfc-bfe4aeece281";

describe("desktop profile partitions", () => {
  it("uses a dedicated ephemeral partition for the unconnected shell", () => {
    expect(DESKTOP_SHELL_PARTITION).toBe("openkeep-shell");
    expect(DESKTOP_SHELL_PARTITION).not.toMatch(/^persist:/);
  });

  it("derives a stable persistent partition from a profile UUID", () => {
    expect(createProfilePartition(PROFILE_ID)).toBe(
      `persist:openkeep-profile-${PROFILE_ID}`,
    );
    expect(createProfilePartition(PROFILE_ID.toUpperCase())).toBe(
      `persist:openkeep-profile-${PROFILE_ID}`,
    );
  });

  it("clears conversations, recent searches, cache, and active streams with removed profile storage", async () => {
    const targetSession = {
      closeAllConnections: vi.fn(async () => undefined),
      clearStorageData: vi.fn(async () => undefined),
      clearCache: vi.fn(async () => undefined),
    };
    const resolveSession = vi.fn(() => targetSession);

    await clearProfilePartitionData(PROFILE_ID, resolveSession);

    expect(resolveSession).toHaveBeenCalledWith(
      `persist:openkeep-profile-${PROFILE_ID}`,
    );
    expect(targetSession.closeAllConnections).toHaveBeenCalledOnce();
    expect(targetSession.clearStorageData).toHaveBeenCalledOnce();
    expect(targetSession.clearCache).toHaveBeenCalledOnce();
  });

  it.each([
    "",
    "profile-one",
    "2f5d2ab5-8477-4ce6-9bfc-bfe4aeece281/../shared",
    "2f5d2ab584774ce69bfcbfe4aeece281",
    "00000000-0000-0000-0000-000000000000",
    "2f5d2ab5-8477-0ce6-9bfc-bfe4aeece281",
    "2f5d2ab5-8477-4ce6-7bfc-bfe4aeece281",
  ])("rejects invalid profile id %j", (profileId) => {
    expect(() => createProfilePartition(profileId)).toThrow(
      "Profile ID must be a valid UUID.",
    );
  });
});

describe("profile partition reset policy", () => {
  it("does not reset when only the profile label changes", () => {
    expect(
      shouldResetProfilePartition(
        {
          id: PROFILE_ID,
          label: "Personal",
          serverUrl: "https://archive.example.com",
        },
        {
          id: PROFILE_ID,
          label: "Household",
          serverUrl: "https://archive.example.com",
        },
      ),
    ).toBe(false);
  });

  it("does not reset for equivalent normalized server URLs", () => {
    expect(
      shouldResetProfilePartition(
        { id: PROFILE_ID, serverUrl: " archive.example.com/ " },
        { id: PROFILE_ID, serverUrl: "https://archive.example.com" },
      ),
    ).toBe(false);
  });

  it("resets when the same profile changes server URL", () => {
    expect(
      shouldResetProfilePartition(
        { id: PROFILE_ID, serverUrl: "https://archive.example.com" },
        { id: PROFILE_ID, serverUrl: "https://other.example.com" },
      ),
    ).toBe(true);
  });

  it("does not reset one profile's partition for a different profile", () => {
    expect(
      shouldResetProfilePartition(
        { id: PROFILE_ID, serverUrl: "https://archive.example.com" },
        {
          id: "38107d87-6501-4142-b9b9-84edac8c4d6a",
          serverUrl: "https://other.example.com",
        },
      ),
    ).toBe(false);
  });
});
