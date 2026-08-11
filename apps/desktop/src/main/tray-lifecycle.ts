import type {
  DesktopCloseBehavior,
  DesktopLifecycleState,
  DesktopWindowBounds,
} from "./lifecycle-state";
import type { DesktopProfilesSnapshot } from "../shared/desktop-api";

type CloseEvent = { preventDefault(): void };

export type LifecycleWindow = {
  isDestroyed(): boolean;
  isVisible(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  hide(): void;
  focus(): void;
  getBounds(): DesktopWindowBounds;
  on(event: "close" | "closed" | "move" | "resize", handler: (...args: any[]) => void): unknown;
};

export type TrayMenuItem = {
  label?: string;
  type?: "normal" | "separator" | "checkbox" | "radio";
  enabled?: boolean;
  checked?: boolean;
  submenu?: TrayMenuItem[];
  click?: () => void | Promise<void>;
};

type TrayHandle = {
  setMenu(menu: TrayMenuItem[]): void;
  setToolTip(toolTip: string): void;
  on(event: "double-click", handler: () => void): unknown;
  destroy(): void;
};

export type TrayLifecycleHost = {
  platform: NodeJS.Platform;
  createTray(): TrayHandle | null;
  focusApplication(): void;
  quitApplication(): void;
  confirmQuitOnClose(): Promise<boolean>;
  onBeforeQuit(handler: (event: CloseEvent) => void): void;
  reportError?(message: string, error: unknown): void;
};

/** Watch-folder counts only: the tray must never show a local path. */
export type WatchFolderSummary = {
  total: number;
  watching: number;
  attention: number;
};

type LifecycleStatePort = {
  snapshot(): DesktopLifecycleState;
  setCloseBehavior(closeBehavior: DesktopCloseBehavior): Promise<unknown>;
  setWindowBounds(bounds: DesktopWindowBounds): Promise<unknown>;
};

export function createDesktopTrayLifecycle({
  host,
  state,
  listProfiles,
  activateProfile,
  startImport,
  ensureWindow,
  watchFolderSummary,
  cleanup,
}: {
  host: TrayLifecycleHost;
  state: LifecycleStatePort;
  listProfiles: () => Promise<DesktopProfilesSnapshot>;
  activateProfile: (profileId: string) => Promise<void>;
  startImport: () => Promise<void>;
  ensureWindow: () => Promise<void>;
  watchFolderSummary: () => WatchFolderSummary;
  cleanup: () => Promise<void>;
}) {
  let tray: TrayHandle | null = null;
  let currentWindow: LifecycleWindow | null = null;
  let quitting = false;
  let quitWork: Promise<void> | null = null;
  let activity = Promise.resolve();
  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  let menuGeneration = 0;

  function report(message: string, error: unknown) {
    host.reportError?.(message, error);
  }

  function enqueue(task: () => Promise<unknown>) {
    activity = activity.then(task).then(() => undefined, (error) => {
      report("Desktop lifecycle operation failed.", error);
    });
    return activity;
  }

  function usableWindow(): LifecycleWindow | null {
    return currentWindow && !currentWindow.isDestroyed() ? currentWindow : null;
  }

  function showWindow() {
    const window = usableWindow();
    if (!window) {
      // The window can be gone for good — a crash, or a profile switch that
      // never finished. Rebuild it rather than leaving the tray pointing at
      // nothing; a new window shows and re-attaches itself.
      if (!quitting) enqueue(ensureWindow);
      return;
    }
    if (window.isMinimized()) window.restore();
    window.show();
    host.focusApplication();
    window.focus();
    void refreshMenu();
  }

  function hideWindow() {
    usableWindow()?.hide();
    void refreshMenu();
  }

  function captureWindowBounds(window = usableWindow()) {
    if (!window || window.isDestroyed()) return Promise.resolve();
    return state.setWindowBounds(window.getBounds()).then(() => undefined);
  }

  function scheduleBoundsCapture(window: LifecycleWindow) {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      boundsTimer = null;
      if (currentWindow === window) enqueue(() => captureWindowBounds(window));
    }, 250);
    boundsTimer.unref?.();
  }

  function effectiveCloseBehavior() {
    return state.snapshot().closeBehavior === "tray" && tray
      ? "tray"
      : "quit";
  }

  async function setKeepRunning(enabled: boolean) {
    if (!enabled) {
      const confirmed = await host.confirmQuitOnClose();
      if (!confirmed) {
        await refreshMenu();
        return;
      }
    }
    await state.setCloseBehavior(enabled ? "tray" : "quit");
    await refreshMenu();
  }

  function settings() {
    return {
      closeBehavior: state.snapshot().closeBehavior,
      trayAvailable: Boolean(tray),
    } as const;
  }

  function describeWatchFolders() {
    const summary = watchFolderSummary();
    if (summary.total === 0) return "No watch folders";
    if (summary.attention > 0) {
      return `Watch folders: ${summary.attention} of ${summary.total} need attention`;
    }
    if (summary.watching === 0) return `Watch folders: ${summary.total} paused`;
    return summary.watching === summary.total
      ? `Watch folders: ${summary.total} active`
      : `Watch folders: ${summary.watching} of ${summary.total} active`;
  }

  async function refreshMenu() {
    if (!tray) return;
    const generation = ++menuGeneration;
    const profiles = await listProfiles().catch(() => ({
      activeProfileId: null,
      profiles: [],
    } satisfies DesktopProfilesSnapshot));
    if (!tray || generation !== menuGeneration) return;
    const active = profiles.profiles.find(
      (profile) => profile.id === profiles.activeProfileId,
    );
    const visible = usableWindow()?.isVisible() ?? false;
    const keepRunning = state.snapshot().closeBehavior === "tray";
    const switchItems: TrayMenuItem[] = profiles.profiles.map((profile) => ({
      label: profile.label,
      type: "radio",
      checked: profile.id === profiles.activeProfileId,
      click: async () => {
        if (profile.id === profiles.activeProfileId) {
          showWindow();
          return;
        }
        showWindow();
        await activateProfile(profile.id);
        await refreshMenu();
      },
    }));

    tray.setMenu([
      {
        label: visible ? "Hide OpenKeep" : "Show OpenKeep",
        click: () => visible ? hideWindow() : showWindow(),
      },
      { type: "separator" },
      {
        label: active ? `Active archive: ${active.label}` : "No active archive",
        enabled: false,
      },
      {
        label: "Switch archive",
        enabled: switchItems.length > 0,
        submenu: switchItems,
      },
      {
        label: "Import documents…",
        enabled: Boolean(active),
        click: async () => {
          showWindow();
          await startImport();
        },
      },
      { label: describeWatchFolders(), enabled: false },
      { type: "separator" },
      {
        label: "Keep OpenKeep running when the window closes",
        type: "checkbox",
        checked: keepRunning,
        click: () => setKeepRunning(!keepRunning),
      },
      { type: "separator" },
      { label: "Quit OpenKeep", click: () => requestQuit() },
    ]);
  }

  async function requestQuit() {
    if (quitWork) return quitWork;
    quitting = true;
    if (boundsTimer) {
      clearTimeout(boundsTimer);
      boundsTimer = null;
    }
    quitWork = (async () => {
      await captureWindowBounds();
      await cleanup();
      tray?.destroy();
      tray = null;
      host.quitApplication();
    })().catch((error) => {
      report("OpenKeep could not finish background cleanup before quitting.", error);
      tray?.destroy();
      tray = null;
      host.quitApplication();
    });
    activity = quitWork;
    return quitWork;
  }

  return {
    async initialize() {
      host.onBeforeQuit((event) => {
        if (quitting) return;
        event.preventDefault();
        void requestQuit();
      });
      try {
        tray = host.createTray();
      } catch (error) {
        tray = null;
        report("OpenKeep could not create a system tray icon.", error);
      }
      tray?.setToolTip("OpenKeep");
      if (tray && host.platform !== "darwin") {
        tray.on("double-click", showWindow);
      }
      await refreshMenu();
      return { trayAvailable: Boolean(tray) };
    },

    attachWindow(window: LifecycleWindow) {
      currentWindow = window;
      window.on("close", (event: CloseEvent) => {
        if (quitting || currentWindow !== window) return;
        event.preventDefault();
        enqueue(() => captureWindowBounds(window));
        if (effectiveCloseBehavior() === "tray") {
          window.hide();
          void refreshMenu();
        } else {
          void requestQuit();
        }
      });
      window.on("move", () => scheduleBoundsCapture(window));
      window.on("resize", () => scheduleBoundsCapture(window));
      window.on("closed", () => {
        if (currentWindow === window) currentWindow = null;
      });
      void refreshMenu();
    },

    /**
     * Electron quits an unsubscribed app once the last window closes. Decide
     * here instead: the tray may legitimately outlive every window, but
     * without one there is nothing left to reveal the app from, so quit.
     */
    handleAllWindowsClosed() {
      if (quitting || usableWindow()) return;
      if (effectiveCloseBehavior() === "tray") {
        void refreshMenu();
        return;
      }
      void requestQuit();
    },

    showWindow,
    hideWindow,
    refreshMenu,
    captureWindowBounds,
    requestQuit,
    settings,
    async setCloseBehavior(closeBehavior: DesktopCloseBehavior) {
      await setKeepRunning(closeBehavior === "tray");
      return settings();
    },

    async idle() {
      await activity;
      await quitWork;
    },
  };
}

export type DesktopTrayLifecycle = ReturnType<typeof createDesktopTrayLifecycle>;
