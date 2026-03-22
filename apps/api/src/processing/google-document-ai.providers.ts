import { Inject, Injectable } from "@nestjs/common";
import type { ParseProvider, ParsedDocument, ParsedDocumentChunkHint } from "@openkeep/types";
import { readFile } from "fs/promises";

import { AppConfigService } from "../common/config/app-config.service";
import { getGoogleCloudAccessToken } from "./google-auth.util";
import type { DocumentParseInput, DocumentParseProvider } from "./provider.types";

type GoogleProcessorKind = "enterprise" | "gemini-layout";

const getTextFromAnchor = (
  sourceText: string,
  anchor: { textSegments?: Array<{ startIndex?: string; endIndex?: string }> } | undefined,
) => {
  if (!anchor?.textSegments?.length) {
    return "";
  }

  return anchor.textSegments
    .map((segment) =>
      sourceText.slice(Number(segment.startIndex ?? 0), Number(segment.endIndex ?? 0)),
    )
    .join("")
    .trim();
};

const toBoundingBox = (
  vertices:
    | Array<{ x?: number; y?: number }>
    | undefined,
) => {
  if (!vertices || vertices.length === 0) {
    return null;
  }

  const xs = vertices.map((vertex) => Number(vertex.x ?? 0));
  const ys = vertices.map((vertex) => Number(vertex.y ?? 0));
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
};

const mapGoogleDocumentAiResponse = (
  provider: ParseProvider,
  response: any,
): ParsedDocument => {
  const document = response.document ?? {};
  const layoutBlocks = Array.isArray(document.documentLayout?.blocks)
    ? document.documentLayout.blocks
    : [];
  const sourceText =
    document.text ??
    layoutBlocks
      .map((block: any) => block.textBlock?.text ?? "")
      .filter(Boolean)
      .join("\n")
      .trim() ??
    "";
  const pages = Array.isArray(document.pages) ? document.pages : [];
  const chunkHints: ParsedDocumentChunkHint[] = Array.isArray(document.chunkedDocument?.chunks)
    ? document.chunkedDocument.chunks.map((chunk: any, index: number) => ({
        chunkIndex: index,
        heading: chunk.heading ?? null,
        text: chunk.content ?? "",
        pageFrom: typeof chunk.pageSpan?.pageStart === "number" ? chunk.pageSpan.pageStart + 1 : null,
        pageTo: typeof chunk.pageSpan?.pageEnd === "number" ? chunk.pageSpan.pageEnd + 1 : null,
        metadata: {
          source: "google-chunked-document",
        },
      }))
    : [];
  const layoutPages = !pages.length
    ? [...new Set(layoutBlocks.map((block: any) => Number(block.pageSpan?.pageStart ?? 1)))]
        .filter((pageNumber): pageNumber is number => Number.isFinite(pageNumber))
        .sort((a: number, b: number) => a - b)
    : [];
  const normalizedPages = pages.length
    ? pages.map((page: any, pageIndex: number) => {
        const lines = Array.isArray(page.lines)
          ? page.lines.map((line: any, lineIndex: number) => ({
              lineIndex,
              text: getTextFromAnchor(sourceText, line.layout?.textAnchor),
              boundingBox: toBoundingBox(line.layout?.boundingPoly?.normalizedVertices) ?? {
                x: 0,
                y: 0,
                width: 0,
                height: 0,
              },
            }))
          : [];
        const paragraphs = Array.isArray(page.paragraphs) ? page.paragraphs : [];
        const blocks = paragraphs.map((paragraph: any, blockIndex: number) => {
          const text = getTextFromAnchor(sourceText, paragraph.layout?.textAnchor);
          const role = blockIndex === 0 && text.length < 160 ? "heading" : "paragraph";
          return {
            blockIndex,
            role,
            text,
            boundingBox: toBoundingBox(paragraph.layout?.boundingPoly?.normalizedVertices),
            lineIndices: [],
            metadata: {},
          } as const;
        });

        return {
          pageNumber: Number(page.pageNumber ?? pageIndex + 1),
          width: Number(page.dimension?.width ?? 0) || null,
          height: Number(page.dimension?.height ?? 0) || null,
          lines,
          blocks,
        };
      })
    : layoutPages.map((pageNumber) => {
        const pageBlocks = layoutBlocks.filter(
          (block: any) => Number(block.pageSpan?.pageStart ?? 1) === pageNumber,
        );
        return {
          pageNumber,
          width: null,
          height: null,
          lines: pageBlocks.map((block: any, lineIndex: number) => ({
            lineIndex,
            text: block.textBlock?.text ?? "",
            boundingBox: { x: 0, y: lineIndex * 12, width: 0, height: 10 },
          })),
          blocks: pageBlocks.map((block: any, blockIndex: number) => ({
            blockIndex,
            role: block.textBlock?.type === "heading" ? "heading" : "paragraph",
            text: block.textBlock?.text ?? "",
            boundingBox: null,
            lineIndices: [blockIndex],
            metadata: {
              blockId: block.blockId ?? null,
              type: block.textBlock?.type ?? null,
            },
          })),
        };
      });

  return {
    provider,
    parseStrategy:
      provider === "google-document-ai-gemini-layout-parser"
        ? "google-document-ai-gemini-layout-parser"
        : "google-document-ai-enterprise-ocr",
    text: sourceText,
    language:
      document.entities?.find?.((entity: any) => entity.type === "language")?.mentionText ??
      null,
    pages: normalizedPages,
    tables: pages.flatMap((page: any, pageIndex: number) =>
      Array.isArray(page.tables)
        ? page.tables.map((table: any, tableIndex: number) => ({
            tableIndex,
            page: Number(page.pageNumber ?? pageIndex + 1),
            title: null,
            boundingBox: toBoundingBox(table.layout?.boundingPoly?.normalizedVertices),
            cells: [
              ...(Array.isArray(table.headerRows) ? table.headerRows : []),
              ...(Array.isArray(table.bodyRows) ? table.bodyRows : []),
            ].flatMap((row: any, rowIndex: number) =>
              (Array.isArray(row.cells) ? row.cells : []).map((cell: any, columnIndex: number) => ({
                row: rowIndex + 1,
                column: columnIndex + 1,
                text: getTextFromAnchor(sourceText, cell.layout?.textAnchor),
                rowSpan: Number(cell.rowSpan ?? 1),
                columnSpan: Number(cell.colSpan ?? 1),
                boundingBox: toBoundingBox(cell.layout?.boundingPoly?.normalizedVertices),
                kind: rowIndex < (Array.isArray(table.headerRows) ? table.headerRows.length : 0)
                  ? "header"
                  : "body",
              })),
            ),
            metadata: {},
          }))
        : [],
    ),
    keyValues: pages.flatMap((page: any, pageIndex: number) =>
      Array.isArray(page.formFields)
        ? page.formFields.map((field: any) => ({
            key: getTextFromAnchor(sourceText, field.fieldName?.textAnchor),
            value: getTextFromAnchor(sourceText, field.fieldValue?.textAnchor),
            confidence:
              typeof field.fieldValue?.confidence === "number"
                ? field.fieldValue.confidence
                : typeof field.confidence === "number"
                  ? field.confidence
                  : null,
            page: Number(page.pageNumber ?? pageIndex + 1),
            keyBoundingBox: toBoundingBox(field.fieldName?.boundingPoly?.normalizedVertices),
            valueBoundingBox: toBoundingBox(field.fieldValue?.boundingPoly?.normalizedVertices),
            metadata: {},
          }))
        : [],
    ),
    chunkHints,
    searchablePdfPath: undefined,
    reviewReasons: [],
    warnings: [],
    providerMetadata: {
      raw: response,
    },
    temporaryPaths: [],
  };
};

abstract class BaseGoogleDocumentAiProvider implements DocumentParseProvider {
  abstract readonly provider: ParseProvider;
  protected abstract readonly processorKind: GoogleProcessorKind;

  constructor(@Inject(AppConfigService) protected readonly configService: AppConfigService) {}

  async parse(input: DocumentParseInput): Promise<ParsedDocument> {
    const projectId = this.configService.get("GOOGLE_CLOUD_PROJECT_ID");
    const location = this.configService.get("GOOGLE_CLOUD_LOCATION");
    const processorId =
      this.processorKind === "enterprise"
        ? this.configService.get("GOOGLE_DOCUMENT_AI_ENTERPRISE_PROCESSOR_ID")
        : this.configService.get("GOOGLE_DOCUMENT_AI_GEMINI_PROCESSOR_ID");

    if (!projectId || !processorId) {
      throw new Error(`Google Document AI ${this.processorKind} processor is not configured`);
    }

    const accessToken = await getGoogleCloudAccessToken({
      accessToken: this.configService.get("GOOGLE_CLOUD_ACCESS_TOKEN"),
      serviceAccountJson: this.configService.get("GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON"),
    });

    const endpoint = `https://${location}-documentai.googleapis.com/v1/projects/${projectId}/locations/${location}/processors/${processorId}:process`;
    const content = await readFile(input.filePath);

    const requestBody = {
      skipHumanReview: true,
      rawDocument: {
        mimeType: input.mimeType,
        content: content.toString("base64"),
      },
      ...(this.processorKind === "gemini-layout"
        ? {
            processOptions: {
              layoutConfig: {
                chunkingConfig: {
                  chunkSize: 512,
                  includeAncestorHeadings: true,
                },
              },
            },
          }
        : {}),
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Google Document AI ${this.processorKind} request failed with status ${response.status}${errorBody ? `: ${errorBody}` : ""}`,
      );
    }

    return mapGoogleDocumentAiResponse(this.provider, await response.json());
  }
}

@Injectable()
export class GoogleDocumentAiEnterpriseOcrProvider extends BaseGoogleDocumentAiProvider {
  readonly provider = "google-document-ai-enterprise-ocr" as const;
  protected readonly processorKind = "enterprise" as const;
}

@Injectable()
export class GoogleGeminiLayoutParseProvider extends BaseGoogleDocumentAiProvider {
  readonly provider = "google-document-ai-gemini-layout-parser" as const;
  protected readonly processorKind = "gemini-layout" as const;
}

export { mapGoogleDocumentAiResponse };
