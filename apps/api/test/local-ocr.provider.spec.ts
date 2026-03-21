import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { describe, expect, it } from "vitest";

import { LocalOcrProvider } from "../src/processing/local-ocr.provider";

describe("LocalOcrProvider", () => {
  it("reads text fixtures directly when a text file is uploaded", async () => {
    const provider = new LocalOcrProvider({
      get(key: string) {
        const values = {
          OCR_LANGUAGES: "deu+eng",
          OCR_EMPTY_TEXT_THRESHOLD: 20,
        } as const;
        return values[key as keyof typeof values];
      },
    } as never);
    const directory = await mkdtemp(join(tmpdir(), "openkeep-ocr-"));
    const filePath = join(directory, "sample.txt");

    await writeFile(
      filePath,
      "Invoice Number: TXT-123\nAmount Due: EUR 42,50\nDue Date: 15.04.2025\n",
      "utf8",
    );

    const result = await provider.extract({
      filePath,
      filename: "sample.txt",
      mimeType: "text/plain",
    });

    expect(result.text).toContain("Invoice Number");
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.lines).toHaveLength(3);
    expect(result.reviewReasons).toEqual([]);
    expect(result.normalizationStrategy).toBe("plain-text");

    await rm(directory, { recursive: true, force: true });
  });
});
