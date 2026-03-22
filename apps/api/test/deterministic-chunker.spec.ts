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
      strategyVersion: "normalized-parse-v1",
    });
    expect(chunks[0]?.text).toContain("Line one");
  });
});
