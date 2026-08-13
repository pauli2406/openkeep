/**
 * Desktop update checks and installation.
 *
 * macOS uses Electron's built-in Squirrel.Mac updater behind a ZIP feed,
 * pointed at update.electronjs.org over this repository's GitHub Releases.
 * Windows and Linux have no in-place updater — Windows ships an MSI and Linux
 * a distribution package — so both compare the latest GitHub Release against
 * the running version and link to it, leaving installation to the installer
 * or package manager that owns it.
 *
 * Updates are checked shortly after startup and on demand, never installed
 * without the user's say-so: `install()` restarts into the downloaded
 * version, and a downloaded update also applies on the next ordinary
 * restart, which is Squirrel's contract.
 */

export type DesktopUpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "downloading" }
  | { status: "ready"; version: string | null }
  | { status: "upToDate" }
  | { status: "available-manual"; version: string; url: string }
  | { status: "unsupported"; reason: string }
  | { status: "error"; message: string };

export type PlatformAutoUpdater = {
  setFeedURL(options: { url: string }): void;
  checkForUpdates(): void;
  quitAndInstall(): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
};

export const UPDATE_STARTUP_DELAY_MS = 15_000;

export function updateFeedUrl(
  repository: string,
  platform: NodeJS.Platform,
  arch: string,
  version: string,
): string {
  return `https://update.electronjs.org/${repository}/${platform}-${arch}/${version}`;
}

/** v-prefixed or bare semantic versions, compared numerically. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (value: string) =>
    value
      .replace(/^v/, "")
      .split(".")
      .map((part) => Number.parseInt(part, 10));
  const a = parse(candidate);
  const b = parse(current);
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
  for (let index = 0; index < 3; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

export function createDesktopUpdateService({
  repository,
  platform,
  arch,
  currentVersion,
  isPackaged,
  autoUpdater,
  fetchRequest,
  timer,
  onChanged,
  startupDelayMs = UPDATE_STARTUP_DELAY_MS,
}: {
  /** owner/name, the repository whose Releases carry the artifacts. */
  repository: string;
  platform: NodeJS.Platform;
  arch: string;
  currentVersion: string;
  isPackaged: boolean;
  /** Electron's autoUpdater; null where the platform has none. */
  autoUpdater: PlatformAutoUpdater | null;
  fetchRequest: (input: string, init?: RequestInit) => Promise<Response>;
  timer: { start(run: () => void, delayMs: number): void; stop(): void };
  onChanged: (state: DesktopUpdateState) => void;
  startupDelayMs?: number;
}) {
  let state: DesktopUpdateState = { status: "idle" };
  // Only Squirrel.Mac remains an in-place updater. Windows ships an MSI, which
  // has no Squirrel feed, so it takes the same manual path as Linux: compare
  // against the latest GitHub release and link to it.
  const nativeUpdates = isPackaged && platform === "darwin";

  function setState(next: DesktopUpdateState) {
    state = next;
    onChanged(state);
  }

  if (!isPackaged) {
    state = {
      status: "unsupported",
      reason: "Updates apply only to the packaged application.",
    };
  } else if (nativeUpdates && autoUpdater) {
    try {
      autoUpdater.setFeedURL({
        url: updateFeedUrl(repository, platform, arch, currentVersion),
      });
      autoUpdater.on("checking-for-update", () => setState({ status: "checking" }));
      autoUpdater.on("update-available", () => setState({ status: "downloading" }));
      autoUpdater.on("update-not-available", () => setState({ status: "upToDate" }));
      autoUpdater.on("update-downloaded", (...args: unknown[]) => {
        const releaseName = args[2];
        setState({
          status: "ready",
          version: typeof releaseName === "string" ? releaseName : null,
        });
      });
      autoUpdater.on("error", (error: unknown) => {
        // Unsigned developer-style builds land here on macOS; the message is
        // sanitized to a category rather than an internals dump.
        setState({
          status: "error",
          message:
            error instanceof Error && /code signature|not signed/i.test(error.message)
              ? "This build is not signed, so it cannot update itself."
              : "The update check failed. It will be retried later.",
        });
      });
    } catch {
      state = {
        status: "unsupported",
        reason: "The platform updater could not be initialized.",
      };
    }
  }

  async function checkManually() {
    setState({ status: "checking" });
    try {
      const response = await fetchRequest(
        `https://api.github.com/repos/${repository}/releases/latest`,
        { headers: { accept: "application/vnd.github+json" } },
      );
      if (!response.ok) {
        setState({
          status: "error",
          message: "The update check failed. It will be retried later.",
        });
        return;
      }
      const release = (await response.json()) as {
        tag_name?: unknown;
        html_url?: unknown;
      };
      const tag = typeof release.tag_name === "string" ? release.tag_name : null;
      const url = typeof release.html_url === "string" ? release.html_url : null;
      if (tag && url && isNewerVersion(tag, currentVersion)) {
        setState({ status: "available-manual", version: tag, url });
      } else {
        setState({ status: "upToDate" });
      }
    } catch {
      setState({
        status: "error",
        message: "The update check failed. It will be retried later.",
      });
    }
  }

  return {
    state(): DesktopUpdateState {
      return state;
    },

    start() {
      if (state.status === "unsupported") return;
      timer.start(() => void this.check(), startupDelayMs);
    },

    async check() {
      if (state.status === "unsupported") return;
      if (state.status === "downloading" || state.status === "ready") return;
      if (nativeUpdates && autoUpdater) {
        autoUpdater.checkForUpdates();
        return;
      }
      await checkManually();
    },

    /** Installs a downloaded update now; a no-op unless one is ready. */
    install() {
      if (state.status === "ready" && nativeUpdates && autoUpdater) {
        autoUpdater.quitAndInstall();
      }
    },

    stop() {
      timer.stop();
    },
  };
}

export type DesktopUpdateService = ReturnType<typeof createDesktopUpdateService>;
