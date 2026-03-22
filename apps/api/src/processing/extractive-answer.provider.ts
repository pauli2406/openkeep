import { Injectable } from "@nestjs/common";
import type { AnswerCitation, AnswerQueryResponse, SemanticSearchResult } from "@openkeep/types";

import type { AnswerProvider } from "./provider.types";

@Injectable()
export class ExtractiveAnswerProvider implements AnswerProvider {
  async answer(input: {
    question: string;
    results: SemanticSearchResult[];
    maxCitations: number;
  }): Promise<{
    status: AnswerQueryResponse["status"];
    answer: string | null;
    reasoning: string | null;
    citations: AnswerCitation[];
  }> {
    const citations = this.collectCitations(input.results, input.maxCitations);

    if (citations.length === 0) {
      return {
        status: "insufficient_evidence",
        answer: null,
        reasoning:
          "No sufficiently relevant chunks were found for a grounded answer.",
        citations: [],
      };
    }

    const best = citations[0]!;
    const supporting = citations.slice(1, 3);
    const supportSummary =
      supporting.length > 0
        ? ` Supporting evidence also appears in ${supporting
            .map((citation) => this.describeCitation(citation))
            .join(", ")}.`
        : "";

    return {
      status: "answered",
      answer:
        `Based on the indexed archive, the strongest answer to "${input.question}" is: ` +
        `${best.quote}${supportSummary}`,
      reasoning:
        "The answer is grounded in the highest-ranked semantic matches and returned only when at least one chunk cleared the evidence threshold.",
      citations,
    };
  }

  private collectCitations(
    results: SemanticSearchResult[],
    maxCitations: number,
  ): AnswerCitation[] {
    const citations: AnswerCitation[] = [];
    const seen = new Set<string>();

    for (const result of results) {
      for (const chunk of result.matchedChunks) {
        const key = `${result.document.id}:${chunk.chunkIndex}`;
        if (seen.has(key)) {
          continue;
        }

        citations.push({
          documentId: result.document.id,
          documentTitle: result.document.title,
          chunkIndex: chunk.chunkIndex,
          pageFrom: chunk.pageFrom,
          pageTo: chunk.pageTo,
          quote: this.normalizeQuote(chunk.text),
          score: chunk.score,
        });
        seen.add(key);

        if (citations.length >= maxCitations) {
          return citations;
        }
      }
    }

    return citations;
  }

  private normalizeQuote(text: string): string {
    return text.replace(/\s+/g, " ").trim().slice(0, 280);
  }

  private describeCitation(citation: AnswerCitation): string {
    const pageLabel =
      citation.pageFrom && citation.pageTo && citation.pageFrom !== citation.pageTo
        ? `pages ${citation.pageFrom}-${citation.pageTo}`
        : citation.pageFrom
          ? `page ${citation.pageFrom}`
          : "an unpaged chunk";

    return `"${citation.documentTitle}" (${pageLabel})`;
  }
}
