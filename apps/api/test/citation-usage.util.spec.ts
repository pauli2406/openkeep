import { describe, expect, it } from "vitest";

import {
  annotateCitationUsage,
  buildCitationQuote,
  extractCitedIndices,
  finalizeCitations,
} from "../src/processing/citation-usage.util";

describe("extractCitedIndices", () => {
  it("collects distinct [n] markers", () => {
    expect([...extractCitedIndices("See [1] and [3], also [1] again.")]).toEqual([1, 3]);
  });

  it("ignores non-citation brackets and null answers", () => {
    expect(extractCitedIndices("array[0] but [12ab] and [ 3 ]").size).toBe(0);
    expect(extractCitedIndices(null).size).toBe(0);
  });
});

describe("annotateCitationUsage", () => {
  it("flags only citations whose index appears in the answer", () => {
    const annotated = annotateCitationUsage(
      [{ index: 1 }, { index: 2 }, { index: undefined }],
      "Answer [2].",
    );
    expect(annotated.map((c) => c.used)).toEqual([false, true, false]);
  });
});

describe("finalizeCitations", () => {
  it("keeps all used citations even beyond the cap and fills with unused up to it", () => {
    const result = finalizeCitations(
      [{ index: 1 }, { index: 2 }, { index: 3 }, { index: 4 }],
      "Both [2] and [4].",
      3,
    );
    expect(result.map((c) => [c.index, c.used])).toEqual([
      [1, false],
      [2, true],
      [4, true],
    ]);
  });
});

describe("buildCitationQuote", () => {
  it("returns short quotes unchanged and collapses whitespace", () => {
    expect(buildCitationQuote("Hello  \n world.")).toBe("Hello world.");
  });

  it("cuts at a sentence boundary instead of mid-sentence, without ellipsis", () => {
    const sentence = "This is a complete sentence that ends properly. ";
    const quote = buildCitationQuote(sentence.repeat(10), 120);
    expect(quote.endsWith(".")).toBe(true);
    expect(quote.length).toBeLessThanOrEqual(120);
    // No ellipsis: clients match the quote verbatim against document text.
    expect(quote.includes("…")).toBe(false);
  });

  it("falls back to a word boundary when no sentence end is in range", () => {
    const quote = buildCitationQuote("word ".repeat(100), 50);
    expect(quote.length).toBeLessThanOrEqual(50);
    expect(quote.endsWith("word")).toBe(true);
  });
});
