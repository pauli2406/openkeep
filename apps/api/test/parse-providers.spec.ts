import { describe, expect, it } from "vitest";

import { mapAmazonTextractResponse } from "../src/processing/amazon-textract.provider";
import { mapAzureDocumentIntelligenceResponse } from "../src/processing/azure-document-intelligence.provider";
import { mapGoogleDocumentAiResponse } from "../src/processing/google-document-ai.providers";
import { mapMistralOcrResponse } from "../src/processing/mistral-ocr.provider";

describe("Parse provider mappers", () => {
  it("maps Google Document AI enterprise OCR into the normalized parse model", () => {
    const result = mapGoogleDocumentAiResponse("google-document-ai-enterprise-ocr", {
      document: {
        text: "Invoice Number INV-001",
        pages: [
          {
            pageNumber: 1,
            lines: [
              {
                layout: {
                  textAnchor: {
                    textSegments: [{ startIndex: "0", endIndex: "22" }],
                  },
                  boundingPoly: {
                    normalizedVertices: [
                      { x: 0, y: 0 },
                      { x: 1, y: 0 },
                      { x: 1, y: 1 },
                      { x: 0, y: 1 },
                    ],
                  },
                },
              },
            ],
            formFields: [
              {
                fieldName: {
                  textAnchor: {
                    textSegments: [{ startIndex: "0", endIndex: "7" }],
                  },
                },
                fieldValue: {
                  textAnchor: {
                    textSegments: [{ startIndex: "8", endIndex: "22" }],
                  },
                },
              },
            ],
          },
        ],
      },
    });

    expect(result.provider).toBe("google-document-ai-enterprise-ocr");
    expect(result.pages).toHaveLength(1);
    expect(result.keyValues[0]).toMatchObject({
      key: "Invoice",
      value: "Number INV-001",
    });
  });

  it("keeps Gemini layout parser as a separate provider path", () => {
    const result = mapGoogleDocumentAiResponse("google-document-ai-gemini-layout-parser", {
      document: {
        text: "Section 1\nBody",
        pages: [],
        chunkedDocument: {
          chunks: [
            {
              heading: "Section 1",
              content: "Body",
              pageSpan: {
                pageStart: 0,
                pageEnd: 0,
              },
            },
          ],
        },
      },
    });

    expect(result.provider).toBe("google-document-ai-gemini-layout-parser");
    expect(result.chunkHints).toHaveLength(1);
  });

  it("maps Amazon Textract blocks into normalized lines and key-values", () => {
    const result = mapAmazonTextractResponse([
      {
        Id: "line-1",
        BlockType: "LINE",
        Text: "Invoice Number INV-001",
        Page: 1,
      },
      {
        Id: "key-1",
        BlockType: "KEY_VALUE_SET",
        EntityTypes: ["KEY"],
        Page: 1,
        Relationships: [
          { Type: "CHILD", Ids: ["word-key"] },
          { Type: "VALUE", Ids: ["value-1"] },
        ],
      },
      {
        Id: "value-1",
        BlockType: "KEY_VALUE_SET",
        EntityTypes: ["VALUE"],
        Page: 1,
        Relationships: [{ Type: "CHILD", Ids: ["word-val"] }],
      },
      {
        Id: "word-key",
        BlockType: "WORD",
        Text: "Invoice",
      },
      {
        Id: "word-val",
        BlockType: "WORD",
        Text: "INV-001",
      },
    ]);

    expect(result.provider).toBe("amazon-textract");
    expect(result.pages[0]?.lines[0]?.text).toContain("Invoice Number");
    expect(result.keyValues[0]).toMatchObject({
      key: "Invoice",
      value: "INV-001",
    });
  });

  it("maps Azure AI Document Intelligence into normalized lines and tables", () => {
    const result = mapAzureDocumentIntelligenceResponse({
      content: "Invoice Date: 2025-01-10",
      pages: [
        {
          pageNumber: 1,
          width: 100,
          height: 200,
          lines: [
            {
              content: "Invoice Date: 2025-01-10",
              polygon: [0, 0, 50, 0, 50, 10, 0, 10],
            },
          ],
        },
      ],
      tables: [
        {
          boundingRegions: [{ pageNumber: 1, polygon: [0, 0, 50, 0, 50, 50, 0, 50] }],
          cells: [
            {
              rowIndex: 0,
              columnIndex: 0,
              content: "Header",
              kind: "columnHeader",
              boundingRegions: [{ polygon: [0, 0, 10, 0, 10, 10, 0, 10] }],
            },
          ],
        },
      ],
      keyValuePairs: [],
      paragraphs: [],
    });

    expect(result.provider).toBe("azure-ai-document-intelligence");
    expect(result.tables).toHaveLength(1);
    expect(result.pages[0]?.lines).toHaveLength(1);
  });

  it("maps the real Mistral OCR response shape (markdown pages + dimensions)", () => {
    const result = mapMistralOcrResponse({
      model: "mistral-ocr-latest",
      pages: [
        {
          index: 0,
          markdown: "# Rechnung Nr. 2024-001\n\nGesamtbetrag: 119,00 EUR",
          dimensions: { dpi: 200, width: 1654, height: 2339 },
          images: [],
        },
        {
          index: 1,
          markdown: "Zahlbar bis 31.08.2026",
          dimensions: { dpi: 200, width: 1654, height: 2339 },
          images: [],
        },
      ],
      usage_info: { pages_processed: 2, doc_size_bytes: 12345 },
    });

    expect(result.provider).toBe("mistral-ocr");
    expect(result.text).toContain("Rechnung Nr. 2024-001");
    expect(result.text).toContain("Zahlbar bis 31.08.2026");
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.pageNumber).toBe(1);
    expect(result.pages[0]?.width).toBe(1654);
    expect(result.pages[0]?.height).toBe(2339);
    expect(result.pages[1]?.pageNumber).toBe(2);
    expect(result.pages[0]?.lines[0]?.text).toBe("# Rechnung Nr. 2024-001");
  });

  it("derives heading blocks from Mistral markdown so chunks keep headings", () => {
    const result = mapMistralOcrResponse({
      pages: [
        {
          index: 0,
          markdown: "# Rechnung Nr. 2024-001\n\nBetrag: 119,00 EUR\n\n## Zahlungshinweise\n\nZahlbar sofort",
        },
      ],
    });

    const blocks = result.pages[0]?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      role: "heading",
      text: "Rechnung Nr. 2024-001",
      boundingBox: null,
    });
    expect(blocks[1]).toMatchObject({ role: "heading", text: "Zahlungshinweise" });
  });

  it("never fabricates bounding boxes for Mistral lines", () => {
    const result = mapMistralOcrResponse({
      pages: [
        {
          index: 0,
          markdown: "Line one\nLine two\nLine three",
        },
      ],
    });

    for (const line of result.pages[0]?.lines ?? []) {
      expect(line.boundingBox).toBeNull();
    }
    expect(result.pages[0]?.width).toBeNull();
    expect(result.pages[0]?.height).toBeNull();
  });

  it("summarizes Mistral provider metadata instead of persisting the raw response", () => {
    const result = mapMistralOcrResponse({
      model: "mistral-ocr-latest",
      pages: [{ index: 0, markdown: "Hello" }],
      usage_info: { pages_processed: 1, doc_size_bytes: 999 },
    });

    expect(result.providerMetadata).not.toHaveProperty("raw");
    expect(result.providerMetadata).toMatchObject({
      model: "mistral-ocr-latest",
      pagesProcessed: 1,
      docSizeBytes: 999,
    });
  });
});
