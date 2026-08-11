import type { CurrentUser } from "@openkeep/types";

export const DESKTOP_CHANNELS = {
  sessionRestore: "desktop:session:restore",
  sessionConnect: "desktop:session:connect",
  sessionRetry: "desktop:session:retry",
  sessionSignOut: "desktop:session:sign-out",
  profilesList: "desktop:profiles:list",
  profilesActivate: "desktop:profiles:activate",
  profilesRename: "desktop:profiles:rename",
  profilesRemove: "desktop:profiles:remove",
  importsPick: "desktop:imports:pick",
  importsPending: "desktop:imports:pending",
  importsAssign: "desktop:imports:assign",
  importsConsume: "desktop:imports:consume",
  importsChanged: "desktop:imports:changed",
  saveRequest: "desktop:save:request",
  lifecycleGetSettings: "desktop:lifecycle:get-settings",
  lifecycleSetCloseBehavior: "desktop:lifecycle:set-close-behavior",
  runtimeGetInfo: "desktop:runtime:get-info",
} as const;

export type DesktopProfileSummary = {
  id: string;
  serverUrl: string;
  label: string;
};

export type DesktopConnectInput = {
  profileId?: string;
  label?: string;
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
      reason?:
        | "invalid-credentials"
        | "signed-out"
        | "no-profile"
        | "choose-profile"
        | "superseded";
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

export type DesktopProfilesSnapshot = {
  profiles: DesktopProfileSummary[];
  activeProfileId: string | null;
};

export type DesktopProfileIdInput = {
  profileId: string;
};

export type DesktopProfileRenameInput = DesktopProfileIdInput & {
  label: string;
};

export type DesktopRuntimeInfo = {
  platform: NodeJS.Platform;
  version: string;
};

export type DesktopCloseBehavior = "tray" | "quit";

export type DesktopLifecycleSettings = {
  closeBehavior: DesktopCloseBehavior;
  trayAvailable: boolean;
};

export type DesktopCloseBehaviorInput = {
  closeBehavior: DesktopCloseBehavior;
};

export type DesktopImportSource = "picker" | "open-with";

export type DesktopImportRejectionCode =
  | "unsupported-format"
  | "invalid-format"
  | "oversized"
  | "inaccessible";

export type DesktopImportFileSummary = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
};

export type DesktopImportFile = DesktopImportFileSummary & {
  bytes: Uint8Array;
};

export type DesktopImportRejection = {
  id: string;
  name: string;
  code: DesktopImportRejectionCode;
  message: string;
};

export type DesktopImportBatch = {
  id: string;
  source: DesktopImportSource;
  profileId: string | null;
  files: DesktopImportFileSummary[];
  rejected: DesktopImportRejection[];
};

export type DesktopImportDelivery = {
  files: DesktopImportFile[];
  rejected: DesktopImportRejection[];
};

export type DesktopImportsSnapshot = {
  batches: DesktopImportBatch[];
};

export type DesktopImportAssignInput = {
  batchId: string;
  profileId: string;
};

export type DesktopSaveRequest =
  | {
      kind: "document-original";
      documentId: string;
    }
  | {
      kind: "document-searchable";
      documentId: string;
    }
  | {
      kind: "archive-export";
    };

export type DesktopSaveResult =
  | { status: "saved" }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

export type DesktopBridge = {
  session: {
    restore: () => Promise<DesktopSessionState>;
    connect: (input: DesktopConnectInput) => Promise<DesktopSessionState>;
    retry: () => Promise<DesktopSessionState>;
    signOut: () => Promise<DesktopSessionState>;
  };
  profiles: {
    list: () => Promise<DesktopProfilesSnapshot>;
    activate: (input: DesktopProfileIdInput) => Promise<DesktopSessionState>;
    rename: (input: DesktopProfileRenameInput) => Promise<DesktopProfilesSnapshot>;
    remove: (input: DesktopProfileIdInput) => Promise<DesktopSessionState>;
  };
  imports: {
    pick: () => Promise<DesktopImportDelivery>;
    pending: () => Promise<DesktopImportsSnapshot>;
    assign: (input: DesktopImportAssignInput) => Promise<DesktopImportBatch>;
    consume: () => Promise<DesktopImportDelivery>;
    onChanged: (listener: () => void) => () => void;
  };
  save: {
    request: (input: DesktopSaveRequest) => Promise<DesktopSaveResult>;
  };
  lifecycle: {
    getSettings: () => Promise<DesktopLifecycleSettings>;
    setCloseBehavior: (
      input: DesktopCloseBehaviorInput,
    ) => Promise<DesktopLifecycleSettings>;
  };
  runtime: {
    getInfo: () => Promise<DesktopRuntimeInfo>;
  };
};

type Invoke = (channel: string, payload?: unknown) => Promise<unknown>;
type Subscribe = (channel: string, listener: () => void) => () => void;

export function createDesktopBridge(
  invoke: Invoke,
  subscribe: Subscribe = () => () => undefined,
): DesktopBridge {
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
    profiles: Object.freeze({
      list: () =>
        invoke(DESKTOP_CHANNELS.profilesList) as Promise<DesktopProfilesSnapshot>,
      activate: (input: DesktopProfileIdInput) =>
        invoke(DESKTOP_CHANNELS.profilesActivate, input) as Promise<DesktopSessionState>,
      rename: (input: DesktopProfileRenameInput) =>
        invoke(DESKTOP_CHANNELS.profilesRename, input) as Promise<DesktopProfilesSnapshot>,
      remove: (input: DesktopProfileIdInput) =>
        invoke(DESKTOP_CHANNELS.profilesRemove, input) as Promise<DesktopSessionState>,
    }),
    imports: Object.freeze({
      pick: () =>
        invoke(DESKTOP_CHANNELS.importsPick) as Promise<DesktopImportDelivery>,
      pending: () =>
        invoke(DESKTOP_CHANNELS.importsPending) as Promise<DesktopImportsSnapshot>,
      assign: (input: DesktopImportAssignInput) =>
        invoke(DESKTOP_CHANNELS.importsAssign, input) as Promise<DesktopImportBatch>,
      consume: () =>
        invoke(DESKTOP_CHANNELS.importsConsume) as Promise<DesktopImportDelivery>,
      onChanged: (listener: () => void) =>
        subscribe(DESKTOP_CHANNELS.importsChanged, listener),
    }),
    save: Object.freeze({
      request: (input: DesktopSaveRequest) =>
        invoke(DESKTOP_CHANNELS.saveRequest, input) as Promise<DesktopSaveResult>,
    }),
    lifecycle: Object.freeze({
      getSettings: () =>
        invoke(
          DESKTOP_CHANNELS.lifecycleGetSettings,
        ) as Promise<DesktopLifecycleSettings>,
      setCloseBehavior: (input: DesktopCloseBehaviorInput) =>
        invoke(
          DESKTOP_CHANNELS.lifecycleSetCloseBehavior,
          input,
        ) as Promise<DesktopLifecycleSettings>,
    }),
    runtime: Object.freeze({
      getInfo: () =>
        invoke(DESKTOP_CHANNELS.runtimeGetInfo) as Promise<DesktopRuntimeInfo>,
    }),
  });
}
