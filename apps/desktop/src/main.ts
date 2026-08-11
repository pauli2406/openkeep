import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  safeStorage,
  session,
  shell,
} from "electron";
import type { DesktopConnectInput } from "./shared/desktop-api";
import type {
  DesktopImportAssignInput,
  DesktopProfileIdInput,
  DesktopProfileRenameInput,
  DesktopSessionState,
} from "./shared/desktop-api";
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
  assertTrustedIpcSender,
  classifyNavigation,
  isTrustedRendererUrl,
} from "./main/security";
import { createMainWindowOptions, getProfileWindowUrl } from "./main/window";
import {
  clearProfilePartitionData,
  createProfilePartition,
  DESKTOP_SHELL_PARTITION,
  shouldResetProfilePartition,
} from "./main/profile-partition";
import {
  createDesktopImportService,
  extractOpenWithPaths,
} from "./main/import-service";
import { createDesktopImportCoordinator } from "./main/import-coordinator";

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
const windowProfileIds = new Map<number, string | null>();
const profileRoutes = new Map<string, string>();
const deferredOpenWithPaths: string[][] = [];
let receiveOpenWithPaths: ((paths: string[]) => Promise<void>) | null = null;

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function assertIpcEvent(event: Electron.IpcMainInvokeEvent) {
  const senderFrame = event.senderFrame;
  assertTrustedIpcSender(
    senderFrame?.url ?? "",
    Boolean(senderFrame && senderFrame === event.sender.mainFrame),
    trustedWebContentsIds.has(event.sender.id),
  );
}

function registerIpcHandlers(
  archiveSession: ArchiveSessionService,
  imports: ReturnType<typeof createDesktopImportCoordinator>,
  transitionWindow: (
    senderId: number,
    state: DesktopSessionState,
    options?: { resetProfileId?: string; clearProfileId?: string },
  ) => void,
) {
  ipcMain.handle(
    DESKTOP_CHANNELS.sessionRestore,
    async (event) => {
      assertIpcEvent(event);
      const profiles = await archiveSession.listProfiles().catch(() => null);
      const restoredProfileId =
        profiles?.profiles.length === 1
          ? profiles.profiles[0]!.id
          : profiles?.activeProfileId ?? undefined;
      const state = await archiveSession.restore();
      transitionWindow(event.sender.id, state, {
        clearProfileId:
          state.status === "disconnected" &&
          state.reason === "invalid-credentials"
            ? restoredProfileId
            : undefined,
      });
      return state;
    },
  );

  ipcMain.handle(
    DESKTOP_CHANNELS.sessionConnect,
    async (event, input: DesktopConnectInput) => {
      assertIpcEvent(event);
      const previous = archiveSession.getActiveSession()?.profile;
      const state = await archiveSession.connect(input);
      const resetProfileId =
        previous &&
        state.status === "connected" &&
        shouldResetProfilePartition(previous, state.profile)
          ? state.profile.id
          : undefined;
      transitionWindow(event.sender.id, state, { resetProfileId });
      return state;
    },
  );

  ipcMain.handle(DESKTOP_CHANNELS.sessionRetry, async (event) => {
    assertIpcEvent(event);
    const profiles = await archiveSession.listProfiles().catch(() => null);
    const state = await archiveSession.retry();
    transitionWindow(event.sender.id, state, {
      clearProfileId:
        state.status === "disconnected" &&
        state.reason === "invalid-credentials"
          ? profiles?.activeProfileId ?? undefined
          : undefined,
    });
    return state;
  });

  ipcMain.handle(DESKTOP_CHANNELS.sessionSignOut, async (event) => {
    assertIpcEvent(event);
    const profileId = archiveSession.getActiveSession()?.profile.id;
    const state = await archiveSession.signOut();
    transitionWindow(event.sender.id, state, {
      clearProfileId:
        state.status === "disconnected" && state.reason === "signed-out"
          ? profileId
          : undefined,
    });
    return state;
  });

  ipcMain.handle(DESKTOP_CHANNELS.profilesList, async (event) => {
    assertIpcEvent(event);
    return archiveSession.listProfiles();
  });

  ipcMain.handle(
    DESKTOP_CHANNELS.profilesActivate,
    async (event, input: DesktopProfileIdInput) => {
      assertIpcEvent(event);
      const state = await archiveSession.activate(input?.profileId);
      transitionWindow(event.sender.id, state, {
        clearProfileId:
          state.status === "disconnected" &&
          state.reason === "invalid-credentials"
            ? input?.profileId
            : undefined,
      });
      return state;
    },
  );

  ipcMain.handle(
    DESKTOP_CHANNELS.profilesRename,
    async (event, input: DesktopProfileRenameInput) => {
      assertIpcEvent(event);
      return archiveSession.renameProfile(input);
    },
  );

  ipcMain.handle(
    DESKTOP_CHANNELS.profilesRemove,
    async (event, input: DesktopProfileIdInput) => {
      assertIpcEvent(event);
      const profiles = await archiveSession.listProfiles().catch(() => null);
      const profileExisted = profiles?.profiles.some(
        (profile) => profile.id === input?.profileId,
      );
      const state = await archiveSession.removeProfile(input?.profileId);
      transitionWindow(event.sender.id, state, {
        clearProfileId:
          profileExisted && state.status !== "error"
            ? input?.profileId
            : undefined,
      });
      return state;
    },
  );

  ipcMain.handle(DESKTOP_CHANNELS.runtimeGetInfo, async (event) => {
    assertIpcEvent(event);
    return {
      platform: process.platform,
      version: app.getVersion(),
    };
  });

  ipcMain.handle(DESKTOP_CHANNELS.importsPending, async (event) => {
    assertIpcEvent(event);
    return imports.pending(windowProfileIds.get(event.sender.id) ?? null);
  });

  ipcMain.handle(DESKTOP_CHANNELS.importsAssign, async (event, input: DesktopImportAssignInput) => {
    assertIpcEvent(event);
    return imports.assign(input);
  });

  ipcMain.handle(DESKTOP_CHANNELS.importsConsume, async (event) => {
    assertIpcEvent(event);
    return imports.consume(windowProfileIds.get(event.sender.id) ?? null);
  });

  ipcMain.handle(DESKTOP_CHANNELS.importsPick, async (event) => {
    assertIpcEvent(event);
    const profileId = windowProfileIds.get(event.sender.id);
    if (!profileId) return { files: [], rejected: [] };
    const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = {
      title: "Import documents into OpenKeep",
      buttonLabel: "Import",
      properties: ["openFile", "multiSelections"] as Array<
        "openFile" | "multiSelections"
      >,
      filters: [
        {
          name: "OpenKeep documents",
          extensions: ["pdf", "jpg", "jpeg", "png", "tif", "tiff", "heic"],
        },
      ],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    return result.canceled
      ? { files: [], rejected: [] }
      : imports.pick(result.filePaths);
  });
}

function configureSessionSecurity(targetSession: Electron.Session) {
  targetSession.setPermissionCheckHandler(() => false);
  targetSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
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
      result.bridgeKeys.join(",") === "session,profiles,runtime" &&
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

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-attach-webview", (event) => event.preventDefault());
});

const ownsSingleInstance = app.requestSingleInstanceLock();

if (!ownsSingleInstance) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv, workingDirectory) => {
    const paths = extractOpenWithPaths(
      argv,
      workingDirectory,
      Boolean(process.defaultApp),
    );
    if (receiveOpenWithPaths) {
      void receiveOpenWithPaths(paths);
    } else if (paths.length > 0) {
      deferredOpenWithPaths.push(paths);
    }
    focusMainWindow();
  });

  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    if (receiveOpenWithPaths) {
      void receiveOpenWithPaths([filePath]);
    } else {
      deferredOpenWithPaths.push([filePath]);
    }
  });

  const coldStartPaths = extractOpenWithPaths(
    process.argv,
    process.cwd(),
    Boolean(process.defaultApp),
  );
  if (coldStartPaths.length > 0) deferredOpenWithPaths.push(coldStartPaths);

void app.whenReady().then(async () => {
  app.setAppUserModelId("de.openkeep.desktop");

  const profileStorage = new ProfileStorage({
    filePath: path.join(app.getPath("userData"), "desktop-state.json"),
    cipher: createSafeStorageCipher(safeStorage),
  });
  const archiveSession = createArchiveSessionService(
    (input, init) => net.fetch(input, init),
    createArchiveProfileRepository(profileStorage),
    randomUUID,
  );
  const importService = createDesktopImportService({
    createId: randomUUID,
  });
  const importCoordinator = createDesktopImportCoordinator({
    imports: importService,
    listProfiles: () => archiveSession.listProfiles(),
    onChanged: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(DESKTOP_CHANNELS.importsChanged);
      }
      focusMainWindow();
    },
  });
  receiveOpenWithPaths = async (paths) => {
    if (paths.length === 0) return;
    await importCoordinator.receivePaths(paths);
  };
  const rendererRoot = path.join(__dirname, "../renderer", MAIN_WINDOW_VITE_NAME);
  const rendererDevServerUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL || undefined;
  const configuredPartitions = new Set<string>();

  async function preparePartition(profileId: string | null) {
    const partition = profileId
      ? createProfilePartition(profileId)
      : DESKTOP_SHELL_PARTITION;
    const targetSession = session.fromPartition(partition);
    if (!configuredPartitions.has(partition)) {
      configureSessionSecurity(targetSession);
      await targetSession.protocol.handle(
        APP_SCHEME,
        createAppProtocolHandler({
          rendererRoot,
          rendererDevServerUrl,
          profileId: profileId ?? undefined,
          archiveSession,
          fetchRequest: (input, init) => targetSession.fetch(input, init),
          fileExists: existsSync,
        }),
      );
      configuredPartitions.add(partition);
    }
    return { partition, targetSession };
  }

  async function resetProfilePartition(profileId: string) {
    profileRoutes.delete(profileId);
    await clearProfilePartitionData(
      profileId,
      (partition) => session.fromPartition(partition),
    );
  }

  async function createMainWindow(
    profileId: string | null,
    options: { resetProfileId?: string; clearProfileId?: string } = {},
  ) {
    const previousWindow = mainWindow;
    if (previousWindow && !previousWindow.isDestroyed()) {
      const previousId = previousWindow.webContents.id;
      const previousProfileId = windowProfileIds.get(previousId);
      const previousUrl = previousWindow.webContents.getURL();
      if (previousProfileId && isTrustedRendererUrl(previousUrl)) {
        profileRoutes.set(previousProfileId, previousUrl);
      }
      trustedWebContentsIds.delete(previousId);
      windowProfileIds.delete(previousId);
      previousWindow.destroy();
      mainWindow = null;
    }

    const partitionsToClear = new Set(
      [options.resetProfileId, options.clearProfileId].filter(
        (profileId): profileId is string => Boolean(profileId),
      ),
    );
    for (const profileToClear of partitionsToClear) {
      await resetProfilePartition(profileToClear);
    }
    const { partition } = await preparePartition(profileId);
    const preloadPath = path.join(__dirname, "preload.js");
    const window = new BrowserWindow(
      createMainWindowOptions(preloadPath, app.isPackaged, partition),
    );
    const webContentsId = window.webContents.id;
    trustedWebContentsIds.add(webContentsId);
    windowProfileIds.set(webContentsId, profileId);
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
      trustedWebContentsIds.delete(webContentsId);
      windowProfileIds.delete(webContentsId);
      if (mainWindow === window) {
        mainWindow = null;
      }
    });
    window.on("close", () => {
      const currentUrl = window.webContents.getURL();
      if (profileId && isTrustedRendererUrl(currentUrl)) {
        profileRoutes.set(profileId, currentUrl);
      }
    });
    void window.loadURL(getProfileWindowUrl(profileId, profileRoutes));
    mainWindow = window;
  }

  function transitionWindow(
    senderId: number,
    state: DesktopSessionState,
    options: { resetProfileId?: string; clearProfileId?: string } = {},
  ) {
    const targetProfileId =
      state.status === "connected"
        ? state.profile.id
        : state.status === "disconnected" &&
            ["signed-out", "no-profile", "choose-profile"].includes(
              state.reason ?? "",
            )
          ? null
          : undefined;
    if (targetProfileId === undefined) {
      if (options.clearProfileId) {
        setTimeout(() => {
          void resetProfilePartition(options.clearProfileId!).catch(() => {
            console.error("OpenKeep could not clear an isolated profile partition.");
          });
        }, 25);
      }
      return;
    }
    const currentProfileId = windowProfileIds.get(senderId);
    const currentPartitionMustBeCleared =
      options.resetProfileId === currentProfileId ||
      options.clearProfileId === currentProfileId;
    if (currentProfileId === targetProfileId && !currentPartitionMustBeCleared) {
      if (options.clearProfileId) {
        setTimeout(() => {
          void resetProfilePartition(options.clearProfileId!).catch(() => {
            console.error("OpenKeep could not clear an isolated profile partition.");
          });
        }, 25);
      }
      return;
    }

    setTimeout(() => {
      void createMainWindow(targetProfileId, options).catch(() => {
        app.exit(1);
      });
    }, 25);
  }

  registerIpcHandlers(archiveSession, importCoordinator, transitionWindow);
  await createMainWindow(null);
  for (const paths of deferredOpenWithPaths.splice(0)) {
    await receiveOpenWithPaths(paths);
  }

  app.on("activate", () => {
    if (isSmokeTest) {
      return;
    }
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow(
        archiveSession.getActiveSession()?.profile.id ?? null,
      );
    } else {
      mainWindow?.show();
    }
  });
}).catch((error: unknown) => {
  console.error("OpenKeep desktop failed to start.", error);
  app.exit(1);
});
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
