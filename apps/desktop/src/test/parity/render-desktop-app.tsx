import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App as WebApp } from "@openkeep/web/app";
import { configureApiAuthMode } from "@openkeep/web/api";
import { makeUser } from "@/test/fixtures";
import { useState } from "react";
import {
  DesktopAuthProvider,
  DesktopSessionContext,
} from "../../renderer/desktop-auth-provider";
import { DesktopArchiveAccessory } from "../../renderer/desktop-archive-accessory";
import type {
  DesktopBridge,
  DesktopProfileSummary,
  DesktopSessionState,
} from "../../shared/desktop-api";

configureApiAuthMode("main-owned");

const DEFAULT_PROFILE: DesktopProfileSummary = {
  id: "11111111-aaaa-aaaa-aaaa-111111111111",
  label: "Personal archive",
  serverUrl: "https://archive.example.test",
};

type DesktopBridgeOverrides = {
  [Group in keyof DesktopBridge]?: Partial<DesktopBridge[Group]>;
};

type RenderDesktopArchiveOptions = {
  route?: string;
  profile?: DesktopProfileSummary;
  bridge?: DesktopBridgeOverrides;
};

function createBridge(
  connected: Extract<DesktopSessionState, { status: "connected" }>,
  overrides: DesktopBridgeOverrides = {},
): DesktopBridge {
  return {
    session: {
      restore: async () => connected,
      connect: async () => connected,
      retry: async () => connected,
      signOut: async () => ({ status: "disconnected", reason: "signed-out" }),
      ...overrides.session,
    },
    profiles: {
      list: async () => ({
        profiles: [connected.profile],
        activeProfileId: connected.profile.id,
      }),
      activate: async () => connected,
      rename: async () => ({
        profiles: [connected.profile],
        activeProfileId: connected.profile.id,
      }),
      remove: async () => ({ status: "disconnected", reason: "no-profile" }),
      ...overrides.profiles,
    },
    imports: {
      pick: async () => ({ files: [], rejected: [] }),
      pending: async () => ({ batches: [] }),
      assign: async (input) => ({
        id: input.batchId,
        source: "open-with",
        profileId: input.profileId,
        files: [],
        rejected: [],
      }),
      consume: async () => ({ files: [], rejected: [] }),
      onChanged: () => () => undefined,
      ...overrides.imports,
    },
    save: {
      request: async () => ({ status: "cancelled" }),
      ...overrides.save,
    },
    runtime: {
      getInfo: async () => ({ platform: "darwin", version: "test" }),
      ...overrides.runtime,
    },
  };
}

function DesktopArchiveHost({
  initialState,
}: {
  initialState: Extract<DesktopSessionState, { status: "connected" }>;
}) {
  const [sessionState, setSessionState] = useState<DesktopSessionState>(initialState);

  if (sessionState.status !== "connected") {
    return (
      <main aria-live="polite">
        {sessionState.status === "unavailable"
          ? sessionState.message
          : "Desktop archive session ended."}
      </main>
    );
  }

  return (
    <DesktopSessionContext.Provider
      value={{ state: sessionState, setState: setSessionState }}
    >
      <WebApp
        AuthProvider={DesktopAuthProvider}
        ShellAccessory={DesktopArchiveAccessory}
        platform="darwin"
        fileSaver={(request) => window.openkeepDesktop.save.request(request)}
      />
    </DesktopSessionContext.Provider>
  );
}

/**
 * Mounts the production web shell exactly as Electron does: host-owned auth,
 * a connected desktop session, and a fresh WebApp (therefore fresh router and
 * QueryClient) for every archive render.
 */
export function renderDesktopArchive({
  route = "/",
  profile = DEFAULT_PROFILE,
  bridge: bridgeOverrides,
}: RenderDesktopArchiveOptions = {}) {
  window.history.replaceState({}, "", route);

  const state: Extract<DesktopSessionState, { status: "connected" }> = {
    status: "connected",
    profile,
    user: {
      ...makeUser(),
      createdAt: "2026-01-01T00:00:00.000Z",
      preferences: {
        uiLanguage: "en",
        aiProcessingLanguage: "en",
        aiChatLanguage: "en",
      },
    },
  };
  const bridge = createBridge(state, bridgeOverrides);
  Object.defineProperty(window, "openkeepDesktop", {
    configurable: true,
    value: bridge,
  });

  return {
    bridge,
    profile,
    user: userEvent.setup(),
    ...render(<DesktopArchiveHost initialState={state} />),
  };
}
