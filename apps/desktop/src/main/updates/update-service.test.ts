import { describe, expect, it, vi } from "vitest";
import {
  createDesktopUpdateService,
  isNewerVersion,
  updateFeedUrl,
  type DesktopUpdateState,
  type PlatformAutoUpdater,
} from "./update-service";

function fakeAutoUpdater() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const updater: PlatformAutoUpdater = {
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
    }),
  };
  return {
    updater,
    emit: (event: string, ...args: unknown[]) => listeners.get(event)?.(...args),
  };
}

function createHarness(options: {
  platform: NodeJS.Platform;
  isPackaged?: boolean;
  autoUpdater?: PlatformAutoUpdater | null;
  latestRelease?: { tag_name: string; html_url: string } | number;
}) {
  const states: DesktopUpdateState[] = [];
  const service = createDesktopUpdateService({
    repository: "pauli2406/openkeep",
    platform: options.platform,
    arch: "arm64",
    currentVersion: "1.2.0",
    isPackaged: options.isPackaged ?? true,
    autoUpdater: options.autoUpdater ?? null,
    fetchRequest: vi.fn(async () =>
      typeof options.latestRelease === "number"
        ? new Response("nope", { status: options.latestRelease })
        : new Response(JSON.stringify(options.latestRelease ?? {}), { status: 200 }),
    ),
    timer: { start: vi.fn(), stop: vi.fn() },
    onChanged: (state) => states.push(state),
  });
  return { service, states };
}

describe("update vocabulary", () => {
  it("builds the update.electronjs.org feed URL", () => {
    expect(updateFeedUrl("pauli2406/openkeep", "darwin", "arm64", "1.2.0")).toBe(
      "https://update.electronjs.org/pauli2406/openkeep/darwin-arm64/1.2.0",
    );
  });

  it("compares versions numerically, with or without the v prefix", () => {
    expect(isNewerVersion("v1.3.0", "1.2.9")).toBe(true);
    expect(isNewerVersion("1.2.10", "1.2.9")).toBe(true);
    expect(isNewerVersion("v1.2.0", "1.2.0")).toBe(false);
    expect(isNewerVersion("v1.1.9", "1.2.0")).toBe(false);
    expect(isNewerVersion("not-a-version", "1.2.0")).toBe(false);
  });
});

describe("native platform updates", () => {
  it("walks checking, downloading, ready — and installs only on request", async () => {
    const fake = fakeAutoUpdater();
    const { service, states } = createHarness({
      platform: "darwin",
      autoUpdater: fake.updater,
    });

    await service.check();
    expect(fake.updater.checkForUpdates).toHaveBeenCalledOnce();

    fake.emit("checking-for-update");
    fake.emit("update-available");
    fake.emit("update-downloaded", null, "notes", "v1.3.0");

    expect(states.map((state) => state.status)).toEqual([
      "checking",
      "downloading",
      "ready",
    ]);
    expect(service.state()).toEqual({ status: "ready", version: "v1.3.0" });

    expect(fake.updater.quitAndInstall).not.toHaveBeenCalled();
    service.install();
    expect(fake.updater.quitAndInstall).toHaveBeenCalledOnce();
  });

  it("reports up to date and never installs without a downloaded update", async () => {
    const fake = fakeAutoUpdater();
    const { service } = createHarness({
      platform: "win32",
      autoUpdater: fake.updater,
    });

    await service.check();
    fake.emit("update-not-available");
    expect(service.state()).toEqual({ status: "upToDate" });

    service.install();
    expect(fake.updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("explains an unsigned build instead of dumping the signature error", () => {
    const fake = fakeAutoUpdater();
    const { service } = createHarness({
      platform: "darwin",
      autoUpdater: fake.updater,
    });

    fake.emit("error", new Error("could not validate code signature of ..."));

    expect(service.state()).toMatchObject({
      status: "error",
      message: expect.stringContaining("not signed"),
    });
  });

  it("does not re-enter a check while a download is in flight", async () => {
    const fake = fakeAutoUpdater();
    const { service } = createHarness({
      platform: "darwin",
      autoUpdater: fake.updater,
    });
    await service.check();
    fake.emit("update-available");

    await service.check();
    expect(fake.updater.checkForUpdates).toHaveBeenCalledOnce();
  });
});

describe("Linux manual updates", () => {
  it("links to a newer release instead of pretending to auto-update", async () => {
    const { service } = createHarness({
      platform: "linux",
      latestRelease: {
        tag_name: "v1.3.0",
        html_url: "https://github.com/pauli2406/openkeep/releases/tag/v1.3.0",
      },
    });

    await service.check();

    expect(service.state()).toEqual({
      status: "available-manual",
      version: "v1.3.0",
      url: "https://github.com/pauli2406/openkeep/releases/tag/v1.3.0",
    });
    // There is nothing to install in-place on Linux.
    service.install();
    expect(service.state().status).toBe("available-manual");
  });

  it("reports up to date when the latest release is not newer", async () => {
    const { service } = createHarness({
      platform: "linux",
      latestRelease: {
        tag_name: "v1.2.0",
        html_url: "https://github.com/pauli2406/openkeep/releases/tag/v1.2.0",
      },
    });
    await service.check();
    expect(service.state()).toEqual({ status: "upToDate" });
  });

  it("turns an unreachable release feed into a retryable error", async () => {
    const { service } = createHarness({ platform: "linux", latestRelease: 503 });
    await service.check();
    expect(service.state()).toMatchObject({ status: "error" });
  });
});

describe("development builds", () => {
  it("declares updates unsupported and never checks", async () => {
    const fake = fakeAutoUpdater();
    const { service } = createHarness({
      platform: "darwin",
      isPackaged: false,
      autoUpdater: fake.updater,
    });

    expect(service.state()).toMatchObject({ status: "unsupported" });
    await service.check();
    expect(fake.updater.checkForUpdates).not.toHaveBeenCalled();
  });
});
