import { describe, expect, it, vi } from "vitest";

import type { SemanticSearchResult } from "@openkeep/types";
import { LlmAnswerProvider } from "../src/processing/llm-answer.provider";
import {
  DOCUMENT_QA_FULL_TEXT_MAX_CHARS,
  shouldUseFullDocumentContext,
} from "../src/processing/relevance.constants";

const makeResult = (
  chunkScores: number[],
  overrides: Partial<SemanticSearchResult["document"]> = {},
): SemanticSearchResult =>
  ({
    document: {
      id: "11111111-1111-1111-1111-111111111111",
      title: "Stromvertrag 2026",
      issueDate: "2026-01-15",
      correspondent: { id: "c1", name: "Hamburg Energie", slug: "hamburg-energie" },
      documentType: { id: "t1", name: "Contract", slug: "contract" },
      ...overrides,
    },
    score: chunkScores[0] ?? 0,
    matchedChunks: chunkScores.map((score, index) => ({
      chunkIndex: index,
      heading: null,
      text: `Chunk ${index} text about the contract terms.`,
      pageFrom: index + 1,
      pageTo: index + 1,
      score,
    })),
  }) as unknown as SemanticSearchResult;

const makeLlmService = (overrides: Partial<Record<string, unknown>> = {}) =>
  ({
    isConfigured: vi.fn().mockReturnValue(true),
    getProviderInfo: vi.fn().mockReturnValue({ provider: "mistral" }),
    complete: vi.fn().mockResolvedValue("The contract ends in December."),
    completeWithFallback: vi.fn().mockResolvedValue({
      text: "The contract ends in December.",
      provider: "mistral",
      model: "mistral-small-latest",
    }),
    stream: vi.fn(),
    streamWithFallback: vi.fn(),
    ...overrides,
  }) as never;

const extractiveStub = { answer: vi.fn() } as never;

const configStub = (minScore = 0.4) =>
  ({
    get: vi.fn((key: string) => (key === "ANSWER_MIN_CHUNK_SCORE" ? minScore : undefined)),
  }) as never;

describe("LlmAnswerProvider", () => {
  it("refuses with a localized message and zero citations when nothing is relevant", async () => {
    const provider = new LlmAnswerProvider(makeLlmService(), extractiveStub, configStub());

    const result = await provider.answer({
      question: "Wann endet mein Vertrag?",
      results: [makeResult([0.1, 0.05])],
      maxCitations: 6,
      responseLanguage: "de",
    });

    expect(result.status).toBe("insufficient_evidence");
    expect(result.citations).toEqual([]);
    expect(result.answer).toContain("keine ausreichenden Belege");
  });

  it("streams the refusal with an explicit insufficient_evidence status", async () => {
    const provider = new LlmAnswerProvider(makeLlmService(), extractiveStub, configStub());

    const chunks = [];
    for await (const chunk of provider.streamAnswer({
      question: "When does my contract end?",
      results: [makeResult([0.05])],
      maxCitations: 6,
      responseLanguage: "en",
    })) {
      chunks.push(chunk);
    }

    expect(chunks[0]?.text).toContain("sufficient evidence");
    const done = chunks.at(-1);
    expect(done?.done).toBe(true);
    expect(done?.status).toBe("insufficient_evidence");
    expect(done?.citations).toEqual([]);
  });

  it("answers low-confidence from the top chunks on a near miss", async () => {
    const provider = new LlmAnswerProvider(makeLlmService(), extractiveStub, configStub());

    const result = await provider.answer({
      question: "When does my contract end?",
      results: [makeResult([0.35, 0.33, 0.31, 0.3])],
      maxCitations: 6,
      responseLanguage: "en",
    });

    expect(result.status).toBe("answered");
    expect(result.citations).toHaveLength(3);
    expect(result.reasoning).toContain("low retrieval confidence");
  });

  it("keeps only chunks within the near-miss margin in the low-confidence fallback", async () => {
    const provider = new LlmAnswerProvider(makeLlmService(), extractiveStub, configStub());

    const result = await provider.answer({
      question: "When does my contract end?",
      // Only the best chunk is a near miss; 0.05/0.01 are unrelated noise and
      // must not be fed to the model or surfaced as citations.
      results: [makeResult([0.35, 0.05, 0.01])],
      maxCitations: 6,
      responseLanguage: "en",
    });

    expect(result.status).toBe("answered");
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]?.score).toBe(0.35);
  });

  it("reports insufficient evidence when the stream completes without any token", async () => {
    // Fresh generator per call; mocked for both stream entry points so the test
    // holds on layers where the provider uses streamWithFallback.
    const makeEmptyStream = async function* () {
      yield { text: "", done: true };
    };
    const provider = new LlmAnswerProvider(
      makeLlmService({
        stream: vi.fn(makeEmptyStream),
        streamWithFallback: vi.fn(makeEmptyStream),
      }),
      extractiveStub,
      configStub(),
    );

    const chunks = [];
    for await (const chunk of provider.streamAnswer({
      question: "When does my contract end?",
      results: [makeResult([0.8])],
      maxCitations: 6,
      responseLanguage: "en",
    })) {
      chunks.push(chunk);
    }

    const done = chunks.at(-1);
    expect(done?.status).toBe("insufficient_evidence");
    expect(done?.citations).toEqual([]);
  });

  it("answers normally when chunks pass the threshold", async () => {
    const llmService = makeLlmService();
    const provider = new LlmAnswerProvider(llmService, extractiveStub, configStub());

    const result = await provider.answer({
      question: "When does my contract end?",
      results: [makeResult([0.8, 0.6])],
      maxCitations: 6,
      responseLanguage: "en",
    });

    expect(result.status).toBe("answered");
    expect(result.citations).toHaveLength(2);
    expect(result.reasoning).not.toContain("low retrieval confidence");
  });

  it("adds a document metadata line to the prompt context", async () => {
    const llmService = makeLlmService();
    const provider = new LlmAnswerProvider(llmService, extractiveStub, configStub());

    await provider.answer({
      question: "When does my contract end?",
      results: [makeResult([0.8])],
      maxCitations: 6,
      responseLanguage: "en",
    });

    const completeMock = (
      llmService as { completeWithFallback: ReturnType<typeof vi.fn> }
    ).completeWithFallback;
    const messages = completeMock.mock.calls[0][0].messages;
    const userMessage = messages.find((m: { role: string }) => m.role === "user");
    expect(userMessage.content).toContain(
      "[Correspondent: Hamburg Energie | Type: Contract | Issue date: 2026-01-15]",
    );
  });

  it("respects an env-overridden threshold", async () => {
    const provider = new LlmAnswerProvider(makeLlmService(), extractiveStub, configStub(0.2));

    const result = await provider.answer({
      question: "When does my contract end?",
      results: [makeResult([0.25])],
      maxCitations: 6,
      responseLanguage: "en",
    });

    expect(result.status).toBe("answered");
    expect(result.citations).toHaveLength(1);
  });
});

describe("shouldUseFullDocumentContext", () => {
  it("uses full-text mode for documents within the budget", () => {
    expect(shouldUseFullDocumentContext(3_000, 4)).toBe(true);
  });

  it("keeps retrieval for large documents and rejects empty documents", () => {
    expect(shouldUseFullDocumentContext(DOCUMENT_QA_FULL_TEXT_MAX_CHARS + 1, 15)).toBe(false);
    expect(shouldUseFullDocumentContext(0, 0)).toBe(false);
  });

  it("counts per-chunk serialization overhead and heading length", () => {
    // Raw text alone fits, but 50 chunks add labels/separators on top.
    expect(shouldUseFullDocumentContext(DOCUMENT_QA_FULL_TEXT_MAX_CHARS - 500, 50)).toBe(false);
    // Long headings also count toward the assembled prompt.
    expect(shouldUseFullDocumentContext(DOCUMENT_QA_FULL_TEXT_MAX_CHARS - 400, 4, 2_000)).toBe(
      false,
    );
  });

  it("caps full-text mode by chunk count regardless of length", () => {
    expect(shouldUseFullDocumentContext(500, 200)).toBe(false);
  });
});
