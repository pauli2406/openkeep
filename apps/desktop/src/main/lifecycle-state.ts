import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type DesktopCloseBehavior = "tray" | "quit";

export type DesktopWindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesktopLifecycleState = {
  closeBehavior: DesktopCloseBehavior;
  windowBounds?: DesktopWindowBounds;
  profileRoutes: Record<string, string>;
};

export type LifecycleStateFileSystem = {
  mkdir(directory: string): Promise<unknown>;
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, contents: string): Promise<unknown>;
  rename(from: string, to: string): Promise<unknown>;
};

const DEFAULT_STATE: DesktopLifecycleState = {
  closeBehavior: "tray",
  profileRoutes: {},
};

function cloneState(state: DesktopLifecycleState): DesktopLifecycleState {
  return {
    closeBehavior: state.closeBehavior,
    ...(state.windowBounds ? { windowBounds: { ...state.windowBounds } } : {}),
    profileRoutes: { ...state.profileRoutes },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseBounds(value: unknown): DesktopWindowBounds | undefined {
  if (!isRecord(value)) return undefined;
  const values = [value.x, value.y, value.width, value.height];
  if (!values.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
    return undefined;
  }
  if ((value.width as number) <= 0 || (value.height as number) <= 0) {
    return undefined;
  }
  return {
    x: Math.round(value.x as number),
    y: Math.round(value.y as number),
    width: Math.round(value.width as number),
    height: Math.round(value.height as number),
  };
}

function parseState(serialized: string): DesktopLifecycleState {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value) || value.version !== 1) return cloneState(DEFAULT_STATE);
    const closeBehavior = value.closeBehavior === "quit" ? "quit" :
      value.closeBehavior === "tray" ? "tray" : null;
    if (!closeBehavior || !isRecord(value.profileRoutes)) {
      return cloneState(DEFAULT_STATE);
    }
    const profileRoutes: Record<string, string> = {};
    for (const [profileId, route] of Object.entries(value.profileRoutes)) {
      if (
        profileId.length > 0 &&
        profileId.length <= 128 &&
        typeof route === "string" &&
        route.length <= 4_096
      ) {
        profileRoutes[profileId] = route;
      }
    }
    const windowBounds = parseBounds(value.windowBounds);
    return {
      closeBehavior,
      ...(windowBounds ? { windowBounds } : {}),
      profileRoutes,
    };
  } catch {
    return cloneState(DEFAULT_STATE);
  }
}

function nodeFileSystem(): LifecycleStateFileSystem {
  return {
    mkdir: (directory) => fs.mkdir(directory, { recursive: true, mode: 0o700 }),
    readFile: (filePath) => fs.readFile(filePath, "utf8"),
    writeFile: (filePath, contents) => fs.writeFile(filePath, contents, {
      encoding: "utf8",
      mode: 0o600,
    }),
    rename: (from, to) => fs.rename(from, to),
  };
}

export function createDesktopLifecycleStateStore({
  filePath,
  fileSystem = nodeFileSystem(),
  createTemporaryId = randomUUID,
}: {
  filePath: string;
  fileSystem?: LifecycleStateFileSystem;
  createTemporaryId?: () => string;
}) {
  let state = cloneState(DEFAULT_STATE);
  let loaded = false;
  let writes = Promise.resolve();

  async function persist(next: DesktopLifecycleState) {
    const temporaryPath = `${filePath}.${createTemporaryId()}.tmp`;
    const serialized = JSON.stringify({ version: 1, ...next }, null, 2);
    await fileSystem.mkdir(path.dirname(filePath));
    await fileSystem.writeFile(temporaryPath, serialized);
    await fileSystem.rename(temporaryPath, filePath);
  }

  function update(mutate: (next: DesktopLifecycleState) => void) {
    writes = writes.then(async () => {
      const next = cloneState(state);
      mutate(next);
      await persist(next);
      state = next;
    });
    return writes;
  }

  return {
    async load() {
      if (loaded) return cloneState(state);
      try {
        state = parseState(await fileSystem.readFile(filePath));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          state = cloneState(DEFAULT_STATE);
        }
      }
      loaded = true;
      return cloneState(state);
    },

    snapshot() {
      return cloneState(state);
    },

    setCloseBehavior(closeBehavior: DesktopCloseBehavior) {
      return update((next) => { next.closeBehavior = closeBehavior; });
    },

    setWindowBounds(windowBounds: DesktopWindowBounds) {
      return update((next) => { next.windowBounds = { ...windowBounds }; });
    },

    rememberProfileRoute(profileId: string, route: string) {
      return update((next) => { next.profileRoutes[profileId] = route; });
    },

    forgetProfileRoute(profileId: string) {
      return update((next) => { delete next.profileRoutes[profileId]; });
    },

    async idle() {
      await writes;
    },
  };
}

export type DesktopLifecycleStateStore = ReturnType<
  typeof createDesktopLifecycleStateStore
>;
