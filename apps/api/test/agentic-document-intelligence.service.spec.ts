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
    getDefaultProviderOrder: vi.fn(() => ["mistral", "gemini", "openai"]),
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

  it("keeps deterministic values over low-confidence LLM values and fills gaps", async () => {
    const llmResponses = [
      JSON.stringify({ documentType: "invoice", subtype: null, confidence: 0.9, reasoningHints: [] }),
      JSON.stringify({ title: "Stromrechnung Mai", titleConfidence: 0.8, summary: null, summaryConfidence: null }),
      JSON.stringify({
        fields: {
          // Contradicts the regex hit in the document text — low confidence, must lose.
          amount: "999,99 EUR",
          // Not present deterministically — high confidence, fills the gap.
          referenceNumber: "R-2026-042",
        },
        fieldConfidence: { amount: 0.3, referenceNumber: 0.9 },
      }),
      JSON.stringify({ tags: ["utilities"], confidence: 0.8 }),
    ];

    const service = createService({ correspondentName: "Stadtwerke" });
    (service as any).llmService.completeWithFallback = vi.fn(async () => ({
      text: llmResponses.shift() ?? null,
      provider: "mistral",
      model: "mistral-small-latest",
    }));

    const result = await service.extract(
      createInput(
        ["Rechnung", "Stadtwerke", "Datum: 03.05.2026", "Betrag: 89,00 EUR"].join("\n"),
        "rechnung.pdf",
      ),
    );

    const intelligence = result.metadata.intelligence as Record<string, any> | undefined;
    expect(result.amount).toBe(89);
    expect(result.referenceNumber).toBe("R-2026-042");
    expect(intelligence?.extraction?.fieldProvenance?.amount?.source).toBe("deterministic_parse");
    expect(intelligence?.extraction?.fieldProvenance?.referenceNumber?.source).toBe(
      "llm_structured_extraction",
    );
  });

  it("accepts strict responses with null fieldConfidence placeholders", async () => {
    const llmResponses = [
      JSON.stringify({ documentType: "invoice", subtype: null, confidence: 0.9, reasoningHints: [] }),
      JSON.stringify({ title: "Rechnung", titleConfidence: 0.8, summary: null, summaryConfidence: null }),
      // Strict mode requires every relevant field in fieldConfidence; unknown ones are null.
      JSON.stringify({
        fields: { referenceNumber: "R-2026-042", issueDate: null, amount: null },
        fieldConfidence: { referenceNumber: 0.9, issueDate: null, amount: null },
      }),
      JSON.stringify({ tags: ["utilities"], confidence: 0.8 }),
    ];

    const service = createService({ correspondentName: "Stadtwerke" });
    (service as any).llmService.completeWithFallback = vi.fn(async () => ({
      text: llmResponses.shift() ?? null,
      provider: "mistral",
      model: "mistral-small-latest",
    }));

    const result = await service.extract(
      createInput(["Rechnung", "Betrag: 89,00 EUR"].join("\n"), "rechnung.pdf"),
    );

    const intelligence = result.metadata.intelligence as Record<string, any> | undefined;
    // The response must NOT be rejected as schema-violating: the LLM-only field lands.
    expect(intelligence?.extraction?.provider).toBe("mistral");
    expect(result.referenceNumber).toBe("R-2026-042");
  });

  it("drops LLM fields that are irrelevant for the routed document type", async () => {
    const llmResponses = [
      JSON.stringify({ documentType: "receipt", subtype: null, confidence: 0.9, reasoningHints: [] }),
      JSON.stringify({ title: "Beleg", titleConfidence: 0.8, summary: null, summaryConfidence: null }),
      // Gemini runs without the per-type schema: dueDate is not relevant for a
      // receipt and must not be merged, persisted, or trigger a deadline tag.
      JSON.stringify({
        fields: { amount: "47,20", currency: "EUR", dueDate: "31.12.2026" },
        fieldConfidence: { amount: 0.9, currency: 0.9, dueDate: 0.95 },
      }),
      JSON.stringify({ tags: ["receipt"], confidence: 0.8 }),
    ];

    const service = createService({ correspondentName: "Trattoria Roma" });
    (service as any).llmService.completeWithFallback = vi.fn(async () => ({
      text: llmResponses.shift() ?? null,
      provider: "gemini",
      model: "gemini-2.0-flash",
    }));

    const result = await service.extract(
      createInput(["Beleg", "Trattoria Roma", "Total: 47,20 EUR"].join("\n"), "beleg.pdf"),
    );

    expect(result.dueDate).toBeNull();
    expect(result.tags).not.toContain("deadline");
  });

  it("falls back to deterministic extraction when the LLM payload violates the schema", async () => {
    const llmResponses = [
      JSON.stringify({ documentType: "invoice", subtype: null, confidence: 0.9, reasoningHints: [] }),
      JSON.stringify({ title: "Rechnung", titleConfidence: 0.8, summary: null, summaryConfidence: null }),
      // fields must be an object — schema violation triggers the deterministic fallback.
      JSON.stringify({ fields: "definitely not an object" }),
      JSON.stringify({ tags: ["utilities"], confidence: 0.8 }),
    ];

    const service = createService({ correspondentName: "Stadtwerke" });
    (service as any).llmService.completeWithFallback = vi.fn(async () => ({
      text: llmResponses.shift() ?? null,
      provider: "mistral",
      model: "mistral-small-latest",
    }));

    const result = await service.extract(
      createInput(["Rechnung", "Betrag: 89,00 EUR"].join("\n"), "rechnung.pdf"),
    );

    const intelligence = result.metadata.intelligence as Record<string, any> | undefined;
    expect(intelligence?.extraction?.provider).toBe("deterministic");
    expect(result.amount).toBe(89);
  });

  it("rejects non-scalar extraction field values from schema-less providers", async () => {
    const llmResponses = [
      JSON.stringify({ documentType: "invoice", subtype: null, confidence: 0.9, reasoningHints: [] }),
      JSON.stringify({ title: "Rechnung", titleConfidence: 0.8, summary: null, summaryConfidence: null }),
      // Gemini runs in plain JSON mode: an object value would replace the valid
      // deterministic amount and then be dropped by normalization.
      JSON.stringify({
        fields: { amount: { value: 89, currency: "EUR" } },
        fieldConfidence: { amount: 0.95 },
      }),
      JSON.stringify({ tags: ["utilities"], confidence: 0.8 }),
    ];

    const service = createService({ correspondentName: "Stadtwerke" });
    (service as any).llmService.completeWithFallback = vi.fn(async () => ({
      text: llmResponses.shift() ?? null,
      provider: "gemini",
      model: "gemini-2.0-flash",
    }));

    const result = await service.extract(
      createInput(["Rechnung", "Betrag: 89,00 EUR"].join("\n"), "rechnung.pdf"),
    );

    expect(result.amount).toBe(89);
    const intelligence = result.metadata.intelligence as Record<string, any> | undefined;
    expect(intelligence?.extraction?.provider).toBe("deterministic");
  });

  it("warns when an ambiguous insurance amount is discarded", async () => {
    const llmResponses = [
      JSON.stringify({
        documentType: "insurance_document",
        subtype: null,
        confidence: 0.9,
        reasoningHints: [],
      }),
      JSON.stringify({ title: "Beitragsübersicht", titleConfidence: 0.8, summary: null, summaryConfidence: null }),
      JSON.stringify({
        fields: { amount: "1.234,00 EUR", currency: "EUR" },
        fieldConfidence: { amount: 0.9, currency: 0.9 },
      }),
      JSON.stringify({ tags: ["insurance"], confidence: 0.8 }),
    ];

    const service = createService({ correspondentName: "Versicherung AG" });
    (service as any).llmService.completeWithFallback = vi.fn(async () => ({
      text: llmResponses.shift() ?? null,
      provider: "mistral",
      model: "mistral-small-latest",
    }));

    // Yearly totals only — no active-premium pattern, so the amount is unreliable.
    const result = await service.extract(
      createInput(
        ["Versicherung", "Gesamtbeitrag in 2026: 1.234,00 EUR", "Arbeitgeberzuschuss: 617,00 EUR"].join("\n"),
        "versicherung.pdf",
      ),
    );

    const intelligence = result.metadata.intelligence as Record<string, any> | undefined;
    expect(result.amount).toBeNull();
    expect(intelligence?.validation?.warnings).toContain("insurance_amount_ambiguous");
  });

  it("skips routing/title/extraction LLM calls when a confident annotation hint is present", async () => {
    const service = createService({ correspondentName: "Stadtwerke" });
    const completeMock = vi.fn(async () => ({
      text: JSON.stringify({ tags: ["utilities"], confidence: 0.8 }),
      provider: "mistral" as const,
      model: "mistral-small-latest",
    }));
    (service as any).llmService.completeWithFallback = completeMock;

    const input = createInput(
      ["Rechnung", "Stadtwerke", "Datum: 03.05.2026", "Betrag: 89,00 EUR"].join("\n"),
      "rechnung.pdf",
    );
    (input.parsed as any).preExtracted = {
      source: "mistral-document-annotation",
      model: "mistral-ocr-latest",
      schemaVersion: "v1",
      documentType: "invoice",
      documentTypeConfidence: 0.93,
      title: "Stromrechnung Mai 2026",
      summary: "Rechnung der Stadtwerke über 89 EUR.",
      fields: {
        issueDate: "03.05.2026",
        dueDate: "17.05.2026",
        amount: "89,00",
        currency: "EUR",
        referenceNumber: "R-2026-042",
        correspondentName: "Stadtwerke",
      },
      fieldConfidence: { amount: 0.9, currency: 0.9, issueDate: 0.9, dueDate: 0.9 },
    };

    const result = await service.extract(input);
    const intelligence = result.metadata.intelligence as Record<string, any> | undefined;

    // Only the tagging node needed an LLM call — routing, title/summary, and
    // extraction were served by the annotation hint.
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(intelligence?.routing?.provider).toBe("mistral-annotation");
    expect(result.title).toBe("Stromrechnung Mai 2026");
    expect(result.amount).toBe(89);
    expect(result.referenceNumber).toBe("R-2026-042");
  });

  it("still calls the extraction LLM when the annotation hint misses required fields", async () => {
    const llmResponses = [
      JSON.stringify({
        fields: { issueDate: "03.05.2026", amount: "89,00 EUR", currency: "EUR" },
        fieldConfidence: { issueDate: 0.9, amount: 0.9, currency: 0.9 },
      }),
      JSON.stringify({ tags: ["utilities"], confidence: 0.8 }),
    ];
    const service = createService({ correspondentName: "Stadtwerke" });
    const completeMock = vi.fn(async () => ({
      text: llmResponses.shift() ?? null,
      provider: "mistral" as const,
      model: "mistral-small-latest",
    }));
    (service as any).llmService.completeWithFallback = completeMock;

    const input = createInput("Unleserlicher Scan ohne verwertbare Labels", "scan.pdf");
    (input.parsed as any).preExtracted = {
      source: "mistral-document-annotation",
      model: "mistral-ocr-latest",
      schemaVersion: "v1",
      documentType: "invoice",
      documentTypeConfidence: 0.9,
      title: "Rechnung",
      summary: null,
      // Missing required invoice fields (issueDate, amount, currency, ...).
      fields: { correspondentName: "Stadtwerke" },
      fieldConfidence: {},
    };

    await service.extract(input);

    // Routing + title/summary were skipped, but extraction (and tagging) still ran.
    expect(completeMock).toHaveBeenCalledTimes(2);
  });

  it("still calls the extraction LLM when required fields came from deterministic parsing", async () => {
    const llmResponses = [
      JSON.stringify({
        fields: { referenceNumber: "R-2026-042" },
        fieldConfidence: { referenceNumber: 0.9 },
      }),
      JSON.stringify({ tags: ["utilities"], confidence: 0.8 }),
    ];
    const service = createService({ correspondentName: "Stadtwerke" });
    const completeMock = vi.fn(async () => ({
      text: llmResponses.shift() ?? null,
      provider: "mistral" as const,
      model: "mistral-small-latest",
    }));
    (service as any).llmService.completeWithFallback = completeMock;

    const input = createInput(
      ["Rechnung", "Stadtwerke", "Datum: 03.05.2026", "Betrag: 89,00 EUR"].join("\n"),
      "rechnung.pdf",
    );
    // Valid annotation, but it contributes no fields of its own.
    (input.parsed as any).preExtracted = {
      source: "mistral-document-annotation",
      model: "mistral-ocr-latest",
      schemaVersion: "v1",
      documentType: "invoice",
      documentTypeConfidence: 0.93,
      title: "Stromrechnung",
      summary: null,
      fields: {},
      fieldConfidence: {},
    };

    await service.extract(input);

    // Extraction must not be skipped just because deterministic parsing filled in.
    expect(completeMock).toHaveBeenCalledTimes(2);
  });

  it("drops annotation fields that are irrelevant for the routed document type", async () => {
    const service = createService({ correspondentName: "Stadtwerke" });
    (service as any).llmService.completeWithFallback = vi.fn(async () => ({
      text: JSON.stringify({ tags: ["letter"], confidence: 0.8 }),
      provider: "mistral" as const,
      model: "mistral-small-latest",
    }));

    const input = createInput("Ein einfaches Anschreiben ohne Betraege.", "brief.pdf");
    (input.parsed as any).preExtracted = {
      source: "mistral-document-annotation",
      model: "mistral-ocr-latest",
      schemaVersion: "v1",
      documentType: "generic_letter",
      documentTypeConfidence: 0.95,
      title: "Anschreiben",
      summary: null,
      // expiryDate is in the generic annotation schema but not relevant here.
      fields: { expiryDate: "31.12.2030", correspondentName: "Stadtwerke" },
      fieldConfidence: { expiryDate: 0.9, correspondentName: 0.9 },
    };

    const result = await service.extract(input);
    expect(result.expiryDate).toBeNull();
  });

  it("ignores low-confidence annotation classifications for routing", async () => {
    const service = createService({ correspondentName: "Stadtwerke" });

    const input = createInput(
      ["Rechnung", "Betrag: 89,00 EUR"].join("\n"),
      "rechnung.pdf",
    );
    (input.parsed as any).preExtracted = {
      source: "mistral-document-annotation",
      model: "mistral-ocr-latest",
      schemaVersion: "v1",
      documentType: "contract",
      documentTypeConfidence: 0.3,
      title: null,
      summary: null,
      fields: {},
      fieldConfidence: {},
    };

    const result = await service.extract(input);
    const intelligence = result.metadata.intelligence as Record<string, any> | undefined;

    // The 0.3-confidence "contract" hint must not beat deterministic invoice routing.
    expect(intelligence?.routing?.provider).not.toBe("mistral-annotation");
    expect(result.documentTypeName).toBe("Invoice");
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

  it("does not treat ELStAM yearly totals as the active insurance premium", async () => {
    const llmResponses = [
      JSON.stringify({
        documentType: "insurance_document",
        subtype: "premium_notification",
        confidence: 0.95,
        reasoningHints: ["versicherung", "beitrag"],
      }),
      JSON.stringify({
        title: "Insurance ELStAM Notice",
        titleConfidence: 0.9,
        summary:
          "ELStAM notice with employer subsidy and tax contribution reporting for 2026.",
        summaryConfidence: 0.88,
      }),
      JSON.stringify({
        fields: {
          issueDate: "27.11.2025",
          amount: 908,
          currency: "EUR",
          referenceNumber: "POL-123456",
          correspondentName: "Example Health Insurance Co.",
        },
        fieldConfidence: {
          issueDate: 0.95,
          amount: 0.95,
          currency: 0.98,
        },
      }),
      JSON.stringify({
        tags: ["insurance-document", "elstam"],
        confidence: 0.8,
      }),
    ];

    const service = createService({ correspondentName: "Example Health Insurance" });
    (service as any).llmService.completeWithFallback = vi.fn(async () => ({
      text: llmResponses.shift() ?? null,
      provider: "mistral",
      model: "mistral-small-latest",
    }));

    const result = await service.extract(
      createInput(
        [
          "Example Health Insurance",
          "27.11.2025",
          "Policy No.: POL-123456 - Initial ELStAM reporting notice",
          "Arbeitgeberzuschuss",
          "Hoehe der monatlichen Beitraege fuer eine private Krankenversicherung.",
          "| Alex Example | Januar bis Dezember | 908,00 EUR |",
          "Vorsorgebeitrag",
          "| Alex Example | Januar bis Dezember | 679,00 EUR |",
        ].join("\n"),
        "insurance.pdf",
      ),
    );

    const intelligence = result.metadata.intelligence as Record<string, any> | undefined;

    expect(result.amount).toBeNull();
    expect(result.currency).toBeNull();
    expect(intelligence?.validation?.normalizedFields?.amount).toBeNull();
  });

  it("extracts the active insurance premium from a contribution adjustment document", async () => {
    const llmResponses = [
      JSON.stringify({
        documentType: "insurance_document",
        subtype: "contribution_adjustment_notice",
        confidence: 0.97,
        reasoningHints: ["beitragsanpassung", "versicherungsschein"],
      }),
      JSON.stringify({
        title: "Insurance Contribution Adjustment 2026",
        titleConfidence: 0.9,
        summary: "Insurance contribution adjustment with new monthly premium from 2026.",
        summaryConfidence: 0.88,
      }),
      JSON.stringify({
        fields: {
          issueDate: "25.11.2025",
          amount: null,
          currency: null,
          referenceNumber: "POL-123456",
          correspondentName: "Example Health Insurance Co.",
        },
        fieldConfidence: {
          issueDate: 0.95,
        },
      }),
      JSON.stringify({
        tags: ["insurance-document", "beitragsanpassung"],
        confidence: 0.8,
      }),
    ];

    const service = createService({ correspondentName: "Example Health Insurance" });
    (service as any).llmService.completeWithFallback = vi.fn(async () => ({
      text: llmResponses.shift() ?? null,
      provider: "mistral",
      model: "mistral-small-latest",
    }));

    const result = await service.extract(
      createInput(
        [
          "Example City, im Nov. 25",
          "Policy No. POL-123456 - Coverage certificate",
          "Ihr neuer Beitrag ab 01.01.2026",
          "Gesamtmonatsbeitrag ab 01.01.26 963,58",
          "Gesamtmonatsbeitrag bis 31.12.25 918,61",
          "Monatsbeitrag fuer den gesamten Vertrag ab 01.01.26 963,58",
        ].join("\n"),
        "insurance-adjustment.pdf",
      ),
    );

    const intelligence = result.metadata.intelligence as Record<string, any> | undefined;

    expect(result.amount).toBe(963.58);
    expect(result.currency).toBe("EUR");
    expect(result.issueDate?.toISOString().slice(0, 10)).toBe("2025-11-25");
    expect(intelligence?.validation?.normalizedFields?.amount).toBe(963.58);
  });

  it("routes and extracts giftcard balances conservatively", async () => {
    const llmResponses = [
      JSON.stringify({
        documentType: "giftcard",
        subtype: "retail",
        confidence: 0.94,
        reasoningHints: ["gift card", "balance"],
      }),
      JSON.stringify({
        title: "Gift Card Balance",
        titleConfidence: 0.86,
        summary: "Gift card with remaining available balance and expiry date.",
        summaryConfidence: 0.84,
      }),
      JSON.stringify({
        fields: {
          issueDate: "12.03.2025",
          expiryDate: "31.12.2026",
          amount: 50,
          currency: "EUR",
          referenceNumber: "GC-4455",
          correspondentName: "Example Store",
        },
        fieldConfidence: {
          amount: 0.9,
          currency: 0.95,
        },
      }),
      JSON.stringify({
        tags: ["giftcard"],
        confidence: 0.8,
      }),
    ];

    const service = createService({ correspondentName: "Example Store" });
    (service as any).llmService.completeWithFallback = vi.fn(async () => ({
      text: llmResponses.shift() ?? null,
      provider: "mistral",
      model: "mistral-small-latest",
    }));

    const result = await service.extract(
      createInput(
        [
          "Example Store Gift Card",
          "Issue Date: 12.03.2025",
          "Card Number: GC-4455",
          "Available Balance: 75,00 EUR",
          "Value: 50,00 EUR",
          "Valid until 31.12.2026",
        ].join("\n"),
        "giftcard.pdf",
      ),
    );

    expect(result.documentTypeName).toBe("Giftcard");
    expect(result.amount).toBe(75);
    expect(result.currency).toBe("EUR");
  });

  it("routes portfolio statements and prefers portfolio value totals", async () => {
    const llmResponses = [
      JSON.stringify({
        documentType: "portfolio_statement",
        subtype: "monthly",
        confidence: 0.96,
        reasoningHints: ["depotauszug", "depotwert"],
      }),
      JSON.stringify({
        title: "Portfolio Statement March 2025",
        titleConfidence: 0.88,
        summary: "Portfolio statement with total asset valuation.",
        summaryConfidence: 0.86,
      }),
      JSON.stringify({
        fields: {
          issueDate: "31.03.2025",
          amount: null,
          currency: null,
          referenceNumber: "DEP-7788",
          correspondentName: "Example Broker",
        },
        fieldConfidence: {
          issueDate: 0.95,
        },
      }),
      JSON.stringify({
        tags: ["portfolio"],
        confidence: 0.8,
      }),
    ];

    const service = createService({ correspondentName: "Example Broker" });
    (service as any).llmService.completeWithFallback = vi.fn(async () => ({
      text: llmResponses.shift() ?? null,
      provider: "mistral",
      model: "mistral-small-latest",
    }));

    const result = await service.extract(
      createInput(
        [
          "Depotauszug",
          "Valuation Date: 31.03.2025",
          "Depot Number: DEP-7788",
          "Portfolio Value: 12.345,67 EUR",
        ].join("\n"),
        "portfolio.pdf",
      ),
    );

    expect(result.documentTypeName).toBe("Portfolio Statement");
    expect(result.amount).toBe(12345.67);
    expect(result.currency).toBe("EUR");
  });

  it("routes trade confirmations and extracts the net settlement amount", async () => {
    const llmResponses = [
      JSON.stringify({
        documentType: "trade_confirmation",
        subtype: "buy",
        confidence: 0.96,
        reasoningHints: ["wertpapierabrechnung", "net amount"],
      }),
      JSON.stringify({
        title: "Trade Confirmation Buy Order",
        titleConfidence: 0.88,
        summary: "Securities transaction confirmation with final settlement amount.",
        summaryConfidence: 0.86,
      }),
      JSON.stringify({
        fields: {
          issueDate: "14.04.2025",
          dueDate: "16.04.2025",
          amount: null,
          currency: null,
          referenceNumber: "TR-9911",
          correspondentName: "Example Broker",
        },
        fieldConfidence: {
          issueDate: 0.95,
        },
      }),
      JSON.stringify({
        tags: ["trade-confirmation"],
        confidence: 0.8,
      }),
    ];

    const service = createService({ correspondentName: "Example Broker" });
    (service as any).llmService.completeWithFallback = vi.fn(async () => ({
      text: llmResponses.shift() ?? null,
      provider: "mistral",
      model: "mistral-small-latest",
    }));

    const result = await service.extract(
      createInput(
        [
          "Wertpapierabrechnung Kauf",
          "Trade Date: 14.04.2025",
          "Settlement Date: 16.04.2025",
          "Order Number: TR-9911",
          "Net Amount: 1.234,56 EUR",
        ].join("\n"),
        "trade.pdf",
      ),
    );

    expect(result.documentTypeName).toBe("Trade Confirmation");
    expect(result.amount).toBe(1234.56);
    expect(result.currency).toBe("EUR");
  });

  it("routes tax statements separately from tax office documents", async () => {
    const llmResponses = [
      JSON.stringify({
        documentType: "tax_statement",
        subtype: "capital-gains",
        confidence: 0.95,
        reasoningHints: ["jahressteuerbescheinigung", "kapitalertragsteuer"],
      }),
      JSON.stringify({
        title: "Annual Tax Statement 2025",
        titleConfidence: 0.88,
        summary: "Annual tax statement with withheld capital gains tax.",
        summaryConfidence: 0.86,
      }),
      JSON.stringify({
        fields: {
          issueDate: "15.01.2026",
          amount: null,
          currency: null,
          referenceNumber: "DEP-7788",
          correspondentName: "Example Broker",
        },
        fieldConfidence: {
          issueDate: 0.95,
        },
      }),
      JSON.stringify({
        tags: ["tax-statement"],
        confidence: 0.8,
      }),
    ];

    const service = createService({ correspondentName: "Example Broker" });
    (service as any).llmService.completeWithFallback = vi.fn(async () => ({
      text: llmResponses.shift() ?? null,
      provider: "mistral",
      model: "mistral-small-latest",
    }));

    const result = await service.extract(
      createInput(
        [
          "Jahressteuerbescheinigung",
          "Date: 15.01.2026",
          "Depot Number: DEP-7788",
          "Kapitalertragsteuer: 321,09 EUR",
        ].join("\n"),
        "tax-statement.pdf",
      ),
    );

    expect(result.documentTypeName).toBe("Tax Statement");
    expect(result.amount).toBe(321.09);
    expect(result.currency).toBe("EUR");
  });

  it("routes legal documents and keeps legal references", async () => {
    const llmResponses = [
      JSON.stringify({
        documentType: "legal_document",
        subtype: "court-notice",
        confidence: 0.93,
        reasoningHints: ["aktenzeichen", "gericht"],
      }),
      JSON.stringify({
        title: "Court Notice",
        titleConfidence: 0.86,
        summary: "Legal notice with case number and response deadline.",
        summaryConfidence: 0.84,
      }),
      JSON.stringify({
        fields: {
          issueDate: "10.02.2025",
          dueDate: "24.02.2025",
          amount: null,
          currency: null,
          referenceNumber: "AZ-2025-99",
          correspondentName: "District Court Example City",
        },
        fieldConfidence: {
          issueDate: 0.95,
          dueDate: 0.9,
        },
      }),
      JSON.stringify({
        tags: ["legal"],
        confidence: 0.8,
      }),
    ];

    const service = createService({ correspondentName: "District Court Example City" });
    (service as any).llmService.completeWithFallback = vi.fn(async () => ({
      text: llmResponses.shift() ?? null,
      provider: "mistral",
      model: "mistral-small-latest",
    }));

    const result = await service.extract(
      createInput(
        [
          "Amtsgericht Beispielstadt",
          "Datum: 10.02.2025",
          "Aktenzeichen: AZ-2025-99",
          "Frist: 24.02.2025",
        ].join("\n"),
        "legal.pdf",
      ),
    );

    expect(result.documentTypeName).toBe("Legal");
    expect(result.referenceNumber).toBe("AZ-2025-99");
  });
});
