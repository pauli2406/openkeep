export interface HybridRankInput {
  id: string;
  keywordRank?: number;
  keywordScore?: number | null;
  semanticRank?: number;
  semanticScore?: number | null;
}

const RRF_K = 60;
const KEYWORD_WEIGHT = 1;
const SEMANTIC_WEIGHT = 2;

export const rankHybridResults = (inputs: HybridRankInput[]) =>
  [...inputs]
    .map((input) => ({
      ...input,
      score:
        (input.keywordRank ? KEYWORD_WEIGHT / (RRF_K + input.keywordRank) : 0) +
        (input.semanticRank ? SEMANTIC_WEIGHT / (RRF_K + input.semanticRank) : 0),
    }))
    .sort((left, right) => right.score - left.score || right.id.localeCompare(left.id));
