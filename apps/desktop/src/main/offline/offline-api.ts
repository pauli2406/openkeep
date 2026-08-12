import type { OfflineCacheColumns, OfflineCacheStore } from "./offline-cache-store";
import {
  deriveCorrespondentInsights,
  deriveDashboard,
  deriveFacets,
  deriveTimeline,
  rowYear,
  searchCachedDocuments,
  visibleRows,
} from "./offline-surfaces";

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
function matchesQuery(row: OfflineCacheColumns, needle: string): boolean {
  return [
    row.title,
    row.correspondentName,
    row.documentTypeName,
    ...row.tags.map((tag) => tag.name),
  ]
    .filter((value): value is string => value !== null)
    .some((value) => value.toLowerCase().includes(needle));
}

export function createOfflineApiHandler({
  store,
  now = () => new Date(),
}: {
  store: Pick<
    OfflineCacheStore,
    "listColumns" | "loadRecord" | "readFile" | "getUser"
  >;
  now?: () => Date;
}) {
  /**
   * Whether the query matches the row's OCR text — checked only when the
   * cheap column match failed, so a search costs one record read per
   * still-unmatched cached document.
   */
  async function matchesText(row: OfflineCacheColumns, needle: string) {
    const record = await store.loadRecord(row.id);
    const text = record?.text;
    if (!text || typeof text !== "object" || Array.isArray(text)) return false;
    const blocks = (text as { blocks?: unknown }).blocks;
    if (!Array.isArray(blocks)) return false;
    return blocks.some(
      (block) =>
        typeof (block as { text?: unknown })?.text === "string" &&
        ((block as { text: string }).text.toLowerCase().includes(needle)),
    );
  }

  function csv(url: URL, key: string): string[] {
    return url.searchParams
      .getAll(key)
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(Boolean);
  }

  async function listDocuments(url: URL, reviewOnly = false): Promise<Response> {
    const query = url.searchParams.get("query")?.trim().toLowerCase() ?? "";
    const correspondentSlug = url.searchParams.get("correspondentSlug");
    const correspondentIds = csv(url, "correspondentIds");
    const documentTypeIds = csv(url, "documentTypeIds");
    const statuses = csv(url, "statuses");
    const tags = csv(url, "tags");
    const reviewStatus = url.searchParams.get("reviewStatus");
    const year = Number(url.searchParams.get("year")) || null;
    const dateFrom = url.searchParams.get("dateFrom");
    const dateTo = url.searchParams.get("dateTo");
    const sort = url.searchParams.get("sort") ?? "createdAt";
    const direction = url.searchParams.get("direction") === "asc" ? 1 : -1;
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get("pageSize")) || 20),
    );

    let rows = visibleRows(store.listColumns())
      .filter((row) => (reviewOnly ? row.reviewStatus === "pending" : true))
      .filter((row) =>
        correspondentSlug ? row.correspondentSlug === correspondentSlug : true,
      )
      .filter((row) =>
        correspondentIds.length
          ? row.correspondentId !== null && correspondentIds.includes(row.correspondentId)
          : true,
      )
      .filter((row) =>
        documentTypeIds.length
          ? row.documentTypeId !== null && documentTypeIds.includes(row.documentTypeId)
          : true,
      )
      .filter((row) =>
        statuses.length ? row.status !== null && statuses.includes(row.status) : true,
      )
      .filter((row) =>
        tags.length ? row.tags.some((tag) => tags.includes(tag.id)) : true,
      )
      .filter((row) => (reviewStatus ? row.reviewStatus === reviewStatus : true))
      .filter((row) => (year ? rowYear(row) === year : true))
      .filter((row) => {
        if (!dateFrom && !dateTo) return true;
        const date = row.issueDate ?? row.createdAt;
        if (!date) return false;
        const day = date.slice(0, 10);
        return (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo);
      });

    if (query) {
      const matched: OfflineCacheColumns[] = [];
      for (const row of rows) {
        if (matchesQuery(row, query) || (await matchesText(row, query))) {
          matched.push(row);
        }
      }
      rows = matched;
    }

    const sortValue = (row: OfflineCacheColumns): string => {
      switch (sort) {
        case "issueDate":
          return row.issueDate ?? "";
        case "dueDate":
          return row.dueDate ?? "";
        case "title":
          return row.title.toLowerCase();
        default:
          return row.createdAt ?? "";
      }
    };
    rows.sort((a, b) => direction * sortValue(a).localeCompare(sortValue(b)));

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
    // Semantic search is a POST that only reads; everything else non-GET is a
    // mutation and refused.
    if (request.method === "POST" && url.pathname === "/api/search/semantic") {
      let body: { query?: unknown; page?: unknown; pageSize?: unknown } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        // An unreadable body searches for nothing.
      }
      return json(
        await searchCachedDocuments(
          typeof body.query === "string" ? body.query : "",
          store.listColumns(),
          store.loadRecord,
          Math.max(1, Number(body.page) || 1),
          Math.min(100, Math.max(1, Number(body.pageSize) || 20)),
        ),
      );
    }
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

    if (url.pathname === "/api/documents/review") {
      return listDocuments(url, true);
    }

    if (url.pathname === "/api/documents/facets") {
      return json(deriveFacets(store.listColumns()));
    }

    if (url.pathname === "/api/documents/timeline") {
      return json(deriveTimeline(store.listColumns()));
    }

    if (url.pathname === "/api/dashboard/insights") {
      return json(
        await deriveDashboard(store.listColumns(), store.loadRecord, now()),
      );
    }

    const correspondent = /^\/api\/correspondents\/([^/]+)\/insights$/.exec(
      url.pathname,
    );
    if (correspondent) {
      const insights = await deriveCorrespondentInsights(
        decodeURIComponent(correspondent[1]!),
        store.listColumns(),
        store.loadRecord,
        now(),
      );
      return insights
        ? json(insights)
        : json({ message: "This correspondent is not in the offline copy." }, 404);
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
