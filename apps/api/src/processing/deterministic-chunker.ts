import { Injectable } from "@nestjs/common";
import { createHash } from "crypto";
import type { ParsedDocumentTable } from "@openkeep/types";

import {
  buildTableRowSignature,
  escapeMarkdownTableCell,
  isMarkdownTableRow,
  isMarkdownTableSeparatorRow,
  splitMarkdownTableRow,
} from "./markdown-table.util";
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

/** Normalized rows of a table as plain cell text, padded to the widest row. */
function buildTableRows(table: ParsedDocumentTable): {
  rows: string[][];
  headerRows: Set<number>;
} {
  if (table.cells.length === 0) {
    return { rows: [], headerRows: new Set() };
  }

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

  const rows: string[][] = [];
  for (let row = 1; row <= maxRow; row++) {
    const rowMap = grid.get(row);
    const cells: string[] = [];
    for (let col = 1; col <= maxCol; col++) {
      cells.push(rowMap?.get(col) ?? "");
    }
    rows.push(cells);
  }

  return { rows, headerRows };
}

/**
 * Locates the source rows of one normalized table: the first run of markdown rows
 * at or after `from` whose content rows match `signatures` in order. Separator rows
 * inside the run are consumed with it. Returns the matched line indices, or null
 * when the table's rows do not appear in the page markdown (an HTML table, or
 * markdown the provider reflowed) — nothing is dropped in that case.
 */
function findTableRegion(
  lineTexts: string[],
  from: number,
  signatures: string[],
): number[] | null {
  if (signatures.length === 0) {
    return null;
  }

  for (let start = from; start < lineTexts.length; start++) {
    const consumed: number[] = [];
    let signatureIndex = 0;

    for (let index = start; index < lineTexts.length && signatureIndex < signatures.length; index++) {
      const text = lineTexts[index]!;
      if (!isMarkdownTableRow(text)) {
        break;
      }

      const cells = splitMarkdownTableRow(text);
      if (isMarkdownTableSeparatorRow(cells)) {
        // A separator only belongs to a table once one of its rows matched.
        if (consumed.length === 0) {
          break;
        }
        consumed.push(index);
        continue;
      }

      if (buildTableRowSignature(cells) !== signatures[signatureIndex]) {
        break;
      }
      consumed.push(index);
      signatureIndex += 1;
    }

    if (signatureIndex === signatures.length) {
      return consumed;
    }
  }

  return null;
}

function serializeTableAsMarkdown(table: ParsedDocumentTable): string {
  const { rows, headerRows } = buildTableRows(table);
  if (rows.length === 0) {
    return "";
  }

  const lines: string[] = [];

  // Add table label
  if (table.title) {
    lines.push(`[Table: ${table.title}]`);
  } else {
    lines.push("[Table]");
  }

  // Render each row as markdown pipe-delimited. Cells are escaped: a cell may
  // legitimately contain a pipe (the mapper unescapes `\|` from the provider
  // markdown), which would otherwise silently split one cell into two.
  rows.forEach((cells, rowIndex) => {
    const row = rowIndex + 1;
    lines.push(`| ${cells.map(escapeMarkdownTableCell).join(" | ")} |`);

    // Insert separator after the last header row
    if (headerRows.has(row) && !headerRows.has(row + 1)) {
      lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
    }
  });

  // If no header rows were found, add separator after first row as fallback
  if (headerRows.size === 0) {
    const separator = rows[0]!.map(() => "---");
    // Insert separator after line index 1 (after the label and first row)
    lines.splice(2, 0, `| ${separator.join(" | ")} |`);
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
      const pageTables = tablesByPage.get(page.pageNumber);
      // Providers that emit markdown (Mistral OCR) keep the raw table rows in
      // `lines` so they still reach `document_text_blocks`; indexing them as
      // prose too would embed the same table twice, once here and once from the
      // normalized table serialized below. Each normalized table is located as a
      // contiguous run of source rows and consumed once, so an unrelated
      // pipe-delimited line (code, a one-cell layout, a second table missing from
      // `tables`) survives — even when it repeats a row of the normalized table.
      const lineTexts = page.lines.map((line) => line.text.trim());
      const skippedLineIndices = new Set<number>();
      const tableByRegionStart = new Map<number, ParsedDocumentTable>();
      // Tables whose rows are not in the page markdown (HTML tables, markdown the
      // provider reflowed) have no source position and are appended at the end.
      const unplacedTables: ParsedDocumentTable[] = [];
      let searchFrom = 0;
      for (const table of pageTables ?? []) {
        const signatures = buildTableRows(table).rows.map(buildTableRowSignature);
        const region = findTableRegion(lineTexts, searchFrom, signatures);
        if (!region) {
          unplacedTables.push(table);
          continue;
        }
        region.forEach((index) => skippedLineIndices.add(index));
        tableByRegionStart.set(region[0]!, table);
        searchFrom = region[region.length - 1]! + 1;
      }

      const emitTable = (table: ParsedDocumentTable) => {
        const tableMarkdown = serializeTableAsMarkdown(table);
        if (!tableMarkdown) {
          return;
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
      };

      page.lines.forEach((line, lineIndex) => {
        // The serialized table takes the place of its source rows, so an
        // `intro → table → explanation` page keeps that order and the table stays
        // in the same chunk neighbourhood as the prose describing it.
        const tableAtLine = tableByRegionStart.get(lineIndex);
        if (tableAtLine) {
          emitTable(tableAtLine);
        }

        const lineText = lineTexts[lineIndex]!;
        if (!lineText || skippedLineIndices.has(lineIndex)) {
          return;
        }

        addLine(lineText, page.pageNumber, pageHeading);
      });

      for (const table of unplacedTables) {
        emitTable(table);
      }

      flush();
    }

    return chunks;
  }
}
