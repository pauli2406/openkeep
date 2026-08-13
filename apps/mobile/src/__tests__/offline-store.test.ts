/**
 * The offline store's first tests. Until now nothing exercised this code: the
 * unit suite mocked the module wholesale and the visual suite stubbed SQLite
 * out, so every query, filter, and derived surface was unverified.
 *
 * These characterise what the store does **today**, including where today's
 * behaviour is wrong. Those cases are marked with the story that fixes them, so
 * the fix flips an assertion here instead of arriving untested.
 */
import type { DocumentHistoryResponse } from "../lib";
import { createOfflineMetadataStore } from "../offline-metadata-store";
import {
  createTestDatabase,
  testDocument,
  testRecord,
} from "./offline-test-doubles";

function createStore() {
  const database = createTestDatabase();
  const store = createOfflineMetadataStore({ openDatabase: async () => database });
  return { store, database };
}

describe("caching a document", () => {
  it("stores it, and reads back what was written", async () => {
    const { store } = createStore();
    const document = testDocument({
      title: "Stromrechnung März",
      correspondent: { id: "c1", name: "Stadtwerke", slug: "stadtwerke" },
      documentType: { id: "t1", name: "Rechnung", slug: "rechnung" },
      tags: [{ id: "g1", name: "Wohnung", slug: "wohnung" }],
    });

    await store.upsertCachedDocument(
      testRecord(document, { fileUri: "file:///cache/openkeep-cache/files/doc.pdf", fileStorageBytes: 2048 }),
    );

    const cached = await store.getCachedDocument(document.id);
    expect(cached).not.toBeNull();
    expect(cached!.document.title).toBe("Stromrechnung März");
    expect(cached!.document.correspondent).toEqual({ id: "c1", name: "Stadtwerke", slug: "stadtwerke" });
    expect(cached!.fileUri).toBe("file:///cache/openkeep-cache/files/doc.pdf");
    expect(cached!.fileStorageBytes).toBe(2048);
  });

  it("replaces the row when the same document is cached again", async () => {
    const { store } = createStore();
    const document = testDocument({ title: "Erste Fassung" });
    await store.upsertCachedDocument(testRecord(document));
    await store.upsertCachedDocument(
      testRecord({ ...document, title: "Zweite Fassung" }, { fileStorageBytes: 10 }),
    );

    const all = await store.listCachedDocuments();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe("Zweite Fassung");
    expect((await store.getCacheStats()).fileStorageBytes).toBe(10);
  });

  it("keeps the cached text and history alongside the document", async () => {
    const { store } = createStore();
    const document = testDocument();
    const record = testRecord(document, { text: ["Rechnungsbetrag 42,00 EUR"] });
    const history: DocumentHistoryResponse = {
      documentId: document.id,
      items: [
        {
          id: "h1",
          actorUserId: null,
          documentId: document.id,
          eventType: "document.created",
          payload: {},
          createdAt: "2026-03-04T09:00:00.000Z",
        },
      ],
    };

    await store.upsertCachedDocument({ ...record, history });

    const cached = await store.getCachedDocument(document.id);
    expect(cached!.text.blocks[0].text).toBe("Rechnungsbetrag 42,00 EUR");
    expect(cached!.history.items).toHaveLength(1);
  });

  it("returns null for a document that was never cached", async () => {
    const { store } = createStore();
    expect(await store.getCachedDocument("22222222-2222-4222-8222-222222222222")).toBeNull();
  });
});

describe("querying the offline mirror", () => {
  async function seeded() {
    const { store } = createStore();
    await store.upsertCachedDocument(
      testRecord(
        testDocument({
          id: "aaaaaaaa-0000-4000-8000-000000000001",
          title: "Stromrechnung",
          status: "ready",
          reviewStatus: "pending",
          correspondent: { id: "c1", name: "Stadtwerke", slug: "stadtwerke" },
          createdAt: "2026-03-01T09:00:00.000Z",
        }),
        { lastViewedAt: "2026-03-10T09:00:00.000Z", text: ["Zählernummer 4711"] },
      ),
    );
    await store.upsertCachedDocument(
      testRecord(
        testDocument({
          id: "aaaaaaaa-0000-4000-8000-000000000002",
          title: "Mietvertrag",
          status: "failed",
          reviewStatus: "resolved",
          correspondent: { id: "c2", name: "Hausverwaltung", slug: "hausverwaltung" },
          createdAt: "2026-03-02T09:00:00.000Z",
        }),
        { lastViewedAt: "2026-03-11T09:00:00.000Z" },
      ),
    );
    return store;
  }

  it("returns the most recently viewed first", async () => {
    const store = await seeded();
    expect((await store.queryCachedDocuments()).map((document) => document.title)).toEqual([
      "Mietvertrag",
      "Stromrechnung",
    ]);
  });

  it("filters by status, review state, and correspondent", async () => {
    const store = await seeded();
    expect((await store.queryCachedDocuments({ status: "failed" })).map((d) => d.title)).toEqual([
      "Mietvertrag",
    ]);
    expect((await store.queryCachedDocuments({ reviewOnly: true })).map((d) => d.title)).toEqual([
      "Stromrechnung",
    ]);
    expect(
      (await store.queryCachedDocuments({ correspondentSlug: "hausverwaltung" })).map((d) => d.title),
    ).toEqual(["Mietvertrag"]);
    expect(await store.queryCachedDocuments({ status: "all" })).toHaveLength(2);
  });

  it("matches a query against the title, the correspondent, and the OCR text", async () => {
    const store = await seeded();
    expect((await store.queryCachedDocuments({ query: "strom" })).map((d) => d.title)).toEqual([
      "Stromrechnung",
    ]);
    expect((await store.queryCachedDocuments({ query: "Stadtwerke" })).map((d) => d.title)).toEqual([
      "Stromrechnung",
    ]);
    expect((await store.queryCachedDocuments({ query: "4711" })).map((d) => d.title)).toEqual([
      "Stromrechnung",
    ]);
    expect(await store.queryCachedDocuments({ query: "  " })).toHaveLength(2);
    expect(await store.queryCachedDocuments({ query: "nirgendwo" })).toHaveLength(0);
  });
});

describe("cache accounting", () => {
  it("counts documents and the bytes their files take", async () => {
    const { store } = createStore();
    await store.upsertCachedDocument(
      testRecord(testDocument({ id: "aaaaaaaa-0000-4000-8000-000000000001" }), {
        fileUri: "file:///a.pdf",
        fileStorageBytes: 100,
      }),
    );
    await store.upsertCachedDocument(
      testRecord(testDocument({ id: "aaaaaaaa-0000-4000-8000-000000000002" }), {
        fileStorageBytes: 0,
      }),
    );

    expect(await store.getCacheStats()).toEqual({ documentCount: 2, fileStorageBytes: 100 });
    expect(await store.getCachedFileUris()).toEqual(["file:///a.pdf"]);
  });

  it("empties completely when cleared", async () => {
    const { store } = createStore();
    await store.upsertCachedDocument(testRecord(testDocument()));
    await store.clearCachedDocumentRows();

    expect(await store.getCacheStats()).toEqual({ documentCount: 0, fileStorageBytes: 0 });
    expect(await store.listCachedDocuments()).toEqual([]);
  });
});

describe("derived offline surfaces", () => {
  it("counts facets over the cached documents", async () => {
    const { store } = createStore();
    for (const [index, correspondent] of [
      { id: "c1", name: "Stadtwerke", slug: "stadtwerke" },
      { id: "c1", name: "Stadtwerke", slug: "stadtwerke" },
      { id: "c2", name: "Finanzamt", slug: "finanzamt" },
    ].entries()) {
      await store.upsertCachedDocument(
        testRecord(
          testDocument({
            id: `aaaaaaaa-0000-4000-8000-00000000000${index + 1}`,
            correspondent,
            tags: [{ id: "g1", name: "Wohnung", slug: "wohnung" }],
          }),
        ),
      );
    }

    const facets = await store.buildCachedFacets();
    expect(facets.correspondents.map((c) => [c.slug, c.count])).toEqual([
      ["stadtwerke", 2],
      ["finanzamt", 1],
    ]);
    expect(facets.tags[0]).toMatchObject({ slug: "wohnung", count: 3 });
    expect(facets.statuses).toEqual([{ status: "ready", count: 3 }]);
  });

  it("summarises the dashboard from the cache", async () => {
    const { store } = createStore();
    await store.upsertCachedDocument(
      testRecord(
        testDocument({
          id: "aaaaaaaa-0000-4000-8000-000000000001",
          reviewStatus: "pending",
          correspondent: { id: "c1", name: "Stadtwerke", slug: "stadtwerke" },
          documentType: { id: "t1", name: "Rechnung", slug: "rechnung" },
          amount: 42,
          currency: "EUR",
        }),
      ),
    );

    const dashboard = await store.buildCachedDashboard();
    expect(dashboard.stats).toEqual({
      totalDocuments: 1,
      pendingReview: 1,
      documentTypesCount: 1,
      correspondentsCount: 1,
    });
    expect(dashboard.topCorrespondents[0]).toMatchObject({
      slug: "stadtwerke",
      documentCount: 1,
      totalAmount: 42,
      currency: "EUR",
    });
  });

  it("leaves a completed task out of the deadlines", async () => {
    const { store } = createStore();
    await store.upsertCachedDocument(
      testRecord(
        testDocument({
          id: "aaaaaaaa-0000-4000-8000-000000000001",
          dueDate: "2026-12-01",
          taskCompletedAt: "2026-11-01T09:00:00.000Z",
        }),
      ),
    );

    const dashboard = await store.buildCachedDashboard();
    expect(dashboard.upcomingDeadlines).toHaveLength(0);
    expect(dashboard.overdueItems).toHaveLength(0);
  });

  // The suite runs in America/Los_Angeles (see jest.config.js), where a
  // date-only value read as UTC midnight lands on the previous day. Until #207
  // this reported 2025 and 2025-12.
  it("keeps a January document in its own year and month", async () => {
    const { store } = createStore();
    await store.upsertCachedDocument(
      testRecord(testDocument({ issueDate: "2026-01-01", createdAt: "2026-01-01T00:00:00.000Z" })),
    );

    const facets = await store.buildCachedFacets();
    expect(facets.years).toEqual([{ year: 2026, count: 1 }]);

    const dashboard = await store.buildCachedDashboard();
    expect(dashboard.monthlyActivity).toEqual([{ month: "2026-01", count: 1 }]);
  });
});

describe("filtering, sorting, and paging by date", () => {
  async function seeded() {
    const { store } = createStore();
    const rows: Array<[string, string | null, string | null]> = [
      // title, issueDate, dueDate
      ["Januar", "2026-01-15", "2026-02-01"],
      ["März", "2026-03-20", null],
      ["Vorjahr", "2025-11-02", "2026-01-10"],
    ];
    for (const [index, [title, issueDate, dueDate]] of rows.entries()) {
      await store.upsertCachedDocument(
        testRecord(
          testDocument({
            id: `aaaaaaaa-0000-4000-8000-00000000000${index + 1}`,
            title,
            issueDate,
            dueDate,
            createdAt: `${issueDate}T12:00:00.000Z`,
          }),
        ),
      );
    }
    return store;
  }

  it("filters by the year a document is filed under", async () => {
    const store = await seeded();
    const page = await store.searchCachedDocuments({ year: 2026 });
    expect(page.items.map((document) => document.title).sort()).toEqual(["Januar", "März"]);
    expect(page.total).toBe(2);
  });

  it("filters by a date range over the filed date", async () => {
    const store = await seeded();
    expect(
      (await store.searchCachedDocuments({ dateFrom: "2026-01-01", dateTo: "2026-02-28" })).items.map(
        (document) => document.title,
      ),
    ).toEqual(["Januar"]);
  });

  it("filters by a due-date range", async () => {
    const store = await seeded();
    expect(
      (await store.searchCachedDocuments({ dueDateTo: "2026-01-31" })).items.map((d) => d.title),
    ).toEqual(["Vorjahr"]);
  });

  it("sorts by issue date in both directions", async () => {
    const store = await seeded();
    expect(
      (await store.searchCachedDocuments({ sort: "issueDate", direction: "asc" })).items.map(
        (d) => d.title,
      ),
    ).toEqual(["Vorjahr", "Januar", "März"]);
    expect(
      (await store.searchCachedDocuments({ sort: "issueDate", direction: "desc" })).items.map(
        (d) => d.title,
      ),
    ).toEqual(["März", "Januar", "Vorjahr"]);
  });

  it("puts a document with no due date last when sorting by due date, as the archive does", async () => {
    const store = await seeded();
    // SQLite would sort the NULL first ascending; Postgres sorts it last. The
    // offline list must not reorder around a missing value.
    expect(
      (await store.searchCachedDocuments({ sort: "dueDate", direction: "asc" })).items.map(
        (d) => d.title,
      ),
    ).toEqual(["Vorjahr", "Januar", "März"]);
  });

  it("pages in SQL, so the total and the page agree", async () => {
    const store = await seeded();
    const first = await store.searchCachedDocuments({
      sort: "issueDate",
      direction: "asc",
      page: 1,
      pageSize: 2,
    });
    const second = await store.searchCachedDocuments({
      sort: "issueDate",
      direction: "asc",
      page: 2,
      pageSize: 2,
    });

    expect(first.items.map((d) => d.title)).toEqual(["Vorjahr", "Januar"]);
    expect(first.total).toBe(3);
    // The second page was unreachable while the caller sliced in JavaScript.
    expect(second.items.map((d) => d.title)).toEqual(["März"]);
    expect(second.total).toBe(3);
    expect(second.page).toBe(2);
  });

  it("keeps most-recently-opened order when no sort is asked for", async () => {
    const store = await seeded();
    expect((await store.searchCachedDocuments()).items).toHaveLength(3);
  });

  it("caps an unreasonable page size instead of reading the whole cache", async () => {
    const store = await seeded();
    expect((await store.searchCachedDocuments({ pageSize: 5000 })).pageSize).toBe(100);
    expect((await store.searchCachedDocuments({ page: 0, pageSize: 0 })).page).toBe(1);
  });
});
