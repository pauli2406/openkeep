import { Injectable } from "@nestjs/common";
import type { AnswerCitation, AnswerQueryResponse, SemanticSearchResult } from "@openkeep/types";

import type { AnswerProvider } from "./provider.types";

@Injectable()
export class ExtractiveAnswerProvider implements AnswerProvider {
  private static readonly MIN_EVIDENCE_SCORE = 0.55;

  async answer(input: {
    question: string;
    results: SemanticSearchResult[];
    maxCitations: number;
    responseLanguage?: "en" | "de" | null;
  }): Promise<{
    status: AnswerQueryResponse["status"];
    answer: string | null;
    reasoning: string | null;
    citations: AnswerCitation[];
  }> {
    const citations = this.collectCitations(input.results, input.maxCitations);

    if (
      citations.length === 0 ||
      (citations[0]?.score ?? 0) < ExtractiveAnswerProvider.MIN_EVIDENCE_SCORE
    ) {
      return {
        status: "insufficient_evidence",
        answer: null,
        reasoning:
          "No sufficiently relevant chunks were found for a grounded answer.",
        citations: [],
      };
    }

    const best = citations[0]!;
    const selected = this.selectBestCitation(citations, input.question);
    const supporting = citations.slice(1, 3).map((citation) => this.describeCitation(citation));

    return {
      status: "answered",
      answer: selected.quote,
      reasoning:
        supporting.length > 0
          ? `Answer selected from the highest-scoring grounded chunk, with corroborating evidence in ${supporting.join(", ")}.`
          : "Answer selected from the highest-scoring grounded chunk after filtering weak and duplicate evidence.",
      citations,
    };
  }

  private collectCitations(
    results: SemanticSearchResult[],
    maxCitations: number,
  ): AnswerCitation[] {
    const ranked = results
      .flatMap((result, resultIndex) =>
        result.matchedChunks.map((chunk) => ({
          documentId: result.document.id,
          documentTitle: result.document.title,
          chunkIndex: chunk.chunkIndex,
          pageFrom: chunk.pageFrom,
          pageTo: chunk.pageTo,
          quote: this.normalizeQuote(chunk.text),
          score: chunk.score,
          resultScore: result.score,
          resultIndex,
        })),
      )
      .filter((citation) => citation.score >= ExtractiveAnswerProvider.MIN_EVIDENCE_SCORE)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        if (right.resultScore !== left.resultScore) {
          return right.resultScore - left.resultScore;
        }

        if (left.resultIndex !== right.resultIndex) {
          return left.resultIndex - right.resultIndex;
        }

        const leftSpan = this.pageSpan(left);
        const rightSpan = this.pageSpan(right);
        if (leftSpan !== rightSpan) {
          return leftSpan - rightSpan;
        }

        return (left.pageFrom ?? Number.MAX_SAFE_INTEGER) - (right.pageFrom ?? Number.MAX_SAFE_INTEGER);
      });

    const citations: AnswerCitation[] = [];
    for (const citation of ranked) {
      if (
        citations.some((existing) => this.isDuplicateCitation(existing, citation))
      ) {
        continue;
      }

      citations.push(citation);
      if (citations.length >= maxCitations) {
        return citations;
      }
    }

    return citations;
  }

  private normalizeQuote(text: string): string {
    return text.replace(/\s+/g, " ").trim().slice(0, 280);
  }

  private selectBestCitation(citations: AnswerCitation[], question: string): AnswerCitation {
    if (citations.length === 0) {
      throw new Error("Expected at least one citation");
    }

    if (!/amount|betrag|total|summe|due/i.test(question)) {
      return citations[0]!;
    }

    const clusters = new Map<
      string,
      { totalScore: number; count: number; bestCitation: AnswerCitation }
    >();

    for (const citation of citations) {
      const amountKey = this.extractAmountFingerprint(citation.quote);
      if (!amountKey) {
        continue;
      }

      const existing = clusters.get(amountKey);
      if (!existing) {
        clusters.set(amountKey, {
          totalScore: citation.score,
          count: 1,
          bestCitation: citation,
        });
        continue;
      }

      existing.totalScore += citation.score;
      existing.count += 1;
      if (citation.score > existing.bestCitation.score) {
        existing.bestCitation = citation;
      }
    }

    const strongestCluster = [...clusters.values()].sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return right.totalScore - left.totalScore;
    })[0];

    return strongestCluster?.bestCitation ?? citations[0]!;
  }

  private extractAmountFingerprint(text: string): string | null {
    const match = text.match(/(?:EUR|USD|GBP|CHF|\$|€|£)?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})/i);
    if (!match) {
      return null;
    }

    return match[0].replace(/\s+/g, "").replace(/,/g, ".").toUpperCase();
  }

  private normalizedFingerprint(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  }

  private isDuplicateCitation(left: AnswerCitation, right: AnswerCitation): boolean {
    if (
      left.documentId === right.documentId &&
      left.chunkIndex === right.chunkIndex
    ) {
      return true;
    }

    const leftFingerprint = this.normalizedFingerprint(left.quote);
    const rightFingerprint = this.normalizedFingerprint(right.quote);
    if (leftFingerprint === rightFingerprint) {
      return true;
    }

    if (
      leftFingerprint.length > 0 &&
      rightFingerprint.length > 0 &&
      (leftFingerprint.includes(rightFingerprint) || rightFingerprint.includes(leftFingerprint))
    ) {
      return true;
    }

    return this.tokenOverlap(leftFingerprint, rightFingerprint) >= 0.9;
  }

  private tokenOverlap(left: string, right: string): number {
    const leftTokens = new Set(left.split(" ").filter(Boolean));
    const rightTokens = new Set(right.split(" ").filter(Boolean));
    if (leftTokens.size === 0 || rightTokens.size === 0) {
      return 0;
    }

    let overlap = 0;
    for (const token of leftTokens) {
      if (rightTokens.has(token)) {
        overlap += 1;
      }
    }

    return overlap / Math.max(leftTokens.size, rightTokens.size);
  }

  private pageSpan(citation: Pick<AnswerCitation, "pageFrom" | "pageTo">): number {
    if (!citation.pageFrom || !citation.pageTo) {
      return Number.MAX_SAFE_INTEGER;
    }

    return citation.pageTo - citation.pageFrom;
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
