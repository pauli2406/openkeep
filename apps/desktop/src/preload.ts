import { contextBridge, ipcRenderer } from "electron";
import { createDesktopBridge } from "./shared/desktop-api";

const bridge = createDesktopBridge((channel, payload) =>
  ipcRenderer.invoke(channel, payload),
);

contextBridge.exposeInMainWorld("openkeepDesktop", bridge);
