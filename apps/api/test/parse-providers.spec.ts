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

  it("maps Mistral OCR into the normalized parse model", () => {
    const result = mapMistralOcrResponse({
      pages: [
        {
          page_number: 1,
          text: "Hello world",
          lines: [{ text: "Hello world", bbox: [0, 0, 100, 0, 100, 10, 0, 10] }],
        },
      ],
      chunks: [{ heading: "Intro", text: "Hello world", page: 1 }],
    });

    expect(result.provider).toBe("mistral-ocr");
    expect(result.pages[0]?.lines[0]?.text).toBe("Hello world");
    expect(result.chunkHints[0]?.heading).toBe("Intro");
  });
});
