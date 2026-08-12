import squirrelStartup from "electron-squirrel-startup";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  app,
  autoUpdater,
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
  DesktopWatchFolderIdInput,
  DesktopWatchFolderPauseInput,
  DesktopOfflineCopyLimitInput,
  DesktopCreatedDocumentsInput,
  DesktopNotificationPreferenceInput,
} from "./shared/desktop-api";
import { DESKTOP_CHANNELS } from "./shared/desktop-api";
import { CurrentUserSchema } from "@openkeep/types";
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
import { createDesktopWatchFolderStore } from "./main/watch-folder-state";
import { createWatchFolderUploader } from "./main/watch-folder-uploader";
import {
  createDesktopWatchFolderService,
  createIntervalWatchFolderTimer,
  nodeWatchFolderFileSystem,
  type DesktopWatchFolderService,
} from "./main/watch-folder-service";
import {
  createDesktopImportOutcomeTracker,
  createIntervalImportOutcomeTimer,
  type DesktopImportOutcomeTracker,
} from "./main/import-outcomes";
import { createArchiveDocumentStatusReader } from "./main/document-status";
import { createDesktopImportNotifier } from "./main/import-notifications";
import { createElectronNotifier } from "./main/electron-notifier";
import {
  createDesktopNotificationRouter,
  type DesktopNotificationRouter,
} from "./main/notification-routing";
import {
  createOfflineCacheStore,
  type OfflineCacheStore,
} from "./main/offline/offline-cache-store";
import { createOfflineReadThrough } from "./main/offline/read-through";
import { createOfflineApiHandler } from "./main/offline/offline-api";
import { createOfflineReconnect } from "./main/offline/offline-reconnect";
import {
  createDesktopUpdateService,
  type DesktopUpdateService,
} from "./main/updates/update-service";
import { SecureStorageUnavailableError } from "./main/storage";

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

// Squirrel.Windows relaunches the app with install/update/uninstall flags to
// manage shortcuts; those invocations must do nothing but exit. Bundled by
// Vite — the packaged app ships no node_modules to require from.
if (squirrelStartup) {
  app.quit();
}

app.enableSandbox();

const isSmokeTest = process.argv.includes("--smoke-test");
let mainWindow: BrowserWindow | null = null;
let trayLifecycle: DesktopTrayLifecycle | null = null;
let notificationRouter: DesktopNotificationRouter | null = null;
/**
 * The profile currently open as a read-only offline session, if any. Owned by
 * main so the protocol proxy, window transitions, and the reconnect loop all
 * agree on it. At most one session — online or offline — is active at a time.
 */
let offlineSession: {
  profileId: string;
  state: Extract<DesktopSessionState, { status: "offline" }>;
} | null = null;
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

async function chooseWatchFolderPath(parent?: BrowserWindow) {
  const options: Electron.OpenDialogOptions = {
    title: "Watch a folder for new documents",
    buttonLabel: "Watch folder",
    properties: ["openDirectory", "createDirectory"],
  };
  const selection = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  return selection.canceled ? null : selection.filePaths[0] ?? null;
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
  watchFolders: DesktopWatchFolderService,
  chooseWatchFolder: (parent?: BrowserWindow) => Promise<string | null>,
  outcomes: DesktopImportOutcomeTracker,
  notificationSettings: () => {
    preferences: { completed: boolean; failed: boolean; review: boolean };
    supported: boolean;
  },
  setNotificationPreference: (
    input: DesktopNotificationPreferenceInput,
  ) => Promise<void>,
  offlineCacheFor: (profileId: string) => Promise<OfflineCacheStore | null>,
  forgetOfflineCache: (profileId: string) => Promise<void>,
) {
  ipcMain.handle(
    DESKTOP_CHANNELS.sessionRestore,
    async (event) => {
      assertIpcEvent(event);
      // A window created for an offline session restores into it directly:
      // asking the archive would either fail (it is unreachable) or silently
      // leave offline mode without the user asking to.
      if (
        offlineSession &&
        windowProfileIds.get(event.sender.id) === offlineSession.profileId
      ) {
        return offlineSession.state;
      }
      const profiles = await archiveSession.listProfiles().catch(() => null);
      const restoredProfileId =
        profiles?.profiles.length === 1
          ? profiles.profiles[0]!.id
          : profiles?.activeProfileId ?? undefined;
      const state = await archiveSession.restore();
      const rejectedProfileId =
        state.status === "disconnected" && state.reason === "invalid-credentials"
          ? restoredProfileId
          : undefined;
      if (rejectedProfileId) {
        // Rejected credentials remove the profile; its cached documents must
        // never remain readable after the credentials that fetched them.
        await forgetOfflineCache(rejectedProfileId);
      }
      transitionWindow(event.sender.id, state, {
        clearProfileId: rejectedProfileId,
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
      if (resetProfileId) {
        // A profile pointed at a different server is a different archive, so
        // its local watch folders and import checkpoints no longer apply.
        await watchFolders.forgetProfile(resetProfileId);
        await outcomes.forgetProfile(resetProfileId);
        await forgetOfflineCache(resetProfileId);
      }
      transitionWindow(event.sender.id, state, { resetProfileId });
      onDesktopStateChanged();
      return state;
    },
  );

  ipcMain.handle(DESKTOP_CHANNELS.sessionRetry, async (event) => {
    assertIpcEvent(event);
    const profiles = await archiveSession.listProfiles().catch(() => null);
    const state = await archiveSession.retry();
    const rejectedProfileId =
      state.status === "disconnected" && state.reason === "invalid-credentials"
        ? profiles?.activeProfileId ?? undefined
        : undefined;
    if (rejectedProfileId) {
      await forgetOfflineCache(rejectedProfileId);
    }
    transitionWindow(event.sender.id, state, {
      clearProfileId: rejectedProfileId,
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

  async function ipcOfflineAvailability() {
    const profiles = await archiveSession.listProfiles().catch(() => null);
    const availability: Record<
      string,
      {
        documentCount: number;
        fileStorageBytes: number;
        lastCachedAt: number | null;
        maxBytes: number;
        quarantined: number;
      }
    > = {};
    for (const profile of profiles?.profiles ?? []) {
      const store = await offlineCacheFor(profile.id);
      if (!store) continue;
      const summary = store.summary();
      const user = await store.getUser();
      // A copy without an identity cannot become a session, so it is not
      // offered as available.
      if (summary.documentCount > 0 && user) {
        availability[profile.id] = {
          documentCount: summary.documentCount,
          fileStorageBytes: summary.fileStorageBytes,
          lastCachedAt: summary.lastCachedAt,
          maxBytes: store.limit(),
          quarantined: store.quarantinedThisSession(),
        };
      }
    }
    return { profiles: availability };
  }

  ipcMain.handle(DESKTOP_CHANNELS.sessionOfflineAvailability, async (event) => {
    assertIpcEvent(event);
    return ipcOfflineAvailability();
  });

  ipcMain.handle(
    DESKTOP_CHANNELS.sessionClearOfflineCopy,
    async (event, input: DesktopProfileIdInput) => {
      assertIpcEvent(event);
      if (!input || typeof input.profileId !== "string") {
        throw new Error("Choose an archive profile.");
      }
      const store = await offlineCacheFor(input.profileId);
      if (store) {
        await store.clear();
      }
      // Clearing the copy under an open offline session leaves nothing to
      // read; end the session and return to the chooser.
      if (offlineSession?.profileId === input.profileId) {
        offlineSession = null;
        transitionWindow(event.sender.id, {
          status: "disconnected",
          reason: "choose-profile",
        });
      }
      onDesktopStateChanged();
      const availability = (await ipcOfflineAvailability()) ?? { profiles: {} };
      return availability;
    },
  );

  ipcMain.handle(
    DESKTOP_CHANNELS.sessionSetOfflineCopyLimit,
    async (event, input: DesktopOfflineCopyLimitInput) => {
      assertIpcEvent(event);
      if (
        !input ||
        typeof input.profileId !== "string" ||
        typeof input.maxBytes !== "number" ||
        !Number.isFinite(input.maxBytes) ||
        input.maxBytes <= 0
      ) {
        throw new Error("Choose a valid offline copy size limit.");
      }
      const store = await offlineCacheFor(input.profileId);
      if (store) {
        await store.setLimit(input.maxBytes);
      }
      return ipcOfflineAvailability();
    },
  );

  ipcMain.handle(
    DESKTOP_CHANNELS.sessionOpenOffline,
    async (event, input: DesktopProfileIdInput) => {
      assertIpcEvent(event);
      if (!input || typeof input.profileId !== "string") {
        throw new Error("Choose an archive profile to open offline.");
      }
      const profiles = await archiveSession.listProfiles().catch(() => null);
      const profile = profiles?.profiles.find(
        (candidate) => candidate.id === input.profileId,
      );
      if (!profile) {
        throw new Error("That archive profile no longer exists.");
      }
      const store = await offlineCacheFor(profile.id);
      const summary = store?.summary();
      const cachedUser = store ? await store.getUser() : null;
      const user = CurrentUserSchema.safeParse(cachedUser);
      if (!store || !summary || summary.documentCount === 0 || !user.success) {
        throw new Error("This archive has no usable offline copy on this computer.");
      }

      // Entering offline leaves any live session without touching stored
      // credentials — this is not a sign-out.
      archiveSession.suspend();
      const state: Extract<DesktopSessionState, { status: "offline" }> = {
        status: "offline",
        profile,
        user: user.data,
      };
      offlineSession = { profileId: profile.id, state };
      transitionWindow(event.sender.id, state);
      onDesktopStateChanged();
      return state;
    },
  );

  ipcMain.handle(DESKTOP_CHANNELS.profilesList, async (event) => {
    assertIpcEvent(event);
    return archiveSession.listProfiles();
  });

  ipcMain.handle(
    DESKTOP_CHANNELS.profilesActivate,
    async (event, input: DesktopProfileIdInput) => {
      assertIpcEvent(event);
      const state = await archiveSession.activate(input?.profileId);
      const rejectedProfileId =
        state.status === "disconnected" && state.reason === "invalid-credentials"
          ? input?.profileId
          : undefined;
      if (rejectedProfileId) {
        await forgetOfflineCache(rejectedProfileId);
      }
      transitionWindow(event.sender.id, state, {
        clearProfileId: rejectedProfileId,
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
      if (profileExisted && state.status !== "error" && input?.profileId) {
        await watchFolders.forgetProfile(input.profileId);
        await outcomes.forgetProfile(input.profileId);
        await forgetOfflineCache(input.profileId);
      }
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

  /**
   * Watch folders belong to the archive of the requesting window. A renderer
   * never names a folder itself: main opens the operating-system picker, so the
   * only local paths that enter are ones the user selected there.
   */
  function assertWatchFolderOwner(event: Electron.IpcMainInvokeEvent) {
    assertIpcEvent(event);
    const profileId = windowProfileIds.get(event.sender.id);
    if (!profileId || profileId !== watchFolders.snapshot().profileId) {
      throw new Error("Connect this archive before changing its watch folders.");
    }
  }

  ipcMain.handle(DESKTOP_CHANNELS.watchFoldersList, async (event) => {
    assertIpcEvent(event);
    return windowProfileIds.get(event.sender.id)
      ? watchFolders.snapshot()
      : { profileId: null, folders: [] };
  });

  ipcMain.handle(DESKTOP_CHANNELS.watchFoldersAdd, async (event) => {
    assertWatchFolderOwner(event);
    const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const selected = await chooseWatchFolder(parent);
    if (!selected) return { status: "cancelled" };
    try {
      return { status: "added", snapshot: await watchFolders.add(selected) };
    } catch (error) {
      return {
        status: "failed",
        message:
          error instanceof Error
            ? error.message
            : "That folder could not be watched.",
      };
    }
  });

  /**
   * The renderer uploads picker and Open-with files itself, so it reports the
   * documents the archive created. Main then owns following them, which is what
   * lets an outcome survive a hidden window, a profile switch, or a restart.
   */
  ipcMain.handle(
    DESKTOP_CHANNELS.importsReportCreated,
    async (event, input: DesktopCreatedDocumentsInput) => {
      assertIpcEvent(event);
      const profileId = windowProfileIds.get(event.sender.id);
      if (!profileId || !Array.isArray(input?.documents)) return;
      await outcomes.track(profileId, "picker", input.documents);
    },
  );

  ipcMain.handle(DESKTOP_CHANNELS.notificationsGetSettings, async (event) => {
    assertIpcEvent(event);
    return notificationSettings();
  });

  ipcMain.handle(
    DESKTOP_CHANNELS.notificationsSetPreference,
    async (event, input: DesktopNotificationPreferenceInput) => {
      assertIpcEvent(event);
      if (
        !input ||
        !["completed", "failed", "review"].includes(input.kind) ||
        typeof input.enabled !== "boolean"
      ) {
        throw new Error("Choose a valid notification preference.");
      }
      await setNotificationPreference(input);
      return notificationSettings();
    },
  );

  ipcMain.handle(
    DESKTOP_CHANNELS.watchFoldersSetPaused,
    async (event, input: DesktopWatchFolderPauseInput) => {
      assertWatchFolderOwner(event);
      if (!input || typeof input.folderId !== "string") {
        throw new Error("A watch folder is required.");
      }
      return watchFolders.setPaused(input.folderId, input.paused === true);
    },
  );

  ipcMain.handle(
    DESKTOP_CHANNELS.watchFoldersRemove,
    async (event, input: DesktopWatchFolderIdInput) => {
      assertWatchFolderOwner(event);
      if (!input || typeof input.folderId !== "string") {
        throw new Error("A watch folder is required.");
      }
      return watchFolders.remove(input.folderId);
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
        "session,profiles,imports,save,watchFolders,notifications,lifecycle,updates,runtime" &&
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
  const outcomes = createDesktopImportOutcomeTracker({
    filePath: path.join(app.getPath("userData"), "desktop-import-outcomes.json"),
    statuses: createArchiveDocumentStatusReader({
      archiveSession,
      fetchRequest: (input, init) => net.fetch(input, init),
    }),
    activeProfileId: () => archiveSession.getActiveSession()?.profile.id ?? null,
    notify: (outcome) => importNotifier.present(outcome),
    timer: createIntervalImportOutcomeTimer(),
    reportError: (message, error) => console.error(message, error),
  });
  await outcomes.load();

  notificationRouter = createDesktopNotificationRouter({
    activeProfileId: () => archiveSession.getActiveSession()?.profile.id ?? null,
    async confirmSwitch(profileId) {
      const profiles = await archiveSession.listProfiles().catch(() => null);
      const label =
        profiles?.profiles.find((profile) => profile.id === profileId)?.label ??
        "another archive";
      const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
      const options: Electron.MessageBoxOptions = {
        type: "question",
        title: "Switch archive?",
        message: `Open this document in ${label}?`,
        detail:
          "Switching archives closes the current archive window, so anything unfinished in it is discarded.",
        buttons: [`Switch to ${label}`, "Stay here"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      };
      const result = owner
        ? await dialog.showMessageBox(owner, options)
        : await dialog.showMessageBox(options);
      return result.response === 0;
    },
    async activateProfile(profileId) {
      const state = await archiveSession.activate(profileId);
      if (state.status === "connected") await createMainWindow(state.profile.id);
    },
    navigate(url) {
      if (mainWindow && !mainWindow.isDestroyed()) void mainWindow.loadURL(url);
    },
    showWindow: () => focusMainWindow(),
    reportError: (message, error) => console.error(message, error),
  });

  const importNotifier = createDesktopImportNotifier({
    notifier: createElectronNotifier(),
    preferences: () => lifecycleState.snapshot().notifications,
    open: (target) => void notificationRouter?.open(target),
  });

  const watchFolderStore = createDesktopWatchFolderStore({
    filePath: path.join(app.getPath("userData"), "desktop-watch-folders.json"),
  });
  await watchFolderStore.load();
  const watchFolders = createDesktopWatchFolderService({
    store: watchFolderStore,
    fileSystem: nodeWatchFolderFileSystem(),
    uploader: createWatchFolderUploader({
      imports: importService,
      archiveSession,
      fetchRequest: (input, init) => net.fetch(input, init),
    }),
    timer: createIntervalWatchFolderTimer(),
    activeProfileId: () => archiveSession.getActiveSession()?.profile.id ?? null,
    onChanged: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(DESKTOP_CHANNELS.watchFoldersChanged);
      }
      void trayLifecycle?.refreshMenu();
    },
    onImported: (profileId, document) => {
      void outcomes.track(profileId, "watch-folder", [document]);
    },
    reportError: (message, error) => console.error(message, error),
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

  /**
   * One offline cache per profile, opened lazily with its partition. A cache
   * that cannot open — most likely no secure keyring — stays disabled for the
   * session: online behavior is identical either way, so this only ever logs.
   */
  const offlineCaches = new Map<string, Promise<OfflineCacheStore | null>>();
  const offlineApiHandlers = new Map<
    string,
    (request: Request, url: URL) => Promise<Response>
  >();

  function offlineCacheFor(profileId: string): Promise<OfflineCacheStore | null> {
    let opening = offlineCaches.get(profileId);
    if (!opening) {
      opening = (async () => {
        const store = createOfflineCacheStore({
          rootDirectory: path.join(
            app.getPath("userData"),
            "offline-cache",
            profileId,
          ),
          credentialCipher: createSafeStorageCipher(safeStorage),
        });
        await store.open();
        offlineApiHandlers.set(profileId, createOfflineApiHandler({ store }));
        return store;
      })().catch((error: unknown) => {
        if (error instanceof SecureStorageUnavailableError) {
          console.error(
            "The offline cache stays disabled: no secure operating-system store.",
          );
        } else {
          console.error("The offline cache could not be opened.", error);
        }
        return null;
      });
      offlineCaches.set(profileId, opening);
    }
    return opening;
  }

  /**
   * The protocol observer is synchronous, but the cache opens asynchronously.
   * Until it is open (or when it is disabled) responses pass through
   * untouched; once open, the same observer instance tees into it.
   */
  /**
   * Deletes a profile's entire offline cache directory. Called when the
   * profile itself dies — removal, a repoint to a different server, or
   * credentials the archive rejected. Sign-out must NOT come here: the
   * profile still exists and its copy is waiting for the next sign-in.
   */
  async function forgetOfflineCache(profileId: string) {
    const opening = offlineCaches.get(profileId);
    offlineCaches.delete(profileId);
    offlineApiHandlers.delete(profileId);
    if (opening) {
      const store = await opening;
      await store?.idle().catch(() => undefined);
    }
    await rm(path.join(app.getPath("userData"), "offline-cache", profileId), {
      recursive: true,
      force: true,
    }).catch(() => {
      console.error("OpenKeep could not delete an offline cache directory.");
    });
  }

  function createProfileReadThrough(profileId: string) {
    let readThrough: ReturnType<typeof createOfflineReadThrough> | null = null;
    void offlineCacheFor(profileId).then((store) => {
      if (store) {
        readThrough = createOfflineReadThrough({
          store,
          reportError: (message, error) => console.error(message, error),
        });
      }
    });
    return (method: string, pathname: string, response: Response): Response =>
      readThrough ? readThrough.observe(method, pathname, response) : response;
  }

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
          ...(profileId
            ? {
                observeApiResponse: createProfileReadThrough(profileId),
                getOfflineApiHandler: () =>
                  offlineSession?.profileId === profileId
                    ? offlineApiHandlers.get(profileId) ?? null
                    : null,
              }
            : {}),
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
    // A notification clicked before this archive was ready decides the first
    // route, rather than loading the remembered one and jumping afterwards.
    const notified = notificationRouter?.takeTarget(profileId);
    void window.loadURL(notified?.url ?? getProfileWindowUrl(profileId, profileRoutes));
  }

  function transitionWindow(
    senderId: number,
    state: DesktopSessionState,
    options: { resetProfileId?: string; clearProfileId?: string } = {},
  ) {
    // An explicit online session or a sign-out ends any offline session; an
    // unavailable or error state leaves it alone so the offer can persist.
    if (
      state.status === "connected" ||
      (state.status === "disconnected" && state.reason === "signed-out")
    ) {
      offlineSession = null;
    }
    const targetProfileId =
      state.status === "connected" || state.status === "offline"
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
    watchFolderSummary: () => watchFolders.summary(),
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
      offlineReconnect.stop();
      updateService.stop();
      await watchFolders.stop();
      await outcomes.stop();
      for (const opening of offlineCaches.values()) {
        const store = await opening;
        await store?.idle().catch(() => undefined);
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
  const offlineReconnect = createOfflineReconnect({
    timer: createIntervalWatchFolderTimer(),
    offlineProfileId: () => offlineSession?.profileId ?? null,
    activateProfile: (profileId) => archiveSession.activate(profileId),
    onReconnected: (profileId) => {
      offlineSession = null;
      void createMainWindow(profileId).catch(() => {
        console.error("OpenKeep could not reopen the reconnected archive.");
      });
    },
    onCredentialsRejected: (profileId) => {
      // The activation already removed the rejected profile; the offline
      // session ends with it, its cache dies with the credentials, and the
      // chooser takes over.
      offlineSession = null;
      void forgetOfflineCache(profileId).catch(() => undefined);
      void createMainWindow(null, { clearProfileId: profileId }).catch(() => {
        console.error("OpenKeep could not leave the removed offline archive.");
      });
    },
    reportError: (message, error) => console.error(message, error),
  });
  offlineReconnect.start();

  const updateService: DesktopUpdateService = createDesktopUpdateService({
    repository: "pauli2406/openkeep",
    platform: process.platform,
    arch: process.arch,
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    autoUpdater:
      process.platform === "darwin" || process.platform === "win32"
        ? autoUpdater
        : null,
    fetchRequest: (input, init) => net.fetch(input, init),
    timer: (() => {
      let handle: ReturnType<typeof setTimeout> | null = null;
      return {
        start(run: () => void, delayMs: number) {
          handle = setTimeout(run, delayMs);
          handle.unref?.();
        },
        stop() {
          if (handle) clearTimeout(handle);
          handle = null;
        },
      };
    })(),
    onChanged: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(DESKTOP_CHANNELS.updatesChanged);
      }
    },
  });
  if (!isSmokeTest) {
    updateService.start();
  }

  ipcMain.handle(DESKTOP_CHANNELS.updatesGetState, async (event) => {
    assertIpcEvent(event);
    return updateService.state();
  });
  ipcMain.handle(DESKTOP_CHANNELS.updatesCheck, async (event) => {
    assertIpcEvent(event);
    await updateService.check();
    return updateService.state();
  });
  ipcMain.handle(DESKTOP_CHANNELS.updatesInstall, async (event) => {
    assertIpcEvent(event);
    updateService.install();
  });

  await trayLifecycle.initialize();
  registerIpcHandlers(
    archiveSession,
    importCoordinator,
    nativeSave,
    transitionWindow,
    () => {
      void trayLifecycle?.refreshMenu();
      // A newly connected, switched, or signed-out archive changes which watch
      // folders apply and whether they may run at all.
      void watchFolders.scan();
    },
    trayLifecycle,
    watchFolders,
    chooseWatchFolderPath,
    outcomes,
    () => ({
      preferences: lifecycleState.snapshot().notifications,
      supported: importNotifier.supported(),
    }),
    async ({ kind, enabled }) => {
      await lifecycleState.setNotificationPreference(kind, enabled);
    },
    offlineCacheFor,
    forgetOfflineCache,
  );
  watchFolders.start();
  outcomes.start();
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
