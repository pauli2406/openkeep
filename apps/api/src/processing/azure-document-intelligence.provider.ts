import { Inject, Injectable } from "@nestjs/common";
import type { ParsedDocument } from "@openkeep/types";
import { readFile } from "fs/promises";

import { AppConfigService } from "../common/config/app-config.service";
import type { DocumentParseInput, DocumentParseProvider } from "./provider.types";

const getPolygonBoundingBox = (polygon: number[] | undefined) => {
  if (!polygon || polygon.length < 8) {
    return null;
  }

  const xs = polygon.filter((_, index) => index % 2 === 0);
  const ys = polygon.filter((_, index) => index % 2 === 1);

  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
};

export const mapAzureDocumentIntelligenceResponse = (result: any): ParsedDocument => {
  const pages = Array.isArray(result.pages) ? result.pages : [];
  const paragraphs = Array.isArray(result.paragraphs) ? result.paragraphs : [];
  const keyValuePairs = Array.isArray(result.keyValuePairs) ? result.keyValuePairs : [];

  return {
    provider: "azure-ai-document-intelligence",
    parseStrategy: "azure-ai-document-intelligence-layout",
    text: result.content ?? "",
    language: result.languages?.[0]?.locale ?? null,
    pages: pages.map((page: any, pageIndex: number) => ({
      pageNumber: Number(page.pageNumber ?? pageIndex + 1),
      width: Number(page.width ?? 0) || null,
      height: Number(page.height ?? 0) || null,
      lines: (Array.isArray(page.lines) ? page.lines : []).map((line: any, lineIndex: number) => ({
        lineIndex,
        text: line.content ?? "",
        boundingBox: getPolygonBoundingBox(line.polygon) ?? { x: 0, y: 0, width: 0, height: 0 },
      })),
      blocks: paragraphs
        .filter((paragraph: any) =>
          (Array.isArray(paragraph.boundingRegions) ? paragraph.boundingRegions : []).some(
            (region: any) => Number(region.pageNumber ?? page.pageNumber) === Number(page.pageNumber ?? pageIndex + 1),
          ),
        )
        .map((paragraph: any, blockIndex: number) => ({
          blockIndex,
          role: paragraph.role === "sectionHeading" ? "heading" : "paragraph",
          text: paragraph.content ?? "",
          boundingBox: getPolygonBoundingBox(paragraph.boundingRegions?.[0]?.polygon),
          lineIndices: [],
          metadata: {},
        })),
    })),
    tables: (Array.isArray(result.tables) ? result.tables : []).map((table: any, tableIndex: number) => ({
      tableIndex,
      page: Number(table.boundingRegions?.[0]?.pageNumber ?? 1),
      title: null,
      boundingBox: getPolygonBoundingBox(table.boundingRegions?.[0]?.polygon),
      cells: (Array.isArray(table.cells) ? table.cells : []).map((cell: any) => ({
        row: Number(cell.rowIndex ?? 0) + 1,
        column: Number(cell.columnIndex ?? 0) + 1,
        text: cell.content ?? "",
        rowSpan: Number(cell.rowSpan ?? 1),
        columnSpan: Number(cell.columnSpan ?? 1),
        boundingBox: getPolygonBoundingBox(cell.boundingRegions?.[0]?.polygon),
        kind: cell.kind === "columnHeader" || cell.kind === "rowHeader" ? "header" : "body",
      })),
      metadata: {},
    })),
    keyValues: keyValuePairs.map((pair: any) => ({
      key: pair.key?.content ?? "",
      value: pair.value?.content ?? "",
      confidence: typeof pair.confidence === "number" ? pair.confidence : null,
      page: Number(pair.key?.boundingRegions?.[0]?.pageNumber ?? pair.value?.boundingRegions?.[0]?.pageNumber ?? 1),
      keyBoundingBox: getPolygonBoundingBox(pair.key?.boundingRegions?.[0]?.polygon),
      valueBoundingBox: getPolygonBoundingBox(pair.value?.boundingRegions?.[0]?.polygon),
      metadata: {},
    })),
    chunkHints: (Array.isArray(result.sections) ? result.sections : []).map((section: any, index: number) => ({
      chunkIndex: index,
      heading: section.heading ?? null,
      text: section.content ?? "",
      pageFrom: Number(section.elements?.[0]?.pageNumber ?? 1) || null,
      pageTo: Number(section.elements?.at?.(-1)?.pageNumber ?? section.elements?.[0]?.pageNumber ?? 1) || null,
      metadata: {
        source: "azure-section",
      },
    })),
    searchablePdfPath: undefined,
    reviewReasons: [],
    warnings: [],
    providerMetadata: {
      raw: result,
    },
    temporaryPaths: [],
  };
};

@Injectable()
export class AzureDocumentIntelligenceParseProvider implements DocumentParseProvider {
  readonly provider = "azure-ai-document-intelligence" as const;

  constructor(@Inject(AppConfigService) private readonly configService: AppConfigService) {}

  async parse(input: DocumentParseInput): Promise<ParsedDocument> {
    const endpoint = this.configService.get("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT");
    const apiKey = this.configService.get("AZURE_DOCUMENT_INTELLIGENCE_API_KEY");

    if (!endpoint || !apiKey) {
      throw new Error("Azure AI Document Intelligence credentials are not configured");
    }

    const bytes = await readFile(input.filePath);
    const response = await fetch(
      `${endpoint.replace(/\/+$/, "")}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-11-30`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": apiKey,
          "Content-Type": "application/octet-stream",
        },
        body: bytes,
      },
    );

    if (!response.ok) {
      throw new Error(
        `Azure AI Document Intelligence request failed with status ${response.status}`,
      );
    }

    const operationLocation = response.headers.get("operation-location");
    if (!operationLocation) {
      throw new Error("Azure AI Document Intelligence did not return operation-location");
    }

    const timeoutMs = this.configService.get("PARSE_PROVIDER_TIMEOUT_SECONDS") * 1000;
    const startedAt = Date.now();
    while (true) {
      const poll = await fetch(operationLocation, {
        headers: {
          "Ocp-Apim-Subscription-Key": apiKey,
        },
      });

      if (!poll.ok) {
        throw new Error(
          `Azure AI Document Intelligence polling failed with status ${poll.status}`,
        );
      }

      const result = (await poll.json()) as any;
      const status = String(result.status ?? "").toLowerCase();
      if (status === "succeeded") {
        return mapAzureDocumentIntelligenceResponse(result.analyzeResult ?? result);
      }

      if (status === "failed") {
        throw new Error("Azure AI Document Intelligence analysis failed");
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error("Azure AI Document Intelligence polling timed out");
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
