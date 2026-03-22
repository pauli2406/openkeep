import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { loadConfig, type AppConfig } from "@openkeep/config";
import type { ParseProvider } from "@openkeep/types";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AmazonTextractParseProvider } from "../src/processing/amazon-textract.provider";
import { AzureDocumentIntelligenceParseProvider } from "../src/processing/azure-document-intelligence.provider";
import {
  GoogleDocumentAiEnterpriseOcrProvider,
  GoogleGeminiLayoutParseProvider,
} from "../src/processing/google-document-ai.providers";
import { MistralOcrParseProvider } from "../src/processing/mistral-ocr.provider";
import type { DocumentParseProvider } from "../src/processing/provider.types";

const shouldRun = process.env.RUN_CLOUD_PARSE_E2E === "1";
const providerId = process.env.E2E_PARSE_PROVIDER as ParseProvider | undefined;

describe.skipIf(!shouldRun)("Cloud parse provider acceptance", () => {
  let directory = "";

  beforeAll(async () => {
    if (!providerId) {
      throw new Error("E2E_PARSE_PROVIDER must be set for cloud parse acceptance tests");
    }

    directory = await mkdtemp(join(tmpdir(), "openkeep-cloud-parse-"));
  });

  afterAll(async () => {
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it(`parses a sample invoice with ${providerId ?? "configured provider"}`, async () => {
    const config = loadConfig(process.env);
    assertProviderConfig(providerId!, config);

    const provider = createProvider(providerId!, config);
    const imagePath = join(directory, "cloud-invoice.png");
    const pdfPath = join(directory, "cloud-invoice.pdf");

    await createAnnotatedImage(
      imagePath,
      "Invoice Number: CLOUD-123\nInvoice Date: 2025-01-10\nAmount Due: EUR 42,50",
    );

    const usePdfInput =
      providerId === "google-document-ai-enterprise-ocr" ||
      providerId === "google-document-ai-gemini-layout-parser";

    if (usePdfInput) {
      await runImagemagick([imagePath, pdfPath]);
    }

    const result = await provider.parse({
      filePath: usePdfInput ? pdfPath : imagePath,
      filename: usePdfInput ? "cloud-invoice.pdf" : "cloud-invoice.png",
      mimeType: usePdfInput ? "application/pdf" : "image/png",
    });

    expect(result.provider).toBe(providerId);
    expect(result.pages.length).toBeGreaterThan(0);
    expect(result.text.trim().length).toBeGreaterThan(10);
    expect(result.text.toLowerCase()).toMatch(/invoice|amount|date/);
  }, 180_000);
});

const createProvider = (
  provider: ParseProvider,
  config: AppConfig,
): DocumentParseProvider => {
  const configService = {
    get<K extends keyof AppConfig>(key: K): AppConfig[K] {
      return config[key];
    },
  } as never;

  switch (provider) {
    case "google-document-ai-enterprise-ocr":
      return new GoogleDocumentAiEnterpriseOcrProvider(configService);
    case "google-document-ai-gemini-layout-parser":
      return new GoogleGeminiLayoutParseProvider(configService);
    case "amazon-textract":
      return new AmazonTextractParseProvider(configService);
    case "azure-ai-document-intelligence":
      return new AzureDocumentIntelligenceParseProvider(configService);
    case "mistral-ocr":
      return new MistralOcrParseProvider(configService);
    default:
      throw new Error(`Unsupported cloud E2E provider: ${String(provider)}`);
  }
};

const assertProviderConfig = (provider: ParseProvider, config: AppConfig) => {
  const missing: string[] = [];

  switch (provider) {
    case "google-document-ai-enterprise-ocr":
      if (!config.GOOGLE_CLOUD_PROJECT_ID) missing.push("GOOGLE_CLOUD_PROJECT_ID");
      if (!config.GOOGLE_CLOUD_LOCATION) missing.push("GOOGLE_CLOUD_LOCATION");
      if (
        !config.GOOGLE_CLOUD_ACCESS_TOKEN &&
        !config.GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON
      ) {
        missing.push("GOOGLE_CLOUD_ACCESS_TOKEN or GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON");
      }
      if (!config.GOOGLE_DOCUMENT_AI_ENTERPRISE_PROCESSOR_ID) {
        missing.push("GOOGLE_DOCUMENT_AI_ENTERPRISE_PROCESSOR_ID");
      }
      break;
    case "google-document-ai-gemini-layout-parser":
      if (!config.GOOGLE_CLOUD_PROJECT_ID) missing.push("GOOGLE_CLOUD_PROJECT_ID");
      if (!config.GOOGLE_CLOUD_LOCATION) missing.push("GOOGLE_CLOUD_LOCATION");
      if (
        !config.GOOGLE_CLOUD_ACCESS_TOKEN &&
        !config.GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON
      ) {
        missing.push("GOOGLE_CLOUD_ACCESS_TOKEN or GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON");
      }
      if (!config.GOOGLE_DOCUMENT_AI_GEMINI_PROCESSOR_ID) {
        missing.push("GOOGLE_DOCUMENT_AI_GEMINI_PROCESSOR_ID");
      }
      break;
    case "amazon-textract":
      if (!config.AWS_REGION) missing.push("AWS_REGION");
      if (!config.AWS_ACCESS_KEY_ID) missing.push("AWS_ACCESS_KEY_ID");
      if (!config.AWS_SECRET_ACCESS_KEY) missing.push("AWS_SECRET_ACCESS_KEY");
      break;
    case "azure-ai-document-intelligence":
      if (!config.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT) {
        missing.push("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT");
      }
      if (!config.AZURE_DOCUMENT_INTELLIGENCE_API_KEY) {
        missing.push("AZURE_DOCUMENT_INTELLIGENCE_API_KEY");
      }
      break;
    case "mistral-ocr":
      if (!config.MISTRAL_API_KEY) missing.push("MISTRAL_API_KEY");
      break;
    default:
      throw new Error(`Unsupported cloud E2E provider: ${String(provider)}`);
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing configuration for ${provider}: ${missing.join(", ")}. Fill the matching .env template first.`,
    );
  }
};

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
    await execa("magick", args);
  } catch {
    await execa("convert", args);
  }
};
