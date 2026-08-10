import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ArchiveSessionService } from "./archive-session";
import { resolveArchiveApiUrl, type DesktopFetch } from "./connection";
import { APP_HOST, isApplicationRoute } from "./security";

type ProtocolHandlerOptions = {
  rendererRoot: string;
  rendererDevServerUrl?: string;
  archiveSession: Pick<ArchiveSessionService, "getActiveSession">;
  fetchRequest: DesktopFetch;
  fileExists: (filePath: string) => boolean;
};

type AssetResolution =
  | { ok: true; filePath: string }
  | { ok: false; status: 400 | 404 };

const PRODUCTION_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' blob: data:",
  "connect-src 'self'",
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

function textResponse(status: number, message: string) {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export function resolveRendererAsset(
  rendererRoot: string,
  requestUrl: string,
  fileExists: (filePath: string) => boolean,
): AssetResolution {
  const rawUrl = requestUrl.toLowerCase();
  if (
    rawUrl.includes("%00") ||
    rawUrl.includes("%2e") ||
    rawUrl.includes("%2f") ||
    rawUrl.includes("%5c") ||
    rawUrl.includes("%25")
  ) {
    return { ok: false, status: 400 };
  }

  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return { ok: false, status: 400 };
  }

  if (
    url.host !== APP_HOST ||
    url.username ||
    url.password ||
    url.pathname.includes("\0")
  ) {
    return { ok: false, status: 400 };
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return { ok: false, status: 400 };
  }

  if (decodedPath.includes("\0") || decodedPath.includes("\\")) {
    return { ok: false, status: 400 };
  }

  const relativePath = decodedPath.replace(/^\/+/, "") || "index.html";
  const candidate = path.resolve(rendererRoot, relativePath);
  const relativeToRoot = path.relative(rendererRoot, candidate);
  const escapesRoot =
    relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot);
  if (escapesRoot) {
    return { ok: false, status: 400 };
  }

  if (fileExists(candidate)) {
    return { ok: true, filePath: candidate };
  }

  if (!path.extname(relativePath) && isApplicationRoute(decodedPath)) {
    const indexPath = path.join(rendererRoot, "index.html");
    return fileExists(indexPath)
      ? { ok: true, filePath: indexPath }
      : { ok: false, status: 404 };
  }

  return { ok: false, status: 404 };
}

function withProductionCsp(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", PRODUCTION_CSP);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function createForwardHeaders(headers: Headers): Headers {
  const forwarded = new Headers(headers);
  for (const name of [
    "host",
    "origin",
    "referer",
    "content-length",
    "cookie",
    "authorization",
    "cf-access-client-id",
    "cf-access-client-secret",
  ]) {
    forwarded.delete(name);
  }
  return forwarded;
}

export function createAppProtocolHandler(options: ProtocolHandlerOptions) {
  return async (request: Request): Promise<Response> => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return textResponse(400, "Invalid OpenKeep URL.");
    }

    if (url.host !== APP_HOST || url.username || url.password) {
      return textResponse(404, "Unknown OpenKeep host.");
    }

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const active = options.archiveSession.getActiveSession();
      if (!active) {
        return textResponse(503, "Connect to an OpenKeep archive first.");
      }

      const headers = createForwardHeaders(request.headers);
      headers.set("authorization", `Bearer ${active.credentials.apiToken}`);
      if (
        active.credentials.cfAccessClientId &&
        active.credentials.cfAccessClientSecret
      ) {
        headers.set("cf-access-client-id", active.credentials.cfAccessClientId);
        headers.set("cf-access-client-secret", active.credentials.cfAccessClientSecret);
      }

      const target = resolveArchiveApiUrl(
        active.profile.serverUrl,
        `${url.pathname}${url.search}`,
      );
      const supportsBody = request.method !== "GET" && request.method !== "HEAD";
      try {
        return await options.fetchRequest(target, {
          method: request.method,
          headers,
          body: supportsBody ? request.body : undefined,
          signal: request.signal,
          redirect: "manual",
          // Required by Node-compatible Fetch implementations for a streaming
          // upload body; Electron ignores the field when it is unnecessary.
          duplex: supportsBody ? "half" : undefined,
        } as RequestInit & { duplex?: "half" });
      } catch {
        return textResponse(502, "The active OpenKeep archive could not be reached.");
      }
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return textResponse(405, "Method not allowed for application assets.");
    }

    if (options.rendererDevServerUrl) {
      const target = new URL(`${url.pathname}${url.search}`, options.rendererDevServerUrl);
      return options.fetchRequest(target.toString(), {
        method: request.method,
        headers: createForwardHeaders(request.headers),
        signal: request.signal,
      });
    }

    const asset = resolveRendererAsset(
      options.rendererRoot,
      request.url,
      options.fileExists,
    );
    if (!asset.ok) {
      return textResponse(asset.status, "OpenKeep application asset not found.");
    }

    const response = await options.fetchRequest(pathToFileURL(asset.filePath).toString(), {
      method: request.method,
      signal: request.signal,
    });
    return path.basename(asset.filePath) === "index.html"
      ? withProductionCsp(response)
      : response;
  };
}
