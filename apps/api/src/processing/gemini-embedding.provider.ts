import { Inject, Injectable } from "@nestjs/common";

import { AppConfigService } from "../common/config/app-config.service";
import { assertEmbeddings } from "./embedding.util";
import type { EmbeddingProvider, EmbeddingRequest, EmbeddingResponse } from "./provider.types";

@Injectable()
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "google-gemini" as const;

  constructor(@Inject(AppConfigService) private readonly configService: AppConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.configService.get("GEMINI_API_KEY") && this.configService.get("GEMINI_EMBEDDING_MODEL"),
    );
  }

  getModel(): string | null {
    return this.configService.get("GEMINI_EMBEDDING_MODEL") ?? null;
  }

  async embed(input: EmbeddingRequest): Promise<EmbeddingResponse> {
    const apiKey = this.configService.get("GEMINI_API_KEY");
    const model = this.getModel();
    if (!apiKey || !model) {
      throw new Error("Gemini embedding configuration is incomplete");
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: input.texts.map((text) => ({
            model: `models/${model}`,
            content: {
              parts: [{ text }],
            },
            taskType:
              input.inputType === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
          })),
        }),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Gemini embeddings request failed with status ${response.status}${errorBody ? `: ${errorBody}` : ""}`,
      );
    }

    const payload = (await response.json()) as {
      embeddings?: Array<{ values?: number[] }>;
    };
    const { dimensions, embeddings } = assertEmbeddings(
      this.provider,
      model,
      (payload.embeddings ?? []).map((item) => item.values ?? []),
    );

    return {
      provider: this.provider,
      model,
      dimensions,
      embeddings,
    };
  }
}
