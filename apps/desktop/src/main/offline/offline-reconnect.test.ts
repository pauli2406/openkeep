import { describe, expect, it, vi } from "vitest";
import { createOfflineReconnect } from "./offline-reconnect";
import type { DesktopSessionState } from "../../shared/desktop-api";

const user = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "owner@example.com",
  displayName: "Owner",
  isOwner: true,
  twoFactorEnabled: false,
  preferences: {
    uiLanguage: "en" as const,
    aiProcessingLanguage: "en" as const,
    aiChatLanguage: "en" as const,
  },
  createdAt: "2026-08-10T00:00:00.000Z",
};

const profile = { id: "home", label: "Home", serverUrl: "https://home.invalid" };

function createHarness(results: DesktopSessionState[]) {
  let offlineProfile: string | null = "home";
  const activateProfile = vi.fn(async () => {
    const next = results.shift();
    if (!next) throw new Error("no scripted result");
    return next;
  });
  const onReconnected = vi.fn(() => {
    offlineProfile = null;
  });
  const onCredentialsRejected = vi.fn(() => {
    offlineProfile = null;
  });
  const reconnect = createOfflineReconnect({
    timer: { start: vi.fn(), stop: vi.fn() },
    offlineProfileId: () => offlineProfile,
    activateProfile,
    onReconnected,
    onCredentialsRejected,
  });
  return {
    reconnect,
    activateProfile,
    onReconnected,
    onCredentialsRejected,
    endOffline: () => {
      offlineProfile = null;
    },
  };
}

describe("offline reconnect", () => {
  it("returns to live data on the first successful verification", async () => {
    const harness = createHarness([
      { status: "unavailable", profile, message: "down" },
      { status: "connected", profile, user },
    ]);

    await harness.reconnect.check();
    expect(harness.onReconnected).not.toHaveBeenCalled();

    await harness.reconnect.check();
    expect(harness.onReconnected).toHaveBeenCalledWith(
      "home",
      expect.objectContaining({ status: "connected" }),
    );

    // The offline session ended; later ticks verify nothing.
    await harness.reconnect.check();
    expect(harness.activateProfile).toHaveBeenCalledTimes(2);
  });

  it("follows the invalid-credentials path instead of staying offline", async () => {
    const harness = createHarness([
      { status: "disconnected", reason: "invalid-credentials" },
    ]);

    await harness.reconnect.check();

    expect(harness.onCredentialsRejected).toHaveBeenCalledWith(
      "home",
      expect.objectContaining({ reason: "invalid-credentials" }),
    );
    expect(harness.onReconnected).not.toHaveBeenCalled();
  });

  it("stays offline quietly while the archive is unreachable", async () => {
    const harness = createHarness([
      { status: "unavailable", profile, message: "down" },
      { status: "error", code: "unreachable", message: "down" },
    ]);

    await harness.reconnect.check();
    await harness.reconnect.check();

    expect(harness.onReconnected).not.toHaveBeenCalled();
    expect(harness.onCredentialsRejected).not.toHaveBeenCalled();
  });

  it("discards a verification that finishes after the session ended", async () => {
    let resolveActivation!: (state: DesktopSessionState) => void;
    let offlineProfile: string | null = "home";
    const onReconnected = vi.fn();
    const reconnect = createOfflineReconnect({
      timer: { start: vi.fn(), stop: vi.fn() },
      offlineProfileId: () => offlineProfile,
      activateProfile: () =>
        new Promise<DesktopSessionState>((resolve) => {
          resolveActivation = resolve;
        }),
      onReconnected,
      onCredentialsRejected: vi.fn(),
    });

    const inFlight = reconnect.check();
    offlineProfile = null;
    resolveActivation({ status: "connected", profile, user });
    await inFlight;

    expect(onReconnected).not.toHaveBeenCalled();
  });
});
