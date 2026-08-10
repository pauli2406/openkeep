import { describe, expect, it, vi } from "vitest";
import { createDesktopBridge, DESKTOP_CHANNELS } from "./desktop-api";

describe("preload bridge contract", () => {
  it("exposes named operations over fixed channels", async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    const bridge = createDesktopBridge(invoke);

    await bridge.session.restore();
    await bridge.session.connect({
      serverUrl: "https://archive.example.com",
      apiToken: "secret",
    });
    await bridge.session.retry();
    await bridge.session.signOut();
    await bridge.runtime.getInfo();

    expect(invoke).toHaveBeenNthCalledWith(1, DESKTOP_CHANNELS.sessionRestore);
    expect(invoke).toHaveBeenNthCalledWith(2, DESKTOP_CHANNELS.sessionConnect, {
      serverUrl: "https://archive.example.com",
      apiToken: "secret",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, DESKTOP_CHANNELS.sessionRetry);
    expect(invoke).toHaveBeenNthCalledWith(4, DESKTOP_CHANNELS.sessionSignOut);
    expect(invoke).toHaveBeenNthCalledWith(5, DESKTOP_CHANNELS.runtimeGetInfo);
    expect(Object.isFrozen(bridge)).toBe(true);
    expect(Object.keys(bridge)).toEqual(["session", "runtime"]);
  });
});
