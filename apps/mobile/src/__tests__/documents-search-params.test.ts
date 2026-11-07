import { buildDocumentsSearchParams } from "../lib";

describe("buildDocumentsSearchParams", () => {
  const base = {
    query: "",
    filter: "all" as const,
    oldestFirst: false,
    currentYear: 2026,
    pageSize: 30,
  };

  it("adds the category filter to the server query", () => {
    const params = new URLSearchParams(
      buildDocumentsSearchParams({ ...base, categoryId: "cat-1" }),
    );
    expect(params.get("categoryIds")).toBe("cat-1");
    expect(params.get("sort")).toBe("createdAt");
  });

  it("carries no category param when the caller dropped it (offline)", () => {
    const params = new URLSearchParams(
      buildDocumentsSearchParams({ ...base, categoryId: null }),
    );
    expect(params.get("categoryIds")).toBeNull();
  });

  it("composes category with the year chip and due sorting", () => {
    const year = new URLSearchParams(
      buildDocumentsSearchParams({ ...base, filter: "year", categoryId: "cat-1" }),
    );
    expect(year.get("year")).toBe("2026");
    expect(year.get("categoryIds")).toBe("cat-1");

    const due = new URLSearchParams(
      buildDocumentsSearchParams({ ...base, filter: "due", categoryId: "cat-1" }),
    );
    expect(due.get("sort")).toBe("dueDate");
    expect(due.get("direction")).toBe("asc");
    expect(due.get("categoryIds")).toBe("cat-1");
  });
});

describe("buildDocumentsSearchParams with the explorer's filters", () => {
  const params = (input: Partial<Parameters<typeof buildDocumentsSearchParams>[0]>) =>
    new URLSearchParams(buildDocumentsSearchParams({ pageSize: 30, ...input }));

  it("asks for the requested page", () => {
    expect(params({ page: 3 }).get("page")).toBe("3");
    expect(params({}).get("page")).toBe("1");
  });

  it("sends list filters as repeated keys", () => {
    const search = params({
      statuses: ["ready", "failed"],
      documentTypeIds: ["t-1"],
      correspondentIds: ["c-1", "c-2"],
      categoryIds: ["cat-1"],
      tags: ["tag-1", "tag-2"],
    });
    expect(search.getAll("statuses")).toEqual(["ready", "failed"]);
    expect(search.getAll("documentTypeIds")).toEqual(["t-1"]);
    expect(search.getAll("correspondentIds")).toEqual(["c-1", "c-2"]);
    expect(search.getAll("categoryIds")).toEqual(["cat-1"]);
    expect(search.getAll("tags")).toEqual(["tag-1", "tag-2"]);
  });

  it("leaves unset filters out entirely", () => {
    const search = params({ statuses: [], tags: undefined });
    for (const key of ["statuses", "tags", "year", "uncategorized", "dateFrom", "amountMin"]) {
      expect(search.has(key)).toBe(false);
    }
  });

  it("carries the year, the date range and uncategorized", () => {
    const search = params({
      year: 2025,
      dateFrom: "2025-01-01",
      dateTo: "2025-03-31",
      uncategorized: true,
    });
    expect(search.get("year")).toBe("2025");
    expect(search.get("dateFrom")).toBe("2025-01-01");
    expect(search.get("dateTo")).toBe("2025-03-31");
    expect(search.get("uncategorized")).toBe("true");
  });

  it("treats an amount of zero as a filter", () => {
    const search = params({ amountMin: 0, amountMax: 12.5 });
    expect(search.get("amountMin")).toBe("0");
    expect(search.get("amountMax")).toBe("12.5");
  });

  it("sorts by every field the API knows, and the explicit sort wins", () => {
    for (const sort of ["title", "issueDate", "createdAt", "dueDate"] as const) {
      const search = params({ sort, direction: "asc", filter: "due" });
      expect(search.get("sort")).toBe(sort);
      expect(search.get("direction")).toBe("asc");
    }
  });

  it("trims the search and drops a blank one", () => {
    expect(params({ query: "  strom " }).get("query")).toBe("strom");
    expect(params({ query: "   " }).has("query")).toBe(false);
  });
});
