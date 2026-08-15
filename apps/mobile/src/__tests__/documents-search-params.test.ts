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
