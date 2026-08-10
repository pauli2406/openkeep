import type { CurrentUser } from "@openkeep/types";

export const DESKTOP_CHANNELS = {
  sessionRestore: "desktop:session:restore",
  sessionConnect: "desktop:session:connect",
  sessionRetry: "desktop:session:retry",
  sessionSignOut: "desktop:session:sign-out",
  runtimeGetInfo: "desktop:runtime:get-info",
} as const;

export type DesktopProfileSummary = {
  id: string;
  serverUrl: string;
  label: string;
};

export type DesktopConnectInput = {
  serverUrl: string;
  apiToken: string;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
  allowInsecureHttp?: boolean;
};

export type DesktopSessionState =
  | {
      status: "disconnected";
      serverUrl?: string;
      reason?: "invalid-credentials" | "signed-out" | "no-profile";
    }
  | {
      status: "connected";
      profile: DesktopProfileSummary;
      user: CurrentUser;
    }
  | {
      status: "unavailable";
      profile: DesktopProfileSummary;
      message: string;
    }
  | {
      status: "error";
      code:
        | "invalid-url"
        | "insecure-http-confirmation-required"
        | "invalid-credentials"
        | "unreachable"
        | "unhealthy"
        | "invalid-response"
        | "secure-storage-unavailable";
      message: string;
      serverUrl?: string;
    };

export type DesktopRuntimeInfo = {
  platform: NodeJS.Platform;
  version: string;
};

export type DesktopBridge = {
  session: {
    restore: () => Promise<DesktopSessionState>;
    connect: (input: DesktopConnectInput) => Promise<DesktopSessionState>;
    retry: () => Promise<DesktopSessionState>;
    signOut: () => Promise<DesktopSessionState>;
  };
  runtime: {
    getInfo: () => Promise<DesktopRuntimeInfo>;
  };
};

type Invoke = (channel: string, payload?: unknown) => Promise<unknown>;

export function createDesktopBridge(invoke: Invoke): DesktopBridge {
  return Object.freeze({
    session: Object.freeze({
      restore: () =>
        invoke(DESKTOP_CHANNELS.sessionRestore) as Promise<DesktopSessionState>,
      connect: (input: DesktopConnectInput) =>
        invoke(DESKTOP_CHANNELS.sessionConnect, input) as Promise<DesktopSessionState>,
      retry: () =>
        invoke(DESKTOP_CHANNELS.sessionRetry) as Promise<DesktopSessionState>,
      signOut: () =>
        invoke(DESKTOP_CHANNELS.sessionSignOut) as Promise<DesktopSessionState>,
    }),
    runtime: Object.freeze({
      getInfo: () =>
        invoke(DESKTOP_CHANNELS.runtimeGetInfo) as Promise<DesktopRuntimeInfo>,
    }),
  });
}
