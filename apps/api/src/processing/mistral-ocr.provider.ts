import { Inject, Injectable, Logger } from "@nestjs/common";
import type {
  ParsedDocument,
  ParsedDocumentKeyValue,
  ParsedDocumentTable,
  ReviewReason,
} from "@openkeep/types";
import { readFile } from "fs/promises";

import { AppConfigService } from "../common/config/app-config.service";
import { DOCUMENT_TYPE_DEFINITIONS } from "./document-intelligence.registry";
import { fetchWithTimeout } from "./http.util";
import {
  buildDocumentAnnotationSchema,
  parseDocumentAnnotation,
} from "./mistral-annotation.schema";
import {
  MistralOcrResponseSchema,
  type MistralOcrBlock,
  type MistralOcrPage,
} from "./mistral-ocr.schema";
import type { DocumentParseInput, DocumentParseProvider } from "./provider.types";

const PROVIDER_METADATA_MAX_BYTES = 16_384;
/** Above this size the Files API is used instead of an inline base64 data URI. */
const INLINE_UPLOAD_MAX_BYTES = 8_000_000;
/** Pages below this OCR confidence flag the document for review. */
const LOW_PAGE_CONFIDENCE_THRESHOLD = 0.75;

export interface MapMistralOcrOptions {
  minPageConfidence?: number;
}

/**
 * Maps the real Mistral OCR response (`pages[].markdown` + `dimensions`) into the
 * normalized parse model. Mistral returns no per-line geometry, so lines carry
 * `boundingBox: null` — boxes are never fabricated. Blocks (from `include_blocks`),
 * tables (from `table_format`) and page confidences are mapped when present, and
 * key/value pairs are derived deterministically from the markdown so the
 * deterministic extractors keep working with this provider.
 */
export const mapMistralOcrResponse = (
  rawResponse: unknown,
  options: MapMistralOcrOptions = {},
): ParsedDocument => {
  const response = MistralOcrResponseSchema.parse(rawResponse);
  const warnings: string[] = [];
  const reviewReasons: ReviewReason[] = [];
  const minPageConfidence = options.minPageConfidence ?? LOW_PAGE_CONFIDENCE_THRESHOLD;

  const tables: ParsedDocumentTable[] = [];
  const keyValues: ParsedDocumentKeyValue[] = [];
  const pageConfidences: Array<{ page: number; confidence: number }> = [];

  const pages = response.pages.map((page, arrayIndex) => {
    const pageNumber = (typeof page.index === "number" ? page.index : arrayIndex) + 1;

    const lines = page.markdown
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, lineIndex) => ({
        lineIndex,
        text: line,
        boundingBox: null,
      }));

    const blocks = mapPageBlocks(page, pageNumber);

    for (const table of page.tables ?? []) {
      // With MISTRAL_OCR_TABLE_FORMAT=html the payload only carries `html`, so
      // reading markdown alone would silently drop those tables entirely.
      const markdownTable = table.markdown ?? table.content ?? null;
      const htmlTable = table.html ?? null;
      const parsed = markdownTable
        ? parseMarkdownTable(markdownTable)
        : htmlTable
          ? parseHtmlTable(htmlTable)
          : [];
      if (parsed.length > 0) {
        tables.push({
          tableIndex: tables.length,
          page: pageNumber,
          title: null,
          boundingBox: null,
          cells: parsed,
          metadata: {
            source: "mistral-table",
            ...(markdownTable ? { markdown: markdownTable } : { html: htmlTable }),
          },
        });
      }
    }

    keyValues.push(...deriveKeyValuesFromMarkdown(page.markdown, pageNumber));

    const pageConfidence = readPageConfidence(page);
    if (pageConfidence !== null) {
      pageConfidences.push({ page: pageNumber, confidence: pageConfidence });
      if (pageConfidence < minPageConfidence) {
        warnings.push(`ocr_low_confidence_page_${pageNumber}`);
        if (!reviewReasons.includes("ocr_low_confidence")) {
          reviewReasons.push("ocr_low_confidence");
        }
      }
    }

    return {
      pageNumber,
      width: typeof page.dimensions?.width === "number" ? page.dimensions.width : null,
      height: typeof page.dimensions?.height === "number" ? page.dimensions.height : null,
      lines,
      // Real provider blocks win, but the chunker derives page headings ONLY from
      // heading-role blocks — so a page that returned just paragraphs or a
      // header/footer still needs the markdown heading fallback appended.
      blocks: blocks.some((block) => block.role === "heading")
        ? blocks
        : [...blocks, ...buildHeadingBlocks(lines, blocks.length)],
      markdown: page.markdown,
    };
  });

  const text = pages
    .map((page) => page.markdown)
    .join("\n\n")
    .trim();

  const providerMetadata: Record<string, unknown> = {
    model: response.model ?? null,
    pagesProcessed: response.usage_info?.pages_processed ?? response.pages.length,
    docSizeBytes: response.usage_info?.doc_size_bytes ?? null,
    ...(pageConfidences.length > 0 ? { pageConfidences } : {}),
  };

  if (JSON.stringify(providerMetadata).length > PROVIDER_METADATA_MAX_BYTES) {
    warnings.push("provider_metadata_truncated");
  }

  const preExtracted =
    response.document_annotation !== undefined && response.document_annotation !== null
      ? (parseDocumentAnnotation(response.document_annotation, response.model ?? null) ??
        undefined)
      : undefined;
  if (preExtracted && pages.length > 8) {
    // Document annotations only consider roughly the first 8 pages — the hint is
    // still useful but may miss facts further in.
    warnings.push("annotation_hint_partial_document");
  }

  return {
    provider: "mistral-ocr",
    parseStrategy: "mistral-ocr-api",
    text,
    language: null,
    pages: pages.map(({ markdown: _markdown, ...page }) => page),
    tables,
    keyValues,
    chunkHints: [],
    searchablePdfPath: undefined,
    reviewReasons,
    warnings,
    providerMetadata,
    ...(preExtracted ? { preExtracted } : {}),
    temporaryPaths: [],
  };
};

@Injectable()
export class MistralOcrParseProvider implements DocumentParseProvider {
  readonly provider = "mistral-ocr" as const;
  private readonly logger = new Logger(MistralOcrParseProvider.name);

  constructor(@Inject(AppConfigService) private readonly configService: AppConfigService) {}

  async parse(input: DocumentParseInput): Promise<ParsedDocument> {
    const apiKey = this.configService.get("MISTRAL_API_KEY");
    if (!apiKey) {
      throw new Error("Mistral OCR credentials are not configured");
    }

    const baseUrl =
      this.configService.get("MISTRAL_OCR_BASE_URL") ??
      this.configService.get("MISTRAL_API_BASE_URL");
    const timeoutMs = this.configService.get("PARSE_PROVIDER_TIMEOUT_SECONDS") * 1000;
    const bytes = await readFile(input.filePath);
    const isPdf = input.mimeType === "application/pdf";
    const strategy = this.configService.get("MISTRAL_OCR_UPLOAD_STRATEGY");
    const useFilesApi =
      strategy === "files" || (strategy === "auto" && bytes.byteLength > INLINE_UPLOAD_MAX_BYTES);

    let uploadedFileId: string | null = null;
    try {
      let document: Record<string, string>;
      if (useFilesApi && isPdf) {
        const uploaded = await this.uploadViaFilesApi(bytes, input, apiKey, baseUrl, timeoutMs);
        uploadedFileId = uploaded.fileId;
        document = { type: "document_url", document_url: uploaded.url };
      } else {
        const dataUri = `data:${input.mimeType};base64,${bytes.toString("base64")}`;
        document = isPdf
          ? { type: "document_url", document_url: dataUri }
          : { type: "image_url", image_url: dataUri };
      }

      const body: Record<string, unknown> = {
        model: this.configService.get("MISTRAL_OCR_MODEL"),
        document,
      };

      if (this.configService.get("MISTRAL_OCR_INCLUDE_BLOCKS")) {
        body.include_blocks = true;
      }
      const tableFormat = this.configService.get("MISTRAL_OCR_TABLE_FORMAT");
      if (tableFormat !== "none") {
        body.table_format = tableFormat;
      }
      const confidenceGranularity = this.configService.get(
        "MISTRAL_OCR_CONFIDENCE_GRANULARITY",
      );
      if (confidenceGranularity !== "none") {
        body.confidence_scores_granularity = confidenceGranularity;
      }
      if (this.configService.get("MISTRAL_OCR_EXTRACT_HEADER_FOOTER")) {
        body.extract_header = true;
        body.extract_footer = true;
      }
      if (this.configService.get("MISTRAL_OCR_DOCUMENT_ANNOTATIONS")) {
        body.document_annotation_format = {
          type: "json_schema",
          json_schema: {
            name: "document_metadata",
            schema: buildDocumentAnnotationSchema(Object.keys(DOCUMENT_TYPE_DEFINITIONS)),
          },
        };
      }

      const response = await fetchWithTimeout(
        `${baseUrl}/v1/ocr`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
        timeoutMs,
      );

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(
          `Mistral OCR request failed with status ${response.status}${errorBody ? `: ${errorBody}` : ""}`,
        );
      }

      return mapMistralOcrResponse(await response.json());
    } finally {
      if (uploadedFileId) {
        await this.deleteUploadedFile(uploadedFileId, apiKey, baseUrl, timeoutMs);
      }
    }
  }

  private async uploadViaFilesApi(
    bytes: Buffer,
    input: DocumentParseInput,
    apiKey: string,
    baseUrl: string,
    timeoutMs: number,
  ): Promise<{ fileId: string; url: string }> {
    const form = new FormData();
    form.append("purpose", "ocr");
    form.append(
      "file",
      new Blob([new Uint8Array(bytes)], { type: input.mimeType }),
      input.filename ?? "document.pdf",
    );

    const uploadResponse = await fetchWithTimeout(
      `${baseUrl}/v1/files`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      },
      timeoutMs,
    );

    if (!uploadResponse.ok) {
      const errorBody = await uploadResponse.text().catch(() => "");
      throw new Error(
        `Mistral file upload failed with status ${uploadResponse.status}${errorBody ? `: ${errorBody}` : ""}`,
      );
    }

    const uploaded = (await uploadResponse.json()) as { id?: string };
    if (!uploaded.id) {
      throw new Error("Mistral file upload returned no file id");
    }

    // From here on the file exists at Mistral. If acquiring the signed URL fails,
    // the caller never learns the file id — delete it here so transient failures
    // do not leave potentially sensitive documents retained upstream.
    try {
      const urlResponse = await fetchWithTimeout(
        `${baseUrl}/v1/files/${uploaded.id}/url`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
        },
        timeoutMs,
      );

      if (!urlResponse.ok) {
        throw new Error(`Mistral signed-url request failed with status ${urlResponse.status}`);
      }

      const signed = (await urlResponse.json()) as { url?: string };
      if (!signed.url) {
        throw new Error("Mistral signed-url response contained no url");
      }

      return { fileId: uploaded.id, url: signed.url };
    } catch (error) {
      await this.deleteUploadedFile(uploaded.id, apiKey, baseUrl, timeoutMs);
      throw error;
    }
  }

  private async deleteUploadedFile(
    fileId: string,
    apiKey: string,
    baseUrl: string,
    timeoutMs: number,
  ): Promise<void> {
    try {
      const response = await fetchWithTimeout(
        `${baseUrl}/v1/files/${fileId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${apiKey}` },
        },
        timeoutMs,
      );

      // A non-2xx DELETE leaves the document retained upstream; fetch resolves
      // normally for those, so the status has to be inspected explicitly.
      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        this.logger.warn(
          `Mistral file ${fileId} was not deleted (HTTP ${response.status})${errorBody ? `: ${errorBody}` : ""} — it remains stored upstream`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to delete uploaded Mistral file ${fileId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

/**
 * Derives heading blocks from markdown heading lines (`# …`), used when the
 * provider returns no blocks of its own.
 *
 * DeterministicChunker takes each chunk's heading exclusively from
 * `page.blocks` with `role: "heading"`, so emitting no blocks at all would
 * leave every Mistral chunk headingless and degrade chunk context for search
 * and citations. Bounding boxes stay null — markdown carries no geometry.
 */
const buildHeadingBlocks = (
  lines: Array<{ lineIndex: number; text: string }>,
  blockIndexOffset = 0,
): NonNullable<ParsedDocument["pages"][number]["blocks"]> =>
  lines
    .filter((line) => /^#{1,6}\s+\S/.test(line.text))
    .map((line, blockIndex) => ({
      blockIndex: blockIndexOffset + blockIndex,
      role: "heading" as const,
      text: line.text.replace(/^#{1,6}\s+/, "").trim(),
      boundingBox: null,
      lineIndices: [line.lineIndex],
      metadata: { source: "mistral-markdown-heading" },
    }));

const mapPageBlocks = (page: MistralOcrPage, pageNumber: number) => {
  const blocks: NonNullable<ParsedDocument["pages"][number]["blocks"]> = [];

  for (const block of page.blocks ?? []) {
    const text = (block.text ?? block.markdown ?? "").trim();
    if (!text) {
      continue;
    }

    blocks.push({
      blockIndex: blocks.length,
      role: mapBlockRole(block.type),
      text,
      boundingBox: normalizeBlockBoundingBox(block),
      lineIndices: [],
      metadata: {
        source: "mistral-block",
        ...(block.type ? { blockType: block.type } : {}),
        ...(typeof block.confidence === "number" ? { confidence: block.confidence } : {}),
        page: pageNumber,
      },
    });
  }

  for (const [region, content] of [
    ["header", page.header],
    ["footer", page.footer],
  ] as const) {
    const text = content?.trim();
    if (!text) {
      continue;
    }
    blocks.push({
      blockIndex: blocks.length,
      role: "other",
      text,
      boundingBox: null,
      lineIndices: [],
      metadata: { source: "mistral-block", region, page: pageNumber },
    });
  }

  return blocks;
};

const mapBlockRole = (
  type: string | null | undefined,
): "paragraph" | "heading" | "table" | "key_value" | "other" => {
  const normalized = (type ?? "").toLowerCase();
  if (/head|title/.test(normalized)) {
    return "heading";
  }
  if (/table/.test(normalized)) {
    return "table";
  }
  if (/key.?value|form/.test(normalized)) {
    return "key_value";
  }
  if (!normalized || /text|paragraph|para/.test(normalized)) {
    return "paragraph";
  }
  return "other";
};

const normalizeBlockBoundingBox = (
  block: MistralOcrBlock,
): { x: number; y: number; width: number; height: number } | null => {
  const corners = (input: {
    top_left_x?: number | null;
    top_left_y?: number | null;
    bottom_right_x?: number | null;
    bottom_right_y?: number | null;
  }) => {
    const { top_left_x, top_left_y, bottom_right_x, bottom_right_y } = input;
    if (
      typeof top_left_x === "number" &&
      typeof top_left_y === "number" &&
      typeof bottom_right_x === "number" &&
      typeof bottom_right_y === "number"
    ) {
      return {
        x: Math.min(top_left_x, bottom_right_x),
        y: Math.min(top_left_y, bottom_right_y),
        width: Math.abs(bottom_right_x - top_left_x),
        height: Math.abs(bottom_right_y - top_left_y),
      };
    }
    return null;
  };

  const direct = corners(block);
  if (direct) {
    return direct;
  }

  const bbox = block.bbox;
  if (Array.isArray(bbox) && bbox.length >= 4 && bbox.every((v) => typeof v === "number")) {
    const [x0, y0, x1, y1] = bbox as number[];
    return {
      x: Math.min(x0!, x1!),
      y: Math.min(y0!, y1!),
      width: Math.abs(x1! - x0!),
      height: Math.abs(y1! - y0!),
    };
  }

  if (bbox && !Array.isArray(bbox)) {
    const fromCorners = corners(bbox);
    if (fromCorners) {
      return fromCorners;
    }
    if (
      typeof bbox.x === "number" &&
      typeof bbox.y === "number" &&
      typeof bbox.width === "number" &&
      typeof bbox.height === "number"
    ) {
      return { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
    }
  }

  return null;
};

/** Parses a GitHub-style markdown pipe table into normalized table cells. */
export const parseMarkdownTable = (
  markdown: string,
): ParsedDocumentTable["cells"] => {
  const rows = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));

  const cells: ParsedDocumentTable["cells"] = [];
  let rowNumber = 0;

  for (const row of rows) {
    // Split on UNESCAPED pipes only: a cell like `A \| B` is one column, not two,
    // and the escape character must not survive into the cell text.
    const columns = row
      .slice(1, -1)
      .split(/(?<!\\)\|/)
      .map((cell) => cell.replace(/\\\|/g, "|").trim());

    // Skip the separator row (|---|---|).
    if (columns.every((cell) => /^:?-{2,}:?$/.test(cell))) {
      continue;
    }

    rowNumber += 1;
    columns.forEach((cellText, columnIndex) => {
      cells.push({
        row: rowNumber,
        column: columnIndex + 1,
        text: cellText,
        rowSpan: 1,
        columnSpan: 1,
        boundingBox: null,
        kind: rowNumber === 1 ? "header" : "body",
      });
    });
  }

  return cells;
};

/**
 * Parses an HTML table (`table_format: "html"`) into normalized cells.
 *
 * Deliberately regex-based rather than pulling in an HTML parser: Mistral emits
 * simple generated markup, and the normalized model only needs row/column text.
 * Row and column spans are not honoured (every cell stays 1x1).
 */
export const parseHtmlTable = (html: string): ParsedDocumentTable["cells"] => {
  const cells: ParsedDocumentTable["cells"] = [];
  const rowMatches = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];

  rowMatches.forEach((row, rowIndex) => {
    const cellMatches = row.match(/<(t[dh])[^>]*>([\s\S]*?)<\/\1>/gi) ?? [];
    cellMatches.forEach((cell, columnIndex) => {
      const isHeaderCell = /^<th/i.test(cell);
      const text = cell
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim();

      cells.push({
        row: rowIndex + 1,
        column: columnIndex + 1,
        text,
        rowSpan: 1,
        columnSpan: 1,
        boundingBox: null,
        kind: isHeaderCell || rowIndex === 0 ? "header" : "body",
      });
    });
  });

  return cells;
};

const KEY_VALUE_LINE = /^(?:\*\*(?<boldKey>[^*:]{2,60}):?\*\*[:\s]*|(?<plainKey>[A-Za-zÄÖÜäöüß][\wÄÖÜäöüß .\/-]{1,50}):\s+)(?<value>\S.*)$/;

/**
 * Derives key/value pairs from markdown lines (`**Key:** value`, `Key: value`).
 * Mistral OCR returns no form fields, so without this every deterministic extractor
 * that checks `parsed.keyValues` degrades to regex-over-text for this provider.
 */
export const deriveKeyValuesFromMarkdown = (
  markdown: string,
  pageNumber: number,
): ParsedDocumentKeyValue[] => {
  const keyValues: ParsedDocumentKeyValue[] = [];

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("|") || line.startsWith("#")) {
      continue;
    }

    const match = KEY_VALUE_LINE.exec(line);
    if (!match?.groups) {
      continue;
    }

    const key = (match.groups.boldKey ?? match.groups.plainKey ?? "").trim().replace(/:$/, "");
    const value = match.groups.value.trim();
    // Keys with too many words are prose sentences, not labels.
    if (!key || !value || key.split(/\s+/).length > 6 || /https?:\/\//.test(key)) {
      continue;
    }

    keyValues.push({
      key,
      value,
      confidence: null,
      page: pageNumber,
      keyBoundingBox: null,
      valueBoundingBox: null,
      metadata: { source: "derived-markdown" },
    });
  }

  return keyValues;
};

const readPageConfidence = (page: MistralOcrPage): number | null => {
  if (typeof page.confidence === "number") {
    return page.confidence;
  }

  const scores = page.confidence_scores;
  if (typeof scores === "number") {
    return scores;
  }
  if (scores && typeof scores === "object") {
    const record = scores as Record<string, unknown>;
    for (const key of ["page", "overall", "score", "confidence"]) {
      if (typeof record[key] === "number") {
        return record[key] as number;
      }
    }
  }

  return null;
};
