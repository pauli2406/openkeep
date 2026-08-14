import { describe, expect, it, vi } from "vitest";
import {
  createDesktopTrayLifecycle,
  type LifecycleWindow,
  type TrayLifecycleHost,
  type TrayMenuItem,
} from "./tray-lifecycle";

type Handler = (...args: unknown[]) => void;

function createWindow({ visible = true } = {}) {
  const handlers = new Map<string, Handler>();
  let isVisible = visible;
  let destroyed = false;
  const window: LifecycleWindow = {
    isDestroyed: vi.fn(() => destroyed),
    isVisible: vi.fn(() => isVisible),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(() => { isVisible = true; }),
    hide: vi.fn(() => { isVisible = false; }),
    focus: vi.fn(),
    getBounds: vi.fn(() => ({ x: 20, y: 30, width: 1280, height: 820 })),
    on: vi.fn((event, handler) => { handlers.set(event, handler); }),
  };
  function destroy() {
    destroyed = true;
    isVisible = false;
    handlers.get("closed")?.();
  }
  return { window, handlers, destroy };
}

function createHarness(options: {
  platform?: NodeJS.Platform;
  trayAvailable?: boolean;
  closeBehavior?: "tray" | "quit";
  confirmQuitOnClose?: boolean;
  watchFolderSummary?: { total: number; watching: number; attention: number };
} = {}) {
  const menus: TrayMenuItem[][] = [];
  const trayHandlers = new Map<string, () => void>();
  const tray = {
    setMenu: vi.fn((menu: TrayMenuItem[]) => { menus.push(menu); }),
    setToolTip: vi.fn(),
    on: vi.fn((event: string, handler: () => void) => trayHandlers.set(event, handler)),
    destroy: vi.fn(),
  };
  let closeBehavior = options.closeBehavior ?? "tray";
  const state = {
    snapshot: vi.fn(() => ({
      closeBehavior,
      profileRoutes: {},
      notifications: { completed: true, failed: true, review: true, deadlines: false },
    })),
    setCloseBehavior: vi.fn(async (next: "tray" | "quit") => { closeBehavior = next; }),
    setWindowBounds: vi.fn(async () => undefined),
  };
  const beforeQuit: Array<(event: { preventDefault(): void }) => void> = [];
  const host: TrayLifecycleHost = {
    platform: options.platform ?? "darwin",
    createTray: vi.fn(() => options.trayAvailable === false ? null : tray),
    focusApplication: vi.fn(),
    quitApplication: vi.fn(),
    confirmQuitOnClose: vi.fn(async () => options.confirmQuitOnClose ?? true),
    onBeforeQuit: vi.fn((handler) => beforeQuit.push(handler)),
  };
  const cleanup = vi.fn(async () => undefined);
  let watchFolderSummary = options.watchFolderSummary ?? {
    total: 0,
    watching: 0,
    attention: 0,
  };
  const activateProfile = vi.fn(async () => undefined);
  const startImport = vi.fn(async () => undefined);
  const ensureWindow = vi.fn(async () => undefined);
  const lifecycle = createDesktopTrayLifecycle({
    host,
    state,
    listProfiles: vi.fn(async () => ({
      activeProfileId: "home",
      profiles: [
        { id: "home", label: "Home", serverUrl: "https://home.invalid" },
        { id: "work", label: "Work", serverUrl: "https://work.invalid" },
      ],
    })),
    activateProfile,
    startImport,
    ensureWindow,
    watchFolderSummary: () => watchFolderSummary,
    cleanup,
  });
  return {
    lifecycle,
    host,
    state,
    cleanup,
    ensureWindow,
    tray,
    menus,
    trayHandlers,
    beforeQuit,
    activateProfile,
    startImport,
  };
}

function findItem(menu: TrayMenuItem[], label: string) {
  const item = menu.find((candidate) => candidate.label === label);
  if (!item) throw new Error(`Missing tray item: ${label}`);
  return item;
}

describe("desktop tray lifecycle", () => {
  it("hides on close by default, then restores and focuses from the tray", async () => {
    const harness = createHarness();
    const fake = createWindow();
    await harness.lifecycle.initialize();
    harness.lifecycle.attachWindow(fake.window);

    const preventDefault = vi.fn();
    fake.handlers.get("close")?.({ preventDefault });
    await harness.lifecycle.idle();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(fake.window.hide).toHaveBeenCalledOnce();
    expect(harness.state.setWindowBounds).toHaveBeenCalledWith({
      x: 20, y: 30, width: 1280, height: 820,
    });

    await findItem(harness.menus.at(-1)!, "Show OpenKeep").click?.();
    expect(fake.window.show).toHaveBeenCalledOnce();
    expect(fake.window.focus).toHaveBeenCalledOnce();
    expect(harness.host.focusApplication).toHaveBeenCalledOnce();
  });

  it("confirms and persists quit-on-close before allowing close to stop background work", async () => {
    const harness = createHarness({ confirmQuitOnClose: true });
    const fake = createWindow();
    await harness.lifecycle.initialize();
    harness.lifecycle.attachWindow(fake.window);

    await findItem(
      harness.menus.at(-1)!,
      "Keep OpenKeep running when the window closes",
    ).click?.();

    expect(harness.host.confirmQuitOnClose).toHaveBeenCalledOnce();
    expect(harness.state.setCloseBehavior).toHaveBeenCalledWith("quit");
    const preventDefault = vi.fn();
    fake.handlers.get("close")?.({ preventDefault });
    await harness.lifecycle.idle();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(harness.cleanup).toHaveBeenCalledOnce();
    expect(harness.tray.destroy).toHaveBeenCalledOnce();
    expect(harness.host.quitApplication).toHaveBeenCalledOnce();
  });

  it("keeps close-to-tray when the warning is cancelled", async () => {
    const harness = createHarness({ confirmQuitOnClose: false });
    await harness.lifecycle.initialize();

    await findItem(
      harness.menus.at(-1)!,
      "Keep OpenKeep running when the window closes",
    ).click?.();

    expect(harness.state.setCloseBehavior).not.toHaveBeenCalled();
  });

  it("exposes the same persisted preference seam to the renderer", async () => {
    const harness = createHarness();
    await harness.lifecycle.initialize();

    await expect(harness.lifecycle.setCloseBehavior("quit")).resolves.toEqual({
      closeBehavior: "quit",
      trayAvailable: true,
    });
    expect(harness.state.setCloseBehavior).toHaveBeenCalledWith("quit");
  });

  it("shows only archive labels, switches profiles, and starts an import", async () => {
    const harness = createHarness();
    const fake = createWindow({ visible: false });
    await harness.lifecycle.initialize();
    harness.lifecycle.attachWindow(fake.window);
    await harness.lifecycle.refreshMenu();
    const menu = harness.menus.at(-1)!;

    expect(JSON.stringify(menu)).not.toContain("home.invalid");
    expect(findItem(menu, "Active archive: Home").enabled).toBe(false);
    const switcher = findItem(menu, "Switch archive");
    await findItem(switcher.submenu!, "Work").click?.();
    expect(harness.activateProfile).toHaveBeenCalledWith("work");

    await findItem(menu, "Import documents…").click?.();
    expect(fake.window.show).toHaveBeenCalled();
    expect(harness.startImport).toHaveBeenCalledOnce();
  });

  it("summarizes watch folders in counts, never in paths", async () => {
    const quiet = createHarness();
    await quiet.lifecycle.initialize();
    expect(findItem(quiet.menus.at(-1)!, "No watch folders").enabled).toBe(false);

    const active = createHarness({
      watchFolderSummary: { total: 3, watching: 2, attention: 0 },
    });
    await active.lifecycle.initialize();
    findItem(active.menus.at(-1)!, "Watch folders: 2 of 3 active");

    const broken = createHarness({
      watchFolderSummary: { total: 2, watching: 1, attention: 1 },
    });
    await broken.lifecycle.initialize();
    findItem(broken.menus.at(-1)!, "Watch folders: 1 of 2 need attention");
  });

  it("falls back to quit on Linux when a tray cannot be created", async () => {
    const harness = createHarness({ platform: "linux", trayAvailable: false });
    const fake = createWindow();
    await harness.lifecycle.initialize();
    harness.lifecycle.attachWindow(fake.window);
    const preventDefault = vi.fn();

    fake.handlers.get("close")?.({ preventDefault });
    await harness.lifecycle.idle();

    expect(fake.window.hide).not.toHaveBeenCalled();
    expect(harness.cleanup).toHaveBeenCalledOnce();
    expect(harness.host.quitApplication).toHaveBeenCalledOnce();
  });

  it("uses platform-native double click to reveal a hidden Windows window", async () => {
    const harness = createHarness({ platform: "win32" });
    const fake = createWindow({ visible: false });
    await harness.lifecycle.initialize();
    harness.lifecycle.attachWindow(fake.window);

    harness.trayHandlers.get("double-click")?.();

    expect(fake.window.show).toHaveBeenCalledOnce();
    expect(fake.window.focus).toHaveBeenCalledOnce();
  });

  it("keeps the tray usable after the window is destroyed by rebuilding it", async () => {
    const harness = createHarness();
    const fake = createWindow();
    await harness.lifecycle.initialize();
    harness.lifecycle.attachWindow(fake.window);

    fake.destroy();
    harness.lifecycle.handleAllWindowsClosed();
    await harness.lifecycle.idle();

    expect(harness.host.quitApplication).not.toHaveBeenCalled();
    await findItem(harness.menus.at(-1)!, "Show OpenKeep").click?.();
    await harness.lifecycle.idle();
    expect(harness.ensureWindow).toHaveBeenCalledOnce();
  });

  it("quits rather than stranding an invisible app when no tray can reveal it", async () => {
    const harness = createHarness({ platform: "linux", trayAvailable: false });
    const fake = createWindow();
    await harness.lifecycle.initialize();
    harness.lifecycle.attachWindow(fake.window);

    fake.destroy();
    harness.lifecycle.handleAllWindowsClosed();
    await harness.lifecycle.idle();

    expect(harness.cleanup).toHaveBeenCalledOnce();
    expect(harness.host.quitApplication).toHaveBeenCalledOnce();
  });

  it("ignores all-windows-closed while a quit is already running", async () => {
    const harness = createHarness();
    await harness.lifecycle.initialize();

    await harness.lifecycle.requestQuit();
    harness.lifecycle.handleAllWindowsClosed();
    await harness.lifecycle.idle();

    expect(harness.cleanup).toHaveBeenCalledOnce();
    expect(harness.host.quitApplication).toHaveBeenCalledOnce();
    expect(harness.ensureWindow).not.toHaveBeenCalled();
  });

  it("runs cleanup exactly once for explicit and operating-system quit", async () => {
    const harness = createHarness();
    await harness.lifecycle.initialize();

    const event = { preventDefault: vi.fn() };
    harness.beforeQuit[0]?.(event);
    await harness.lifecycle.requestQuit();
    await harness.lifecycle.idle();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(harness.cleanup).toHaveBeenCalledOnce();
    expect(harness.host.quitApplication).toHaveBeenCalledOnce();
  });
});
