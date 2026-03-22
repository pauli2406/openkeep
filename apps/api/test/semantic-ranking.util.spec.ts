import { describe, expect, it } from "vitest";

import { rankHybridResults } from "../src/search/semantic-ranking.util";

describe("rankHybridResults", () => {
  it("weights semantic rank higher than keyword rank", () => {
    const results = rankHybridResults([
      {
        id: "keyword-only",
        keywordRank: 1,
        keywordScore: 0.9,
      },
      {
        id: "semantic-only",
        semanticRank: 1,
        semanticScore: 0.95,
      },
      {
        id: "hybrid",
        keywordRank: 2,
        semanticRank: 2,
        keywordScore: 0.8,
        semanticScore: 0.8,
      },
    ]);

    expect(results[0]?.id).toBe("hybrid");
    expect(results[1]?.id).toBe("semantic-only");
    expect(results[2]?.id).toBe("keyword-only");
  });
});
