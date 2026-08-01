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

  it("maps Mistral include_blocks output with real geometry and roles", () => {
    const result = mapMistralOcrResponse({
      pages: [
        {
          index: 0,
          markdown: "# Rechnung\n\nBetrag: 100 EUR",
          blocks: [
            {
              type: "title",
              text: "Rechnung",
              top_left_x: 100,
              top_left_y: 50,
              bottom_right_x: 500,
              bottom_right_y: 90,
            },
            {
              type: "text",
              text: "Betrag: 100 EUR",
              bbox: [100, 120, 500, 160],
            },
          ],
          header: "Stadtwerke Musterstadt",
          footer: "Seite 1 von 1",
        },
      ],
    });

    const blocks = result.pages[0]?.blocks ?? [];
    expect(blocks[0]).toMatchObject({
      role: "heading",
      text: "Rechnung",
      boundingBox: { x: 100, y: 50, width: 400, height: 40 },
    });
    expect(blocks[1]).toMatchObject({
      role: "paragraph",
      boundingBox: { x: 100, y: 120, width: 400, height: 40 },
    });
    const regions = blocks.filter((block) => block.metadata?.region);
    expect(regions.map((block) => block.metadata?.region)).toEqual(["header", "footer"]);
    expect(regions.every((block) => block.role === "other")).toBe(true);
  });

  it("parses Mistral markdown tables into normalized cells", () => {
    const result = mapMistralOcrResponse({
      pages: [
        {
          index: 0,
          markdown: "Details siehe Tabelle.",
          tables: [
            {
              markdown: "| Position | Betrag |\n|---|---|\n| Strom | 89,00 EUR |",
            },
          ],
        },
      ],
    });

    expect(result.tables).toHaveLength(1);
    const cells = result.tables[0]!.cells;
    expect(cells).toHaveLength(4);
    expect(cells[0]).toMatchObject({ row: 1, column: 1, text: "Position", kind: "header" });
    expect(cells[3]).toMatchObject({ row: 2, column: 2, text: "89,00 EUR", kind: "body" });
  });

  it("keeps markdown headings when the provider returns only non-heading blocks", () => {
    const result = mapMistralOcrResponse({
      pages: [
        {
          index: 0,
          markdown: "# Rechnung Nr. 2024-001\n\nBetrag: 119,00 EUR",
          blocks: [{ type: "text", text: "Betrag: 119,00 EUR" }],
          header: "Stadtwerke Musterstadt",
        },
      ],
    });

    const blocks = result.pages[0]?.blocks ?? [];
    // The chunker only reads heading-role blocks, so the markdown fallback must
    // be appended even though paragraph/header blocks exist.
    const headings = blocks.filter((block) => block.role === "heading");
    expect(headings).toHaveLength(1);
    expect(headings[0]).toMatchObject({ text: "Rechnung Nr. 2024-001", boundingBox: null });
    expect(new Set(blocks.map((block) => block.blockIndex)).size).toBe(blocks.length);
  });

  it("treats escaped pipes inside markdown table cells as content", () => {
    const result = mapMistralOcrResponse({
      pages: [
        {
          index: 0,
          markdown: "Tabelle folgt.",
          tables: [
            {
              markdown: "| Rule | Value |\n|---|---|\n| A \\| B | 10 |",
            },
          ],
        },
      ],
    });

    const cells = result.tables[0]!.cells;
    const bodyCells = cells.filter((cell) => cell.row === 2);
    expect(bodyCells).toHaveLength(2);
    expect(bodyCells[0]?.text).toBe("A | B");
    expect(bodyCells[1]?.text).toBe("10");
  });

  it("parses HTML tables when table_format=html is configured", () => {
    const result = mapMistralOcrResponse({
      pages: [
        {
          index: 0,
          markdown: "Details siehe Tabelle.",
          tables: [
            {
              html: "<table><tr><th>Position</th><th>Betrag</th></tr><tr><td>Strom</td><td>89,00&nbsp;EUR</td></tr></table>",
            },
          ],
        },
      ],
    });

    expect(result.tables).toHaveLength(1);
    const cells = result.tables[0]!.cells;
    expect(cells).toHaveLength(4);
    expect(cells[0]).toMatchObject({ row: 1, column: 1, text: "Position", kind: "header" });
    expect(cells[3]).toMatchObject({ row: 2, column: 2, text: "89,00 EUR", kind: "body" });
  });

  it("derives keyValues from Mistral markdown so deterministic extractors keep working", () => {
    const result = mapMistralOcrResponse({
      pages: [
        {
          index: 0,
          markdown: [
            "**Rechnungsnummer:** 2026-042",
            "Fälligkeitsdatum: 15.08.2026",
            "Dies ist ein normaler Satz ohne Label und sollte ignoriert werden.",
            "| Tabelle | bleibt |",
          ].join("\n"),
        },
      ],
    });

    expect(result.keyValues).toEqual([
      expect.objectContaining({
        key: "Rechnungsnummer",
        value: "2026-042",
        page: 1,
        metadata: { source: "derived-markdown" },
      }),
      expect.objectContaining({
        key: "Fälligkeitsdatum",
        value: "15.08.2026",
      }),
    ]);
  });

  it("flags low Mistral page confidence for review", () => {
    const result = mapMistralOcrResponse({
      pages: [
        { index: 0, markdown: "Klarer Text", confidence: 0.95 },
        { index: 1, markdown: "Verwaschener Scan", confidence: 0.4 },
      ],
    });

    expect(result.reviewReasons).toContain("ocr_low_confidence");
    expect(result.warnings).toContain("ocr_low_confidence_page_2");
    expect(result.providerMetadata.pageConfidences).toEqual([
      { page: 1, confidence: 0.95 },
      { page: 2, confidence: 0.4 },
    ]);
  });
});
