/**
 * Account administration: two-factor enrolment and API tokens, against the same
 * endpoints the web client's Profile page uses.
 *
 * Every call takes `authFetch`, so the session handling (bearer token, refresh,
 * Cloudflare Access headers) stays in one place.
 */
import { responseToMessage } from "../lib";

export type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>;

export type ApiToken = {
  id: string;
  name: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type CreatedApiToken = {
  id: string;
  /** The secret. The server never returns it again. */
  token: string;
  name: string;
  expiresAt: string | null;
};

export type TwoFactorSetup = {
  secret: string;
  qrDataUrl: string;
  enrollmentToken: string;
};

/** The server's own words when it has any, otherwise the caller's. */
export async function failureMessage(response: Response, fallback: string) {
  try {
    const message = await responseToMessage(response);
    return message.startsWith("Request failed with") ? fallback : message;
  } catch {
    return fallback;
  }
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function listApiTokens(authFetch: AuthFetch, fallback: string): Promise<ApiToken[]> {
  const response = await authFetch("/api/auth/tokens");
  if (!response.ok) throw new Error(await failureMessage(response, fallback));
  return (await response.json()) as ApiToken[];
}

export async function createApiToken(
  authFetch: AuthFetch,
  input: { name: string; expiresAt?: string | null },
  fallback: string,
): Promise<CreatedApiToken> {
  const body: { name: string; expiresAt?: string } = { name: input.name };
  if (input.expiresAt) body.expiresAt = input.expiresAt;
  const response = await authFetch("/api/auth/tokens", jsonPost(body));
  if (!response.ok) throw new Error(await failureMessage(response, fallback));
  return (await response.json()) as CreatedApiToken;
}

export async function deleteApiToken(authFetch: AuthFetch, id: string, fallback: string) {
  const response = await authFetch(`/api/auth/tokens/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await failureMessage(response, fallback));
}

/** A phone has no date field to hand, so a token's lifetime is a choice of presets. */
export const TOKEN_EXPIRY_PRESETS = [null, 30, 90, 365] as const;
export type TokenExpiryPreset = (typeof TOKEN_EXPIRY_PRESETS)[number];

export function expiryFromPreset(preset: TokenExpiryPreset, now = new Date()): string | null {
  if (preset === null) return null;
  const expires = new Date(now);
  expires.setDate(expires.getDate() + preset);
  return expires.toISOString();
}

export async function startTwoFactorSetup(
  authFetch: AuthFetch,
  fallback: string,
): Promise<TwoFactorSetup> {
  const response = await authFetch("/api/auth/2fa/setup", jsonPost({}));
  if (!response.ok) throw new Error(await failureMessage(response, fallback));
  return (await response.json()) as TwoFactorSetup;
}

export async function enableTwoFactor(
  authFetch: AuthFetch,
  input: { enrollmentToken: string; code: string },
  fallback: string,
): Promise<string[]> {
  const response = await authFetch("/api/auth/2fa/enable", jsonPost(input));
  if (!response.ok) throw new Error(await failureMessage(response, fallback));
  const payload = (await response.json()) as { recoveryCodes?: string[] };
  return payload.recoveryCodes ?? [];
}

export async function disableTwoFactor(
  authFetch: AuthFetch,
  input: { password: string; code: string },
  fallback: string,
) {
  const response = await authFetch("/api/auth/2fa/disable", jsonPost(input));
  if (!response.ok) throw new Error(await failureMessage(response, fallback));
}
