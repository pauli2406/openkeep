import { Inject, Injectable } from "@nestjs/common";

import { AppConfigService } from "../common/config/app-config.service";
import { assertEmbeddings } from "./embedding.util";
import type { EmbeddingProvider, EmbeddingRequest, EmbeddingResponse } from "./provider.types";

@Injectable()
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "openai" as const;

  constructor(@Inject(AppConfigService) private readonly configService: AppConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.configService.get("OPENAI_API_KEY") && this.configService.get("OPENAI_EMBEDDING_MODEL"),
    );
  }

  getModel(): string | null {
    return this.configService.get("OPENAI_EMBEDDING_MODEL") ?? null;
  }

  async embed(input: EmbeddingRequest): Promise<EmbeddingResponse> {
    const apiKey = this.configService.get("OPENAI_API_KEY");
    const model = this.getModel();
    if (!apiKey || !model) {
      throw new Error("OpenAI embedding configuration is incomplete");
    }

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: input.texts,
        encoding_format: "float",
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `OpenAI embeddings request failed with status ${response.status}${errorBody ? `: ${errorBody}` : ""}`,
      );
    }

    const payload = (await response.json()) as {
      data?: Array<{ index: number; embedding: number[] }>;
    };
    const data = Array.isArray(payload.data) ? [...payload.data].sort((a, b) => a.index - b.index) : [];
    const { dimensions, embeddings } = assertEmbeddings(
      this.provider,
      model,
      data.map((item) => item.embedding),
    );

    return {
      provider: this.provider,
      model,
      dimensions,
      embeddings,
    };
  }
}
