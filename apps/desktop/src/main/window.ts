import type { BrowserWindowConstructorOptions } from "electron";

export function createMainWindowOptions(
  preloadPath: string,
  isPackaged: boolean,
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
