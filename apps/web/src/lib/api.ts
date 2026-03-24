import createApiClient from "openapi-fetch";
import type { paths } from "@openkeep/sdk";

const ACCESS_TOKEN_STORAGE_KEY = "openkeep.access-token";
const REFRESH_TOKEN_STORAGE_KEY = "openkeep.refresh-token";

function getBaseUrl() {
  if (typeof window === "undefined") {
    return "";
  }

  return window.location.origin;
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
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(key);
}

function writeStoredToken(key: string, value: string | null) {
  if (typeof window === "undefined") {
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

function ensureTokensInitialized() {
  if (!tokensInitialized) {
    tokensInitialized = true;
    accessToken = readStoredToken(ACCESS_TOKEN_STORAGE_KEY);
    refreshToken = readStoredToken(REFRESH_TOKEN_STORAGE_KEY);
  }
}

export function syncTokensFromStorage() {
  tokensInitialized = true;
  accessToken = readStoredToken(ACCESS_TOKEN_STORAGE_KEY);
  refreshToken = readStoredToken(REFRESH_TOKEN_STORAGE_KEY);
}

export function setTokens(access: string, refresh: string) {
  accessToken = access;
  refreshToken = refresh;
  writeStoredToken(ACCESS_TOKEN_STORAGE_KEY, access);
  writeStoredToken(REFRESH_TOKEN_STORAGE_KEY, refresh);
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
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

async function refreshAccessToken(): Promise<boolean> {
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
    ensureTokensInitialized();
    if (accessToken) {
      request.headers.set("Authorization", `Bearer ${accessToken}`);
    }
    return request;
  },
  async onResponse({ response, request }) {
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
        const retryRequest = new Request(request, {
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
