import { describe, expect, it } from "vitest";
import { DESKTOP_SHELL_PARTITION } from "./profile-partition";
import { createMainWindowOptions, getProfileWindowUrl } from "./window";

describe("desktop window hardening", () => {
  it("keeps Electron capabilities out of the renderer", () => {
    const options = createMainWindowOptions(
      "/absolute/preload.js",
      true,
      DESKTOP_SHELL_PARTITION,
    );

    expect(options.webPreferences).toMatchObject({
      preload: "/absolute/preload.js",
      partition: DESKTOP_SHELL_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      devTools: false,
    });
  });

  it("places the window in the explicitly selected profile partition", () => {
    const options = createMainWindowOptions(
      "/absolute/preload.js",
      false,
      "persist:openkeep-profile-2f5d2ab5-8477-4ce6-9bfc-bfe4aeece281",
    );

    expect(options.webPreferences?.partition).toBe(
      "persist:openkeep-profile-2f5d2ab5-8477-4ce6-9bfc-bfe4aeece281",
    );
    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    });
  });

  it("restores only the active profile's last trusted deep route", () => {
    const rememberedRoutes = new Map([
      ["home", "openkeep://app/documents/0191?preview=1#page-2"],
      ["work", "https://malicious.example.com/steal"],
    ]);

    expect(getProfileWindowUrl("home", rememberedRoutes)).toBe(
      "openkeep://app/documents/0191?preview=1#page-2",
    );
    expect(getProfileWindowUrl("work", rememberedRoutes)).toBe(
      "openkeep://app/",
    );
    expect(getProfileWindowUrl("new", rememberedRoutes)).toBe(
      "openkeep://app/",
    );
    expect(getProfileWindowUrl(null, rememberedRoutes)).toBe(
      "openkeep://app/",
    );
  });
});
