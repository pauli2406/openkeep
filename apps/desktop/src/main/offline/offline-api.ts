import type { OfflineCacheColumns, OfflineCacheStore } from "./offline-cache-store";

/**
 * Serves the shared web application from the offline cache.
 *
 * The renderer keeps calling the same `/api` endpoints it always calls; in an
 * offline session the protocol handler routes them here instead of to the
 * network, and this module answers the read endpoints in the archive's own
 * response shapes. Because the cache records hold the archive's verbatim
 * responses, a cached document renders identically offline and online.
 *
 * Everything that is not an explicitly served read — every mutation, AI
 * answer, list the cache cannot honestly answer — receives a read-only
 * refusal. Read-only is therefore enforced at the transport, not merely
 * disabled in the UI. The refusal deliberately does not carry the
 * `archive-unavailable` header: that header means "go re-verify the archive",
 * which is the reconnect service's job, not every failed request's.
 */

export const OFFLINE_READ_ONLY_HEADER = "x-openkeep-desktop-offline";

const DOCUMENT_ROUTE =
  /^\/api\/documents\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/text|\/history|\/download|\/download\/searchable)?$/i;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function readOnlyRefusal(): Response {
  return new Response(
    JSON.stringify({
      message: "This archive is open read-only from its offline copy.",
    }),
    {
      status: 503,
      headers: {
        "content-type": "application/json",
        [OFFLINE_READ_ONLY_HEADER]: "read-only",
      },
    },
  );
}

function notCached(): Response {
  return json({ message: "This document is not in the offline copy." }, 404);
}

/** Case-insensitive contains over the columns a query can honestly match. */
function matchesQuery(row: OfflineCacheColumns, query: string): boolean {
  const needle = query.toLowerCase();
  return [row.title, row.correspondentName, row.documentTypeName]
    .filter((value): value is string => value !== null)
    .some((value) => value.toLowerCase().includes(needle));
}

function compareByCreatedAt(a: OfflineCacheColumns, b: OfflineCacheColumns) {
  return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
}

export function createOfflineApiHandler({
  store,
}: {
  store: Pick<
    OfflineCacheStore,
    "listColumns" | "loadRecord" | "readFile" | "getUser"
  >;
}) {
  async function listDocuments(url: URL): Promise<Response> {
    const query = url.searchParams.get("query")?.trim() ?? "";
    const correspondentSlug = url.searchParams.get("correspondentSlug");
    const reviewStatus = url.searchParams.get("reviewStatus");
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get("pageSize")) || 20),
    );

    const rows = store
      .listColumns()
      .filter((row) => row.hasDocument)
      .filter((row) => (query ? matchesQuery(row, query) : true))
      .filter((row) =>
        correspondentSlug ? row.correspondentSlug === correspondentSlug : true,
      )
      .filter((row) => (reviewStatus ? row.reviewStatus === reviewStatus : true))
      .sort(compareByCreatedAt);

    const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
    const items: unknown[] = [];
    for (const row of pageRows) {
      const record = await store.loadRecord(row.id);
      if (record?.document) items.push(record.document);
    }
    return json({
      items,
      total: rows.length,
      page,
      pageSize,
      appliedFilters: {},
    });
  }

  return async (request: Request, url: URL): Promise<Response> => {
    if (request.method !== "GET") {
      return readOnlyRefusal();
    }

    if (url.pathname === "/api/auth/me") {
      const user = await store.getUser();
      return user ? json(user) : readOnlyRefusal();
    }

    if (url.pathname === "/api/documents") {
      return listDocuments(url);
    }

    const match = DOCUMENT_ROUTE.exec(url.pathname);
    if (match) {
      const documentId = match[1]!.toLowerCase();
      const subresource = match[2]?.toLowerCase();
      const row = store
        .listColumns()
        .find((candidate) => candidate.id === documentId && candidate.hasDocument);
      if (!row) return notCached();

      if (subresource === "/download" || subresource === "/download/searchable") {
        const bytes = await store.readFile(documentId);
        if (!bytes) return notCached();
        return new Response(new Uint8Array(bytes), {
          status: 200,
          headers: {
            "content-type": row.mimeType ?? "application/octet-stream",
            "content-length": String(bytes.length),
          },
        });
      }

      const record = await store.loadRecord(documentId);
      if (!record?.document) return notCached();
      if (subresource === "/text") {
        return record.text !== null ? json(record.text) : notCached();
      }
      if (subresource === "/history") {
        return json(record.history ?? []);
      }
      return json(record.document);
    }

    return readOnlyRefusal();
  };
}

export type OfflineApiHandler = ReturnType<typeof createOfflineApiHandler>;
