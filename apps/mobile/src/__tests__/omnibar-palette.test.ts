import {
  buildFollowUps,
  buildPaletteRows,
  buildSuggestions,
  citedPageOf,
  groupBlocksByPage,
  isCitedBlock,
} from "../components/chat/palette";

const t = (key: string) => key;
const facets = {
  correspondents: [{ id: "c-1", name: "Stadtwerke", slug: "s", count: 2 }],
  documentTypes: [{ id: "t-1", name: "Invoice", slug: "i", count: 2 }],
  tags: [{ id: "g-1", name: "Stadt", slug: "st", count: 1 }],
};
const base = { suggestions: [], recents: [], facets, online: true, t: t as never };

describe("the palette", () => {
  it("opens with suggestions, recent questions and the first jumps", () => {
    const rows = buildPaletteRows({
      ...base,
      query: "",
      suggestions: ["A", "B", "C", "D"],
      recents: ["B", "E", "F"],
    });
    expect(rows.filter((row) => row.section === "ask").map((row) => row.label)).toEqual(["A", "B", "C"]);
    // The first two recent questions, minus what a suggestion already offers.
    expect(rows.filter((row) => row.section === "recent").map((row) => row.label)).toEqual(["E"]);
    expect(rows.filter((row) => row.section === "jump")).toHaveLength(4);
  });

  it("puts the ask row first while typing, then what matches", () => {
    const rows = buildPaletteRows({ ...base, query: "stadt" });
    expect(rows[0]).toMatchObject({ section: "ask", action: { kind: "ask", query: "stadt" } });
    expect(rows.slice(1).map((row) => row.id)).toEqual(["c-c-1", "g-g-1"]);
  });

  it("filters Documents by what was picked", () => {
    const rows = buildPaletteRows({ ...base, query: "invoice" });
    expect(rows.find((row) => row.id === "t-t-1")?.action).toEqual({
      kind: "tab",
      route: "Documents",
      applyFilters: { documentTypeIds: ["t-1"] },
    });
    const tags = buildPaletteRows({ ...base, query: "stadt" });
    expect(tags.find((row) => row.id === "g-g-1")?.action).toMatchObject({
      applyFilters: { tags: ["g-1"] },
    });
  });

  it("switches to commands on `>` and asks nothing there", () => {
    const rows = buildPaletteRows({ ...base, query: ">" });
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.section === "actions")).toBe(true);
    expect(rows.some((row) => row.action.kind === "ask")).toBe(false);
  });

  it("narrows the commands by the text after `>`", () => {
    const rows = buildPaletteRows({ ...base, query: ">taxes" });
    expect(rows.map((row) => row.id)).toEqual(["go-taxes"]);
  });

  it("offers nothing to ask offline, in any state", () => {
    const opening = buildPaletteRows({
      ...base,
      online: false,
      query: "",
      suggestions: ["A"],
      recents: ["B"],
    });
    const typing = buildPaletteRows({
      ...base,
      online: false,
      query: "haus",
      cachedDocuments: [{ id: "d-1", title: "Hausrat" }],
    });
    for (const row of [...opening, ...typing]) {
      expect(row.action.kind).not.toBe("ask");
    }
    expect(typing.map((row) => row.action.kind)).toEqual(["document"]);
  });

  it("carries the review count on its jump", () => {
    const rows = buildPaletteRows({ ...base, query: "", pendingReview: 3 });
    expect(rows.find((row) => row.id === "go-review")?.label).toBe("omnibar.goReview · 3");
  });
});

describe("suggestions", () => {
  it("comes from what the archive holds, capped at five", () => {
    const items = buildSuggestions(
      {
        ...facets,
        correspondents: [...facets.correspondents, { id: "c-2", name: "Allianz", slug: "a", count: 1 }],
        years: [{ year: 2025, count: 1 }, { year: 2026, count: 1 }],
      },
      { overdueItems: [{}], upcomingDeadlines: [{}] },
      t as never,
    );
    expect(items).toHaveLength(5);
    expect(items[0]).toBe("omnibar.suggestOverdue");
  });

  it("has nothing to say before anything has loaded", () => {
    expect(buildSuggestions(undefined, undefined, t as never)).toEqual([]);
  });
});

describe("follow-ups", () => {
  it("always offers to go deeper, and more when the first hit says who and what", () => {
    expect(buildFollowUps("q", undefined, t as never)).toHaveLength(1);
    expect(
      buildFollowUps(
        "q",
        { correspondent: { name: "A" }, documentType: { name: "B" } },
        t as never,
      ),
    ).toHaveLength(3);
  });
});

describe("the cited passage", () => {
  const blocks = [
    { documentId: "d", page: 2, lineIndex: 1, text: "monatlich 84,50 EUR statt 79,00 EUR." },
    { documentId: "d", page: 2, lineIndex: 0, text: "Ihr Beitrag beträgt ab dem 1. April" },
    { documentId: "d", page: 1, lineIndex: 0, text: "Allianz" },
  ];

  it("groups the text by page, in reading order", () => {
    const pages = groupBlocksByPage(blocks);
    expect(pages.map((page) => page.page)).toEqual([1, 2]);
    expect(pages[1].blocks.map((block) => block.lineIndex)).toEqual([0, 1]);
  });

  it("finds the page from the citation, or failing that from the quote", () => {
    const pages = groupBlocksByPage(blocks);
    expect(citedPageOf({ pageFrom: 7 }, pages)).toBe(7);
    expect(citedPageOf({ quote: "MONATLICH 84,50" }, pages)).toBe(2);
    expect(citedPageOf({ quote: "not in here" }, pages)).toBeNull();
    expect(citedPageOf({}, pages)).toBeNull();
  });

  it("marks a line holding the quote, even with its closing full stop", () => {
    expect(isCitedBlock("monatlich 84,50 EUR statt 79,00 EUR", "monatlich 84,50 EUR statt 79,00 EUR.")).toBe(true);
  });

  it("marks each line of a quote that spans several", () => {
    const quote = "Ihr Beitrag beträgt ab dem 1. April monatlich 84,50 EUR";
    expect(isCitedBlock(quote, "Ihr Beitrag beträgt ab dem 1. April")).toBe(true);
    expect(isCitedBlock(quote, "Die Anpassung folgt der Schadensentwicklung.")).toBe(false);
  });

  it("does not match on a line too short to mean anything", () => {
    expect(isCitedBlock("Die Summe beträgt 1 Euro", "1")).toBe(false);
    expect(isCitedBlock(undefined, "Ihr Beitrag beträgt")).toBe(false);
  });
});
