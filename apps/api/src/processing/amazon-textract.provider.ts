import {
  AnalyzeDocumentCommand,
  TextractClient,
  type Block,
} from "@aws-sdk/client-textract";
import { Inject, Injectable } from "@nestjs/common";
import type { ParsedDocument } from "@openkeep/types";
import { readFile } from "fs/promises";

import { AppConfigService } from "../common/config/app-config.service";
import type { DocumentParseInput, DocumentParseProvider } from "./provider.types";

const getBoundingBox = (block: Block) => {
  const box = block.Geometry?.BoundingBox;
  if (!box) {
    return null;
  }

  return {
    x: box.Left ?? 0,
    y: box.Top ?? 0,
    width: box.Width ?? 0,
    height: box.Height ?? 0,
  };
};

export const mapAmazonTextractResponse = (blocks: Block[]): ParsedDocument => {
  const lines = blocks.filter((block) => block.BlockType === "LINE");
  const pages = [...new Set(lines.map((line) => Number(line.Page ?? 1)))].sort((a, b) => a - b);
  const blockById = new Map(blocks.map((block) => [block.Id ?? "", block]));

  const keyValueBlocks = blocks.filter((block) => block.BlockType === "KEY_VALUE_SET");
  const keyValues = keyValueBlocks
    .filter((block) => block.EntityTypes?.includes("KEY"))
    .map((keyBlock) => {
      const valueRelationship = keyBlock.Relationships?.find(
        (relationship) => relationship.Type === "VALUE",
      );
      const valueBlocks = (valueRelationship?.Ids ?? [])
        .map((id) => blockById.get(id))
        .filter(Boolean) as Block[];
      const childIds = valueBlocks.flatMap(
        (block) =>
          block.Relationships?.find((relationship) => relationship.Type === "CHILD")?.Ids ?? [],
      );
      const childWords = childIds
        .map((id) => blockById.get(id))
        .filter((block): block is Block => Boolean(block?.Text))
        .map((block) => block.Text ?? "")
        .join(" ")
        .trim();
      const keyChildren =
        keyBlock.Relationships?.find((relationship) => relationship.Type === "CHILD")?.Ids ?? [];
      const key = keyChildren
        .map((id) => blockById.get(id))
        .filter((block): block is Block => Boolean(block?.Text))
        .map((block) => block.Text ?? "")
        .join(" ")
        .trim();

      return {
        key,
        value: childWords,
        confidence:
          typeof keyBlock.Confidence === "number" ? Number((keyBlock.Confidence / 100).toFixed(2)) : null,
        page: Number(keyBlock.Page ?? 1),
        keyBoundingBox: getBoundingBox(keyBlock),
        valueBoundingBox: valueBlocks[0] ? getBoundingBox(valueBlocks[0]) : null,
        metadata: {},
      };
    })
    .filter((field) => field.key && field.value);

  return {
    provider: "amazon-textract",
    parseStrategy: "amazon-textract-analyze-document",
    text: lines.map((line) => line.Text ?? "").join("\n"),
    language: null,
    pages: pages.map((pageNumber) => {
      const pageLines = lines.filter((line) => Number(line.Page ?? 1) === pageNumber);
      return {
        pageNumber,
        width: null,
        height: null,
        lines: pageLines.map((line, lineIndex) => ({
          lineIndex,
          text: line.Text ?? "",
          boundingBox: getBoundingBox(line) ?? { x: 0, y: 0, width: 0, height: 0 },
        })),
        blocks: pageLines.map((line, blockIndex) => ({
          blockIndex,
          role: blockIndex === 0 && (line.Text?.length ?? 0) < 160 ? "heading" : "paragraph",
          text: line.Text ?? "",
          boundingBox: getBoundingBox(line),
          lineIndices: [blockIndex],
          metadata: {},
        })),
      };
    }),
    tables: blocks
      .filter((block) => block.BlockType === "TABLE")
      .map((table, tableIndex) => {
        const cellIds =
          table.Relationships?.find((relationship) => relationship.Type === "CHILD")?.Ids ?? [];
        const cells = cellIds
          .map((id) => blockById.get(id))
          .filter((block): block is Block => block?.BlockType === "CELL")
          .map((cell) => {
            const wordIds =
              cell.Relationships?.find((relationship) => relationship.Type === "CHILD")?.Ids ?? [];
            const text = wordIds
              .map((id) => blockById.get(id))
              .filter((block): block is Block => Boolean(block?.Text))
              .map((block) => block.Text ?? "")
              .join(" ")
              .trim();
              return {
                row: Number(cell.RowIndex ?? 1),
                column: Number(cell.ColumnIndex ?? 1),
                text,
                rowSpan: Number(cell.RowSpan ?? 1),
                columnSpan: Number(cell.ColumnSpan ?? 1),
                boundingBox: getBoundingBox(cell),
                kind: (Number(cell.RowIndex ?? 1) === 1 ? "header" : "body") as
                  | "header"
                  | "body",
              };
            });

        return {
          tableIndex,
          page: Number(table.Page ?? 1),
          title: null,
          boundingBox: getBoundingBox(table),
          cells,
          metadata: {},
        };
      }),
    keyValues,
    chunkHints: [],
    searchablePdfPath: undefined,
    reviewReasons: [],
    warnings: [],
    providerMetadata: {
      raw: {
        blockCount: blocks.length,
      },
    },
    temporaryPaths: [],
  };
};

@Injectable()
export class AmazonTextractParseProvider implements DocumentParseProvider {
  readonly provider = "amazon-textract" as const;

  constructor(@Inject(AppConfigService) private readonly configService: AppConfigService) {}

  async parse(input: DocumentParseInput): Promise<ParsedDocument> {
    const region = this.configService.get("AWS_REGION");
    const accessKeyId = this.configService.get("AWS_ACCESS_KEY_ID");
    const secretAccessKey = this.configService.get("AWS_SECRET_ACCESS_KEY");

    if (!region || !accessKeyId || !secretAccessKey) {
      throw new Error("Amazon Textract credentials are not configured");
    }

    const client = new TextractClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
        sessionToken: this.configService.get("AWS_SESSION_TOKEN"),
      },
    });

    const bytes = await readFile(input.filePath);
    const response = await client.send(
      new AnalyzeDocumentCommand({
        Document: {
          Bytes: bytes,
        },
        FeatureTypes: ["FORMS", "TABLES", "LAYOUT"],
      }),
    );

    return mapAmazonTextractResponse(response.Blocks ?? []);
  }
}
