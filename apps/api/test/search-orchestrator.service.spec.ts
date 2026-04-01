import { describe, expect, it, vi } from "vitest";

import type { DashboardDeadlineItem, Document } from "@openkeep/types";
import { SearchOrchestratorService } from "../src/search/search-orchestrator.service";

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    title: "Test document",
    source: "upload",
    mimeType: "application/pdf",
    checksum: "a".repeat(64),
    storageKey: "documents/test.pdf",
    status: "ready",
    language: "en",
    issueDate: "2026-04-01",
    dueDate: null,
    taskCompletedAt: null,
    expiryDate: null,
    amount: null,
    currency: null,
    referenceNumber: null,
    holderName: null,
    issuingAuthority: null,
    correspondent: null,
    documentType: null,
    tags: [],
    confidence: 0.9,
    reviewStatus: "not_required",
    reviewReasons: [],
    reviewedAt: null,
    reviewNote: null,
    searchablePdfAvailable: true,
    parseProvider: "local-ocr",
    chunkCount: 0,
    embeddingStatus: "not_configured",
    embeddingProvider: null,
    embeddingModel: null,
    embeddingsStale: false,
    lastProcessingError: null,
    latestProcessingJob: null,
    latestEmbeddingJob: null,
    metadata: { detectedKeywords: [], reviewReasons: [], chunkCount: 0 },
    createdAt: "2026-04-01T00:00:00.000Z",
    processedAt: "2026-04-01T00:00:00.000Z",
    snippets: [],
    matchingLines: [],
    ...overrides,
  };
}

function makeLanguageDb(language: "en" | "de") {
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([{ aiChatLanguage: language }]),
          })),
        })),
      })),
    },
  };
}

describe("SearchOrchestratorService", () => {
  it("routes open invoice questions to structured deadline data", async () => {
    const deadlineItems: DashboardDeadlineItem[] = [
      {
        documentId: "11111111-1111-1111-1111-111111111111",
        title: "Electricity invoice April 2026",
        referenceNumber: "INV-APR-2026",
        dueDate: "2026-04-18",
        amount: 89,
        currency: "EUR",
        correspondentName: "Hamburg Energie",
        documentTypeName: "Invoice",
        taskLabel: "Pay",
        daysUntilDue: 17,
        isOverdue: false,
        taskCompletedAt: null,
      },
    ];

    const databaseService = makeLanguageDb("de");
    const documentsService = {
      answerQuery: vi.fn(),
      streamAnswer: vi.fn(),
      listReviewDocuments: vi.fn(),
      listExpiringDocuments: vi.fn(),
    };
    const explorerService = {
      listDeadlineItems: vi.fn().mockResolvedValue(deadlineItems),
    };

    const service = new SearchOrchestratorService(
      databaseService as never,
      documentsService as never,
      explorerService as never,
    );

    const response = await service.answerQuery(
      {
        query: "Welche Rechnungen habe ich noch diesen Monat zu bezahlen?",
        maxDocuments: 5,
        maxCitations: 6,
        maxChunkMatches: 6,
      },
      { userId: "user-1" } as never,
    );

    expect(documentsService.answerQuery).not.toHaveBeenCalled();
    expect(explorerService.listDeadlineItems).toHaveBeenCalledOnce();
    expect(response.route).toBe("structured");
    expect(response.structuredData?.kind).toBe("deadline_items");
    expect(response.structuredData?.items).toHaveLength(1);
    expect(response.citations).toEqual([]);
    expect(response.results).toEqual([]);
    expect(response.answer).toContain("1 offene Rechnung");
    expect(response.answer).toContain("89,00");
  });

  it("falls back to semantic answers for non-operational questions", async () => {
    const semanticResponse = {
      status: "answered" as const,
      route: "semantic" as const,
      answer: "The archive says this contract ends in 2027.",
      reasoning: null,
      citations: [],
      results: [],
      structuredData: null,
    };

    const service = new SearchOrchestratorService(
      makeLanguageDb("en") as never,
      {
        answerQuery: vi.fn().mockResolvedValue(semanticResponse),
        streamAnswer: vi.fn(),
        listReviewDocuments: vi.fn(),
        listExpiringDocuments: vi.fn(),
      } as never,
      { listDeadlineItems: vi.fn() } as never,
    );

    const response = await service.answerQuery(
      {
        query: "What does the archive say about the cancellation clause?",
        maxDocuments: 5,
        maxCitations: 6,
        maxChunkMatches: 6,
      },
      { userId: "user-1" } as never,
    );

    expect(response).toEqual(semanticResponse);
  });

  it("routes review questions to structured pending review data", async () => {
    const reviewDocument = makeDocument({
      id: "22222222-2222-2222-2222-222222222222",
      title: "Insurance document needing review",
      reviewStatus: "pending",
      reviewReasons: ["missing_key_fields", "low_confidence"],
    });
    const documentsService = {
      answerQuery: vi.fn(),
      streamAnswer: vi.fn(),
      listReviewDocuments: vi.fn().mockResolvedValue({
        items: [reviewDocument],
        total: 1,
        page: 1,
        pageSize: 20,
        appliedFilters: {},
      }),
      listExpiringDocuments: vi.fn(),
    };

    const service = new SearchOrchestratorService(
      makeLanguageDb("en") as never,
      documentsService as never,
      { listDeadlineItems: vi.fn() } as never,
    );

    const response = await service.answerQuery(
      { query: "Which documents still need review?", maxDocuments: 5, maxCitations: 6, maxChunkMatches: 6 },
      { userId: "user-1" } as never,
    );

    expect(documentsService.listReviewDocuments).toHaveBeenCalledOnce();
    expect(response.structuredData?.kind).toBe("pending_review_documents");
    expect(response.structuredData?.items).toHaveLength(1);
    expect(response.answer).toContain("pending review");
  });

  it("routes contract expiry questions to structured expiring contract data", async () => {
    const contractDocument = makeDocument({
      id: "33333333-3333-3333-3333-333333333333",
      title: "Mobile contract",
      expiryDate: "2026-04-22",
      documentType: {
        id: "44444444-4444-4444-4444-444444444444",
        name: "Contract",
        slug: "contract",
        description: null,
        requiredFields: ["correspondent", "issueDate", "referenceNumber", "expiryDate"],
      },
    });
    const documentsService = {
      answerQuery: vi.fn(),
      streamAnswer: vi.fn(),
      listReviewDocuments: vi.fn(),
      listExpiringDocuments: vi.fn().mockResolvedValue({
        items: [contractDocument],
        total: 1,
        page: 1,
        pageSize: 20,
        appliedFilters: {},
      }),
    };

    const service = new SearchOrchestratorService(
      makeLanguageDb("en") as never,
      documentsService as never,
      { listDeadlineItems: vi.fn() } as never,
    );

    const response = await service.answerQuery(
      { query: "Which contracts expire this month?", maxDocuments: 5, maxCitations: 6, maxChunkMatches: 6 },
      { userId: "user-1" } as never,
    );

    expect(documentsService.listExpiringDocuments).toHaveBeenCalledOnce();
    expect(response.structuredData?.kind).toBe("expiring_contracts");
    expect(response.structuredData?.items).toHaveLength(1);
    expect(response.answer).toContain("contract documents expiring");
  });
});
