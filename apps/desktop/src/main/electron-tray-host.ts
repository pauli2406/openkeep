import type {
  App,
  BrowserWindow,
  Dialog,
  MenuItemConstructorOptions,
  NativeImage,
} from "electron";
import { Menu, Tray, nativeImage } from "electron";
import type {
  TrayLifecycleHost,
  TrayMenuItem,
} from "./tray-lifecycle";

const TRAY_MARK = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <path fill="#000" d="M6 4h16l4 4v15l-10 6L6 23V4Zm4 6v11l6 3.7 6-3.7V10H10Zm1-4 2 2h9l-2-2h-9Z"/>
</svg>`;

function createTrayImage(platform: NodeJS.Platform): NativeImage | null {
  const source = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(TRAY_MARK).toString("base64")}`,
  );
  if (source.isEmpty()) return null;
  const size = platform === "darwin" ? 18 : platform === "win32" ? 20 : 22;
  const image = source.resize({ width: size, height: size, quality: "best" });
  if (platform === "darwin") image.setTemplateImage(true);
  return image;
}

function toElectronMenu(items: TrayMenuItem[]): MenuItemConstructorOptions[] {
  return items.map((item) => ({
    ...(item.label ? { label: item.label } : {}),
    ...(item.type ? { type: item.type } : {}),
    ...(item.enabled !== undefined ? { enabled: item.enabled } : {}),
    ...(item.checked !== undefined ? { checked: item.checked } : {}),
    ...(item.submenu ? { submenu: toElectronMenu(item.submenu) } : {}),
    ...(item.click ? { click: () => { void item.click?.(); } } : {}),
  }));
}

export function createElectronTrayLifecycleHost({
  app,
  dialog,
  platform,
  getWindow,
}: {
  app: App;
  dialog: Dialog;
  platform: NodeJS.Platform;
  getWindow: () => BrowserWindow | null;
}): TrayLifecycleHost {
  return {
    platform,
    createTray() {
      const image = createTrayImage(platform);
      if (!image) return null;
      const electronTray = new Tray(image);
      return {
        setMenu(items) {
          electronTray.setContextMenu(Menu.buildFromTemplate(toElectronMenu(items)));
        },
        setToolTip(toolTip) {
          electronTray.setToolTip(toolTip);
        },
        on(event, handler) {
          electronTray.on(event, handler);
        },
        destroy() {
          if (!electronTray.isDestroyed()) electronTray.destroy();
        },
      };
    },
    focusApplication() {
      app.focus({ steal: true });
    },
    quitApplication() {
      app.quit();
    },
    async confirmQuitOnClose() {
      const options = {
        type: "warning" as const,
        title: "Quit when the window closes?",
        message: "Closing OpenKeep will stop background work.",
        detail:
          "Imports and other archive work can continue only while OpenKeep is running. You can still quit explicitly from the tray at any time.",
        buttons: ["Quit on window close", "Keep running"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      };
      const parent = getWindow();
      const result = parent && !parent.isDestroyed()
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options);
      return result.response === 0;
    },
    onBeforeQuit(handler) {
      app.on("before-quit", handler);
    },
    reportError(message, error) {
      console.error(message, error);
    },
  };
}
