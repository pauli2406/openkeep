/**
 * Dates in the offline derivations, in a timezone where getting them wrong is
 * visible. The suite runs in America/Los_Angeles (jest.config.js), so a
 * date-only value read as an instant lands on the previous day — which is how
 * the offline dashboard came to call a document due today overdue, and to file
 * January in the year before.
 *
 * "Today" is injected, so these assertions are about the arithmetic rather than
 * about when the suite happens to run.
 */
import { createOfflineMetadataStore } from "../offline-metadata-store";
import { createTestDatabase, testDocument, testRecord } from "./offline-test-doubles";

function createStore(now: Date) {
  const database = createTestDatabase();
  return createOfflineMetadataStore({
    openDatabase: async () => database,
    now: () => now,
  });
}

let nextId = 0;
function uniqueDocument(overrides: Parameters<typeof testDocument>[0] = {}) {
  nextId += 1;
  return testDocument({
    id: `aaaaaaaa-0000-4000-8000-${String(nextId).padStart(12, "0")}`,
    ...overrides,
  });
}

describe("due dates", () => {
  async function dueOn(dueDate: string, now: Date) {
    const store = createStore(now);
    await store.upsertCachedDocument(
      testRecord(uniqueDocument({ dueDate, title: `Fällig ${dueDate}` })),
    );
    const dashboard = await store.buildCachedDashboard();
    return [...dashboard.upcomingDeadlines, ...dashboard.overdueItems][0];
  }

  it("treats a document due today as due today, not overdue", async () => {
    // Morning, midday, and late evening local time: the same calendar day must
    // give the same answer. The millisecond arithmetic this replaces flipped
    // somewhere in the middle of the day.
    for (const hour of [0, 9, 13, 23]) {
      const item = await dueOn("2026-03-10", new Date(2026, 2, 10, hour, 30));
      expect(item.daysUntilDue).toBe(0);
      expect(item.isOverdue).toBe(false);
    }
  });

  it("counts whole days ahead and behind", async () => {
    expect((await dueOn("2026-03-12", new Date(2026, 2, 10, 22, 0))).daysUntilDue).toBe(2);
    expect((await dueOn("2026-03-09", new Date(2026, 2, 10, 1, 0))).daysUntilDue).toBe(-1);
  });

  it("reports yesterday as overdue", async () => {
    const item = await dueOn("2026-03-09", new Date(2026, 2, 10, 9, 0));
    expect(item.isOverdue).toBe(true);
    expect(item.daysUntilDue).toBe(-1);
  });

  it("counts across a daylight-saving change", async () => {
    // Clocks go forward on 8 March 2026 in this zone; the day count must not
    // absorb the missing hour.
    const item = await dueOn("2026-03-09", new Date(2026, 2, 6, 12, 0));
    expect(item.daysUntilDue).toBe(3);
  });

  it("sorts the deadlines by their day", async () => {
    const store = createStore(new Date(2026, 2, 10, 9, 0));
    for (const dueDate of ["2026-03-20", "2026-03-11", "2026-03-15"]) {
      await store.upsertCachedDocument(testRecord(uniqueDocument({ dueDate, title: dueDate })));
    }

    const dashboard = await store.buildCachedDashboard();
    expect(dashboard.upcomingDeadlines.map((item) => item.dueDate)).toEqual([
      "2026-03-11",
      "2026-03-15",
      "2026-03-20",
    ]);
  });

  it("splits upcoming from overdue around today", async () => {
    const store = createStore(new Date(2026, 2, 10, 9, 0));
    for (const dueDate of ["2026-03-09", "2026-03-10", "2026-03-11"]) {
      await store.upsertCachedDocument(testRecord(uniqueDocument({ dueDate, title: dueDate })));
    }

    const dashboard = await store.buildCachedDashboard();
    expect(dashboard.overdueItems.map((item) => item.dueDate)).toEqual(["2026-03-09"]);
    expect(dashboard.upcomingDeadlines.map((item) => item.dueDate)).toEqual([
      "2026-03-10",
      "2026-03-11",
    ]);
  });
});

describe("years and months", () => {
  it("files a document on its own local day, at either end of the year", async () => {
    const store = createStore(new Date(2026, 5, 1));
    for (const issueDate of ["2026-01-01", "2025-12-31"]) {
      await store.upsertCachedDocument(testRecord(uniqueDocument({ issueDate })));
    }

    const facets = await store.buildCachedFacets();
    expect(facets.years).toEqual([
      { year: 2026, count: 1 },
      { year: 2025, count: 1 },
    ]);

    const dashboard = await store.buildCachedDashboard();
    expect(dashboard.monthlyActivity).toEqual([
      { month: "2025-12", count: 1 },
      { month: "2026-01", count: 1 },
    ]);
  });

  it("falls back to the created timestamp when a document has no issue date", async () => {
    const store = createStore(new Date(2026, 5, 1));
    await store.upsertCachedDocument(
      testRecord(uniqueDocument({ issueDate: null, createdAt: "2026-04-15T18:00:00.000Z" })),
    );

    const facets = await store.buildCachedFacets();
    expect(facets.years).toEqual([{ year: 2026, count: 1 }]);
  });

  it("leaves an unparseable date out instead of counting a year of NaN", async () => {
    const store = createStore(new Date(2026, 5, 1));
    await store.upsertCachedDocument(
      testRecord(uniqueDocument({ issueDate: "not-a-date", createdAt: "also-not-a-date" })),
    );

    expect((await store.buildCachedFacets()).years).toEqual([]);
    expect((await store.buildCachedDashboard()).monthlyActivity).toEqual([]);
  });
});

describe("a correspondent's latest document", () => {
  it("compares dates as dates, not as strings", async () => {
    const store = createStore(new Date(2026, 5, 1));
    const correspondent = { id: "c1", name: "Stadtwerke", slug: "stadtwerke" };
    // Same calendar day, one a date-only value and one a timestamp. Sorted as
    // strings the shorter value always loses, because it is a prefix of the
    // longer one — so the earlier document won. As dates, local midnight on the
    // 9th is 07:00Z, which is after 03:00Z.
    await store.upsertCachedDocument(
      testRecord(uniqueDocument({ correspondent, issueDate: "2026-05-09" })),
    );
    await store.upsertCachedDocument(
      testRecord(
        uniqueDocument({ correspondent, issueDate: null, createdAt: "2026-05-09T03:00:00.000Z" }),
      ),
    );

    const dashboard = await store.buildCachedDashboard();
    expect(dashboard.topCorrespondents[0].latestDocDate).toBe("2026-05-09");
  });
});
