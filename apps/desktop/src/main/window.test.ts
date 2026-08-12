import { describe, expect, it } from "vitest";
import { createMainWindowOptions } from "./window";

describe("desktop window hardening", () => {
  it("keeps Electron capabilities out of the renderer", () => {
    const options = createMainWindowOptions("/absolute/preload.js", true);

    expect(options.webPreferences).toMatchObject({
      preload: "/absolute/preload.js",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      devTools: false,
    });
  });
});
