import { describe, expect, it } from "vitest";
import { createOfflineApiHandler } from "./offline-api";
import {
  daysUntilDue,
  deriveCorrespondentInsights,
  deriveDashboard,
  deriveFacets,
  deriveTimeline,
  searchCachedDocuments,
} from "./offline-surfaces";
import type {
  OfflineCacheColumns,
  OfflineCacheStore,
} from "./offline-cache-store";

const DOC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DOC_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** Noon local time, so day arithmetic cannot straddle midnight. */
const NOW = new Date(2026, 7, 12, 12, 0, 0);

function column(overrides: Partial<OfflineCacheColumns> = {}): OfflineCacheColumns {
  return {
    id: DOC_A,
    title: "Stromabrechnung",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: null,
    issueDate: "2026-08-01",
    dueDate: null,
    status: "ready",
    reviewStatus: "not_required",
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

type FakeRecord = {
  version: number;
  document: unknown;
  text: unknown;
  history: unknown;
};

function loadRecordFrom(records: Record<string, FakeRecord>) {
  return async (id: string) => records[id] ?? null;
}

describe("offline due-date arithmetic", () => {
  it("treats a document due today as due today, not overdue", () => {
    // new Date("2026-08-12") is UTC midnight — west of Greenwich that is
    // still 2026-08-11 locally, which is exactly mobile's #151 bug. The
    // local-date parser keeps today today in every timezone.
    expect(daysUntilDue("2026-08-12", NOW)).toBe(0);
    expect(daysUntilDue("2026-08-13", NOW)).toBe(1);
    expect(daysUntilDue("2026-08-11", NOW)).toBe(-1);
  });
});

describe("offline dashboard", () => {
  it("derives stats, deadlines, and activity from cached documents only", async () => {
    const columns = [
      column({ dueDate: "2026-08-20" }),
      column({
        id: DOC_B,
        title: "Mahnung",
        dueDate: "2026-08-01",
        reviewStatus: "pending",
        createdAt: "2026-08-05T10:00:00.000Z",
      }),
      column({ id: DOC_C, hasDocument: false }),
    ];
    const dashboard = await deriveDashboard(
      columns,
      loadRecordFrom({
        [DOC_A]: { version: 1, document: { id: DOC_A }, text: null, history: null },
        [DOC_B]: { version: 1, document: { id: DOC_B }, text: null, history: null },
      }),
      NOW,
    );

    expect(dashboard.stats).toEqual({
      totalDocuments: 2,
      pendingReview: 1,
      documentTypesCount: 1,
      correspondentsCount: 1,
    });
    expect(dashboard.upcomingDeadlines).toEqual([
      expect.objectContaining({ documentId: DOC_A, isOverdue: false, daysUntilDue: 8 }),
    ]);
    expect(dashboard.overdueItems).toEqual([
      expect.objectContaining({ documentId: DOC_B, isOverdue: true }),
    ]);
    expect(dashboard.monthlyActivity).toEqual([{ month: "2026-08", count: 2 }]);
    expect(dashboard.recentDocuments).toHaveLength(2);
    expect(dashboard.topCorrespondents[0]).toMatchObject({
      slug: "stadtwerke",
      documentCount: 2,
    });
  });

  it("is empty rather than wrong for an empty cache", async () => {
    const dashboard = await deriveDashboard([], loadRecordFrom({}), NOW);
    expect(dashboard.stats.totalDocuments).toBe(0);
    expect(dashboard.upcomingDeadlines).toEqual([]);
    expect(dashboard.monthlyActivity).toEqual([]);
  });
});

describe("offline facets and timeline", () => {
  it("aggregates years, correspondents, types, tags, and statuses", () => {
    const facets = deriveFacets([
      column({ tags: [{ id: "tag-1", name: "Energie", slug: "energie" }] }),
      column({
        id: DOC_B,
        issueDate: "2025-12-31",
        correspondentId: "c-2",
        correspondentName: "Praxis",
        correspondentSlug: "praxis",
        documentTypeId: "t-2",
        documentTypeName: "Letter",
        documentTypeSlug: "letter",
      }),
    ]);

    expect(facets.years).toEqual([
      { year: 2026, count: 1 },
      { year: 2025, count: 1 },
    ]);
    expect(facets.correspondents).toHaveLength(2);
    expect(facets.correspondents[0]).toMatchObject({ dominantTypeName: "Invoice" });
    expect(facets.tags).toEqual([
      { id: "tag-1", name: "Energie", slug: "energie", count: 1 },
    ]);
    expect(facets.statuses).toEqual([{ status: "ready", count: 2 }]);
  });

  it("keeps a 1 January document in its own year", () => {
    // new Date("2026-01-01").getFullYear() is 2025 west of Greenwich; the
    // facet derivation must not inherit that (#151's facet variant).
    const facets = deriveFacets([column({ issueDate: "2026-01-01" })]);
    expect(facets.years).toEqual([{ year: 2026, count: 1 }]);
  });

  it("builds the timeline with month-level top names", () => {
    const timeline = deriveTimeline([
      column(),
      column({ id: DOC_B, issueDate: "2026-08-15" }),
      column({ id: DOC_C, issueDate: "2026-01-01" }),
    ]);

    expect(timeline.years[0]).toMatchObject({ year: 2026, count: 3 });
    expect(timeline.years[0]!.months).toEqual([
      expect.objectContaining({ month: 1, count: 1 }),
      expect.objectContaining({
        month: 8,
        count: 2,
        topCorrespondents: ["Stadtwerke"],
        topTypes: ["Invoice"],
      }),
    ]);
  });
});

describe("offline correspondent insights", () => {
  it("derives the dossier for a cached correspondent, honest about AI", async () => {
    const insights = await deriveCorrespondentInsights(
      "stadtwerke",
      [column(), column({ id: DOC_B, issueDate: "2026-03-01", dueDate: "2026-09-01" })],
      loadRecordFrom({
        [DOC_A]: { version: 1, document: { id: DOC_A }, text: null, history: null },
        [DOC_B]: { version: 1, document: { id: DOC_B }, text: null, history: null },
      }),
      NOW,
    );

    expect(insights).toMatchObject({
      correspondent: { slug: "stadtwerke", name: "Stadtwerke" },
      summaryStatus: "unavailable",
      intelligenceStatus: "unavailable",
      stats: {
        documentCount: 2,
        dateRange: { from: "2026-03-01", to: "2026-08-01" },
      },
      documentTypeBreakdown: [{ name: "Invoice", count: 2 }],
    });
    expect(insights!.upcomingDeadlines).toEqual([
      expect.objectContaining({ documentId: DOC_B }),
    ]);
  });

  it("answers null for a correspondent the cache does not hold", async () => {
    await expect(
      deriveCorrespondentInsights("unbekannt", [column()], loadRecordFrom({}), NOW),
    ).resolves.toBeNull();
  });
});

describe("offline text search", () => {
  const records = {
    [DOC_A]: {
      version: 1,
      document: { id: DOC_A, title: "Stromabrechnung" },
      text: { blocks: [{ text: "Jahresverbrauch 3.200 kWh", page: 2 }] },
      history: null,
    },
    [DOC_B]: {
      version: 1,
      document: { id: DOC_B, title: "Arztbrief" },
      text: { blocks: [{ text: "Befund unauffällig" }] },
      history: null,
    },
  };

  it("matches OCR text and quotes the matching block", async () => {
    const result = await searchCachedDocuments(
      "jahresverbrauch",
      [column(), column({ id: DOC_B, title: "Arztbrief" })],
      loadRecordFrom(records),
      1,
      20,
    );

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      document: { id: DOC_A },
      matchedChunks: [
        expect.objectContaining({ text: "Jahresverbrauch 3.200 kWh", pageFrom: 2 }),
      ],
    });
  });

  it("never returns a document the cache cannot open", async () => {
    const result = await searchCachedDocuments(
      "strom",
      [column(), column({ id: DOC_C, title: "Strom aber nur Metadaten", hasDocument: false })],
      loadRecordFrom(records),
      1,
      20,
    );
    expect(result.items.map((item) => (item.document as { id: string }).id)).toEqual([
      DOC_A,
    ]);
  });
});

describe("offline documents list, extended filters", () => {
  function handler(columns: OfflineCacheColumns[], records: Record<string, FakeRecord>) {
    const store: Pick<
      OfflineCacheStore,
      "listColumns" | "loadRecord" | "readFile" | "getUser"
    > = {
      listColumns: () => columns,
      loadRecord: loadRecordFrom(records),
      readFile: async () => null,
      getUser: async () => ({ id: "user-1" }),
    };
    return createOfflineApiHandler({ store, now: () => NOW });
  }

  async function list(h: ReturnType<typeof createOfflineApiHandler>, path: string) {
    const url = new URL(`openkeep://app${path}`);
    const response = await h(new Request(`https://app${path}`), url);
    return (await response.json()) as { items: Array<{ id: string }>; total: number };
  }

  const columns = [
    column({ dueDate: "2026-08-20" }),
    column({ id: DOC_B, issueDate: "2025-06-15", reviewStatus: "pending" }),
  ];
  const records = {
    [DOC_A]: { version: 1, document: { id: DOC_A }, text: null, history: null },
    [DOC_B]: {
      version: 1,
      document: { id: DOC_B },
      text: { blocks: [{ text: "Altvertrag Kündigungsfrist" }] },
      history: null,
    },
  };

  it("honors the year filter with local dates", async () => {
    const h = handler(columns, records);
    const by2025 = await list(h, "/api/documents?year=2025");
    expect(by2025.items.map((item) => item.id)).toEqual([DOC_B]);
  });

  it("sorts by issue date in both directions", async () => {
    const h = handler(columns, records);
    const ascending = await list(h, "/api/documents?sort=issueDate&direction=asc");
    expect(ascending.items.map((item) => item.id)).toEqual([DOC_B, DOC_A]);
    const descending = await list(h, "/api/documents?sort=issueDate&direction=desc");
    expect(descending.items.map((item) => item.id)).toEqual([DOC_A, DOC_B]);
  });

  it("matches a query against cached OCR text", async () => {
    const h = handler(columns, records);
    const byText = await list(h, "/api/documents?query=k%C3%BCndigungsfrist");
    expect(byText.items.map((item) => item.id)).toEqual([DOC_B]);
  });

  it("serves the review queue as pending documents only", async () => {
    const h = handler(columns, records);
    const review = await list(h, "/api/documents/review");
    expect(review.items.map((item) => item.id)).toEqual([DOC_B]);
  });

  it("serves semantic search as a read even though it is a POST", async () => {
    const h = handler(columns, records);
    const url = new URL("openkeep://app/api/search/semantic");
    const response = await h(
      new Request("https://app/api/search/semantic", {
        method: "POST",
        body: JSON.stringify({ query: "Altvertrag" }),
      }),
      url,
    );
    const payload = (await response.json()) as { total: number };
    expect(response.status).toBe(200);
    expect(payload.total).toBe(1);
  });
});
