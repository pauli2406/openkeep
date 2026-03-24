import { Injectable } from "@nestjs/common";
import { createHash } from "crypto";
import type { ParsedDocumentTable } from "@openkeep/types";

import type { Chunker, ChunkingInput } from "./provider.types";

const DEFAULT_STRATEGY = "normalized-parse-v2";
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

// ---------------------------------------------------------------------------
// Table → Markdown serialization
// ---------------------------------------------------------------------------

function serializeTableAsMarkdown(table: ParsedDocumentTable): string {
  if (table.cells.length === 0) {
    return "";
  }

  // Determine grid dimensions
  const maxRow = Math.max(...table.cells.map((c) => c.row));
  const maxCol = Math.max(...table.cells.map((c) => c.column));

  // Build cell lookup: row → column → text
  const grid = new Map<number, Map<number, string>>();
  const headerRows = new Set<number>();

  for (const cell of table.cells) {
    if (!grid.has(cell.row)) {
      grid.set(cell.row, new Map());
    }
    grid.get(cell.row)!.set(cell.column, cell.text.trim());
    if (cell.kind === "header") {
      headerRows.add(cell.row);
    }
  }

  const lines: string[] = [];

  // Add table label
  if (table.title) {
    lines.push(`[Table: ${table.title}]`);
  } else {
    lines.push("[Table]");
  }

  // Render each row as markdown pipe-delimited
  for (let row = 1; row <= maxRow; row++) {
    const rowMap = grid.get(row);
    const cells: string[] = [];
    for (let col = 1; col <= maxCol; col++) {
      cells.push(rowMap?.get(col) ?? "");
    }
    lines.push(`| ${cells.join(" | ")} |`);

    // Insert separator after the last header row
    if (headerRows.has(row) && !headerRows.has(row + 1)) {
      lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
    }
  }

  // If no header rows were found, add separator after first row as fallback
  if (headerRows.size === 0 && maxRow >= 1) {
    const cells: string[] = [];
    for (let col = 1; col <= maxCol; col++) {
      cells.push("---");
    }
    // Insert separator after line index 1 (after the label and first row)
    lines.splice(2, 0, `| ${cells.join(" | ")} |`);
  }

  return lines.join("\n");
}

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

    // Group tables by page number
    const tablesByPage = new Map<number, ParsedDocumentTable[]>();
    for (const table of parsed.tables) {
      const existing = tablesByPage.get(table.page) ?? [];
      existing.push(table);
      tablesByPage.set(table.page, existing);
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

    const addLine = (lineText: string, pageNumber: number, pageHeading: string | null) => {
      if (!lineText) {
        return;
      }

      if (pageFrom === null) {
        pageFrom = pageNumber;
        currentHeading = pageHeading;
      }

      const candidateText = [...currentLines, lineText].join("\n");
      if (candidateText.length > MAX_CHUNK_CHARS && currentLines.length > 0) {
        flush();
        pageFrom = pageNumber;
        currentHeading = pageHeading;
      }

      currentLines.push(lineText);
      pageTo = pageNumber;
    };

    for (const page of parsed.pages) {
      const headingBlocks = page.blocks.filter((block) => block.role === "heading");
      const pageHeading = headingBlocks[0]?.text?.trim() || null;

      for (const line of page.lines) {
        const lineText = line.text.trim();
        if (!lineText) {
          continue;
        }

        addLine(lineText, page.pageNumber, pageHeading);
      }

      // Inject serialized tables for this page after the regular lines
      const pageTables = tablesByPage.get(page.pageNumber);
      if (pageTables) {
        for (const table of pageTables) {
          const tableMarkdown = serializeTableAsMarkdown(table);
          if (!tableMarkdown) {
            continue;
          }

          // If the table is large, flush current lines first so the table
          // gets its own chunk(s) rather than being appended to unrelated text
          if (tableMarkdown.length > MAX_CHUNK_CHARS / 2 && currentLines.length > 0) {
            flush();
          }

          // Add each table line individually so the size limit is respected
          for (const tableLine of tableMarkdown.split("\n")) {
            const trimmed = tableLine.trim();
            if (trimmed) {
              addLine(trimmed, page.pageNumber, pageHeading);
            }
          }
        }
      }

      flush();
    }

    return chunks;
  }
}
