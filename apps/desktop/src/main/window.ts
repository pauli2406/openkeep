import type { BrowserWindowConstructorOptions } from "electron";
import { DESKTOP_SHELL_PARTITION } from "./profile-partition";

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
