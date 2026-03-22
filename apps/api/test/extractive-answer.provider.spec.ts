import type { SemanticSearchResult } from "@openkeep/types";
import { describe, expect, it } from "vitest";

import { ExtractiveAnswerProvider } from "../src/processing/extractive-answer.provider";

function makeResult(input: {
  documentId: string;
  title: string;
  matchedChunks: Array<{
    chunkIndex: number;
    text: string;
    score: number;
    pageFrom?: number | null;
    pageTo?: number | null;
  }>;
}): SemanticSearchResult {
  return {
    document: {
      id: input.documentId,
      title: input.title,
    } as SemanticSearchResult["document"],
    score: Math.max(...input.matchedChunks.map((chunk) => chunk.score)),
    semanticScore: null,
    keywordScore: null,
    matchedChunks: input.matchedChunks.map((chunk) => ({
      chunkIndex: chunk.chunkIndex,
      heading: null,
      text: chunk.text,
      pageFrom: chunk.pageFrom ?? null,
      pageTo: chunk.pageTo ?? null,
      score: chunk.score,
      distance: null,
    })),
  };
}

describe("ExtractiveAnswerProvider", () => {
  const provider = new ExtractiveAnswerProvider();

  it("returns insufficient_evidence when all chunks are below the evidence threshold", async () => {
    const response = await provider.answer({
      question: "What is the amount due?",
      maxCitations: 3,
      results: [
        makeResult({
          documentId: "11111111-1111-1111-1111-111111111111",
          title: "Weak invoice",
          matchedChunks: [
            {
              chunkIndex: 0,
              text: "The scan mentions several totals but nothing is clear.",
              score: 0.54,
              pageFrom: 1,
              pageTo: 1,
            },
          ],
        }),
      ],
    });

    expect(response.status).toBe("insufficient_evidence");
    expect(response.answer).toBeNull();
    expect(response.citations).toEqual([]);
  });

  it("deduplicates overlapping chunks before selecting citations", async () => {
    const response = await provider.answer({
      question: "What is the amount due?",
      maxCitations: 3,
      results: [
        makeResult({
          documentId: "11111111-1111-1111-1111-111111111111",
          title: "Invoice A",
          matchedChunks: [
            {
              chunkIndex: 0,
              text: "Amount due is EUR 42.50 and must be paid by the end of the month.",
              score: 0.92,
              pageFrom: 1,
              pageTo: 1,
            },
            {
              chunkIndex: 1,
              text: "Amount due is EUR 42.50 and must be paid by end of month.",
              score: 0.91,
              pageFrom: 1,
              pageTo: 1,
            },
          ],
        }),
        makeResult({
          documentId: "22222222-2222-2222-2222-222222222222",
          title: "Invoice B",
          matchedChunks: [
            {
              chunkIndex: 0,
              text: "The invoice total shown here is EUR 42.50.",
              score: 0.83,
              pageFrom: 2,
              pageTo: 2,
            },
          ],
        }),
      ],
    });

    expect(response.status).toBe("answered");
    expect(response.citations).toHaveLength(2);
    expect(response.citations[0]?.documentId).toBe("11111111-1111-1111-1111-111111111111");
    expect(response.citations[1]?.documentId).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("breaks score ties by preferring narrower and earlier page spans", async () => {
    const response = await provider.answer({
      question: "Which clause mentions the cancellation deadline?",
      maxCitations: 3,
      results: [
        makeResult({
          documentId: "33333333-3333-3333-3333-333333333333",
          title: "Contract",
          matchedChunks: [
            {
              chunkIndex: 0,
              text: "Cancellation requires 30 days notice before renewal.",
              score: 0.88,
              pageFrom: 4,
              pageTo: 5,
            },
            {
              chunkIndex: 1,
              text: "Cancellation requires 30 days notice before renewal.",
              score: 0.88,
              pageFrom: 2,
              pageTo: 2,
            },
          ],
        }),
      ],
    });

    expect(response.status).toBe("answered");
    expect(response.answer).toContain("30 days notice");
    expect(response.citations[0]?.pageFrom).toBe(2);
    expect(response.citations[0]?.pageTo).toBe(2);
  });
});
