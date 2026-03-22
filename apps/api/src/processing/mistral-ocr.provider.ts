import { Inject, Injectable } from "@nestjs/common";
import type { ParsedDocument } from "@openkeep/types";
import { readFile } from "fs/promises";

import { AppConfigService } from "../common/config/app-config.service";
import type { DocumentParseInput, DocumentParseProvider } from "./provider.types";

const parseMistralBoundingBox = (box: any) => {
  if (!box) {
    return null;
  }

  if (Array.isArray(box) && box.length >= 4) {
    const xs = box.filter((_: unknown, index: number) => index % 2 === 0).map(Number);
    const ys = box.filter((_: unknown, index: number) => index % 2 === 1).map(Number);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  }

  if (typeof box === "object") {
    return {
      x: Number(box.x ?? 0),
      y: Number(box.y ?? 0),
      width: Number(box.width ?? 0),
      height: Number(box.height ?? 0),
    };
  }

  return null;
};

export const mapMistralOcrResponse = (response: any): ParsedDocument => {
  const pages = Array.isArray(response.pages) ? response.pages : [];
  return {
    provider: "mistral-ocr",
    parseStrategy: "mistral-ocr-api",
    text:
      response.text ??
      pages
        .map((page: any) => page.text ?? page.markdown ?? "")
        .join("\n")
        .trim(),
    language: response.language ?? null,
    pages: pages.map((page: any, pageIndex: number) => {
      const lines = Array.isArray(page.lines)
        ? page.lines.map((line: any, lineIndex: number) => ({
            lineIndex,
            text: line.text ?? "",
            boundingBox: parseMistralBoundingBox(line.bbox) ?? {
              x: 0,
              y: 0,
              width: 0,
              height: 0,
            },
          }))
        : (String(page.text ?? page.markdown ?? "")
            .split("\n")
            .map((line: string) => line.trim())
            .filter(Boolean)
            .map((line: string, lineIndex: number) => ({
              lineIndex,
              text: line,
              boundingBox: { x: 0, y: lineIndex * 12, width: line.length * 7, height: 10 },
            })));

      return {
        pageNumber: Number(page.page_number ?? page.pageNumber ?? pageIndex + 1),
        width: Number(page.width ?? 0) || null,
        height: Number(page.height ?? 0) || null,
        lines,
        blocks: lines.map((line: any, blockIndex: number) => ({
          blockIndex,
          role: blockIndex === 0 && line.text.length < 160 ? "heading" : "paragraph",
          text: line.text,
          boundingBox: line.boundingBox,
          lineIndices: [line.lineIndex],
          metadata: {},
        })),
      };
    }),
    tables: [],
    keyValues: [],
    chunkHints: Array.isArray(response.chunks)
      ? response.chunks.map((chunk: any, index: number) => ({
          chunkIndex: index,
          heading: chunk.heading ?? null,
          text: chunk.text ?? chunk.content ?? "",
          pageFrom: chunk.pageFrom ?? chunk.page ?? null,
          pageTo: chunk.pageTo ?? chunk.page ?? null,
          metadata: {
            source: "mistral-chunk",
          },
        }))
      : [],
    searchablePdfPath: undefined,
    reviewReasons: [],
    warnings: [],
    providerMetadata: {
      raw: response,
    },
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
    const response = await fetch(`${this.configService.get("MISTRAL_OCR_BASE_URL")}/v1/ocr`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.configService.get("MISTRAL_OCR_MODEL"),
        document,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Mistral OCR request failed with status ${response.status}${errorBody ? `: ${errorBody}` : ""}`,
      );
    }

    return mapMistralOcrResponse(await response.json());
  }
}
