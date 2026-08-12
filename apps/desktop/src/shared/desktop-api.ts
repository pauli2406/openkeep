import type { CurrentUser } from "@openkeep/types";

export const DESKTOP_CHANNELS = {
  sessionRestore: "desktop:session:restore",
  sessionConnect: "desktop:session:connect",
  sessionRetry: "desktop:session:retry",
  sessionSignOut: "desktop:session:sign-out",
  sessionOpenOffline: "desktop:session:open-offline",
  sessionOfflineAvailability: "desktop:session:offline-availability",
  sessionClearOfflineCopy: "desktop:session:clear-offline-copy",
  profilesList: "desktop:profiles:list",
  profilesActivate: "desktop:profiles:activate",
  profilesRename: "desktop:profiles:rename",
  profilesRemove: "desktop:profiles:remove",
  importsPick: "desktop:imports:pick",
  importsReportCreated: "desktop:imports:report-created",
  importsPending: "desktop:imports:pending",
  importsAssign: "desktop:imports:assign",
  importsConsume: "desktop:imports:consume",
  importsChanged: "desktop:imports:changed",
  saveRequest: "desktop:save:request",
  watchFoldersList: "desktop:watch-folders:list",
  watchFoldersAdd: "desktop:watch-folders:add",
  watchFoldersSetPaused: "desktop:watch-folders:set-paused",
  watchFoldersRemove: "desktop:watch-folders:remove",
  watchFoldersChanged: "desktop:watch-folders:changed",
  notificationsGetSettings: "desktop:notifications:get-settings",
  notificationsSetPreference: "desktop:notifications:set-preference",
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
      status: "offline";
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

/**
 * Which profiles have a usable offline copy: cached documents plus a cached
 * identity. Counts only — never paths or document titles.
 */
export type DesktopOfflineAvailability = {
  profiles: Record<
    string,
    {
      documentCount: number;
      fileStorageBytes: number;
      lastCachedAt: number | null;
    }
  >;
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

/**
 * Which desktop entry point produced an import. Watch folders upload from main;
 * the other two are uploaded by the renderer and reported back to main so every
 * source shares one outcome tracker.
 */
export type DesktopImportSource = "picker" | "open-with" | "watch-folder";

export type DesktopNotificationKind = "completed" | "failed" | "review";

export type DesktopNotificationPreferences = Record<
  DesktopNotificationKind,
  boolean
>;

export type DesktopNotificationSettings = {
  preferences: DesktopNotificationPreferences;
  /** False when the operating system offers no usable notification service. */
  supported: boolean;
};

export type DesktopNotificationPreferenceInput = {
  kind: DesktopNotificationKind;
  enabled: boolean;
};

/** Documents the renderer just created, so main can follow their processing. */
export type DesktopCreatedDocumentsInput = {
  documents: Array<{ documentId: string; name: string }>;
};

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

/**
 * A workstation-local watch folder, not the archive's server-side watch folder.
 * `waiting` means the owning archive is not connected, so nothing is scanned.
 */
export type DesktopWatchFolderState =
  | "watching"
  | "paused"
  | "waiting"
  | "missing"
  | "unreadable";

export type DesktopWatchFolderOutcome =
  | "imported"
  | "duplicate"
  | "retrying"
  | "failed"
  | "unsupported";

export type DesktopWatchFolderEvent = {
  id: string;
  name: string;
  outcome: DesktopWatchFolderOutcome;
  message?: string;
  at: number;
};

export type DesktopWatchFolderCounts = {
  imported: number;
  duplicate: number;
  failed: number;
};

export type DesktopWatchFolder = {
  id: string;
  path: string;
  label: string;
  state: DesktopWatchFolderState;
  message?: string;
  counts: DesktopWatchFolderCounts;
  history: DesktopWatchFolderEvent[];
};

export type DesktopWatchFoldersSnapshot = {
  profileId: string | null;
  folders: DesktopWatchFolder[];
};

export type DesktopWatchFolderIdInput = {
  folderId: string;
};

export type DesktopWatchFolderPauseInput = DesktopWatchFolderIdInput & {
  paused: boolean;
};

export type DesktopWatchFolderAddResult =
  | { status: "added"; snapshot: DesktopWatchFoldersSnapshot }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

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
    openOffline: (input: DesktopProfileIdInput) => Promise<DesktopSessionState>;
    offlineAvailability: () => Promise<DesktopOfflineAvailability>;
    clearOfflineCopy: (
      input: DesktopProfileIdInput,
    ) => Promise<DesktopOfflineAvailability>;
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
    reportCreated: (input: DesktopCreatedDocumentsInput) => Promise<void>;
    onChanged: (listener: () => void) => () => void;
  };
  save: {
    request: (input: DesktopSaveRequest) => Promise<DesktopSaveResult>;
  };
  watchFolders: {
    list: () => Promise<DesktopWatchFoldersSnapshot>;
    add: () => Promise<DesktopWatchFolderAddResult>;
    setPaused: (
      input: DesktopWatchFolderPauseInput,
    ) => Promise<DesktopWatchFoldersSnapshot>;
    remove: (
      input: DesktopWatchFolderIdInput,
    ) => Promise<DesktopWatchFoldersSnapshot>;
    onChanged: (listener: () => void) => () => void;
  };
  notifications: {
    getSettings: () => Promise<DesktopNotificationSettings>;
    setPreference: (
      input: DesktopNotificationPreferenceInput,
    ) => Promise<DesktopNotificationSettings>;
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
      openOffline: (input: DesktopProfileIdInput) =>
        invoke(
          DESKTOP_CHANNELS.sessionOpenOffline,
          input,
        ) as Promise<DesktopSessionState>,
      offlineAvailability: () =>
        invoke(
          DESKTOP_CHANNELS.sessionOfflineAvailability,
        ) as Promise<DesktopOfflineAvailability>,
      clearOfflineCopy: (input: DesktopProfileIdInput) =>
        invoke(
          DESKTOP_CHANNELS.sessionClearOfflineCopy,
          input,
        ) as Promise<DesktopOfflineAvailability>,
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
      reportCreated: (input: DesktopCreatedDocumentsInput) =>
        invoke(DESKTOP_CHANNELS.importsReportCreated, input) as Promise<void>,
      onChanged: (listener: () => void) =>
        subscribe(DESKTOP_CHANNELS.importsChanged, listener),
    }),
    save: Object.freeze({
      request: (input: DesktopSaveRequest) =>
        invoke(DESKTOP_CHANNELS.saveRequest, input) as Promise<DesktopSaveResult>,
    }),
    watchFolders: Object.freeze({
      list: () =>
        invoke(
          DESKTOP_CHANNELS.watchFoldersList,
        ) as Promise<DesktopWatchFoldersSnapshot>,
      add: () =>
        invoke(
          DESKTOP_CHANNELS.watchFoldersAdd,
        ) as Promise<DesktopWatchFolderAddResult>,
      setPaused: (input: DesktopWatchFolderPauseInput) =>
        invoke(
          DESKTOP_CHANNELS.watchFoldersSetPaused,
          input,
        ) as Promise<DesktopWatchFoldersSnapshot>,
      remove: (input: DesktopWatchFolderIdInput) =>
        invoke(
          DESKTOP_CHANNELS.watchFoldersRemove,
          input,
        ) as Promise<DesktopWatchFoldersSnapshot>,
      onChanged: (listener: () => void) =>
        subscribe(DESKTOP_CHANNELS.watchFoldersChanged, listener),
    }),
    notifications: Object.freeze({
      getSettings: () =>
        invoke(
          DESKTOP_CHANNELS.notificationsGetSettings,
        ) as Promise<DesktopNotificationSettings>,
      setPreference: (input: DesktopNotificationPreferenceInput) =>
        invoke(
          DESKTOP_CHANNELS.notificationsSetPreference,
          input,
        ) as Promise<DesktopNotificationSettings>,
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
