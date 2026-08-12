import { contextBridge, ipcRenderer } from "electron";
import { createDesktopBridge } from "./shared/desktop-api";

const bridge = createDesktopBridge((channel, payload) =>
  ipcRenderer.invoke(channel, payload),
  (channel, listener) => {
    const wrapped = () => listener();
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
);

contextBridge.exposeInMainWorld("openkeepDesktop", bridge);
