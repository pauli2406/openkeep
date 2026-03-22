import { Injectable } from "@nestjs/common";
import { createHash } from "crypto";

import type { Chunker, ChunkingInput } from "./provider.types";

const DEFAULT_STRATEGY = "normalized-parse-v1";
const MAX_CHUNK_CHARS = 1200;

const buildChunkContentHash = (input: {
  heading: string | null;
  text: string;
  pageFrom: number | null;
  pageTo: number | null;
  strategyVersion: string;
}) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        heading: input.heading,
        text: input.text,
        pageFrom: input.pageFrom,
        pageTo: input.pageTo,
        strategyVersion: input.strategyVersion,
      }),
    )
    .digest("hex");

@Injectable()
export class DeterministicChunker implements Chunker {
  async chunk(input: ChunkingInput) {
    const { documentId, parsed } = input;

    if (parsed.chunkHints.length > 0) {
      return parsed.chunkHints
        .map((chunkHint, index) => ({
          documentId,
          chunkIndex: index,
          heading: chunkHint.heading ?? null,
          text: chunkHint.text.trim(),
          pageFrom: chunkHint.pageFrom ?? null,
          pageTo: chunkHint.pageTo ?? chunkHint.pageFrom ?? null,
          strategyVersion: DEFAULT_STRATEGY,
          contentHash: buildChunkContentHash({
            heading: chunkHint.heading ?? null,
            text: chunkHint.text.trim(),
            pageFrom: chunkHint.pageFrom ?? null,
            pageTo: chunkHint.pageTo ?? chunkHint.pageFrom ?? null,
            strategyVersion: DEFAULT_STRATEGY,
          }),
          metadata: {
            source: "provider-hint",
            provider: parsed.provider,
            ...(chunkHint.metadata ?? {}),
          },
        }))
        .filter((chunk) => chunk.text.length > 0);
    }

    const chunks: Array<{
      documentId: string;
      chunkIndex: number;
      heading: string | null;
      text: string;
      pageFrom: number | null;
      pageTo: number | null;
      strategyVersion: string;
      contentHash: string;
      metadata: Record<string, unknown>;
    }> = [];

    let currentLines: string[] = [];
    let currentHeading: string | null = null;
    let pageFrom: number | null = null;
    let pageTo: number | null = null;

    const flush = () => {
      const text = currentLines.join("\n").trim();
      if (!text) {
        return;
      }

      chunks.push({
        documentId,
        chunkIndex: chunks.length,
        heading: currentHeading,
        text,
        pageFrom,
        pageTo,
        strategyVersion: DEFAULT_STRATEGY,
        contentHash: buildChunkContentHash({
          heading: currentHeading,
          text,
          pageFrom,
          pageTo,
          strategyVersion: DEFAULT_STRATEGY,
        }),
        metadata: {
          source: "openkeep-lines",
          provider: parsed.provider,
        },
      });

      currentLines = [];
      currentHeading = null;
      pageFrom = null;
      pageTo = null;
    };

    for (const page of parsed.pages) {
      const headingBlocks = page.blocks.filter((block) => block.role === "heading");
      const pageHeading = headingBlocks[0]?.text?.trim() || null;

      for (const line of page.lines) {
        const lineText = line.text.trim();
        if (!lineText) {
          continue;
        }

        if (pageFrom === null) {
          pageFrom = page.pageNumber;
          currentHeading = pageHeading;
        }

        const candidateText = [...currentLines, lineText].join("\n");
        if (candidateText.length > MAX_CHUNK_CHARS && currentLines.length > 0) {
          flush();
          pageFrom = page.pageNumber;
          currentHeading = pageHeading;
        }

        currentLines.push(lineText);
        pageTo = page.pageNumber;
      }

      flush();
    }

    return chunks;
  }
}
