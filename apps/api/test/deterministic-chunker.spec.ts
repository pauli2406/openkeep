import { describe, expect, it } from "vitest";

import { DeterministicChunker } from "../src/processing/deterministic-chunker";

describe("DeterministicChunker", () => {
  const chunker = new DeterministicChunker();

  it("uses provider chunk hints when available", async () => {
    const chunks = await chunker.chunk({
      documentId: "11111111-1111-1111-1111-111111111111",
      parsed: {
        provider: "google-document-ai-gemini-layout-parser",
        parseStrategy: "fixture",
        text: "Section one\nSection two",
        language: "en",
        pages: [],
        tables: [],
        keyValues: [],
        reviewReasons: [],
        warnings: [],
        searchablePdfPath: undefined,
        providerMetadata: {},
        temporaryPaths: [],
        chunkHints: [
          {
            chunkIndex: 0,
            heading: "Intro",
            text: "First section",
            pageFrom: 1,
            pageTo: 1,
            metadata: {
              source: "fixture",
            },
          },
        ],
      },
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      chunkIndex: 0,
      heading: "Intro",
      text: "First section",
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      metadata: {
        source: "fixture",
        provider: "google-document-ai-gemini-layout-parser",
      },
    });
  });

  it("falls back to line-based deterministic chunking", async () => {
    const chunks = await chunker.chunk({
      documentId: "11111111-1111-1111-1111-111111111111",
      parsed: {
        provider: "local-ocr",
        parseStrategy: "fixture",
        text: "Invoice\nLine one\nLine two",
        language: "en",
        tables: [],
        keyValues: [],
        chunkHints: [],
        reviewReasons: [],
        warnings: [],
        searchablePdfPath: undefined,
        providerMetadata: {},
        temporaryPaths: [],
        pages: [
          {
            pageNumber: 1,
            width: null,
            height: null,
            lines: [
              {
                lineIndex: 0,
                text: "Invoice",
                boundingBox: { x: 0, y: 0, width: 40, height: 10 },
              },
              {
                lineIndex: 1,
                text: "Line one",
                boundingBox: { x: 0, y: 12, width: 40, height: 10 },
              },
              {
                lineIndex: 2,
                text: "Line two",
                boundingBox: { x: 0, y: 24, width: 40, height: 10 },
              },
            ],
            blocks: [
              {
                blockIndex: 0,
                role: "heading",
                text: "Invoice",
                boundingBox: { x: 0, y: 0, width: 40, height: 10 },
                lineIndices: [0],
                metadata: {},
              },
            ],
          },
        ],
      },
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      heading: "Invoice",
      pageFrom: 1,
      pageTo: 1,
      strategyVersion: "normalized-parse-v2",
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(chunks[0]?.text).toContain("Line one");
  });

  it("indexes a normalized table once, not twice via its markdown rows", async () => {
    const chunks = await chunker.chunk({
      documentId: "11111111-1111-1111-1111-111111111111",
      parsed: {
        provider: "mistral-ocr",
        parseStrategy: "fixture",
        text: "Details siehe Tabelle.",
        language: "de",
        keyValues: [],
        chunkHints: [],
        reviewReasons: [],
        warnings: [],
        searchablePdfPath: undefined,
        providerMetadata: {},
        temporaryPaths: [],
        tables: [
          {
            tableIndex: 0,
            page: 1,
            title: null,
            boundingBox: null,
            cells: [
              { row: 1, column: 1, rowSpan: 1, columnSpan: 1, text: "Position", kind: "header" as const },
              { row: 1, column: 2, rowSpan: 1, columnSpan: 1, text: "Betrag", kind: "header" as const },
              { row: 2, column: 1, rowSpan: 1, columnSpan: 1, text: "Strom", kind: "body" as const },
              {
                row: 2,
                column: 2,
                rowSpan: 1,
                columnSpan: 1,
                text: "89,00 | 92,00 EUR",
                kind: "body" as const,
              },
            ],
            metadata: {},
          },
        ],
        pages: [
          {
            pageNumber: 1,
            width: null,
            height: null,
            lines: [
              { lineIndex: 0, text: "Details siehe Tabelle.", boundingBox: null },
              { lineIndex: 1, text: "| Position | Betrag |", boundingBox: null },
              { lineIndex: 2, text: "|---|---|", boundingBox: null },
              { lineIndex: 3, text: "| Strom | 89,00 \\| 92,00 EUR |", boundingBox: null },
              // Pipe-delimited, but not part of the normalized table.
              { lineIndex: 4, text: "| grep -c ok | wc -l |", boundingBox: null },
            ],
            blocks: [],
          },
        ],
      },
    });

    const combined = chunks.map((chunk) => chunk.text).join("\n");
    expect(combined).toContain("Details siehe Tabelle.");
    // The serialized table appears exactly once — the raw markdown rows that the
    // provider keeps for the text blocks must not be chunked as prose.
    expect(combined.match(/Strom/g)).toHaveLength(1);
    expect(combined).toContain("[Table]");
    // A pipe inside a cell stays escaped, so the row keeps two columns instead of
    // silently becoming three.
    expect(combined).toContain("| Strom | 89,00 \\| 92,00 EUR |");
    // A pipe-delimited line that belongs to no normalized table must survive.
    expect(combined).toContain("| grep -c ok | wc -l |");
  });

  it("matches source rows of a ragged table despite normalized padding", async () => {
    const chunks = await chunker.chunk({
      documentId: "11111111-1111-1111-1111-111111111111",
      parsed: {
        provider: "mistral-ocr",
        parseStrategy: "fixture",
        text: "Übersicht",
        language: "de",
        keyValues: [],
        chunkHints: [],
        reviewReasons: [],
        warnings: [],
        searchablePdfPath: undefined,
        providerMetadata: {},
        temporaryPaths: [],
        tables: [
          {
            tableIndex: 0,
            page: 1,
            title: null,
            boundingBox: null,
            // Two-cell header above a three-cell body row: `buildTableRows` pads the
            // header, the source line does not carry the padding cell.
            cells: [
              { row: 1, column: 1, rowSpan: 1, columnSpan: 1, text: "Position", kind: "header" as const },
              { row: 1, column: 2, rowSpan: 1, columnSpan: 1, text: "Betrag", kind: "header" as const },
              { row: 2, column: 1, rowSpan: 1, columnSpan: 1, text: "Strom", kind: "body" as const },
              { row: 2, column: 2, rowSpan: 1, columnSpan: 1, text: "89,00", kind: "body" as const },
              { row: 2, column: 3, rowSpan: 1, columnSpan: 1, text: "EUR", kind: "body" as const },
            ],
            metadata: {},
          },
        ],
        pages: [
          {
            pageNumber: 1,
            width: null,
            height: null,
            lines: [
              { lineIndex: 0, text: "Übersicht", boundingBox: null },
              { lineIndex: 1, text: "| Position | Betrag |", boundingBox: null },
              { lineIndex: 2, text: "|---|---|", boundingBox: null },
              { lineIndex: 3, text: "| Strom | 89,00 | EUR |", boundingBox: null },
            ],
            blocks: [],
          },
        ],
      },
    });

    const combined = chunks.map((chunk) => chunk.text).join("\n");
    expect(combined.match(/Position/g)).toHaveLength(1);
    expect(combined.match(/Strom/g)).toHaveLength(1);
  });
});
