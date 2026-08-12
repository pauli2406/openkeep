import type { OfflineCachedKind, OfflineCacheStore } from "./offline-cache-store";

/**
 * The read-through half of the offline cache.
 *
 * Every renderer API request already flows through the main-process protocol
 * proxy, so the proxy is the one place that can observe exactly what the user
 * read — no renderer change, no second fetch. Opening a document online means
 * the renderer requests the document, its OCR text, its history, and its
 * preview bytes; each successful response is copied into the cache as it
 * passes by. This is mobile's "opening a document caches it" semantics with
 * the trigger moved to the transport seam the desktop already owns.
 *
 * A caching failure must never break online viewing: every store write is
 * detached from the response path and only reported.
 */

const DOCUMENT_ROUTE =
  /^\/api\/documents\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/text|\/history|\/download|\/download\/searchable)?$/i;

export type ReadThroughTarget =
  | { kind: "document" | "text" | "history"; documentId: string }
  | { kind: "file"; documentId: string; fileKind: OfflineCachedKind };

/** Decides whether one proxied request is worth copying into the cache. */
export function classifyReadThrough(
  method: string,
  pathname: string,
): ReadThroughTarget | null {
  if (method !== "GET") return null;
  const match = DOCUMENT_ROUTE.exec(pathname);
  if (!match) return null;
  const documentId = match[1]!.toLowerCase();
  switch (match[2]?.toLowerCase()) {
    case undefined:
      return { kind: "document", documentId };
    case "/text":
      return { kind: "text", documentId };
    case "/history":
      return { kind: "history", documentId };
    case "/download":
      return { kind: "file", documentId, fileKind: "original" };
    case "/download/searchable":
      return { kind: "file", documentId, fileKind: "searchable" };
    default:
      return null;
  }
}

export function createOfflineReadThrough({
  store,
  reportError,
}: {
  store: Pick<
    OfflineCacheStore,
    "upsertDocument" | "attachText" | "attachHistory" | "cacheFileStream"
  >;
  reportError?: (message: string, error: unknown) => void;
}) {
  function report(error: unknown) {
    reportError?.("A document could not be copied into the offline cache.", error);
  }

  return {
    /**
     * Observes one proxied response. Returns the response the renderer should
     * receive — identical content, but for cached endpoints the body has been
     * teed so one copy streams to the renderer while the other enters the
     * cache.
     */
    observe(method: string, pathname: string, response: Response): Response {
      const target = classifyReadThrough(method, pathname);
      if (!target || !response.ok || !response.body) {
        return response;
      }

      if (target.kind === "file") {
        const [toRenderer, toCache] = response.body.tee();
        void store
          .cacheFileStream(target.documentId, target.fileKind, toCache)
          .catch(report);
        return new Response(toRenderer, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }

      const [toRenderer, toCache] = response.body.tee();
      void new Response(toCache)
        .json()
        .then(async (payload: unknown) => {
          if (target.kind === "document") {
            await store.upsertDocument(payload);
          } else if (target.kind === "text") {
            await store.attachText(target.documentId, payload);
          } else {
            await store.attachHistory(target.documentId, payload);
          }
        })
        .catch(report);
      return new Response(toRenderer, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
  };
}

export type OfflineReadThrough = ReturnType<typeof createOfflineReadThrough>;
