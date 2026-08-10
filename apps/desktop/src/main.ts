import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  app,
  BrowserWindow,
  ipcMain,
  net,
  protocol,
  safeStorage,
  session,
  shell,
} from "electron";
import type { DesktopConnectInput } from "./shared/desktop-api";
import { DESKTOP_CHANNELS } from "./shared/desktop-api";
import { createArchiveSessionService, type ArchiveSessionService } from "./main/archive-session";
import { createAppProtocolHandler } from "./main/protocol";
import {
  createArchiveProfileRepository,
  createSafeStorageCipher,
  ProfileStorage,
} from "./main/storage";
import {
  APP_HOST,
  APP_SCHEME,
  APP_URL,
  assertTrustedIpcSender,
  classifyNavigation,
} from "./main/security";
import { createMainWindowOptions } from "./main/window";

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      codeCache: true,
    },
  },
]);

app.enableSandbox();

const isSmokeTest = process.argv.includes("--smoke-test");
let mainWindow: BrowserWindow | null = null;
const trustedWebContentsIds = new Set<number>();

function assertIpcEvent(event: Electron.IpcMainInvokeEvent) {
  const senderFrame = event.senderFrame;
  assertTrustedIpcSender(
    senderFrame?.url ?? "",
    Boolean(senderFrame && senderFrame === event.sender.mainFrame),
    trustedWebContentsIds.has(event.sender.id),
  );
}

function registerIpcHandlers(archiveSession: ArchiveSessionService) {
  ipcMain.handle(
    DESKTOP_CHANNELS.sessionRestore,
    async (event) => {
      assertIpcEvent(event);
      return archiveSession.restore();
    },
  );

  ipcMain.handle(
    DESKTOP_CHANNELS.sessionConnect,
    async (event, input: DesktopConnectInput) => {
      assertIpcEvent(event);
      return archiveSession.connect(input);
    },
  );

  ipcMain.handle(DESKTOP_CHANNELS.sessionRetry, async (event) => {
    assertIpcEvent(event);
    return archiveSession.retry();
  });

  ipcMain.handle(DESKTOP_CHANNELS.sessionSignOut, async (event) => {
    assertIpcEvent(event);
    return archiveSession.signOut();
  });

  ipcMain.handle(DESKTOP_CHANNELS.runtimeGetInfo, async (event) => {
    assertIpcEvent(event);
    return {
      platform: process.platform,
      version: app.getVersion(),
    };
  });
}

function configureSessionSecurity() {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

function openExternalIfAllowed(target: string) {
  if (classifyNavigation(target) === "external") {
    void shell.openExternal(target);
  }
}

function attachWindowSecurity(window: BrowserWindow) {
  window.webContents.on("will-navigate", (event, target) => {
    const decision = classifyNavigation(target);
    if (decision === "allow") {
      return;
    }

    event.preventDefault();
    if (decision === "external") {
      openExternalIfAllowed(target);
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    const decision = classifyNavigation(url);
    if (decision === "allow") {
      void window.loadURL(url);
    } else if (decision === "external") {
      openExternalIfAllowed(url);
    }
    return { action: "deny" };
  });
}

async function completeSmokeTest(window: BrowserWindow) {
  const timeout = setTimeout(() => {
    console.error("OpenKeep desktop smoke test timed out.");
    app.exit(1);
  }, 15_000);

  try {
    const result = await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const deadline = Date.now() + 10000;
        const check = () => {
          const heading = document.querySelector('h1')?.textContent;
          if (heading || Date.now() >= deadline) {
            resolve({
              heading,
              bridgeKeys: Object.keys(window.openkeepDesktop ?? {}),
              hasProcess: typeof window.process !== 'undefined',
              hasRequire: typeof window.require !== 'undefined',
              csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content,
            });
            return;
          }
          setTimeout(check, 50);
        };
        check();
      })
    `) as {
      heading?: string;
      bridgeKeys: string[];
      hasProcess: boolean;
      hasRequire: boolean;
      csp?: string;
    };

    const passed =
      result.heading === "Connect your archive" &&
      result.bridgeKeys.join(",") === "session,runtime" &&
      !result.hasProcess &&
      !result.hasRequire &&
      result.csp?.includes("default-src 'none'");
    if (!passed) {
      throw new Error(`Unexpected renderer state: ${JSON.stringify(result)}`);
    }

    console.log("OPENKEEP_DESKTOP_SMOKE_OK");
    clearTimeout(timeout);
    // Destroy the window before exiting. A live renderer can keep the packaged
    // process alive past `app.exit` on some platforms, which reads to the smoke
    // runner as a hung application rather than a healthy boot.
    for (const open of BrowserWindow.getAllWindows()) open.destroy();
    app.exit(0);
  } catch (error) {
    clearTimeout(timeout);
    console.error("OpenKeep desktop smoke test failed.", error);
    app.exit(1);
  }
}

function createMainWindow() {
  const preloadPath = path.join(__dirname, "preload.js");
  const window = new BrowserWindow(createMainWindowOptions(preloadPath, app.isPackaged));
  trustedWebContentsIds.add(window.webContents.id);
  attachWindowSecurity(window);

  if (isSmokeTest) {
    window.webContents.once("did-fail-load", (_event, code, description) => {
      console.error(`OpenKeep desktop smoke load failed (${code}): ${description}`);
      app.exit(1);
    });
    window.webContents.once("did-finish-load", () => void completeSmokeTest(window));
  } else {
    window.once("ready-to-show", () => window.show());
  }
  window.on("closed", () => {
    trustedWebContentsIds.delete(window.webContents.id);
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
  void window.loadURL(APP_URL);
  mainWindow = window;
}

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-attach-webview", (event) => event.preventDefault());
});

void app.whenReady().then(async () => {
  app.setAppUserModelId("de.openkeep.desktop");
  configureSessionSecurity();

  const profileStorage = new ProfileStorage({
    filePath: path.join(app.getPath("userData"), "desktop-state.json"),
    cipher: createSafeStorageCipher(safeStorage),
  });
  const archiveSession = createArchiveSessionService(
    (input, init) => net.fetch(input, init),
    createArchiveProfileRepository(profileStorage),
    randomUUID,
  );
  registerIpcHandlers(archiveSession);

  const rendererRoot = path.join(__dirname, "../renderer", MAIN_WINDOW_VITE_NAME);
  const rendererDevServerUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL || undefined;
  await protocol.handle(
    APP_SCHEME,
    createAppProtocolHandler({
      rendererRoot,
      rendererDevServerUrl,
      archiveSession,
      fetchRequest: (input, init) => net.fetch(input, init),
      fileExists: existsSync,
    }),
  );

  createMainWindow();

  app.on("activate", () => {
    if (isSmokeTest) {
      return;
    }
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else {
      mainWindow?.show();
    }
  });
}).catch((error: unknown) => {
  console.error("OpenKeep desktop failed to start.", error);
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
