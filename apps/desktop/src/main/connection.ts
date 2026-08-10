import { HealthResponseSchema } from "@openkeep/types";
import type {
  ConnectionCheckInput,
  ConnectionCheckResult,
} from "../shared/desktop-api";

const CONNECTION_TIMEOUT_MS = 12_000;
const MAX_SERVER_URL_LENGTH = 2_048;

export type DesktopFetch = (
  input: string | Request,
  init?: RequestInit,
) => Promise<Response>;

export function normalizeArchiveUrl(input: string): string {
  const value = input.trim();
  if (!value || value.length > MAX_SERVER_URL_LENGTH) {
    throw new Error("Enter a valid OpenKeep server URL.");
  }

  if (value.includes("://") && !/^https?:\/\//i.test(value)) {
    throw new Error("Use an HTTP or HTTPS server URL without credentials, query, or fragment.");
  }

  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new Error("Enter a valid OpenKeep server URL.");
  }

  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Use an HTTP or HTTPS server URL without credentials, query, or fragment.");
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

export function resolveArchiveApiUrl(serverUrl: string, apiPath: string): string {
  const normalized = normalizeArchiveUrl(serverUrl);
  const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  return `${normalized}${path}`;
}

export function createConnectionService(fetchRequest: DesktopFetch) {
  let activeArchiveUrl: string | null = null;

  return {
    getActiveArchiveUrl() {
      return activeArchiveUrl;
    },

    async checkHealth(input: ConnectionCheckInput): Promise<ConnectionCheckResult> {
      let serverUrl: string;
      try {
        if (!input || typeof input.serverUrl !== "string") {
          throw new Error("Enter a valid OpenKeep server URL.");
        }
        serverUrl = normalizeArchiveUrl(input.serverUrl);
      } catch (error) {
        return {
          ok: false,
          code: "invalid-url",
          message: error instanceof Error ? error.message : "Enter a valid OpenKeep server URL.",
        };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);
      try {
        const response = await fetchRequest(resolveArchiveApiUrl(serverUrl, "/api/health"), {
          method: "GET",
          signal: controller.signal,
        });
        if (!response.ok) {
          return {
            ok: false,
            code: "unhealthy",
            message: `The server health check returned ${response.status}.`,
          };
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          return {
            ok: false,
            code: "invalid-response",
            message: "The server returned an invalid health response.",
          };
        }

        const health = HealthResponseSchema.safeParse(payload);
        if (!health.success || health.data.status !== "ok") {
          return {
            ok: false,
            code: "invalid-response",
            message: "The server does not appear to be a compatible OpenKeep archive.",
          };
        }

        activeArchiveUrl = serverUrl;
        return {
          ok: true,
          serverUrl,
          serverStatus: health.data.status,
        };
      } catch {
        return {
          ok: false,
          code: "unreachable",
          message: "Could not reach the OpenKeep server. Check the address and try again.",
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export type ConnectionService = ReturnType<typeof createConnectionService>;
