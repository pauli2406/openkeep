import { vi } from "vitest";
import type { DesktopBridge, DesktopSessionState } from "../shared/desktop-api";

export type DesktopBridgeOverrides = {
  [Group in keyof DesktopBridge]?: Partial<DesktopBridge[Group]>;
};

const DISCONNECTED: DesktopSessionState = {
  status: "disconnected",
  reason: "no-profile",
};

/**
 * One preload-bridge double for every renderer test.
 *
 * The bridge is a frozen contract, so a test that spells out all seven groups
 * has to be edited whenever any group gains an operation — which is how six
 * copies of the same object ended up in this suite. Tests override only the
 * operations they assert on and inherit inert defaults for the rest.
 */
export function createDesktopBridgeStub(
  overrides: DesktopBridgeOverrides = {},
): DesktopBridge {
  return {
    session: {
      restore: vi.fn(async () => DISCONNECTED),
      connect: vi.fn(async () => DISCONNECTED),
      retry: vi.fn(async () => DISCONNECTED),
      signOut: vi.fn(async (): Promise<DesktopSessionState> => ({
        status: "disconnected",
        reason: "signed-out",
      })),
      openOffline: vi.fn(async () => DISCONNECTED),
      offlineAvailability: vi.fn(async () => ({ profiles: {} })),
      clearOfflineCopy: vi.fn(async () => ({ profiles: {} })),
      setOfflineCopyLimit: vi.fn(async () => ({ profiles: {} })),
      ...overrides.session,
    },
    profiles: {
      list: vi.fn(async () => ({ profiles: [], activeProfileId: null })),
      activate: vi.fn(async () => DISCONNECTED),
      rename: vi.fn(async () => ({ profiles: [], activeProfileId: null })),
      remove: vi.fn(async () => DISCONNECTED),
      ...overrides.profiles,
    },
    imports: {
      pick: vi.fn(async () => ({ files: [], rejected: [] })),
      pending: vi.fn(async () => ({ batches: [] })),
      assign: vi.fn(),
      consume: vi.fn(async () => ({ files: [], rejected: [] })),
      reportCreated: vi.fn(async () => undefined),
      onChanged: vi.fn(() => () => undefined),
      ...overrides.imports,
    },
    save: {
      request: vi.fn(async () => ({ status: "cancelled" as const })),
      ...overrides.save,
    },
    watchFolders: {
      list: vi.fn(async () => ({ profileId: null, folders: [] })),
      add: vi.fn(async () => ({ status: "cancelled" as const })),
      setPaused: vi.fn(async () => ({ profileId: null, folders: [] })),
      remove: vi.fn(async () => ({ profileId: null, folders: [] })),
      onChanged: vi.fn(() => () => undefined),
      ...overrides.watchFolders,
    },
    notifications: {
      getSettings: vi.fn(async () => ({
        preferences: { completed: true, failed: true, review: true, deadlines: false },
        supported: true,
      })),
      setPreference: vi.fn(async () => ({
        preferences: { completed: true, failed: true, review: true, deadlines: false },
        supported: true,
      })),
      ...overrides.notifications,
    },
    lifecycle: {
      getSettings: vi.fn(async () => ({
        closeBehavior: "tray" as const,
        trayAvailable: true,
      })),
      setCloseBehavior: vi.fn(async () => ({
        closeBehavior: "tray" as const,
        trayAvailable: true,
      })),
      ...overrides.lifecycle,
    },
    updates: {
      state: vi.fn(async () => ({ status: "idle" as const })),
      check: vi.fn(async () => ({ status: "upToDate" as const })),
      install: vi.fn(async () => undefined),
      onChanged: vi.fn(() => () => undefined),
      ...overrides.updates,
    },
    runtime: {
      getInfo: vi.fn(async () => ({
        platform: "darwin" as NodeJS.Platform,
        version: "0.1.0",
      })),
      ...overrides.runtime,
    },
  };
}
