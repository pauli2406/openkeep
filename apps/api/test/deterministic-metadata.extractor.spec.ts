import { readFile } from "fs/promises";
import { resolve } from "path";

import { describe, expect, it } from "vitest";
import type { ReviewEvidenceField } from "@openkeep/types";

import { DeterministicMetadataExtractor } from "../src/processing/deterministic-metadata.extractor";
import { DocumentTypePolicyService } from "../src/processing/document-type-policy.service";

const fixturePath = (name: string) =>
  resolve(__dirname, "../../../tests/fixtures", name);

const buildParsedInput = async (name: string) => {
  const text = await readFile(fixturePath(name), "utf8");
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, lineIndex) => ({
      lineIndex,
      text: line,
      boundingBox: {
        x: 0,
        y: lineIndex * 12,
        width: line.length * 7,
        height: 10,
      },
    }));

  return {
    documentId: "11111111-1111-1111-1111-111111111111",
    title: name,
    mimeType: "application/pdf",
    parsed: {
      provider: "local-ocr" as const,
      parseStrategy: "fixture",
      text,
      language: null,
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
          lines,
          blocks: [],
        },
      ],
    },
  };
};

describe("DeterministicMetadataExtractor", () => {
  const policyService = {
    getPolicy: async (documentTypeName: string | null) => {
      const policies: Record<string, ReviewEvidenceField[]> = {
        Invoice: [
          "correspondent",
          "issueDate",
          "dueDate",
          "amount",
          "currency",
          "referenceNumber",
        ],
        Letter: ["correspondent", "issueDate"],
        Manual: [],
        "Utility Bill": [
          "correspondent",
          "issueDate",
          "dueDate",
          "amount",
          "currency",
          "referenceNumber",
        ],
        "Tax Document": ["correspondent", "issueDate", "dueDate", "referenceNumber"],
        Giftcard: ["correspondent", "amount", "currency", "referenceNumber", "expiryDate"],
        ID: ["holderName", "issuingAuthority", "referenceNumber", "issueDate", "expiryDate"],
      };

      return {
        documentTypeName,
        requiredFields: (documentTypeName ? policies[documentTypeName] : []) ?? [],
        documentClass:
          documentTypeName === "Invoice" || documentTypeName === "Utility Bill"
            ? ("invoice" as const)
            : ("generic" as const),
      };
    },
    buildReviewEvidence: (
      policy: Awaited<ReturnType<DocumentTypePolicyService["getPolicy"]>>,
      extracted: ReturnType<DocumentTypePolicyService["emptyExtracted"]>,
    ) => ({
      documentClass: policy.documentClass,
      requiredFields: policy.requiredFields,
      missingFields: policy.requiredFields.filter((field) => !extracted[field]),
      extracted,
      activeReasons: [],
    }),
  } satisfies Pick<DocumentTypePolicyService, "getPolicy" | "buildReviewEvidence">;
  const extractor = new DeterministicMetadataExtractor(
    policyService as unknown as DocumentTypePolicyService,
  );

  it("extracts German invoice metadata and due dates", async () => {
    const result = await extractor.extract(await buildParsedInput("invoice.de.txt"));

    expect(result.documentTypeName).toBe("Invoice");
    expect(result.correspondentName).toBe("Stadtwerke Berlin GmbH");
    expect(result.amount).toBe(123.45);
    expect(result.currency).toBe("EUR");
    expect(result.referenceNumber).toBe("2025-0042");
    expect(result.tags).toContain("deadline");
    expect(result.dueDate?.toISOString().slice(0, 10)).toBe("2025-02-15");
    expect(result.reviewReasons).toEqual([]);
  });

  it("extracts English invoice metadata", async () => {
    const result = await extractor.extract(await buildParsedInput("invoice.en.txt"));

    expect(result.documentTypeName).toBe("Invoice");
    expect(result.correspondentName).toBe("Example Telecom Ltd.");
    expect(result.amount).toBe(89.9);
    expect(result.currency).toBe("USD");
    expect(result.referenceNumber).toBe("INV-2025-901");
    expect(result.issueDate?.toISOString().slice(0, 10)).toBe("2025-03-02");
    expect(result.reviewReasons).toEqual([]);
  });

  it("flags invoice-like documents with missing required fields in structured review evidence", async () => {
    const lines = [
      "Invoice",
      "Example Energy GmbH",
      "Invoice Date: 2025-05-03",
      "Payment reference pending",
    ].map((text, lineIndex) => ({
      lineIndex,
      text,
      boundingBox: {
        x: 0,
        y: lineIndex * 12,
        width: text.length * 7,
        height: 10,
      },
    }));

    const result = await extractor.extract({
      documentId: "11111111-1111-1111-1111-111111111111",
      title: "missing-currency",
      mimeType: "application/pdf",
      parsed: {
        provider: "local-ocr",
        parseStrategy: "fixture",
        text: "Invoice\nExample Energy GmbH\nInvoice Date: 2025-05-03\nPayment reference pending\n",
        language: "en",
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
            lines,
            blocks: [],
          },
        ],
      },
    });

    expect(result.reviewReasons).toContain("missing_key_fields");
    expect(result.metadata.reviewEvidence).toMatchObject({
      documentClass: "invoice",
      requiredFields: [
        "correspondent",
        "issueDate",
        "dueDate",
        "amount",
        "currency",
        "referenceNumber",
      ],
      missingFields: ["dueDate", "amount", "currency"],
      extracted: {
        correspondent: true,
        issueDate: true,
        dueDate: false,
        amount: false,
        currency: false,
        referenceNumber: true,
      },
    });
  });

  it("does not require amount or currency for letters", async () => {
    const result = await extractor.extract({
      documentId: "11111111-1111-1111-1111-111111111111",
      title: "letter.txt",
      mimeType: "application/pdf",
      parsed: {
        provider: "local-ocr",
        parseStrategy: "fixture",
        text: "Letter\nWHU Alumni Association\nDate: 2025-05-03\nHello there\n",
        language: "en",
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
            lines: [
              "Letter",
              "WHU Alumni Association",
              "Date: 2025-05-03",
              "Hello there",
            ].map((text, lineIndex) => ({
              lineIndex,
              text,
              boundingBox: { x: 0, y: lineIndex * 12, width: text.length * 7, height: 10 },
            })),
            blocks: [],
          },
        ],
      },
    });

    expect(result.documentTypeName).toBe("Letter");
    expect(result.reviewReasons).not.toContain("missing_key_fields");
  });

  it("extracts ID fields conservatively", async () => {
    const result = await extractor.extract({
      documentId: "11111111-1111-1111-1111-111111111111",
      title: "id-card.txt",
      mimeType: "application/pdf",
      parsed: {
        provider: "local-ocr",
        parseStrategy: "fixture",
        text: [
          "PERSONALAUSWEIS",
          "Name: Alex Example",
          "Document No: C01X00ABC",
          "Issued on: 01.02.2024",
          "Valid until: 01.02.2034",
          "Issuing Authority: Example City Authority",
        ].join("\n"),
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
            lines: [
              "PERSONALAUSWEIS",
              "Name: Alex Example",
              "Document No: C01X00ABC",
              "Issued on: 01.02.2024",
              "Valid until: 01.02.2034",
              "Issuing Authority: Example City Authority",
            ].map((text, lineIndex) => ({
              lineIndex,
              text,
              boundingBox: { x: 0, y: lineIndex * 12, width: text.length * 7, height: 10 },
            })),
            blocks: [],
          },
        ],
      },
    });

    expect(result.documentTypeName).toBe("ID");
    expect(result.holderName).toBe("Alex Example");
    expect(result.issuingAuthority).toBe("Example City Authority");
    expect(result.expiryDate?.toISOString().slice(0, 10)).toBe("2034-02-01");
    expect(result.reviewReasons).not.toContain("missing_key_fields");
  });

  it("requires due date and reference number for utility bills", async () => {
    const result = await extractor.extract({
      documentId: "11111111-1111-1111-1111-111111111111",
      title: "city-water.txt",
      mimeType: "application/pdf",
      parsed: {
        provider: "local-ocr",
        parseStrategy: "fixture",
        text: [
          "CITY WATER",
          "Informationen über die Beschaffenheit des Trinkwassers",
          "Datum: 01.02.2025",
          "Gesamtbetrag: EUR 42,50",
        ].join("\n"),
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
            lines: [
              "CITY WATER",
              "Informationen über die Beschaffenheit des Trinkwassers",
              "Datum: 01.02.2025",
              "Gesamtbetrag: EUR 42,50",
            ].map((text, lineIndex) => ({
              lineIndex,
              text,
              boundingBox: { x: 0, y: lineIndex * 12, width: text.length * 7, height: 10 },
            })),
            blocks: [],
          },
        ],
      },
    });

    expect(result.documentTypeName).toBe("Utility Bill");
    expect(result.reviewReasons).toContain("missing_key_fields");
    expect(result.metadata.reviewEvidence).toMatchObject({
      missingFields: ["dueDate", "referenceNumber"],
    });
  });

  it("does not require any key fields for manuals", async () => {
    const result = await extractor.extract({
      documentId: "11111111-1111-1111-1111-111111111111",
      title: "manual.pdf",
      mimeType: "application/pdf",
      parsed: {
        provider: "local-ocr",
        parseStrategy: "fixture",
        text: "Manual\nQuick start guide\nSetup instructions\n",
        language: "en",
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
            lines: ["Manual", "Quick start guide", "Setup instructions"].map((text, lineIndex) => ({
              lineIndex,
              text,
              boundingBox: { x: 0, y: lineIndex * 12, width: text.length * 7, height: 10 },
            })),
            blocks: [],
          },
        ],
      },
    });

    expect(result.documentTypeName).toBe("Manual");
    expect(result.reviewReasons).not.toContain("missing_key_fields");
    expect(result.metadata.reviewEvidence).toMatchObject({
      requiredFields: [],
      missingFields: [],
    });
  });

  it("canonicalizes tax-like detections to Tax Document", async () => {
    const result = await extractor.extract({
      documentId: "11111111-1111-1111-1111-111111111111",
      title: "tax-notice.pdf",
      mimeType: "application/pdf",
      parsed: {
        provider: "local-ocr",
        parseStrategy: "fixture",
        text: "Steuerbescheid\nFinanzamt Beispielstadt\nDatum: 01.02.2025\n",
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
            lines: ["Steuerbescheid", "Finanzamt Beispielstadt", "Datum: 01.02.2025"].map(
              (text, lineIndex) => ({
                lineIndex,
                text,
                boundingBox: { x: 0, y: lineIndex * 12, width: text.length * 7, height: 10 },
              }),
            ),
            blocks: [],
          },
        ],
      },
    });

    expect(result.documentTypeName).toBe("Tax Document");
    expect(result.metadata.reviewEvidence).toMatchObject({
      requiredFields: ["correspondent", "issueDate", "dueDate", "referenceNumber"],
      missingFields: ["dueDate", "referenceNumber"],
    });
  });

  it("detects gift cards and infers expiry from month-year plus duration text", async () => {
    const result = await extractor.extract({
      documentId: "11111111-1111-1111-1111-111111111111",
      title: "topgolf-gutschein.pdf",
      mimeType: "application/pdf",
      parsed: {
        provider: "local-ocr",
        parseStrategy: "fixture",
        text: [
          "Topgolf Gutschein über 100€",
          "Betrag: 100€",
          "3 Jahre gültig ab Ausstellungsdatum",
          "07/2024",
          "A38Q-20XP-JUO5-6974",
        ].join("\n"),
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
            lines: [
              "Topgolf Gutschein über 100€",
              "Betrag: 100€",
              "3 Jahre gültig ab Ausstellungsdatum",
              "07/2024",
              "A38Q-20XP-JUO5-6974",
            ].map((text, lineIndex) => ({
              lineIndex,
              text,
              boundingBox: { x: 0, y: lineIndex * 12, width: text.length * 7, height: 10 },
            })),
            blocks: [],
          },
        ],
      },
    });

    expect(result.documentTypeName).toBe("Giftcard");
    expect(result.amount).toBe(100);
    expect(result.currency).toBe("EUR");
    expect(result.expiryDate?.toISOString().slice(0, 10)).toBe("2027-07-31");
  });
});
