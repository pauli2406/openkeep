import { Inject, Injectable } from "@nestjs/common";
import { mkdtemp, readFile, readdir } from "fs/promises";
import { extname, join } from "path";
import { tmpdir } from "os";
import { exec } from "./exec.util";
import type { ParsedDocument } from "@openkeep/types";

import { AppConfigService } from "../common/config/app-config.service";
import type {
  DocumentParseInput,
  DocumentParseProvider,
} from "./provider.types";

interface NormalizedImageSet {
  pageImagePaths: string[];
  strategy: string;
}

@Injectable()
export class LocalDocumentParseProvider implements DocumentParseProvider {
  readonly provider = "local-ocr" as const;

  constructor(@Inject(AppConfigService) private readonly configService: AppConfigService) {}

  async parse(input: DocumentParseInput): Promise<ParsedDocument> {
    if (input.mimeType.startsWith("text/")) {
      return this.fromText(await readFile(input.filePath, "utf8"), {
        parseStrategy: "plain-text",
      });
    }

    const temporaryPaths: string[] = [];

    if (this.isPdf(input)) {
      const pdfResult = await this.tryPdfOcr(input.filePath, temporaryPaths);
      if (pdfResult) {
        return pdfResult;
      }
    }

    const normalized = await this.normalizeToPageImages(input, temporaryPaths);
    if (normalized) {
      const pages = await this.ocrPageImages(normalized.pageImagePaths);
      const text = pages
        .map((page) => page.lines.map((line) => line.text).join("\n"))
        .join("\f")
        .trim();
      const searchablePdfPath = await this.tryBuildSearchablePdf(
        normalized.pageImagePaths,
        temporaryPaths,
      );

      return {
        provider: this.provider,
        parseStrategy: normalized.strategy,
        text,
        language: this.detectLanguage(text),
        pages,
        tables: [],
        keyValues: [],
        chunkHints: [],
        searchablePdfPath,
        reviewReasons: [],
        warnings: [],
        providerMetadata: {
          normalizationStrategy: normalized.strategy,
        },
        temporaryPaths,
      };
    }

    const fallback = await readFile(input.filePath).catch(() => Buffer.from(""));
    return this.fromText(fallback.toString("utf8"), {
      reviewReasons: ["unsupported_format"],
      parseStrategy: "unsupported-format",
      temporaryPaths,
    });
  }

  private async tryPdfOcr(
    filePath: string,
    temporaryPaths: string[],
  ): Promise<ParsedDocument | null> {
    const workingDir = await this.makeTempDir();
    temporaryPaths.push(workingDir);
    const searchablePdfPath = join(workingDir, "searchable.pdf");
    const sidecarPath = join(workingDir, "sidecar.txt");

    try {
      await exec("ocrmypdf", [
        "--skip-text",
        "--sidecar",
        sidecarPath,
        "-l",
        this.configService.get("OCR_LANGUAGES"),
        filePath,
        searchablePdfPath,
      ]);

      const text = await readFile(sidecarPath, "utf8");
      if (text.trim().length >= this.configService.get("OCR_EMPTY_TEXT_THRESHOLD")) {
        return {
          ...this.fromText(text, {
            parseStrategy: "ocrmypdf-sidecar",
            temporaryPaths,
          }),
          searchablePdfPath,
        };
      }
    } catch {
      // Fall through to page rasterization when OCRmyPDF is unavailable,
      // misconfigured, or cannot process the source PDF.
    }

    const fallbackPages = await this.rasterizePdfToImages(filePath, temporaryPaths);
    if (!fallbackPages) {
      return null;
    }

    const pages = await this.ocrPageImages(fallbackPages.pageImagePaths);
    const text = pages
      .map((page) => page.lines.map((line) => line.text).join("\n"))
      .join("\f")
      .trim();

    return {
      provider: this.provider,
      parseStrategy: "pdf-rasterized",
      text,
      language: this.detectLanguage(text),
      pages,
      tables: [],
      keyValues: [],
      chunkHints: [],
      searchablePdfPath,
      reviewReasons: [],
      warnings: [],
      providerMetadata: {
        normalizationStrategy: "pdf-rasterized",
      },
      temporaryPaths,
    };
  }

  private async normalizeToPageImages(
    input: DocumentParseInput,
    temporaryPaths: string[],
  ): Promise<NormalizedImageSet | null> {
    if (this.isDirectImage(input)) {
      return {
        pageImagePaths: [input.filePath],
        strategy: "direct-image",
      };
    }

    if (this.isTiff(input) || this.isHeif(input)) {
      const workingDir = await this.makeTempDir();
      temporaryPaths.push(workingDir);
      const outputPattern = join(workingDir, "page-%04d.png");

      try {
        await this.runImagemagick([input.filePath, outputPattern]);
        const pageImagePaths = await this.listGeneratedPngs(workingDir);
        if (pageImagePaths.length > 0) {
          return {
            pageImagePaths,
            strategy: this.isHeif(input) ? "heif-to-png" : "tiff-to-png",
          };
        }
      } catch {
        return null;
      }
    }

    return null;
  }

  private async rasterizePdfToImages(
    filePath: string,
    temporaryPaths: string[],
  ): Promise<NormalizedImageSet | null> {
    const workingDir = await this.makeTempDir();
    temporaryPaths.push(workingDir);
    const prefix = join(workingDir, "page");

    try {
      await exec("pdftoppm", ["-png", filePath, prefix]);
      const pageImagePaths = await this.listGeneratedPngs(workingDir);
      if (pageImagePaths.length > 0) {
        return {
          pageImagePaths,
          strategy: "pdf-rasterized",
        };
      }
    } catch {
      return null;
    }

    return null;
  }

  private async ocrPageImages(pageImagePaths: string[]): Promise<ParsedDocument["pages"]> {
    const pages: ParsedDocument["pages"] = [];

    for (const [index, pageImagePath] of pageImagePaths.entries()) {
      try {
        const { stdout } = await exec("tesseract", [
          pageImagePath,
          "stdout",
          "-l",
          this.configService.get("OCR_LANGUAGES"),
          "tsv",
        ]);
        const page = this.parseSinglePageTesseractTsv(stdout, index + 1);
        pages.push(page);
      } catch {
        pages.push({
          pageNumber: index + 1,
          width: null,
          height: null,
          lines: [],
          blocks: [],
        });
      }
    }

    return pages;
  }

  private async tryBuildSearchablePdf(
    pageImagePaths: string[],
    temporaryPaths: string[],
  ): Promise<string | undefined> {
    if (pageImagePaths.length === 0) {
      return undefined;
    }

    const workingDir = await this.makeTempDir();
    temporaryPaths.push(workingDir);
    const combinedPdfPath = join(workingDir, "normalized.pdf");
    const searchablePdfPath = join(workingDir, "normalized-searchable.pdf");

    try {
      await this.runImagemagick([...pageImagePaths, combinedPdfPath]);
      await exec("ocrmypdf", [
        "--skip-text",
        "-l",
        this.configService.get("OCR_LANGUAGES"),
        combinedPdfPath,
        searchablePdfPath,
      ]);
      return searchablePdfPath;
    } catch {
      return undefined;
    }
  }

  private fromText(
    text: string,
    options?: {
      reviewReasons?: ParsedDocument["reviewReasons"];
      parseStrategy?: string;
      temporaryPaths?: string[];
      warnings?: string[];
    },
  ): ParsedDocument {
    const normalized = text.replace(/\r\n/g, "\n").trim();
    const pages = normalized.length === 0 ? [] : this.splitTextIntoPages(normalized);

    return {
      provider: this.provider,
      parseStrategy: options?.parseStrategy ?? "text-fallback",
      text: normalized,
      language: this.detectLanguage(normalized),
      pages,
      tables: [],
      keyValues: [],
      chunkHints: [],
      reviewReasons: options?.reviewReasons ?? [],
      warnings: options?.warnings ?? [],
      providerMetadata: {
        normalizationStrategy: options?.parseStrategy ?? "text-fallback",
      },
      temporaryPaths: options?.temporaryPaths ?? [],
    };
  }

  private splitTextIntoPages(text: string): ParsedDocument["pages"] {
    return text.split(/\f+/).map((pageText, pageIndex) => {
      const lines = pageText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, lineIndex) => ({
          lineIndex,
          text: line,
          boundingBox: {
            x: 0,
            y: lineIndex * 12,
            width: line.length * 7,
            height: 10,
          },
        }));

      return {
        pageNumber: pageIndex + 1,
        width: null,
        height: null,
        lines,
        blocks: lines.map((line, blockIndex) => ({
          blockIndex,
          role: blockIndex === 0 && line.text.length < 160 ? "heading" : "paragraph",
          text: line.text,
          boundingBox: line.boundingBox,
          lineIndices: [line.lineIndex],
          metadata: {},
        })),
      };
    });
  }

  private parseSinglePageTesseractTsv(
    tsv: string,
    pageNumber: number,
  ): ParsedDocument["pages"][number] {
    const rows = tsv.split(/\r?\n/).slice(1);
    const grouped = new Map<
      number,
      {
        lineIndex: number;
        left: number;
        top: number;
        right: number;
        bottom: number;
        words: string[];
      }
    >();

    for (const row of rows) {
      if (!row.trim()) {
        continue;
      }

      const columns = row.split("\t");
      if (columns.length < 12) {
        continue;
      }

      const level = Number(columns[0]);
      const lineNumber = Number(columns[4]);
      const wordNumber = Number(columns[5]);
      const left = Number(columns[6]);
      const top = Number(columns[7]);
      const width = Number(columns[8]);
      const height = Number(columns[9]);
      const text = columns[11]?.trim();

      if (level !== 5 || wordNumber < 1 || !text) {
        continue;
      }

      const existing = grouped.get(lineNumber);
      if (existing) {
        existing.words.push(text);
        existing.left = Math.min(existing.left, left);
        existing.top = Math.min(existing.top, top);
        existing.right = Math.max(existing.right, left + width);
        existing.bottom = Math.max(existing.bottom, top + height);
      } else {
        grouped.set(lineNumber, {
          lineIndex: Math.max(0, lineNumber - 1),
          left,
          top,
          right: left + width,
          bottom: top + height,
          words: [text],
        });
      }
    }

    return {
      pageNumber,
      width: null,
      height: null,
      lines: [...grouped.values()]
        .sort((a, b) => a.lineIndex - b.lineIndex)
        .map((line) => ({
          lineIndex: line.lineIndex,
          text: line.words.join(" "),
          boundingBox: {
            x: line.left,
            y: line.top,
            width: line.right - line.left,
            height: line.bottom - line.top,
          },
        })),
      blocks: [...grouped.values()]
        .sort((a, b) => a.lineIndex - b.lineIndex)
        .map((line, blockIndex) => ({
          blockIndex,
          role:
            blockIndex === 0 && line.words.join(" ").length < 160 ? "heading" : "paragraph",
          text: line.words.join(" "),
          boundingBox: {
            x: line.left,
            y: line.top,
            width: line.right - line.left,
            height: line.bottom - line.top,
          },
          lineIndices: [line.lineIndex],
          metadata: {},
        })),
    };
  }

  private detectLanguage(text: string): string | null {
    if (!text.trim()) {
      return null;
    }

    const germanScore = [
      /\brechnung\b/gi,
      /\bfällig\b/gi,
      /\betrag\b/gi,
      /\bzahlbar\b/gi,
    ].reduce((score, pattern) => score + (text.match(pattern)?.length ?? 0), 0);

    const englishScore = [
      /\binvoice\b/gi,
      /\bdue date\b/gi,
      /\bamount\b/gi,
      /\bpayment\b/gi,
    ].reduce((score, pattern) => score + (text.match(pattern)?.length ?? 0), 0);

    if (germanScore === 0 && englishScore === 0) {
      return "und";
    }

    return germanScore >= englishScore ? "de" : "en";
  }

  private isPdf(input: DocumentParseInput): boolean {
    return input.mimeType === "application/pdf" || extname(input.filename).toLowerCase() === ".pdf";
  }

  private isDirectImage(input: DocumentParseInput): boolean {
    return [
      "image/jpeg",
      "image/png",
      "image/jpg",
      "image/webp",
    ].includes(input.mimeType);
  }

  private isTiff(input: DocumentParseInput): boolean {
    return ["image/tiff", "image/tif"].includes(input.mimeType) || [".tif", ".tiff"].includes(extname(input.filename).toLowerCase());
  }

  private isHeif(input: DocumentParseInput): boolean {
    return ["image/heic", "image/heif"].includes(input.mimeType) || [".heic", ".heif"].includes(extname(input.filename).toLowerCase());
  }

  private async listGeneratedPngs(directory: string): Promise<string[]> {
    const entries = await readdir(directory);
    return entries
      .filter((entry) => entry.toLowerCase().endsWith(".png"))
      .sort()
      .map((entry) => join(directory, entry));
  }

  private async makeTempDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), "openkeep-ocr-"));
  }

  private async runImagemagick(args: string[]): Promise<void> {
    try {
      await exec("magick", args);
    } catch {
      await exec("convert", args);
    }
  }
}

export { LocalDocumentParseProvider as LocalOcrProvider };
