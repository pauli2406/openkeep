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
  title: "Test document",
  summary: null,
  language: "de",
  issueDate: null,
  dueDate: null,
  expiryDate: null,
  amount: null,
  currency: null,
  referenceNumber: null,
  holderName: null,
  issuingAuthority: null,
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
        dueDate: false,
        amount: false,
        currency: false,
        referenceNumber: false,
        expiryDate: false,
        holderName: false,
        issuingAuthority: false,
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
    expect((service as any).cleanDisplayName("ABC Einfach fuer alle da")).toBe("ABC");
  });

  it("resolves an exact canonical correspondent", async () => {
    const service = createService();
    (service as any).findCandidateCorrespondents = vi.fn().mockResolvedValue([
      {
        id: "c1",
        name: "ABC",
        normalizedName: "abc",
        reason: "exact",
        score: 1,
      },
    ]);

    const result = await service.resolve(
      buildInput(["ABC", "Mitgliederservice"]),
      buildDeterministicResult("ABC"),
    );

    expect(result.correspondentName).toBe("ABC");
    expect(result.metadata.matchStrategy).toBe("exact");
  });

  it("resolves an alias candidate to the canonical correspondent", async () => {
    const service = createService();
    (service as any).findCandidateCorrespondents = vi.fn().mockResolvedValue([
      {
        id: "c1",
        name: "ABC",
        normalizedName: "abc",
        reason: "alias",
        score: 0.98,
      },
    ]);

    const result = await service.resolve(
      buildInput(["IABC", "Einfach fuer alle da"]),
      buildDeterministicResult("IABC"),
    );

    expect(result.correspondentName).toBe("ABC");
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
        name: "City Water",
        normalizedName: "city water",
        reason: "fuzzy",
        score: 0.71,
      },
    ]);
    (service as any).resolveWithLlm = vi.fn().mockResolvedValue({
      rawName: "City Water Customer Account",
      cleanDisplayName: "City Water",
      confidence: 0.58,
      evidenceLines: ["City Water Customer Account"],
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
      buildInput(["City Water Customer Account", "INFORMATIONEN UEBER DIE BESCHAFFENHEIT DES TRINKWASSERS"]),
      buildDeterministicResult("City Water Customer Account"),
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
