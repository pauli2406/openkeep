import { screen } from "@testing-library/react";
import { http } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { makeDocument } from "@/test/fixtures";
import { createOfflineApiHandler } from "../../main/offline/offline-api";
import type {
  OfflineCacheColumns,
  OfflineCacheStore,
} from "../../main/offline/offline-cache-store";
import { desktopApiUrl, desktopParityServer } from "./msw-server";
import { renderDesktopArchive } from "./render-desktop-app";

/**
 * The derivation↔UI contract: msw delegates every intercepted request to the
 * REAL offline API handler over a fixture cache, so the shared routes render
 * exactly what an offline session would serve — the whole offline read path
 * minus Electron. If a derived shape drifts from what Today or the explorer
 * expects, this fails.
 */

const DOC_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = new Date(2026, 7, 12, 12, 0, 0);

function column(overrides: Partial<OfflineCacheColumns> = {}): OfflineCacheColumns {
  return {
    id: DOC_ID,
    title: "Stromabrechnung",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: null,
    issueDate: "2026-08-01",
    dueDate: "2026-08-20",
    status: "ready",
    reviewStatus: "pending",
    correspondentId: "c-1",
    correspondentName: "Stadtwerke",
    correspondentSlug: "stadtwerke",
    documentTypeId: "t-1",
    documentTypeName: "Invoice",
    documentTypeSlug: "invoice",
    mimeType: "application/pdf",
    tags: [],
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

// The cache stores the archive's verbatim document responses, so the parity
// fixture is a full Document — exactly what a cached record would hold.
const cachedDocument = makeDocument({
  id: DOC_ID,
  title: "Stromabrechnung",
  reviewStatus: "pending",
  createdAt: "2026-08-01T10:00:00.000Z",
  issueDate: "2026-08-01",
  dueDate: "2026-08-20",
});

function offlineHandler(columns: OfflineCacheColumns[]) {
  const store: Pick<
    OfflineCacheStore,
    "listColumns" | "loadRecord" | "readFile" | "getUser"
  > = {
    listColumns: () => columns,
    loadRecord: async (id) =>
      columns.some((row) => row.id === id && row.hasDocument)
        ? { version: 1, document: cachedDocument, text: null, history: null }
        : null,
    readFile: async () => null,
    getUser: async () => ({ id: "user-1", isOwner: true }),
  };
  const handler = createOfflineApiHandler({ store, now: () => NOW });
  return async ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    return handler(request, url);
  };
}

function serveOffline(columns: OfflineCacheColumns[]) {
  const respond = offlineHandler(columns);
  desktopParityServer.use(
    http.get(desktopApiUrl("/api/dashboard/insights"), respond),
    http.get(desktopApiUrl("/api/documents/facets"), respond),
    http.get(desktopApiUrl("/api/documents"), respond),
    http.get(desktopApiUrl("/api/documents/timeline"), respond),
  );
}

beforeAll(() => desktopParityServer.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => desktopParityServer.resetHandlers());
afterAll(() => desktopParityServer.close());

describe("offline surfaces through the shared routes", () => {
  it("renders offline Today from the served cache", async () => {
    serveOffline([column()]);
    renderDesktopArchive({ route: "/", sessionStatus: "offline" });

    // The due document reaches the task queue through the offline documents
    // list (Today sorts by dueDate), not through a hand-written stub.
    expect(await screen.findAllByText("Stromabrechnung")).not.toHaveLength(0);
    expect(
      await screen.findByText(/Offline copy — read only/i),
    ).toBeInTheDocument();
  });

  it("renders the empty offline Today without errors", async () => {
    serveOffline([]);
    renderDesktopArchive({ route: "/", sessionStatus: "offline" });

    expect(
      await screen.findByText(/Offline copy — read only/i),
    ).toBeInTheDocument();
  });

  it("feeds the served list and facets into the documents explorer", async () => {
    serveOffline([column()]);
    renderDesktopArchive({ route: "/documents", sessionStatus: "offline" });

    expect(await screen.findAllByText("Stromabrechnung")).not.toHaveLength(0);
    // The derived year facet renders as a filter the cache can honor.
    expect(await screen.findAllByText(/2026/)).not.toHaveLength(0);
  });
});
