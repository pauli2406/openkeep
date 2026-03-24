import { describe, expect, it, vi } from "vitest";

import { AgenticDocumentIntelligenceService } from "../src/processing/agentic-document-intelligence.service";

const createInput = (text: string, title = "document.pdf") => ({
  documentId: "11111111-1111-1111-1111-111111111111",
  title,
  mimeType: "application/pdf",
  parsed: {
    provider: "local-ocr" as const,
    parseStrategy: "fixture",
    text,
    language: "de",
    tables: [],
    keyValues: [],
    chunkHints: [],
    warnings: [],
    providerMetadata: {},
    reviewReasons: [],
    pages: [
      {
        pageNumber: 1,
        width: null,
        height: null,
        lines: text.split("\n").map((line, index) => ({
          lineIndex: index,
          text: line,
          boundingBox: { x: 0, y: index * 10, width: line.length * 7, height: 10 },
        })),
        blocks: [],
      },
    ],
  },
});

const createService = (overrides?: {
  llmText?: string | null;
  correspondentName?: string | null;
}) => {
  const llmService = {
    getAvailableProviderInfos: vi.fn(() => [{ provider: "mistral", model: "mistral-small-latest" }]),
    completeWithFallback: vi.fn(async () => ({
      text: overrides?.llmText ?? null,
      provider: overrides?.llmText ? "mistral" : null,
      model: overrides?.llmText ? "mistral-small-latest" : null,
    })),
  } as any;

  const documentTypePolicyService = {
    getPolicy: vi.fn(async (documentTypeName: string | null) => ({
      documentTypeName,
      requiredFields:
        documentTypeName === "Invoice"
          ? ["correspondent", "issueDate", "dueDate", "amount", "currency", "referenceNumber"]
          : ["correspondent", "issueDate"],
      documentClass: documentTypeName === "Invoice" ? "invoice" : "generic",
    })),
    buildReviewEvidence: vi.fn((policy, extracted) => ({
      documentClass: policy.documentClass,
      requiredFields: policy.requiredFields,
      missingFields: policy.requiredFields.filter((field: keyof typeof extracted) => !extracted[field]),
      extracted,
      activeReasons: [],
    })),
  } as any;

  const correspondentResolutionService = {
    resolve: vi.fn(async (_input, seed) => ({
      correspondentName: overrides?.correspondentName ?? seed.correspondentName ?? null,
      metadata: {
        rawName: seed.correspondentName ?? null,
        rawNameNormalized: seed.correspondentName ? String(seed.correspondentName).toLowerCase() : null,
        resolvedName: overrides?.correspondentName ?? seed.correspondentName ?? null,
        matchStrategy: overrides?.correspondentName ?? seed.correspondentName ? "exact" : "none",
        confidence: overrides?.correspondentName ?? seed.correspondentName ? 0.92 : null,
        evidenceLines: [],
        candidateCorrespondents: [],
        blockedReason: null,
        provider: "deterministic",
      },
    })),
  } as any;

  const configService = {
    get: vi.fn((key: string) => {
      if (key === "REVIEW_CONFIDENCE_THRESHOLD") return 0.65;
      if (key === "OCR_EMPTY_TEXT_THRESHOLD") return 20;
      return undefined;
    }),
  } as any;

  return new AgenticDocumentIntelligenceService(
    llmService,
    documentTypePolicyService,
    correspondentResolutionService,
    configService,
  );
};

describe("AgenticDocumentIntelligenceService", () => {
  it("falls back to deterministic invoice routing and builds intelligence metadata", async () => {
    const service = createService({ correspondentName: "Stadtwerke Berlin GmbH" });

    const result = await service.extract(
      createInput(
        [
          "Rechnung",
          "Stadtwerke Berlin GmbH",
          "Rechnungsdatum: 03.02.2025",
          "Zahlbar bis: 15.02.2025",
          "Rechnungsnummer: 2025-0042",
          "Gesamtbetrag: EUR 123,45",
        ].join("\n"),
      ),
    );

    const intelligence = result.metadata.intelligence as Record<string, any> | undefined;

    expect(result.documentTypeName).toBe("Invoice");
    expect(result.correspondentName).toBe("Stadtwerke Berlin GmbH");
    expect(result.amount).toBe(123.45);
    expect(result.currency).toBe("EUR");
    expect(intelligence?.routing?.documentType).toBe("invoice");
    expect(intelligence?.tagging?.tags).toContain("finance");
    expect(intelligence?.pipeline?.framework).toBe("langgraph-ready");
    expect(intelligence?.extraction?.fieldProvenance?.amount?.page).toBe(1);
    expect(result.reviewReasons).not.toContain("classification_ambiguous");
  });

  it("accepts structured llm routing/title/summary responses", async () => {
    const llmResponses = [
      JSON.stringify({
        documentType: "receipt",
        subtype: "restaurant",
        confidence: 0.88,
        reasoningHints: ["keyword:receipt", "merchant header"],
      }),
      JSON.stringify({
        title: "Restaurant Receipt 12.03.2025",
        titleConfidence: 0.84,
        summary: "Restaurant receipt with total amount and payment timestamp.",
        summaryConfidence: 0.82,
      }),
      JSON.stringify({
        fields: {
          issueDate: "12.03.2025",
          amount: "47,20 EUR",
          currency: "EUR",
          referenceNumber: "POS-991",
          correspondentName: "Trattoria Roma",
        },
        fieldConfidence: {
          issueDate: 0.89,
          amount: 0.9,
          currency: 0.92,
        },
      }),
      JSON.stringify({
        tags: ["receipt", "meals", "travel"],
        confidence: 0.8,
      }),
    ];

    const service = createService({ correspondentName: "Trattoria Roma" });
    (service as any).llmService.completeWithFallback = vi.fn(async () => ({
      text: llmResponses.shift() ?? null,
      provider: "mistral",
      model: "mistral-small-latest",
    }));

    const result = await service.extract(
      createInput(
        [
          "Receipt",
          "Trattoria Roma",
          "Date: 12.03.2025",
          "Total: 47,20 EUR",
          "Ref: POS-991",
        ].join("\n"),
        "receipt.pdf",
      ),
    );

    const intelligence = result.metadata.intelligence as Record<string, any> | undefined;

    expect(result.documentTypeName).toBe("Receipt");
    expect(result.title).toBe("Restaurant Receipt 12.03.2025");
    expect(result.summary).toContain("Restaurant receipt");
    expect(intelligence?.routing).toMatchObject({
      documentType: "receipt",
      subtype: "restaurant",
      provider: "mistral",
    });
    expect(intelligence?.extraction?.provider).toBe("mistral");
    expect(result.tags).toContain("meals");
  });

  it("adds review reasons for unresolved correspondents and validation issues", async () => {
    const service = createService({ correspondentName: null });

    const result = await service.extract(
      createInput("Invoice\nDate: 2025-05-03\n", "invoice.pdf"),
    );

    const intelligence = result.metadata.intelligence as Record<string, any> | undefined;

    expect(result.reviewReasons).toContain("missing_key_fields");
    expect(result.reviewReasons).toContain("correspondent_unresolved");
    expect(intelligence?.validation?.warnings).toContain("correspondent_missing");
  });
});
