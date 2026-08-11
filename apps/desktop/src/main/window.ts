import type { BrowserWindowConstructorOptions } from "electron";
import { DESKTOP_SHELL_PARTITION } from "./profile-partition";
import { APP_URL, isTrustedRendererUrl } from "./security";

export function getProfileWindowUrl(
  profileId: string | null,
  rememberedRoutes: ReadonlyMap<string, string>,
): string {
  if (!profileId) return APP_URL;
  const remembered = rememberedRoutes.get(profileId);
  return remembered && isTrustedRendererUrl(remembered) ? remembered : APP_URL;
}

export function createMainWindowOptions(
  preloadPath: string,
  isPackaged: boolean,
  partition = DESKTOP_SHELL_PARTITION,
): BrowserWindowConstructorOptions {
  return {
    width: 1_280,
    height: 820,
    minWidth: 920,
    minHeight: 620,
    show: false,
    backgroundColor: "#f4f1ea",
    title: "OpenKeep",
    webPreferences: {
      preload: preloadPath,
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      devTools: !isPackaged,
    },
  };
}
