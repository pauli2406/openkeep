import { Inject, Injectable } from "@nestjs/common";
import type { ParsedDocument } from "@openkeep/types";
import { readFile } from "fs/promises";

import { AppConfigService } from "../common/config/app-config.service";
import { fetchWithTimeout } from "./http.util";
import { MistralOcrResponseSchema } from "./mistral-ocr.schema";
import type { DocumentParseInput, DocumentParseProvider } from "./provider.types";

const PROVIDER_METADATA_MAX_BYTES = 16_384;

/**
 * Maps the real Mistral OCR response (`pages[].markdown` + `dimensions`) into the
 * normalized parse model. Mistral returns no per-line geometry, so lines carry
 * `boundingBox: null` — boxes are never fabricated. The raw response is summarized
 * instead of persisted wholesale (it previously bloated `documents.metadata`).
 */
export const mapMistralOcrResponse = (rawResponse: unknown): ParsedDocument => {
  const response = MistralOcrResponseSchema.parse(rawResponse);
  const warnings: string[] = [];

  const pages = response.pages.map((page, arrayIndex) => {
    const lines = page.markdown
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, lineIndex) => ({
        lineIndex,
        text: line,
        boundingBox: null,
      }));

    return {
      pageNumber: (typeof page.index === "number" ? page.index : arrayIndex) + 1,
      width: typeof page.dimensions?.width === "number" ? page.dimensions.width : null,
      height: typeof page.dimensions?.height === "number" ? page.dimensions.height : null,
      lines,
      blocks: [],
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
  };

  if (JSON.stringify(providerMetadata).length > PROVIDER_METADATA_MAX_BYTES) {
    warnings.push("provider_metadata_truncated");
  }

  return {
    provider: "mistral-ocr",
    parseStrategy: "mistral-ocr-api",
    text,
    language: null,
    pages: pages.map(({ markdown: _markdown, ...page }) => page),
    tables: [],
    keyValues: [],
    chunkHints: [],
    searchablePdfPath: undefined,
    reviewReasons: [],
    warnings,
    providerMetadata,
    temporaryPaths: [],
  };
};

@Injectable()
export class MistralOcrParseProvider implements DocumentParseProvider {
  readonly provider = "mistral-ocr" as const;

  constructor(@Inject(AppConfigService) private readonly configService: AppConfigService) {}

  async parse(input: DocumentParseInput): Promise<ParsedDocument> {
    const apiKey = this.configService.get("MISTRAL_API_KEY");
    if (!apiKey) {
      throw new Error("Mistral OCR credentials are not configured");
    }

    const bytes = await readFile(input.filePath);
    const isPdf = input.mimeType === "application/pdf";
    const document = isPdf
      ? {
          type: "document_url",
          document_url: `data:${input.mimeType};base64,${bytes.toString("base64")}`,
        }
      : {
          type: "image_url",
          image_url: `data:${input.mimeType};base64,${bytes.toString("base64")}`,
        };

    const timeoutMs = this.configService.get("PARSE_PROVIDER_TIMEOUT_SECONDS") * 1000;
    const response = await fetchWithTimeout(
      `${this.configService.get("MISTRAL_OCR_BASE_URL")}/v1/ocr`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.configService.get("MISTRAL_OCR_MODEL"),
          document,
        }),
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
  }
}
