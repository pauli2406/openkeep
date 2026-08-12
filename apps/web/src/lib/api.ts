import createApiClient from "openapi-fetch";
import type { paths } from "@openkeep/sdk";

const ACCESS_TOKEN_STORAGE_KEY = "openkeep.access-token";
const REFRESH_TOKEN_STORAGE_KEY = "openkeep.refresh-token";

export type ApiAuthMode = "browser" | "main-owned";
export type ApiFailure = "unauthorized" | "unavailable";

const DESKTOP_ERROR_HEADER = "x-openkeep-desktop-error";

function getBaseUrl() {
  if (typeof window === "undefined") {
    return "";
  }

  return new URL("/", window.location.href).toString();
}

function toApiUrl(input: string) {
  if (/^https?:\/\//.test(input)) {
    return input;
  }

  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    return input;
  }

  return new URL(input, baseUrl).toString();
}

function fetchWithCurrentGlobal(input: RequestInfo | URL, init?: RequestInit) {
  return globalThis.fetch(input, init);
}

function readStoredToken(key: string): string | null {
  if (apiAuthMode === "main-owned" || typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(key);
}

function writeStoredToken(key: string, value: string | null) {
  if (apiAuthMode === "main-owned" || typeof window === "undefined") {
    return;
  }

  if (value === null) {
    window.localStorage.removeItem(key);
  } else {
    window.localStorage.setItem(key, value);
  }
}

let accessToken: string | null = null;
let refreshToken: string | null = null;
let tokensInitialized = false;
let onAuthFailure: (() => void) | null = null;
let apiAuthMode: ApiAuthMode = "browser";
let apiFailureHandler: ((failure: ApiFailure) => void) | null = null;
const retryableRequests = new WeakMap<Request, Request>();

/**
 * Selects who owns authentication for API requests made by the shared UI.
 *
 * Browser mode keeps the existing local JWT and refresh-token flow. In
 * main-owned mode the host transport is responsible for authentication, so
 * renderer code neither accesses token storage nor retries 401 responses.
 */
export function configureApiAuthMode(mode: ApiAuthMode) {
  if (mode === apiAuthMode) {
    return;
  }

  apiAuthMode = mode;
  accessToken = null;
  refreshToken = null;
  tokensInitialized = mode === "main-owned";
}

/**
 * Lets a native host leave the shared shell when its authenticated transport
 * is no longer usable. Browser auth remains unchanged and owns its refresh
 * flow independently.
 */
export function setApiFailureHandler(
  handler: ((failure: ApiFailure) => void) | null,
) {
  apiFailureHandler = handler;
}

function reportMainOwnedFailure(response: Response) {
  if (apiAuthMode !== "main-owned") return;
  if (response.status === 401) {
    apiFailureHandler?.("unauthorized");
  } else if (
    response.headers.get(DESKTOP_ERROR_HEADER) === "archive-unavailable"
  ) {
    apiFailureHandler?.("unavailable");
  }
}

function ensureTokensInitialized() {
  if (apiAuthMode === "main-owned") {
    accessToken = null;
    refreshToken = null;
    tokensInitialized = true;
    return;
  }

  if (!tokensInitialized) {
    tokensInitialized = true;
    accessToken = readStoredToken(ACCESS_TOKEN_STORAGE_KEY);
    refreshToken = readStoredToken(REFRESH_TOKEN_STORAGE_KEY);
  }
}

export function syncTokensFromStorage() {
  if (apiAuthMode === "main-owned") {
    accessToken = null;
    refreshToken = null;
    tokensInitialized = true;
    return;
  }

  tokensInitialized = true;
  accessToken = readStoredToken(ACCESS_TOKEN_STORAGE_KEY);
  refreshToken = readStoredToken(REFRESH_TOKEN_STORAGE_KEY);
}

export function setTokens(access: string, refresh: string) {
  if (apiAuthMode === "main-owned") {
    accessToken = null;
    refreshToken = null;
    tokensInitialized = true;
    return;
  }

  accessToken = access;
  refreshToken = refresh;
  writeStoredToken(ACCESS_TOKEN_STORAGE_KEY, access);
  writeStoredToken(REFRESH_TOKEN_STORAGE_KEY, refresh);
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  if (apiAuthMode === "main-owned") {
    tokensInitialized = true;
    return;
  }

  writeStoredToken(ACCESS_TOKEN_STORAGE_KEY, null);
  writeStoredToken(REFRESH_TOKEN_STORAGE_KEY, null);
}

export function getAccessToken() {
  ensureTokensInitialized();
  return accessToken;
}

export function getRefreshToken() {
  ensureTokensInitialized();
  return refreshToken;
}

export function setOnAuthFailure(handler: () => void) {
  onAuthFailure = handler;
}

export function hasTokens() {
  ensureTokensInitialized();
  return accessToken !== null && refreshToken !== null;
}

export function getApiErrorMessage(error: unknown, fallback: string) {
  if (!error || typeof error !== "object") {
    return fallback;
  }

  const message = (error as { message?: unknown }).message;
  if (typeof message === "string" && message.trim().length > 0) {
    return message;
  }
  if (
    Array.isArray(message) &&
    message.every((item) => typeof item === "string")
  ) {
    const joined = message.join(", ").trim();
    return joined.length > 0 ? joined : fallback;
  }

  return fallback;
}

/**
 * Reads a server error without exposing request headers or credentials. This
 * is used by the few auth flows that use raw fetch instead of the generated
 * client, so native and browser hosts present the same authorization detail.
 */
export async function readApiErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    return getApiErrorMessage(await response.clone().json(), fallback);
  } catch {
    return fallback;
  }
}

// The API rotates refresh tokens and treats reuse as theft. Concurrent 401s
// (e.g. parallel uploads with an expired access token) must therefore share ONE
// refresh attempt — independent refreshes with the same token would revoke every
// session and log the user out mid-batch.
let refreshInFlight: Promise<boolean> | null = null;

function refreshAccessToken(): Promise<boolean> {
  if (apiAuthMode === "main-owned") {
    return Promise.resolve(false);
  }

  if (!refreshInFlight) {
    refreshInFlight = doRefreshAccessToken().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefreshAccessToken(): Promise<boolean> {
  if (apiAuthMode === "main-owned") {
    return false;
  }

  ensureTokensInitialized();
  if (!refreshToken) {
    return false;
  }

  const refreshResponse = await fetchWithCurrentGlobal(toApiUrl("/api/auth/refresh"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });

  if (!refreshResponse.ok) {
    clearTokens();
    onAuthFailure?.();
    return false;
  }

  const tokens = (await refreshResponse.json()) as {
    accessToken: string;
    refreshToken: string;
  };
  setTokens(tokens.accessToken, tokens.refreshToken);
  return true;
}

export async function authFetch(input: string, init?: RequestInit): Promise<Response> {
  if (apiAuthMode === "main-owned") {
    const response = await fetchWithCurrentGlobal(toApiUrl(input), init);
    reportMainOwnedFailure(response);
    return response;
  }

  ensureTokensInitialized();
  const headers = new Headers(init?.headers);
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const url = toApiUrl(input);

  let response = await fetchWithCurrentGlobal(url, {
    ...init,
    headers,
  });

  if (response.status === 401 && (await refreshAccessToken())) {
    const retryHeaders = new Headers(init?.headers);
    if (accessToken) {
      retryHeaders.set("Authorization", `Bearer ${accessToken}`);
    }

    response = await fetchWithCurrentGlobal(url, {
      ...init,
      headers: retryHeaders,
    });
  }

  return response;
}

const client = createApiClient<paths>({
  baseUrl: getBaseUrl(),
  fetch: fetchWithCurrentGlobal,
});

// Add auth middleware
client.use({
  async onRequest({ request }) {
    if (apiAuthMode === "main-owned") {
      return request;
    }

    ensureTokensInitialized();
    if (accessToken) {
      request.headers.set("Authorization", `Bearer ${accessToken}`);
    }
    retryableRequests.set(request, request.clone());
    return request;
  },
  async onResponse({ response, request }) {
    if (apiAuthMode === "main-owned") {
      reportMainOwnedFailure(response);
      return response;
    }

    // If we get a 401 and have a refresh token, try to refresh
    const isRefreshableAuthRequest =
      request.url.includes("/api/auth/me") || request.url.includes("/api/auth/tokens");
    const isBlockedAuthRequest =
      request.url.includes("/api/auth/login") ||
      request.url.includes("/api/auth/setup") ||
      request.url.includes("/api/auth/refresh");

    if (
      response.status === 401 &&
      refreshToken &&
      (!request.url.includes("/api/auth/") || isRefreshableAuthRequest) &&
      !isBlockedAuthRequest
    ) {
      if (await refreshAccessToken()) {

        // Retry the original request with new token
        const retryRequest = new Request(retryableRequests.get(request) ?? request, {
          headers: new Headers(request.headers),
        });
        retryRequest.headers.set("Authorization", `Bearer ${accessToken}`);
        return fetchWithCurrentGlobal(retryRequest);
      }
    }
    return response;
  },
});

export const api = client;
