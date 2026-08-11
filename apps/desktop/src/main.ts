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
  screen,
  session,
  shell,
} from "electron";
import type { DesktopConnectInput } from "./shared/desktop-api";
import type {
  DesktopImportAssignInput,
  DesktopCloseBehaviorInput,
  DesktopProfileIdInput,
  DesktopProfileRenameInput,
  DesktopSaveRequest,
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
import {
  createMainWindowOptions,
  getProfileWindowUrl,
  resolveWindowBounds,
} from "./main/window";
import {
  clearProfilePartitionData,
  createProfilePartition,
  DESKTOP_SHELL_PARTITION,
  shouldResetProfilePartition,
} from "./main/profile-partition";
import { createDesktopImportService } from "./main/import-service";
import { createDesktopImportCoordinator } from "./main/import-coordinator";
import { installDesktopLaunchLifecycle } from "./main/launch-lifecycle";
import { registerPackagedFileAssociations } from "./main/file-associations";
import {
  createNativeSaveService,
  type NativeSaveService,
} from "./main/native-save";
import { createDesktopLifecycleStateStore } from "./main/lifecycle-state";
import {
  createDesktopTrayLifecycle,
  type DesktopTrayLifecycle,
} from "./main/tray-lifecycle";
import { createElectronTrayLifecycleHost } from "./main/electron-tray-host";

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
let trayLifecycle: DesktopTrayLifecycle | null = null;
const trustedWebContentsIds = new Set<number>();
const windowProfileIds = new Map<number, string | null>();
const profileRoutes = new Map<string, string>();

function focusMainWindow() {
  if (trayLifecycle) {
    trayLifecycle.showWindow();
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function chooseImportPaths(parent?: BrowserWindow) {
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
  return result.canceled ? [] : result.filePaths;
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
  nativeSave: NativeSaveService,
  transitionWindow: (
    senderId: number,
    state: DesktopSessionState,
    options?: { resetProfileId?: string; clearProfileId?: string },
  ) => void,
  onDesktopStateChanged: () => void,
  lifecycle: DesktopTrayLifecycle,
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
      onDesktopStateChanged();
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
      onDesktopStateChanged();
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
    onDesktopStateChanged();
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
    onDesktopStateChanged();
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
      onDesktopStateChanged();
      return state;
    },
  );

  ipcMain.handle(
    DESKTOP_CHANNELS.profilesRename,
    async (event, input: DesktopProfileRenameInput) => {
      assertIpcEvent(event);
      const profiles = await archiveSession.renameProfile(input);
      onDesktopStateChanged();
      return profiles;
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
      onDesktopStateChanged();
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

  ipcMain.handle(DESKTOP_CHANNELS.lifecycleGetSettings, async (event) => {
    assertIpcEvent(event);
    return lifecycle.settings();
  });

  ipcMain.handle(
    DESKTOP_CHANNELS.lifecycleSetCloseBehavior,
    async (event, input: DesktopCloseBehaviorInput) => {
      assertIpcEvent(event);
      if (
        !input ||
        (input.closeBehavior !== "tray" && input.closeBehavior !== "quit")
      ) {
        throw new Error("Choose a valid desktop close behavior.");
      }
      return lifecycle.setCloseBehavior(input.closeBehavior);
    },
  );

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
    const paths = await chooseImportPaths(parent);
    return paths.length === 0
      ? { files: [], rejected: [] }
      : imports.pick(paths);
  });

  ipcMain.handle(
    DESKTOP_CHANNELS.saveRequest,
    async (event, input: DesktopSaveRequest) => {
      assertIpcEvent(event);
      return nativeSave.save(windowProfileIds.get(event.sender.id), input);
    },
  );
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
      result.bridgeKeys.join(",") ===
        "session,profiles,imports,save,watchFolders,lifecycle,runtime" &&
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

const launchLifecycle = installDesktopLaunchLifecycle({
  app,
  defaultApp: Boolean(process.defaultApp),
  focusWindow: focusMainWindow,
});

if (launchLifecycle) {
  launchLifecycle.captureInitial(process.argv, process.cwd());

void app.whenReady().then(async () => {
  app.setAppUserModelId("de.openkeep.desktop");
  await registerPackagedFileAssociations({
    platform: process.platform,
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    applicationsDirectory: path.join(
      app.getPath("home"),
      ".local",
      "share",
      "applications",
    ),
  }).catch(() => {
    console.error("OpenKeep could not register desktop file associations.");
  });

  const lifecycleState = createDesktopLifecycleStateStore({
    filePath: path.join(app.getPath("userData"), "desktop-lifecycle.json"),
  });
  const restoredLifecycleState = await lifecycleState.load();
  for (const [profileId, route] of Object.entries(
    restoredLifecycleState.profileRoutes,
  )) {
    if (isTrustedRendererUrl(route)) profileRoutes.set(profileId, route);
  }

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
  const nativeSave = createNativeSaveService({
    archiveSession,
    fetchRequest: (input, init) => net.fetch(input, init),
    async showSaveDialog(options) {
      const electronOptions: Electron.SaveDialogOptions = {
        title: options.title,
        defaultPath: path.join(app.getPath("downloads"), options.suggestedFilename),
        buttonLabel: "Save",
        showsTagField: false,
        filters:
          options.extensions.length > 0
            ? [
                {
                  name: options.mimeType,
                  extensions: options.extensions,
                },
              ]
            : undefined,
      };
      const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
      const selection = owner
        ? await dialog.showSaveDialog(owner, electronOptions)
        : await dialog.showSaveDialog(electronOptions);
      return selection.canceled || !selection.filePath
        ? { cancelled: true }
        : { cancelled: false, filePath: selection.filePath };
    },
  });
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
    await lifecycleState.forgetProfileRoute(profileId);
    await clearProfilePartitionData(
      profileId,
      (partition) => session.fromPartition(partition),
    );
  }

  let windowCreationsInFlight = 0;

  async function createMainWindow(
    profileId: string | null,
    options: { resetProfileId?: string; clearProfileId?: string } = {},
  ) {
    // Replacing a window destroys the old one before the new one exists, so
    // the app owns no windows for a moment. Hold off the lifecycle's
    // all-windows-closed policy until the replacement is up.
    windowCreationsInFlight += 1;
    try {
      await replaceMainWindow(profileId, options);
    } finally {
      windowCreationsInFlight -= 1;
    }
  }

  async function replaceMainWindow(
    profileId: string | null,
    options: { resetProfileId?: string; clearProfileId?: string },
  ) {
    const previousWindow = mainWindow;
    if (previousWindow && !previousWindow.isDestroyed()) {
      await trayLifecycle?.captureWindowBounds(previousWindow);
      const previousId = previousWindow.webContents.id;
      const previousProfileId = windowProfileIds.get(previousId);
      const previousUrl = previousWindow.webContents.getURL();
      if (previousProfileId && isTrustedRendererUrl(previousUrl)) {
        profileRoutes.set(previousProfileId, previousUrl);
        await lifecycleState.rememberProfileRoute(previousProfileId, previousUrl);
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
    const primaryDisplay = screen.getPrimaryDisplay();
    const displayWorkAreas = [
      primaryDisplay.workArea,
      ...screen.getAllDisplays()
        .filter((display) => display.id !== primaryDisplay.id)
        .map((display) => display.workArea),
    ];
    const restoredBounds = resolveWindowBounds(
      lifecycleState.snapshot().windowBounds,
      displayWorkAreas,
    );
    const window = new BrowserWindow(
      createMainWindowOptions(
        preloadPath,
        app.isPackaged,
        partition,
        restoredBounds,
      ),
    );
    const webContentsId = window.webContents.id;
    trustedWebContentsIds.add(webContentsId);
    windowProfileIds.set(webContentsId, profileId);
    attachWindowSecurity(window);
    mainWindow = window;
    trayLifecycle?.attachWindow(window);

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
        void lifecycleState.rememberProfileRoute(profileId, currentUrl).catch(() => {
          console.error("OpenKeep could not remember the active archive route.");
        });
      }
    });
    void window.loadURL(getProfileWindowUrl(profileId, profileRoutes));
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

  trayLifecycle = createDesktopTrayLifecycle({
    host: createElectronTrayLifecycleHost({
      app,
      dialog,
      platform: process.platform,
      getWindow: () => mainWindow,
    }),
    state: lifecycleState,
    listProfiles: () => archiveSession.listProfiles(),
    async activateProfile(profileId) {
      const state = await archiveSession.activate(profileId);
      if (state.status === "connected") {
        await createMainWindow(state.profile.id);
      } else if (
        state.status === "disconnected" &&
        state.reason === "invalid-credentials"
      ) {
        await createMainWindow(null, { clearProfileId: profileId });
      } else {
        focusMainWindow();
      }
    },
    async startImport() {
      const profileId = archiveSession.getActiveSession()?.profile.id;
      if (!profileId) return;
      const parent = mainWindow && !mainWindow.isDestroyed()
        ? mainWindow
        : undefined;
      const paths = await chooseImportPaths(parent);
      if (paths.length > 0) {
        await importCoordinator.receivePickerPaths(paths, profileId);
      }
    },
    async ensureWindow() {
      await createMainWindow(
        archiveSession.getActiveSession()?.profile.id ?? null,
      );
    },
    async cleanup() {
      // Remember the active route first: quit destroys the window after this
      // cleanup, which is too late for the close handler's unawaited write, so
      // a quit taken from the tray or the OS would restore a stale route.
      const currentWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
      if (currentWindow) {
        const currentProfileId = windowProfileIds.get(currentWindow.webContents.id);
        const currentUrl = currentWindow.webContents.getURL();
        if (currentProfileId && isTrustedRendererUrl(currentUrl)) {
          profileRoutes.set(currentProfileId, currentUrl);
          await lifecycleState
            .rememberProfileRoute(currentProfileId, currentUrl)
            .catch(() => {
              console.error("OpenKeep could not remember the active archive route.");
            });
        }
      }
      archiveSession.dispose();
      await Promise.all(
        [...configuredPartitions].map((partition) =>
          session.fromPartition(partition).closeAllConnections(),
        ),
      );
      await lifecycleState.idle();
    },
  });
  await trayLifecycle.initialize();
  registerIpcHandlers(
    archiveSession,
    importCoordinator,
    nativeSave,
    transitionWindow,
    () => { void trayLifecycle?.refreshMenu(); },
    trayLifecycle,
  );
  await createMainWindow(null);
  await launchLifecycle.connect(async (paths) => {
    await importCoordinator.receivePaths(paths);
  });

  app.on("activate", () => {
    if (isSmokeTest) return;
    trayLifecycle?.showWindow();
  });

  app.on("window-all-closed", () => {
    if (windowCreationsInFlight > 0) return;
    if (!trayLifecycle) {
      app.quit();
      return;
    }
    trayLifecycle.handleAllWindowsClosed();
  });
}).catch((error: unknown) => {
  console.error("OpenKeep desktop failed to start.", error);
  app.exit(1);
});
}
