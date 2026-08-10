import { describe, expect, it, vi } from "vitest";
import { createDesktopBridge, DESKTOP_CHANNELS } from "./desktop-api";

describe("preload bridge contract", () => {
  it("exposes named operations over fixed channels", async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    const bridge = createDesktopBridge(invoke);

    await bridge.connection.checkHealth({ serverUrl: "https://archive.example.com" });
    await bridge.runtime.getInfo();

    expect(invoke).toHaveBeenNthCalledWith(
      1,
      DESKTOP_CHANNELS.connectionCheckHealth,
      { serverUrl: "https://archive.example.com" },
    );
    expect(invoke).toHaveBeenNthCalledWith(2, DESKTOP_CHANNELS.runtimeGetInfo);
    expect(Object.isFrozen(bridge)).toBe(true);
    expect(Object.keys(bridge)).toEqual(["connection", "runtime"]);
  });
});
