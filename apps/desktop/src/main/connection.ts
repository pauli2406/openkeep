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

/**
 * Headers for an authenticated main-process request to the active archive.
 * Cloudflare Access service credentials travel with the bearer token because a
 * protected archive rejects the request without both.
 */
export function createArchiveRequestHeaders(credentials: {
  apiToken: string;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
}): Headers {
  const headers = new Headers({
    authorization: `Bearer ${credentials.apiToken}`,
  });
  if (credentials.cfAccessClientId && credentials.cfAccessClientSecret) {
    headers.set("cf-access-client-id", credentials.cfAccessClientId);
    headers.set("cf-access-client-secret", credentials.cfAccessClientSecret);
  }
  return headers;
}

export function resolveArchiveApiUrl(serverUrl: string, apiPath: string): string {
  const normalized = normalizeArchiveUrl(serverUrl);
  const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  return `${normalized}${path}`;
}
