import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { exec } from "../src/processing/exec.util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LocalOcrProvider } from "../src/processing/local-ocr.provider";

const shouldRun = process.env.RUN_OCR_ACCEPTANCE === "1";

describe.skipIf(!shouldRun)("LocalOcrProvider acceptance", () => {
  const provider = new LocalOcrProvider({
    get(key: string) {
      const values = {
        OCR_LANGUAGES: "deu+eng",
        OCR_EMPTY_TEXT_THRESHOLD: 20,
      } as const;
      return values[key as keyof typeof values];
    },
  } as never);

  let directory = "";

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "openkeep-ocr-acceptance-"));
  });

  afterAll(async () => {
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("extracts searchable text from scanned PDFs", async () => {
    const imagePath = join(directory, "invoice-page.png");
    const pdfPath = join(directory, "invoice.pdf");

    await createAnnotatedImage(
      imagePath,
      "Invoice Number: PDF-123\nInvoice Date: 2025-01-10\nAmount Due: EUR 42,50",
    );
    await runImagemagick([imagePath, pdfPath]);

    const result = await provider.parse({
      filePath: pdfPath,
      filename: "invoice.pdf",
      mimeType: "application/pdf",
    });

    expect(result.text).toContain("Invoice");
    expect(result.pages.length).toBeGreaterThan(0);
    expect(result.searchablePdfPath).toBeTruthy();
  });

  it("handles multi-page TIFF normalization", async () => {
    const pageOne = join(directory, "tiff-page-1.png");
    const pageTwo = join(directory, "tiff-page-2.png");
    const tiffPath = join(directory, "multipage.tiff");

    await createAnnotatedImage(pageOne, "Invoice Number: TIFF-1\nAmount Due: EUR 10,00");
    await createAnnotatedImage(pageTwo, "Invoice Number: TIFF-2\nDue Date: 2025-02-15");
    await runImagemagick([pageOne, pageTwo, tiffPath]);

    const result = await provider.parse({
      filePath: tiffPath,
      filename: "multipage.tiff",
      mimeType: "image/tiff",
    });

    expect(result.pages.length).toBeGreaterThanOrEqual(2);
    expect(result.parseStrategy).toBe("tiff-to-png");
  });

  it("handles HEIC normalization", async () => {
    const imagePath = join(directory, "heic-source.png");
    const heicPath = join(directory, "phone.heic");

    await createAnnotatedImage(imagePath, "Invoice Number: HEIC-1\nAmount Due: USD 19.99");
    await runImagemagick([imagePath, heicPath]);

    const result = await provider.parse({
      filePath: heicPath,
      filename: "phone.heic",
      mimeType: "image/heic",
    });

    expect(result.pages.length).toBeGreaterThan(0);
    expect(result.parseStrategy).toBe("heif-to-png");
  });
});

const createAnnotatedImage = async (outputPath: string, text: string) => {
  await runImagemagick([
    "-size",
    "1240x1754",
    "xc:white",
    "-fill",
    "black",
    "-gravity",
    "NorthWest",
    "-pointsize",
    "36",
    "-annotate",
    "+80+120",
    text,
    outputPath,
  ]);
};

const runImagemagick = async (args: string[]) => {
  try {
    await exec("magick", args);
  } catch {
    await exec("convert", args);
  }
};
