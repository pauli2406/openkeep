import { findPassage, firstLines } from "../components/Passage";
import type { DocumentTextResponse } from "../lib";

const blocks: DocumentTextResponse["blocks"] = [
  { page: 1, lineIndex: 0, text: "Musterversicherung AG · Kundenservice" },
  { page: 1, lineIndex: 1, text: "Rechnung 4711" },
  { page: 1, lineIndex: 2, text: "Fällig am 18.03.2024" },
  { page: 2, lineIndex: 0, text: "Musterversicherung AG · Kundenservice" },
  { page: 2, lineIndex: 1, text: "Der Beitrag beträgt ab dem 1. April" },
  { page: 2, lineIndex: 2, text: "monatlich 84,50 EUR statt 79,00 EUR" },
] as DocumentTextResponse["blocks"];

/**
 * `findPassage` serves two callers with different needs. A chat citation quotes
 * across line breaks and wants its opening words to be enough; review evidence
 * points at the line a field value came from and must not settle for a prefix
 * that happens to appear elsewhere. The difference is the `allowPrefix` flag,
 * and that is what these tests hold in place.
 */
describe("findPassage", () => {
  it("finds a value regardless of punctuation and case", () => {
    const passage = findPassage(blocks, "18.03.2024");
    expect(passage?.page).toBe(1);
    expect(passage?.lines.find((line) => line.hit)?.text).toContain("18.03.2024");
  });

  it("includes the line before and after the hit", () => {
    const passage = findPassage(blocks, "Rechnung 4711");
    expect(passage?.lines.map((line) => line.hit)).toEqual([false, true, false]);
  });

  it("requires the whole value by default", () => {
    // The first 20 characters of this title do appear, on both pages.
    const needle = "Musterversicherung AG · Beitragsanpassung 2024";
    expect(findPassage(blocks, needle)).toBeNull();
  });

  it("accepts a prefix only when asked", () => {
    const needle = "Musterversicherung AG · Beitragsanpassung 2024";
    expect(findPassage(blocks, needle, { allowPrefix: true })?.page).toBe(1);
  });

  it("prefers the cited page when the text repeats", () => {
    const repeated = "Musterversicherung AG · Kundenservice";
    expect(findPassage(blocks, repeated)?.page).toBe(1);
    expect(findPassage(blocks, repeated, { page: 2 })?.page).toBe(2);
  });

  it("falls back to the whole document when the cited page has no match", () => {
    expect(findPassage(blocks, "Rechnung 4711", { page: 2 })?.page).toBe(1);
  });

  it("ignores needles too short to be evidence", () => {
    expect(findPassage(blocks, "AG")).toBeNull();
    expect(findPassage(blocks, null)).toBeNull();
    expect(findPassage([], "Rechnung 4711")).toBeNull();
  });
});

describe("firstLines", () => {
  it("returns the opening lines with nothing highlighted", () => {
    const passage = firstLines(blocks, 2);
    expect(passage?.lines).toHaveLength(2);
    expect(passage?.lines.every((line) => !line.hit)).toBe(true);
  });

  it("returns null with no text", () => {
    expect(firstLines([], 4)).toBeNull();
  });
});
