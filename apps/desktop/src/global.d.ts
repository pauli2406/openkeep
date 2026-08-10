import type { DesktopBridge } from "./shared/desktop-api";

declare global {
  interface Window {
    openkeepDesktop: DesktopBridge;
  }
}

export {};
