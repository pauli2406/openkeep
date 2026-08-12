import { describe, expect, it } from "vitest";
import {
  createOfflineApiHandler,
  OFFLINE_READ_ONLY_HEADER,
} from "./offline-api";
import type {
  OfflineCacheColumns,
  OfflineCacheStore,
} from "./offline-cache-store";

const DOC_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function column(overrides: Partial<OfflineCacheColumns> = {}): OfflineCacheColumns {
  return {
    id: DOC_ID,
    title: "Stromabrechnung",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: null,
    issueDate: "2026-01-01",
    dueDate: null,
    status: "ready",
    reviewStatus: "not_required",
    correspondentId: "c-1",
    correspondentName: "Stadtwerke",
    correspondentSlug: "stadtwerke",
    documentTypeId: null,
    documentTypeName: "Invoice",
    documentTypeSlug: null,
    mimeType: "application/pdf",
    cachedAt: 1_000,
    lastViewedAt: 1_000,
    hasDocument: true,
    hasText: true,
    hasHistory: true,
    fileBytes: 10,
    fileKind: "searchable",
    ...overrides,
  };
}

function fakeStore(
  options: {
    columns?: OfflineCacheColumns[];
    records?: Record<
      string,
      { version: number; document: unknown; text: unknown; history: unknown }
    >;
    files?: Record<string, Buffer>;
    user?: unknown;
  } = {},
): Pick<OfflineCacheStore, "listColumns" | "loadRecord" | "readFile" | "getUser"> {
  return {
    listColumns: () => options.columns ?? [column()],
    loadRecord: async (id) => options.records?.[id] ?? null,
    readFile: async (id) => options.files?.[id] ?? null,
    getUser: async () => options.user ?? null,
  };
}

function record(document: unknown, text: unknown = null, history: unknown = null) {
  return { version: 1, document, text, history };
}

function handle(
  handler: ReturnType<typeof createOfflineApiHandler>,
  path: string,
  method = "GET",
) {
  const url = new URL(`openkeep://app${path}`);
  return handler(new Request(`https://app${path}`, { method }), url);
}

describe("offline API handler", () => {
  it("serves the cached user as the session identity", async () => {
    const handler = createOfflineApiHandler({
      store: fakeStore({ user: { id: "user-1", isOwner: true } }),
    });
    const response = await handle(handler, "/api/auth/me");
    await expect(response.json()).resolves.toMatchObject({ id: "user-1" });
  });

  it("lists only cached documents in the archive's response shape", async () => {
    const handler = createOfflineApiHandler({
      store: fakeStore({
        columns: [
          column(),
          column({ id: OTHER_ID, title: "Neuer", createdAt: "2026-08-05T00:00:00.000Z" }),
          column({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", hasDocument: false }),
        ],
        records: {
          [DOC_ID]: record({ id: DOC_ID, title: "Stromabrechnung" }),
          [OTHER_ID]: record({ id: OTHER_ID, title: "Neuer" }),
        },
      }),
    });

    const payload = (await (await handle(handler, "/api/documents")).json()) as {
      items: Array<{ id: string }>;
      total: number;
      page: number;
      pageSize: number;
    };
    expect(payload.total).toBe(2);
    // Newest created first; the metadata-only stub row does not appear.
    expect(payload.items.map((item) => item.id)).toEqual([OTHER_ID, DOC_ID]);
    expect(payload).toMatchObject({ page: 1, pageSize: 20 });
  });

  it("honors query, correspondent, review filters, and paging", async () => {
    const handler = createOfflineApiHandler({
      store: fakeStore({
        columns: [
          column(),
          column({
            id: OTHER_ID,
            title: "Arztbrief",
            correspondentName: "Praxis",
            correspondentSlug: "praxis",
            reviewStatus: "pending",
          }),
        ],
        records: {
          [DOC_ID]: record({ id: DOC_ID }),
          [OTHER_ID]: record({ id: OTHER_ID }),
        },
      }),
    });

    const byQuery = (await (
      await handle(handler, "/api/documents?query=stadtwerke")
    ).json()) as { items: Array<{ id: string }> };
    expect(byQuery.items.map((item) => item.id)).toEqual([DOC_ID]);

    const bySlug = (await (
      await handle(handler, "/api/documents?correspondentSlug=praxis")
    ).json()) as { items: Array<{ id: string }> };
    expect(bySlug.items.map((item) => item.id)).toEqual([OTHER_ID]);

    const byReview = (await (
      await handle(handler, "/api/documents?reviewStatus=pending")
    ).json()) as { total: number };
    expect(byReview.total).toBe(1);

    const paged = (await (
      await handle(handler, "/api/documents?page=2&pageSize=1")
    ).json()) as { items: Array<{ id: string }>; total: number };
    expect(paged.total).toBe(2);
    expect(paged.items).toHaveLength(1);
  });

  it("serves detail, text, history, and decrypted file bytes from the cache", async () => {
    const handler = createOfflineApiHandler({
      store: fakeStore({
        records: {
          [DOC_ID]: record(
            { id: DOC_ID, title: "Stromabrechnung" },
            { blocks: [{ text: "OCR" }] },
            [{ event: "created" }],
          ),
        },
        files: { [DOC_ID]: Buffer.from("%PDF-1.4 cached") },
      }),
    });

    await expect(
      (await handle(handler, `/api/documents/${DOC_ID}`)).json(),
    ).resolves.toMatchObject({ title: "Stromabrechnung" });
    await expect(
      (await handle(handler, `/api/documents/${DOC_ID}/text`)).json(),
    ).resolves.toMatchObject({ blocks: [{ text: "OCR" }] });
    await expect(
      (await handle(handler, `/api/documents/${DOC_ID}/history`)).json(),
    ).resolves.toEqual([{ event: "created" }]);

    const download = await handle(handler, `/api/documents/${DOC_ID}/download`);
    expect(download.headers.get("content-type")).toBe("application/pdf");
    await expect(download.text()).resolves.toBe("%PDF-1.4 cached");
  });

  it("answers 404 for documents the cache does not hold", async () => {
    const handler = createOfflineApiHandler({ store: fakeStore() });
    expect((await handle(handler, `/api/documents/${OTHER_ID}`)).status).toBe(404);
    expect(
      (await handle(handler, `/api/documents/${DOC_ID}/download`)).status,
    ).toBe(404);
  });

  it("refuses every mutation and unserved endpoint as read-only", async () => {
    const handler = createOfflineApiHandler({ store: fakeStore() });

    for (const [method, path] of [
      ["POST", "/api/documents"],
      ["PATCH", `/api/documents/${DOC_ID}`],
      ["DELETE", `/api/documents/${DOC_ID}`],
      ["POST", "/api/search/ask"],
      ["GET", "/api/documents/facets"],
      ["GET", "/api/dashboard/insights"],
      ["GET", "/api/taxonomies/tags"],
    ] as const) {
      const response = await handle(handler, path, method);
      expect(response.status, `${method} ${path}`).toBe(503);
      expect(response.headers.get(OFFLINE_READ_ONLY_HEADER)).toBe("read-only");
      // Never the archive-unavailable header: that would send the renderer's
      // failure handler into a retry loop on every offline request.
      expect(response.headers.get("x-openkeep-desktop-error")).toBeNull();
    }
  });
});
