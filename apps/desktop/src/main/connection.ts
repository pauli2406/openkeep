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
