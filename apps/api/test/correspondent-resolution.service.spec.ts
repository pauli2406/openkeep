import { describe, expect, it, vi } from "vitest";

import { CorrespondentResolutionService } from "../src/processing/correspondent-resolution.service";

const createService = () =>
  new CorrespondentResolutionService(
    {
      db: {
        select: vi.fn(),
        insert: vi.fn(),
        transaction: vi.fn(),
      },
    } as any,
    {
      get: vi.fn(() => undefined),
    } as any,
  );

const buildInput = (lines: string[]) => ({
  documentId: "11111111-1111-1111-1111-111111111111",
  title: "Test document",
  mimeType: "application/pdf",
  parsed: {
    provider: "local-ocr" as const,
    parseStrategy: "fixture",
    text: `${lines.join("\n")}\n`,
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
        lines: lines.map((text, lineIndex) => ({
          lineIndex,
          text,
          boundingBox: { x: 0, y: lineIndex * 10, width: text.length * 6, height: 10 },
        })),
        blocks: [],
      },
    ],
  },
});

const buildDeterministicResult = (correspondentName: string | null) => ({
  language: "de",
  issueDate: null,
  dueDate: null,
  amount: null,
  currency: null,
  referenceNumber: null,
  correspondentName,
  documentTypeName: "Letter",
  tags: [],
  confidence: 0.7,
  reviewReasons: [],
  metadata: {
    reviewEvidence: {
      documentClass: "generic",
      requiredFields: [],
      missingFields: [],
      extracted: {
        correspondent: Boolean(correspondentName),
        issueDate: false,
        amount: false,
        currency: false,
      },
      activeReasons: [],
      confidence: 0.7,
    },
  },
});

describe("CorrespondentResolutionService", () => {
  it("strips an address suffix from a correspondent line", () => {
    const service = createService();
    expect(
      (service as any).cleanDisplayName(
        "In Praxi - WHU Alumni Association : Burgplatz 1 - 56179 Vallendar : Germany",
      ),
    ).toBe("In Praxi - WHU Alumni Association");
  });

  it("blocks long uppercase document headlines", () => {
    const service = createService();
    expect(
      (service as any).blockedReasonForCandidate(
        "INFORMATIONEN ÜBER DIE BESCHAFFENHEIT DES TRINKWASSERS",
      ),
    ).toBe("headline");
  });

  it("blocks phone-like fragments", () => {
    const service = createService();
    expect((service as any).blockedReasonForCandidate("-0680 8167")).toBe("phone_like");
  });

  it("trims slogan suffixes from acronym-based correspondent names", () => {
    const service = createService();
    expect((service as any).cleanDisplayName("SDK Einfach für Ihr Leben da")).toBe("SDK");
  });

  it("resolves an exact canonical correspondent", async () => {
    const service = createService();
    (service as any).findCandidateCorrespondents = vi.fn().mockResolvedValue([
      {
        id: "c1",
        name: "SDK",
        normalizedName: "sdk",
        reason: "exact",
        score: 1,
      },
    ]);

    const result = await service.resolve(
      buildInput(["SDK", "Mitgliedsservice"]),
      buildDeterministicResult("SDK"),
    );

    expect(result.correspondentName).toBe("SDK");
    expect(result.metadata.matchStrategy).toBe("exact");
  });

  it("resolves an alias candidate to the canonical correspondent", async () => {
    const service = createService();
    (service as any).findCandidateCorrespondents = vi.fn().mockResolvedValue([
      {
        id: "c1",
        name: "SDK",
        normalizedName: "sdk",
        reason: "alias",
        score: 0.98,
      },
    ]);

    const result = await service.resolve(
      buildInput(["ISDK", "Einfach für Ihr Leben da"]),
      buildDeterministicResult("ISDK"),
    );

    expect(result.correspondentName).toBe("SDK");
    expect(result.metadata.matchStrategy).toBe("alias");
  });

  it("accepts a strong fuzzy candidate", async () => {
    const service = createService();
    (service as any).findCandidateCorrespondents = vi.fn().mockResolvedValue([
      {
        id: "c1",
        name: "Gothaer",
        normalizedName: "gothaer",
        reason: "fuzzy",
        score: 0.91,
      },
    ]);

    const result = await service.resolve(
      buildInput(["Gothaer Versicherung"]),
      buildDeterministicResult("Gothaer Versicherung"),
    );

    expect(result.correspondentName).toBe("Gothaer");
    expect(result.metadata.matchStrategy).toBe("fuzzy");
  });

  it("sends ambiguous candidate matches to review", async () => {
    const service = createService();
    (service as any).findCandidateCorrespondents = vi.fn().mockResolvedValue([
      {
        id: "c1",
        name: "Hamburg Wasser",
        normalizedName: "hamburg wasser",
        reason: "fuzzy",
        score: 0.71,
      },
    ]);
    (service as any).resolveWithLlm = vi.fn().mockResolvedValue({
      rawName: "Hamburg Wasser Kundenkonto",
      cleanDisplayName: "Hamburg Wasser",
      confidence: 0.58,
      evidenceLines: ["Hamburg Wasser Kundenkonto"],
      isLikelyOrganizationOrPerson: true,
      shouldCreateNew: false,
      selectedCandidateId: "c1",
    });
    (service as any).getProvider = vi.fn(() => ({
      provider: "openai",
      apiKey: "test",
      model: "gpt-test",
    }));

    const result = await service.resolve(
      buildInput(["Hamburg Wasser Kundenkonto", "INFORMATIONEN ÜBER DIE BESCHAFFENHEIT DES TRINKWASSERS"]),
      buildDeterministicResult("Hamburg Wasser Kundenkonto"),
    );

    expect(result.correspondentName).toBeNull();
    expect(result.metadata.matchStrategy).toBe("review");
  });

  it("sends low-confidence llm new-name proposals to review", async () => {
    const service = createService();
    (service as any).findCandidateCorrespondents = vi.fn().mockResolvedValue([]);
    (service as any).resolveWithLlm = vi.fn().mockResolvedValue({
      rawName: "Barmenia Gothaer",
      cleanDisplayName: "Barmenia Gothaer",
      confidence: 0.52,
      evidenceLines: ["Barmenia Gothaer"],
      isLikelyOrganizationOrPerson: true,
      shouldCreateNew: true,
      selectedCandidateId: null,
    });
    (service as any).getProvider = vi.fn(() => ({
      provider: "openai",
      apiKey: "test",
      model: "gpt-test",
    }));

    const result = await service.resolve(
      buildInput(["Barmenia", "Gothaer"]),
      buildDeterministicResult("Barmenia Gothaer"),
    );

    expect(result.correspondentName).toBeNull();
    expect(result.metadata.matchStrategy).toBe("review");
  });
});
