import {
  buildFilterChips,
  bulkReprocess,
  bulkSetTag,
  bulkSetType,
  categoryColorIndex,
  clearFacetFilters,
  countActiveFilters,
  exportDocuments,
  exportFileName,
  fetchFacets,
  fetchTimeline,
  flattenDocumentPages,
  formatRowDate,
  matchesCachedFilters,
  monthBounds,
  monthDateRange,
  nextDocumentsPage,
  parseFilterAmount,
  parseFilterDate,
  queryOfflineDocuments,
  smartHighlight,
  toggleValue,
  unpaidByMonth,
  withoutServerOnlyFilters,
} from "../api/documents";
import type {
  ArchiveDocument,
  CorrespondentInsightsResponse,
  FacetsResponse,
  SearchDocumentsResponse,
} from "../lib";

function doc(fields: Partial<ArchiveDocument> & { id: string }): ArchiveDocument {
  return {
    status: "ready",
    amount: null,
    dueDate: null,
    taskCompletedAt: null,
    correspondent: null,
    documentType: null,
    tags: [],
    mimeType: "application/pdf",
    ...fields,
  } as ArchiveDocument;
}

function page(items: ArchiveDocument[], total = items.length): SearchDocumentsResponse {
  return { items, total, page: 1, pageSize: 30 };
}

function ok(body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function failing(): Response {
  return {
    ok: false,
    status: 500,
    headers: new Headers(),
    json: async () => ({ message: "boom" }),
    text: async () => "boom",
  } as unknown as Response;
}

describe("filter state", () => {
  it("counts dimensions, not values, and not the search", () => {
    expect(countActiveFilters({})).toBe(0);
    expect(countActiveFilters({ query: "strom" })).toBe(0);
    expect(countActiveFilters({ statuses: ["ready", "failed"] })).toBe(1);
    expect(countActiveFilters({ statuses: [] })).toBe(0);
    expect(countActiveFilters({ amountMin: 0 })).toBe(1);
    expect(countActiveFilters({ amountMin: 1, amountMax: 2, dateFrom: "2026-01-01", year: 2026 })).toBe(3);
    expect(countActiveFilters({ categoryIds: ["c"], uncategorized: true })).toBe(2);
  });

  it("toggles a value in and out", () => {
    expect(toggleValue(undefined, "a")).toEqual(["a"]);
    expect(toggleValue(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleValue(["a", "b"], "a")).toEqual(["b"]);
  });

  it("keeps the search when the sheet clears its filters", () => {
    expect(clearFacetFilters({ query: "strom", year: 2026, tags: ["t"] })).toEqual({ query: "strom" });
    expect(clearFacetFilters({ year: 2026 })).toEqual({});
  });

  it("drops only the category filters offline", () => {
    expect(
      withoutServerOnlyFilters({ year: 2026, categoryIds: ["c"], uncategorized: true, tags: ["t"] }),
    ).toEqual({ year: 2026, tags: ["t"] });
  });
});

describe("filter chips", () => {
  const facets = {
    correspondents: [{ id: "c-1", name: "Allianz", slug: "allianz", count: 3 }],
    documentTypes: [{ id: "t-1", name: "Invoice", slug: "invoice", count: 3 }],
    tags: [{ id: "tag-1", name: "Home", slug: "home", count: 3 }],
    categories: [{ id: "cat-1", name: "Housing", slug: "housing", count: 3, topCorrespondents: [] }],
    statuses: [],
    years: [],
  } satisfies FacetsResponse;
  const labels = {
    search: "Search",
    uncategorized: "Uncategorized",
    status: (status: string) => status.toUpperCase(),
  };

  it("names each active filter", () => {
    const chips = buildFilterChips(
      {
        query: "strom",
        year: 2026,
        statuses: ["ready"],
        documentTypeIds: ["t-1"],
        categoryIds: ["cat-1"],
        uncategorized: true,
        correspondentIds: ["c-1"],
        tags: ["tag-1"],
        dateFrom: "2026-01-01",
        amountMin: 0,
      },
      facets,
      labels,
    );
    expect(chips.map((chip) => chip.label)).toEqual([
      "Search: strom",
      "2026",
      "READY",
      "Invoice",
      "Housing",
      "Uncategorized",
      "Allianz",
      "Home",
      "2026-01-01 – …",
      "0 – …",
    ]);
  });

  it("removes one value, leaving the others", () => {
    const [chip] = buildFilterChips({ statuses: ["ready", "failed"] }, facets, labels);
    expect(chip.clear).toEqual({ statuses: ["failed"] });
  });

  it("clears a range as a whole", () => {
    const [chip] = buildFilterChips({ dateFrom: "2026-01-01", dateTo: "2026-02-01" }, facets, labels);
    expect(chip.clear).toEqual({ dateFrom: undefined, dateTo: undefined });
  });

  it("never shows a raw id while the facets are on their way", () => {
    const [chip] = buildFilterChips({ correspondentIds: ["c-1"] }, undefined, labels);
    expect(chip.label).toBe("…");
  });
});

describe("typed filter values", () => {
  it("reads dates the two ways people write them here", () => {
    expect(parseFilterDate("2026-03-20")).toBe("2026-03-20");
    expect(parseFilterDate(" 20.03.2026 ")).toBe("2026-03-20");
    expect(parseFilterDate("1.3.2026")).toBe("2026-03-01");
  });

  it("refuses what is not on the calendar, or not finished", () => {
    for (const input of ["2026-02-31", "31.02.2026", "2026-13-01", "2026-03", "20.03.", "soon", ""]) {
      expect(parseFilterDate(input)).toBeNull();
    }
  });

  it("reads a German decimal comma", () => {
    expect(parseFilterAmount("12,5")).toBe(12.5);
    expect(parseFilterAmount("12.5")).toBe(12.5);
    expect(parseFilterAmount("0")).toBe(0);
    expect(parseFilterAmount("12,")).toBe(12);
    expect(parseFilterAmount("-4")).toBe(-4);
  });

  it("refuses what is not an amount", () => {
    for (const input of ["", ",", "abc", "1.2.3"]) {
      expect(parseFilterAmount(input)).toBeNull();
    }
  });
});

describe("aggregate endpoints", () => {
  it("send the filters without paging or order", async () => {
    const authFetch = jest.fn(async (_path: string) => ok({ years: [] }));
    await fetchTimeline(authFetch, { year: 2026, tags: ["t"] });
    const url = authFetch.mock.calls[0][0];
    expect(url.startsWith("/api/documents/timeline?")).toBe(true);
    const search = new URLSearchParams(url.split("?")[1]);
    expect(search.get("year")).toBe("2026");
    expect(search.getAll("tags")).toEqual(["t"]);
    for (const key of ["page", "pageSize", "sort", "direction"]) {
      expect(search.has(key)).toBe(false);
    }
  });

  it("ask the bare endpoint when nothing is filtered", async () => {
    const authFetch = jest.fn(async (_path: string) => ok({}));
    await fetchFacets(authFetch, {});
    expect(authFetch.mock.calls[0][0]).toBe("/api/documents/facets");
  });
});

describe("paging", () => {
  it("asks for the next page until everything is loaded", () => {
    const one = page([doc({ id: "a" }), doc({ id: "b" })], 3);
    expect(nextDocumentsPage([one])).toBe(2);
    expect(nextDocumentsPage([one, page([doc({ id: "c" })], 3)])).toBeUndefined();
  });

  it("stops on an empty page even if the total disagrees", () => {
    expect(nextDocumentsPage([page([doc({ id: "a" })], 5), page([], 5)])).toBeUndefined();
  });

  it("keeps a document once when paging repeats it", () => {
    const documents = flattenDocumentPages([
      page([doc({ id: "a" }), doc({ id: "b" })]),
      page([doc({ id: "b" }), doc({ id: "c" })]),
    ]);
    expect(documents.map((document) => document.id)).toEqual(["a", "b", "c"]);
  });
});

describe("the offline list", () => {
  const sort = { field: "createdAt", direction: "desc" } as const;

  it("reads the filters the mirror has no column for off the document", () => {
    const document = doc({
      id: "a",
      status: "ready",
      amount: 10,
      correspondent: { id: "c-1", name: "A", slug: "a" },
      documentType: { id: "t-1", name: "T", slug: "t" },
      tags: [{ id: "tag-1", name: "Home", slug: "home" }],
    });
    expect(matchesCachedFilters(document, {})).toBe(true);
    expect(matchesCachedFilters(document, { statuses: ["failed"] })).toBe(false);
    expect(matchesCachedFilters(document, { documentTypeIds: ["t-1"] })).toBe(true);
    expect(matchesCachedFilters(document, { correspondentIds: ["c-2"] })).toBe(false);
    expect(matchesCachedFilters(document, { tags: ["tag-2", "tag-1"] })).toBe(true);
    expect(matchesCachedFilters(document, { amountMin: 10, amountMax: 10 })).toBe(true);
    expect(matchesCachedFilters(document, { amountMin: 11 })).toBe(false);
    expect(matchesCachedFilters(doc({ id: "b" }), { amountMax: 10 })).toBe(false);
    expect(matchesCachedFilters(doc({ id: "b" }), { documentTypeIds: ["t-1"] })).toBe(false);
  });

  it("pages in SQL when the mirror can answer alone", async () => {
    const query = jest.fn(async () => page([doc({ id: "a" })], 40));
    const result = await queryOfflineDocuments(query, {
      filters: { query: "strom", year: 2026, dateFrom: "2026-01-01" },
      sort,
      page: 2,
      pageSize: 30,
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith({
      query: "strom",
      year: 2026,
      dateFrom: "2026-01-01",
      sort: "createdAt",
      direction: "desc",
      page: 2,
      pageSize: 30,
    });
    expect(result.total).toBe(40);
  });

  it("walks the mirror when it cannot, so the total counts matches", async () => {
    const all = Array.from({ length: 250 }, (_, index) =>
      doc({ id: `d-${index}`, status: index % 5 === 0 ? "failed" : "ready" }),
    );
    const query = jest.fn(async (options: { page?: number; pageSize?: number }) => {
      const size = options.pageSize ?? 30;
      const start = ((options.page ?? 1) - 1) * size;
      return page(all.slice(start, start + size), all.length);
    });

    const first = await queryOfflineDocuments(query, {
      filters: { statuses: ["failed"] },
      sort,
      page: 1,
      pageSize: 30,
    });
    expect(query).toHaveBeenCalledTimes(3);
    expect(first.total).toBe(50);
    expect(first.items).toHaveLength(30);

    const second = await queryOfflineDocuments(query, {
      filters: { statuses: ["failed"] },
      sort,
      page: 2,
      pageSize: 30,
    });
    expect(second.items).toHaveLength(20);
    expect(second.items[0].id).toBe("d-150");
  });
});

describe("bulk actions", () => {
  it("tags add and remove through one request", async () => {
    const authFetch = jest.fn(async (_path: string, _init?: RequestInit) => ok({ updated: [], failed: [] }));
    await bulkSetTag(authFetch, ["a", "b"], "tag-1", "remove");
    const [path, init] = authFetch.mock.calls[0];
    expect(path).toBe("/api/documents/bulk/tags");
    expect(JSON.parse(String(init?.body))).toEqual({
      documentIds: ["a", "b"],
      tagId: "tag-1",
      action: "remove",
    });
  });

  it("sends null to clear the type", async () => {
    const authFetch = jest.fn(async (_path: string, _init?: RequestInit) => ok({ updated: [], failed: [] }));
    await bulkSetType(authFetch, ["a"], null);
    const [path, init] = authFetch.mock.calls[0];
    expect(path).toBe("/api/documents/bulk/type");
    expect(JSON.parse(String(init?.body))).toEqual({ documentIds: ["a"], documentTypeId: null });
  });

  it("stays within what the API takes per request", async () => {
    const ids = Array.from({ length: 450 }, (_, index) => `d-${index}`);
    const authFetch = jest.fn(async (_path: string, _init?: RequestInit) => ok({ updated: [], failed: [] }));
    await bulkSetTag(authFetch, ids, "tag-1", "add");
    const sizes = authFetch.mock.calls.map(
      ([, init]) => JSON.parse(String(init?.body)).documentIds.length,
    );
    expect(sizes).toEqual([200, 200, 50]);
  });

  it("reports what failed, including a whole failed request", async () => {
    const ids = Array.from({ length: 201 }, (_, index) => `d-${index}`);
    const authFetch = jest
      .fn<Promise<Response>, [string, RequestInit?]>()
      .mockResolvedValueOnce(ok({ updated: [], failed: [{ id: "d-3", reason: "gone" }] }))
      .mockResolvedValueOnce(failing());
    await expect(bulkSetType(authFetch, ids, "t-1")).resolves.toEqual({
      failed: ["d-3", "d-200"],
    });
  });

  it("reprocesses the selection, and a refusal is an error", async () => {
    const authFetch = jest.fn(async (_path: string, _init?: RequestInit) => ok({ queued: true }));
    await bulkReprocess(authFetch, ["a"]);
    const [path, init] = authFetch.mock.calls[0];
    expect(path).toBe("/api/documents/reprocess/bulk");
    expect(JSON.parse(String(init?.body))).toEqual({ scope: "selected", documentIds: ["a"] });

    await expect(bulkReprocess(async () => failing(), ["a"])).rejects.toThrow();
  });
});

describe("export", () => {
  it("keeps the server's name", () => {
    expect(
      exportFileName('attachment; filename="Rechnung März.pdf"', { id: "a", mimeType: "application/pdf" }),
    ).toBe("Rechnung März.pdf");
    expect(exportFileName("attachment; filename=scan.png", { id: "a", mimeType: "image/png" })).toBe(
      "scan.png",
    );
  });

  it("does not let a name leave the cache directory", () => {
    const document = { id: "a", mimeType: "application/pdf" };
    expect(exportFileName('attachment; filename="../../etc/passwd"', document)).toBe("passwd");
    expect(exportFileName('attachment; filename="..\\evil.pdf"', document)).toBe("evil.pdf");
    expect(exportFileName('attachment; filename=".."', document)).toBe("openkeep-a.pdf");
  });

  it("builds a name with the right extension otherwise", () => {
    expect(exportFileName(null, { id: "a", mimeType: "application/pdf" })).toBe("openkeep-a.pdf");
    expect(exportFileName(null, { id: "a", mimeType: "application/x-unknown" })).toBe("openkeep-a");
  });

  it("delivers one at a time and carries on past a failure", async () => {
    const delivered: string[] = [];
    const authFetch = jest.fn(async (path: string) =>
      path.includes("/b/")
        ? failing()
        : ok({}, { "Content-Disposition": `attachment; filename="${path.split("/")[3]}.pdf"` }),
    );
    const result = await exportDocuments(
      authFetch,
      ["a", "b", "c"].map((id) => ({ id, mimeType: "application/pdf" })),
      async (_response, filename) => {
        delivered.push(filename);
      },
    );
    expect(delivered).toEqual(["a.pdf", "c.pdf"]);
    expect(result.failed).toEqual(["b"]);
  });

  it("counts a share that fails as failed", async () => {
    const result = await exportDocuments(
      async () => ok({}),
      [{ id: "a", mimeType: "application/pdf" }],
      async () => {
        throw new Error("no sharing");
      },
    );
    expect(result.failed).toEqual(["a"]);
  });
});

describe("the timeline", () => {
  it("bounds a month, leap years and December included", () => {
    expect(monthBounds(2026, 3)).toEqual({ start: "2026-03-01", end: "2026-03-31" });
    expect(monthBounds(2024, 2)).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(monthBounds(2025, 12)).toEqual({ start: "2025-12-01", end: "2025-12-31" });
  });

  it("files a deadline in its own month, west of Greenwich too", () => {
    const counts = unpaidByMonth(
      [
        doc({ id: "a", dueDate: "2026-03-01" }),
        doc({ id: "b", dueDate: "2026-03-15" }),
        doc({ id: "c", dueDate: "2026-02-10" }),
      ],
      new Date(2026, 2, 20, 9),
    );
    expect(counts.get("2026-3")).toBe(2);
    expect(counts.get("2026-2")).toBe(1);
  });

  it("does not count what is done, due today, or still to come", () => {
    const counts = unpaidByMonth(
      [
        doc({ id: "a", dueDate: "2026-03-01", taskCompletedAt: "2026-03-02T00:00:00.000Z" }),
        doc({ id: "b", dueDate: "2026-03-20" }),
        doc({ id: "c", dueDate: "2026-04-01" }),
        doc({ id: "d" }),
      ],
      new Date(2026, 2, 20, 23),
    );
    expect(counts.size).toBe(0);
  });
});

describe("the dossier's highlight", () => {
  const data = (intelligence: unknown, types: Array<{ name: string; count: number }> = []) =>
    ({ intelligence, documentTypeBreakdown: types }) as unknown as CorrespondentInsightsResponse;
  const facts = (...entries: Array<[string, string]>) => ({
    domainInsights: {},
    currentState: entries.map(([label, value]) => ({ label, value })),
  });

  it("prefers the insurance premium", () => {
    expect(
      smartHighlight(
        data({
          currentState: [],
          domainInsights: { insurance: { latestPremiumAmount: 84.5, latestPremiumCurrency: "EUR" } },
        }),
      ),
    ).toEqual({ kind: "latestPremium", value: null, amount: { value: 84.5, currency: "EUR" } });
  });

  it("then the latest amount, then the latest type, whatever their case", () => {
    expect(
      smartHighlight(data(facts(["latest AMOUNT", "€92.00"], ["Latest document type", "Bill"]))),
    ).toEqual({ kind: "latestAmount", value: "€92.00" });
    expect(smartHighlight(data(facts(["Latest document type", "Bill"])))).toEqual({
      kind: "latestType",
      value: "Bill",
    });
  });

  it("falls back to the top type, or to nothing", () => {
    expect(smartHighlight(data(null, [{ name: "Invoice", count: 3 }]))).toEqual({
      kind: "topType",
      value: "Invoice",
    });
    expect(smartHighlight(data(null))).toEqual({ kind: "topType", value: null });
  });
});

describe("presentation", () => {
  it("gives a name the same slot of the palette every time", () => {
    const slot = categoryColorIndex("Stadtwerke München");
    expect(categoryColorIndex("Stadtwerke München")).toBe(slot);
    for (const name of ["", "a", "Allianz", "Finanzamt München", "ready"]) {
      const index = categoryColorIndex(name);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(8);
    }
  });

  it("formats a date-only value as its own calendar day", () => {
    expect(formatRowDate("2026-03-14")).toBe("14.03.2026");
    expect(formatRowDate(null)).toBe("—");
  });
});

describe("monthDateRange", () => {
  it("keeps the whole month when no date filter is active", () => {
    expect(monthDateRange(2026, 3)).toEqual({ dateFrom: "2026-03-01", dateTo: "2026-03-31" });
  });

  it("narrows the month to an active date filter inside it", () => {
    expect(monthDateRange(2026, 3, "2026-03-15", "2026-03-20")).toEqual({
      dateFrom: "2026-03-15",
      dateTo: "2026-03-20",
    });
  });

  it("keeps the month's own edge when the filter reaches past it", () => {
    expect(monthDateRange(2026, 3, "2026-02-10", "2026-03-20")).toEqual({
      dateFrom: "2026-03-01",
      dateTo: "2026-03-20",
    });
    expect(monthDateRange(2026, 3, "2026-03-15", null)).toEqual({
      dateFrom: "2026-03-15",
      dateTo: "2026-03-31",
    });
  });
});
