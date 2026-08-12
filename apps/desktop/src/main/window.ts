import type { BrowserWindowConstructorOptions } from "electron";
import { DESKTOP_SHELL_PARTITION } from "./profile-partition";
import { APP_URL, isTrustedRendererUrl } from "./security";
import type { DesktopWindowBounds } from "./lifecycle-state";

const DEFAULT_WIDTH = 1_280;
const DEFAULT_HEIGHT = 820;
const MIN_WIDTH = 920;
const MIN_HEIGHT = 620;

function containsBounds(display: DesktopWindowBounds, bounds: DesktopWindowBounds) {
  return (
    bounds.x >= display.x &&
    bounds.y >= display.y &&
    bounds.x + bounds.width <= display.x + display.width &&
    bounds.y + bounds.height <= display.y + display.height
  );
}

export function resolveWindowBounds(
  remembered: DesktopWindowBounds | undefined,
  displayWorkAreas: DesktopWindowBounds[],
): DesktopWindowBounds | undefined {
  const validRemembered = remembered &&
    Number.isFinite(remembered.x) && Number.isFinite(remembered.y) &&
    Number.isFinite(remembered.width) && Number.isFinite(remembered.height) &&
    remembered.width >= MIN_WIDTH && remembered.height >= MIN_HEIGHT;
  if (
    validRemembered &&
    displayWorkAreas.some((display) => containsBounds(display, remembered))
  ) {
    return { ...remembered };
  }
  const primary = displayWorkAreas[0];
  if (!primary) return undefined;
  const width = Math.min(
    validRemembered ? remembered.width : DEFAULT_WIDTH,
    primary.width,
  );
  const height = Math.min(
    validRemembered ? remembered.height : DEFAULT_HEIGHT,
    primary.height,
  );
  return {
    x: primary.x + Math.round((primary.width - width) / 2),
    y: primary.y + Math.round((primary.height - height) / 2),
    width,
    height,
  };
}

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
  bounds?: DesktopWindowBounds,
): BrowserWindowConstructorOptions {
  return {
    width: bounds?.width ?? DEFAULT_WIDTH,
    height: bounds?.height ?? DEFAULT_HEIGHT,
    ...(bounds ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
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
