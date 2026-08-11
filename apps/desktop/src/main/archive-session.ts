import {
  CurrentUserSchema,
  HealthResponseSchema,
  type CurrentUser,
} from "@openkeep/types";
import type {
  DesktopConnectInput,
  DesktopProfileRenameInput,
  DesktopProfileSummary,
  DesktopProfilesSnapshot,
  DesktopSessionState,
} from "../shared/desktop-api";
import {
  normalizeArchiveUrl,
  resolveArchiveApiUrl,
  type DesktopFetch,
} from "./connection";

const AUTH_REQUEST_TIMEOUT_MS = 12_000;
const MAX_SECRET_LENGTH = 16_384;
const MAX_PROFILE_LABEL_LENGTH = 120;

export type ArchiveCredentials = {
  apiToken: string;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
};

export type ArchiveProfile = DesktopProfileSummary & {
  allowInsecureHttp: boolean;
};

export type StoredArchiveSession = {
  profile: ArchiveProfile;
  credentials: ArchiveCredentials;
};

export type ArchiveProfilesSnapshot = {
  profiles: ArchiveProfile[];
  lastActiveProfileId: string | null;
};

export interface ArchiveProfileRepository {
  assertSecureStorageAvailable(): Promise<void>;
  snapshot(): Promise<ArchiveProfilesSnapshot>;
  load(profileId: string): Promise<StoredArchiveSession | null>;
  save(session: StoredArchiveSession): Promise<void>;
  setActive(profileId: string): Promise<void>;
  rename(profileId: string, label: string): Promise<ArchiveProfile>;
  remove(profileId: string): Promise<void>;
}

type VerificationFailure = {
  ok: false;
  code:
    | "invalid-credentials"
    | "unreachable"
    | "unhealthy"
    | "invalid-response";
  message: string;
};

type VerificationResult = { ok: true; user: CurrentUser } | VerificationFailure;

type ActiveArchiveSession = StoredArchiveSession & {
  signal: AbortSignal;
};

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

export function requiresInsecureHttpConfirmation(serverUrl: string): boolean {
  const url = new URL(serverUrl);
  return url.protocol === "http:" && !isLoopbackHostname(url.hostname);
}

function createArchiveHeaders(
  credentials: ArchiveCredentials,
  includeBearer: boolean,
) {
  const headers = new Headers();
  if (includeBearer) {
    headers.set("authorization", `Bearer ${credentials.apiToken}`);
  }
  if (credentials.cfAccessClientId && credentials.cfAccessClientSecret) {
    headers.set("cf-access-client-id", credentials.cfAccessClientId);
    headers.set("cf-access-client-secret", credentials.cfAccessClientSecret);
  }
  return headers;
}

function combineAbortSignals(first: AbortSignal, second: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (first.aborted || second.aborted) {
    controller.abort();
  } else {
    first.addEventListener("abort", abort, { once: true });
    second.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup() {
      first.removeEventListener("abort", abort);
      second.removeEventListener("abort", abort);
    },
  };
}

async function fetchWithTimeout(
  fetchRequest: DesktopFetch,
  input: string,
  init: RequestInit,
  operationSignal: AbortSignal,
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS,
) {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
  const combined = combineAbortSignals(operationSignal, timeoutController.signal);
  try {
    return await fetchRequest(input, { ...init, signal: combined.signal });
  } finally {
    clearTimeout(timeout);
    combined.cleanup();
  }
}

async function verifyArchive(
  fetchRequest: DesktopFetch,
  session: StoredArchiveSession,
  operationSignal: AbortSignal,
): Promise<VerificationResult> {
  let healthResponse: Response;
  try {
    healthResponse = await fetchWithTimeout(
      fetchRequest,
      resolveArchiveApiUrl(session.profile.serverUrl, "/api/health"),
      {
        method: "GET",
        headers: createArchiveHeaders(session.credentials, false),
        redirect: "manual",
      },
      operationSignal,
    );
  } catch {
    return {
      ok: false,
      code: "unreachable",
      message: "Could not reach the OpenKeep server. Check the address and try again.",
    };
  }

  if (!healthResponse.ok) {
    return {
      ok: false,
      code: "unhealthy",
      message: `The server health check returned ${healthResponse.status}.`,
    };
  }

  try {
    const health = HealthResponseSchema.safeParse(await healthResponse.json());
    if (!health.success || health.data.status !== "ok") {
      return {
        ok: false,
        code: "invalid-response",
        message: "The server does not appear to be a compatible OpenKeep archive.",
      };
    }
  } catch {
    return {
      ok: false,
      code: "invalid-response",
      message: "The server returned an invalid health response.",
    };
  }

  let meResponse: Response;
  try {
    meResponse = await fetchWithTimeout(
      fetchRequest,
      resolveArchiveApiUrl(session.profile.serverUrl, "/api/auth/me"),
      {
        method: "GET",
        headers: createArchiveHeaders(session.credentials, true),
        redirect: "manual",
      },
      operationSignal,
    );
  } catch {
    return {
      ok: false,
      code: "unreachable",
      message: "The archive could not verify the session. Check the connection and retry.",
    };
  }

  if (meResponse.status === 401 || meResponse.status === 403) {
    return {
      ok: false,
      code: "invalid-credentials",
      message: "The API token or Cloudflare Access credentials were not accepted.",
    };
  }
  if (!meResponse.ok) {
    return {
      ok: false,
      code: "unhealthy",
      message: `The archive session check returned ${meResponse.status}.`,
    };
  }

  try {
    const user = CurrentUserSchema.safeParse(await meResponse.json());
    return user.success
      ? { ok: true, user: user.data }
      : {
          ok: false,
          code: "invalid-response",
          message: "The archive returned an invalid current-user response.",
        };
  } catch {
    return {
      ok: false,
      code: "invalid-response",
      message: "The archive returned an invalid current-user response.",
    };
  }
}

function profileSummary(profile: ArchiveProfile): DesktopProfileSummary {
  return { id: profile.id, label: profile.label, serverUrl: profile.serverUrl };
}

function publicSnapshot(snapshot: ArchiveProfilesSnapshot): DesktopProfilesSnapshot {
  return {
    activeProfileId: snapshot.lastActiveProfileId,
    profiles: snapshot.profiles.map(profileSummary),
  };
}

function disconnected(
  reason:
    | "invalid-credentials"
    | "signed-out"
    | "no-profile"
    | "choose-profile"
    | "superseded",
  serverUrl?: string,
): DesktopSessionState {
  return { status: "disconnected", reason, ...(serverUrl ? { serverUrl } : {}) };
}

function secureStorageError(serverUrl?: string): DesktopSessionState {
  return {
    status: "error",
    code: "secure-storage-unavailable",
    message:
      "OpenKeep needs an unlocked operating-system credential store. On Linux, configure Secret Service or KWallet and try again.",
    ...(serverUrl ? { serverUrl } : {}),
  };
}

export function createArchiveSessionService(
  fetchRequest: DesktopFetch,
  repository: ArchiveProfileRepository,
  createId: () => string,
) {
  let activeSession: StoredArchiveSession | null = null;
  let activeUser: CurrentUser | null = null;
  let activeController: AbortController | null = null;
  let verificationController: AbortController | null = null;
  let verificationGeneration = 0;

  function beginVerification() {
    verificationController?.abort();
    verificationController = new AbortController();
    verificationGeneration += 1;
    return {
      controller: verificationController,
      generation: verificationGeneration,
    };
  }

  function isCurrent(generation: number) {
    return generation === verificationGeneration;
  }

  function connectedState(): DesktopSessionState {
    if (!activeSession || !activeUser) {
      return disconnected("choose-profile");
    }
    return {
      status: "connected",
      profile: profileSummary(activeSession.profile),
      user: activeUser,
    };
  }

  function activateInMemory(
    stored: StoredArchiveSession,
    user: CurrentUser,
    controller: AbortController,
  ) {
    activeController?.abort();
    activeSession = stored;
    activeUser = user;
    activeController = controller;
  }

  function deactivateInMemory() {
    activeController?.abort();
    activeController = null;
    activeSession = null;
    activeUser = null;
  }

  async function verifyAndActivate(
    stored: StoredArchiveSession,
    options: { removeRejectedProfile: boolean },
  ): Promise<DesktopSessionState> {
    const operation = beginVerification();
    const verification = await verifyArchive(
      fetchRequest,
      stored,
      operation.controller.signal,
    );
    if (!isCurrent(operation.generation)) {
      return disconnected("superseded");
    }
    if (verification.ok) {
      await repository.setActive(stored.profile.id);
      if (!isCurrent(operation.generation)) {
        return disconnected("superseded");
      }
      activateInMemory(stored, verification.user, operation.controller);
      return connectedState();
    }

    operation.controller.abort();
    if (verification.code === "invalid-credentials") {
      if (options.removeRejectedProfile) {
        await repository.remove(stored.profile.id);
      }
      if (activeSession?.profile.id === stored.profile.id) {
        deactivateInMemory();
      }
      return disconnected("invalid-credentials", stored.profile.serverUrl);
    }

    return {
      status: "unavailable",
      profile: profileSummary(stored.profile),
      message: verification.message,
    };
  }

  return {
    getActiveSession(): ActiveArchiveSession | null {
      if (!activeSession || !activeController) {
        return null;
      }
      return { ...activeSession, signal: activeController.signal };
    },

    async listProfiles(): Promise<DesktopProfilesSnapshot> {
      try {
        await repository.assertSecureStorageAvailable();
        return publicSnapshot(await repository.snapshot());
      } catch {
        return { profiles: [], activeProfileId: null };
      }
    },

    async restore(): Promise<DesktopSessionState> {
      if (activeSession && activeUser) {
        return connectedState();
      }
      try {
        await repository.assertSecureStorageAvailable();
        const snapshot = await repository.snapshot();
        if (snapshot.profiles.length === 0) {
          return disconnected("no-profile");
        }

        const targetId =
          snapshot.profiles.length === 1
            ? snapshot.profiles[0]!.id
            : snapshot.lastActiveProfileId;
        if (!targetId) {
          return disconnected("choose-profile");
        }
        const stored = await repository.load(targetId);
        // Awaited inside the try: a rejection while removing a rejected
        // credential must surface as the secure-storage error state, not as
        // an unhandled rejection that leaves the renderer waiting forever.
        return stored
          ? await verifyAndActivate(stored, { removeRejectedProfile: true })
          : disconnected("choose-profile");
      } catch {
        deactivateInMemory();
        return secureStorageError();
      }
    },

    async connect(input: DesktopConnectInput): Promise<DesktopSessionState> {
      let serverUrl: string;
      let credentials: ArchiveCredentials;
      let label: string;
      try {
        if (
          !input ||
          typeof input.serverUrl !== "string" ||
          typeof input.apiToken !== "string" ||
          (input.profileId !== undefined && typeof input.profileId !== "string") ||
          (input.label !== undefined && typeof input.label !== "string")
        ) {
          throw new Error("Enter valid archive connection details.");
        }
        serverUrl = normalizeArchiveUrl(input.serverUrl);
        const apiToken = input.apiToken.trim();
        const cfAccessClientId = input.cfAccessClientId?.trim() || undefined;
        const cfAccessClientSecret = input.cfAccessClientSecret?.trim() || undefined;
        label = input.label?.trim() || new URL(serverUrl).hostname;
        if (!label || label.length > MAX_PROFILE_LABEL_LENGTH) {
          throw new Error("Enter a profile name with at most 120 characters.");
        }
        if (!apiToken || apiToken.length > MAX_SECRET_LENGTH) {
          throw new Error("Enter a valid OpenKeep API token.");
        }
        if (Boolean(cfAccessClientId) !== Boolean(cfAccessClientSecret)) {
          throw new Error("Cloudflare Access client ID and secret must be provided together.");
        }
        if (
          (cfAccessClientId?.length ?? 0) > MAX_SECRET_LENGTH ||
          (cfAccessClientSecret?.length ?? 0) > MAX_SECRET_LENGTH
        ) {
          throw new Error("Enter valid Cloudflare Access credentials.");
        }
        if (
          requiresInsecureHttpConfirmation(serverUrl) &&
          input.allowInsecureHttp !== true
        ) {
          return {
            status: "error",
            code: "insecure-http-confirmation-required",
            message:
              "This remote server uses plaintext HTTP. The API token could be read in transit. Confirm only if you trust this network.",
            serverUrl,
          };
        }
        credentials = { apiToken, cfAccessClientId, cfAccessClientSecret };
      } catch (error) {
        return {
          status: "error",
          code: "invalid-url",
          message: error instanceof Error ? error.message : "Enter valid connection details.",
        };
      }

      try {
        await repository.assertSecureStorageAvailable();
      } catch {
        return secureStorageError(serverUrl);
      }

      let existing: StoredArchiveSession | null = null;
      if (input.profileId) {
        try {
          existing = await repository.load(input.profileId);
        } catch {
          return secureStorageError(serverUrl);
        }
        if (!existing) {
          return {
            status: "error",
            code: "invalid-url",
            message: "The archive profile no longer exists.",
            serverUrl,
          };
        }
      }

      const profile: ArchiveProfile = {
        id: existing?.profile.id ?? createId(),
        label,
        serverUrl,
        allowInsecureHttp: input.allowInsecureHttp === true,
      };
      const candidate = { profile, credentials };
      const operation = beginVerification();
      const verification = await verifyArchive(
        fetchRequest,
        candidate,
        operation.controller.signal,
      );
      if (!isCurrent(operation.generation)) {
        return disconnected("superseded");
      }
      if (!verification.ok) {
        operation.controller.abort();
        return {
          status: "error",
          code: verification.code,
          message: verification.message,
          serverUrl,
        };
      }

      try {
        await repository.save(candidate);
      } catch {
        operation.controller.abort();
        return {
          status: "error",
          code: "secure-storage-unavailable",
          message: "OpenKeep could not save credentials in the operating-system credential store.",
          serverUrl,
        };
      }
      if (!isCurrent(operation.generation)) {
        return disconnected("superseded");
      }

      activateInMemory(candidate, verification.user, operation.controller);
      return connectedState();
    },

    async retry(): Promise<DesktopSessionState> {
      deactivateInMemory();
      return this.restore();
    },

    async activate(profileId: string): Promise<DesktopSessionState> {
      if (typeof profileId !== "string" || !profileId) {
        return {
          status: "error",
          code: "invalid-url",
          message: "Choose a valid archive profile.",
        };
      }
      if (activeSession?.profile.id === profileId && activeUser) {
        return connectedState();
      }
      try {
        await repository.assertSecureStorageAvailable();
        const stored = await repository.load(profileId);
        // Awaited for the same reason as restore: a failure inside activation
        // must resolve to an error state rather than reject the IPC call.
        return stored
          ? await verifyAndActivate(stored, { removeRejectedProfile: true })
          : {
              status: "error",
              code: "invalid-url",
              message: "The archive profile no longer exists.",
            };
      } catch {
        return secureStorageError();
      }
    },

    async renameProfile(input: DesktopProfileRenameInput): Promise<DesktopProfilesSnapshot> {
      try {
        const label = input?.label?.trim();
        if (!input?.profileId || !label || label.length > MAX_PROFILE_LABEL_LENGTH) {
          return this.listProfiles();
        }
        await repository.assertSecureStorageAvailable();
        const profile = await repository.rename(input.profileId, label);
        if (activeSession?.profile.id === profile.id) {
          activeSession = { ...activeSession, profile };
        }
        return publicSnapshot(await repository.snapshot());
      } catch {
        return this.listProfiles();
      }
    },

    async removeProfile(profileId: string): Promise<DesktopSessionState> {
      if (typeof profileId !== "string" || !profileId) {
        return {
          status: "error",
          code: "invalid-url",
          message: "Choose a valid archive profile.",
        };
      }
      try {
        await repository.assertSecureStorageAvailable();
        const removedActive = activeSession?.profile.id === profileId;
        await repository.remove(profileId);
        if (!removedActive) {
          return connectedState();
        }
        deactivateInMemory();
        const snapshot = await repository.snapshot();
        if (snapshot.profiles.length === 1) {
          return this.activate(snapshot.profiles[0]!.id);
        }
        return disconnected(
          snapshot.profiles.length === 0 ? "no-profile" : "choose-profile",
        );
      } catch {
        return secureStorageError();
      }
    },

    async signOut(): Promise<DesktopSessionState> {
      const profileId = activeSession?.profile.id;
      verificationController?.abort();
      verificationGeneration += 1;
      try {
        if (profileId) {
          await repository.remove(profileId);
        }
      } catch {
        return secureStorageError();
      }
      deactivateInMemory();
      return disconnected("signed-out");
    },
  };
}

export type ArchiveSessionService = ReturnType<typeof createArchiveSessionService>;
