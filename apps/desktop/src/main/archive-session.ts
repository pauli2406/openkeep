import { CurrentUserSchema, HealthResponseSchema, type CurrentUser } from "@openkeep/types";
import type { DesktopConnectInput, DesktopProfileSummary, DesktopSessionState } from "../shared/desktop-api";
import { normalizeArchiveUrl, resolveArchiveApiUrl, type DesktopFetch } from "./connection";

const AUTH_REQUEST_TIMEOUT_MS = 12_000;
const MAX_SECRET_LENGTH = 16_384;

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

export interface ArchiveProfileRepository {
  assertSecureStorageAvailable(): Promise<void>;
  loadActive(): Promise<StoredArchiveSession | null>;
  saveActive(session: StoredArchiveSession): Promise<void>;
  clear(): Promise<void>;
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

type VerificationResult =
  | { ok: true; user: CurrentUser }
  | VerificationFailure;

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

function createArchiveHeaders(credentials: ArchiveCredentials, includeBearer: boolean) {
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

async function fetchWithTimeout(
  fetchRequest: DesktopFetch,
  input: string,
  init: RequestInit,
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchRequest(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyArchive(
  fetchRequest: DesktopFetch,
  session: StoredArchiveSession,
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

function disconnected(
  reason: "invalid-credentials" | "signed-out" | "no-profile",
  serverUrl?: string,
): DesktopSessionState {
  return { status: "disconnected", reason, ...(serverUrl ? { serverUrl } : {}) };
}

export function createArchiveSessionService(
  fetchRequest: DesktopFetch,
  repository: ArchiveProfileRepository,
  createId: () => string,
) {
  let activeSession: StoredArchiveSession | null = null;

  async function checkStoredSession(stored: StoredArchiveSession): Promise<DesktopSessionState> {
    const verification = await verifyArchive(fetchRequest, stored);
    if (verification.ok) {
      activeSession = stored;
      return {
        status: "connected",
        profile: profileSummary(stored.profile),
        user: verification.user,
      };
    }

    activeSession = null;
    if (verification.code === "invalid-credentials") {
      await repository.clear();
      return disconnected("invalid-credentials", stored.profile.serverUrl);
    }

    return {
      status: "unavailable",
      profile: profileSummary(stored.profile),
      message: verification.message,
    };
  }

  return {
    getActiveSession() {
      return activeSession;
    },

    async restore(): Promise<DesktopSessionState> {
      try {
        await repository.assertSecureStorageAvailable();
        const stored = await repository.loadActive();
        // Awaited inside the try: a rejection while clearing a rejected
        // credential must surface as the secure-storage error state, not as
        // an unhandled rejection that leaves the renderer waiting forever.
        return stored ? await checkStoredSession(stored) : disconnected("no-profile");
      } catch {
        activeSession = null;
        return {
          status: "error",
          code: "secure-storage-unavailable",
          message:
            "OpenKeep needs an unlocked operating-system credential store. On Linux, configure Secret Service or KWallet and try again.",
        };
      }
    },

    async connect(input: DesktopConnectInput): Promise<DesktopSessionState> {
      let serverUrl: string;
      let credentials: ArchiveCredentials;
      try {
        if (!input || typeof input.serverUrl !== "string" || typeof input.apiToken !== "string") {
          throw new Error("Enter a valid OpenKeep server URL and API token.");
        }
        serverUrl = normalizeArchiveUrl(input.serverUrl);
        const apiToken = input.apiToken.trim();
        const cfAccessClientId = input.cfAccessClientId?.trim() || undefined;
        const cfAccessClientSecret = input.cfAccessClientSecret?.trim() || undefined;
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

      let existingProfile: StoredArchiveSession | null;
      try {
        await repository.assertSecureStorageAvailable();
        existingProfile = await repository.loadActive();
      } catch {
        return {
          status: "error",
          code: "secure-storage-unavailable",
          message:
            "OpenKeep needs an unlocked operating-system credential store. On Linux, configure Secret Service or KWallet and try again.",
          serverUrl,
        };
      }

      const profile: ArchiveProfile = {
        // #160 exposes a single connection, but keeps the persistence schema
        // ready for #161. Reusing the stored ID replaces that one connection
        // instead of silently accumulating unreachable profiles.
        id: existingProfile?.profile.id ?? createId(),
        label: new URL(serverUrl).hostname,
        serverUrl,
        allowInsecureHttp: input.allowInsecureHttp === true,
      };
      const candidate = { profile, credentials };
      const verification = await verifyArchive(fetchRequest, candidate);
      if (!verification.ok) {
        return {
          status: "error",
          code: verification.code,
          message: verification.message,
          serverUrl,
        };
      }

      try {
        await repository.saveActive(candidate);
      } catch {
        return {
          status: "error",
          code: "secure-storage-unavailable",
          message: "OpenKeep could not save credentials in the operating-system credential store.",
          serverUrl,
        };
      }

      activeSession = candidate;
      return {
        status: "connected",
        profile: profileSummary(profile),
        user: verification.user,
      };
    },

    async retry(): Promise<DesktopSessionState> {
      try {
        await repository.assertSecureStorageAvailable();
        const stored = await repository.loadActive();
        // Awaited inside the try: a rejection while clearing a rejected
        // credential must surface as the secure-storage error state, not as
        // an unhandled rejection that leaves the renderer waiting forever.
        return stored ? await checkStoredSession(stored) : disconnected("no-profile");
      } catch {
        return {
          status: "error",
          code: "secure-storage-unavailable",
          message:
            "OpenKeep needs an unlocked operating-system credential store. On Linux, configure Secret Service or KWallet and try again.",
        };
      }
    },

    async signOut(): Promise<DesktopSessionState> {
      await repository.clear();
      activeSession = null;
      return disconnected("signed-out");
    },
  };
}

export type ArchiveSessionService = ReturnType<typeof createArchiveSessionService>;
