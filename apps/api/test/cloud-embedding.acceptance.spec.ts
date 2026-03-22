import { loadConfig, type AppConfig } from "@openkeep/config";
import type { EmbeddingProvider as EmbeddingProviderId } from "@openkeep/types";
import { describe, expect, it } from "vitest";

import { GeminiEmbeddingProvider } from "../src/processing/gemini-embedding.provider";
import { MistralEmbeddingProvider } from "../src/processing/mistral-embedding.provider";
import { OpenAiEmbeddingProvider } from "../src/processing/openai-embedding.provider";
import type { EmbeddingProvider } from "../src/processing/provider.types";
import { VoyageEmbeddingProvider } from "../src/processing/voyage-embedding.provider";

const shouldRun = process.env.RUN_CLOUD_EMBEDDING_E2E === "1";
const providerId = process.env.E2E_EMBEDDING_PROVIDER as EmbeddingProviderId | undefined;

describe.skipIf(!shouldRun)("Cloud embedding provider acceptance", () => {
  it(`embeds retrieval text with ${providerId ?? "configured provider"}`, async () => {
    if (!providerId) {
      throw new Error("E2E_EMBEDDING_PROVIDER must be set for cloud embedding acceptance tests");
    }

    const config = loadConfig(process.env);
    assertProviderConfig(providerId, config);
    const provider = createProvider(providerId, config);

    const result = await provider.embed({
      texts: ["Invoice 2025 electricity bill due on 2025-02-14"],
      inputType: "query",
    });

    expect(result.provider).toBe(providerId);
    expect(result.model.length).toBeGreaterThan(0);
    expect(result.dimensions).toBeGreaterThan(0);
    expect(result.embeddings).toHaveLength(1);
    expect(result.embeddings[0]?.length).toBe(result.dimensions);
  }, 120_000);
});

const createProvider = (
  provider: EmbeddingProviderId,
  config: AppConfig,
): EmbeddingProvider => {
  const configService = {
    get<K extends keyof AppConfig>(key: K): AppConfig[K] {
      return config[key];
    },
  } as never;

  switch (provider) {
    case "openai":
      return new OpenAiEmbeddingProvider(configService);
    case "google-gemini":
      return new GeminiEmbeddingProvider(configService);
    case "voyage":
      return new VoyageEmbeddingProvider(configService);
    case "mistral":
      return new MistralEmbeddingProvider(configService);
    default:
      throw new Error(`Unsupported embedding E2E provider: ${String(provider)}`);
  }
};

const assertProviderConfig = (provider: EmbeddingProviderId, config: AppConfig) => {
  const missing: string[] = [];

  switch (provider) {
    case "openai":
      if (!config.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
      if (!config.OPENAI_EMBEDDING_MODEL) missing.push("OPENAI_EMBEDDING_MODEL");
      break;
    case "google-gemini":
      if (!config.GEMINI_API_KEY) missing.push("GEMINI_API_KEY");
      if (!config.GEMINI_EMBEDDING_MODEL) missing.push("GEMINI_EMBEDDING_MODEL");
      break;
    case "voyage":
      if (!config.VOYAGE_API_KEY) missing.push("VOYAGE_API_KEY");
      if (!config.VOYAGE_EMBEDDING_MODEL) missing.push("VOYAGE_EMBEDDING_MODEL");
      break;
    case "mistral":
      if (!config.MISTRAL_API_KEY) missing.push("MISTRAL_API_KEY");
      if (!config.MISTRAL_EMBEDDING_MODEL) missing.push("MISTRAL_EMBEDDING_MODEL");
      break;
    default:
      throw new Error(`Unsupported embedding E2E provider: ${String(provider)}`);
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing configuration for ${provider}: ${missing.join(", ")}. Fill the matching .env template first.`,
    );
  }
};
