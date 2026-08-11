import { randomUUID } from "node:crypto";
import {
  createAtomicJsonFile,
  type AtomicJsonFileSystem,
} from "./storage/atomic-json-file";

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

export type LifecycleStateFileSystem = AtomicJsonFileSystem;

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

export function createDesktopLifecycleStateStore({
  filePath,
  fileSystem,
  createTemporaryId = randomUUID,
}: {
  filePath: string;
  fileSystem?: LifecycleStateFileSystem;
  createTemporaryId?: () => string;
}) {
  const file = createAtomicJsonFile({ filePath, fileSystem, createTemporaryId });
  let state = cloneState(DEFAULT_STATE);
  let loaded = false;
  let writes = Promise.resolve();

  function persist(next: DesktopLifecycleState) {
    return file.write({ version: 1, ...next });
  }

  function update(mutate: (next: DesktopLifecycleState) => void) {
    const run = writes.then(async () => {
      const next = cloneState(state);
      mutate(next);
      await persist(next);
      state = next;
    });
    // The stored chain must always settle. One transient write failure — an
    // antivirus lock, a full disk — must not leave the chain rejected and
    // disable every later close-preference, bounds, and route write until the
    // application restarts. The caller still sees its own failure via `run`.
    writes = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return {
    async load() {
      if (loaded) return cloneState(state);
      try {
        const serialized = await file.read();
        if (serialized !== null) state = parseState(serialized);
      } catch {
        state = cloneState(DEFAULT_STATE);
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
