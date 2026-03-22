import { readFile } from "fs/promises";
import { resolve } from "path";

import { describe, expect, it } from "vitest";

import { DeterministicMetadataExtractor } from "../src/processing/deterministic-metadata.extractor";

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
  const extractor = new DeterministicMetadataExtractor();

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
      requiredFields: ["correspondent", "issueDate", "amount", "currency"],
      missingFields: ["amount", "currency"],
      extracted: {
        correspondent: true,
        issueDate: true,
        amount: false,
        currency: false,
      },
    });
  });
});
