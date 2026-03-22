import { Inject, Injectable } from "@nestjs/common";

import { AppConfigService } from "../common/config/app-config.service";
import { assertEmbeddings } from "./embedding.util";
import type { EmbeddingProvider, EmbeddingRequest, EmbeddingResponse } from "./provider.types";

@Injectable()
export class MistralEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "mistral" as const;

  constructor(@Inject(AppConfigService) private readonly configService: AppConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.configService.get("MISTRAL_API_KEY") &&
        this.configService.get("MISTRAL_EMBEDDING_MODEL"),
    );
  }

  getModel(): string | null {
    return this.configService.get("MISTRAL_EMBEDDING_MODEL") ?? null;
  }

  async embed(input: EmbeddingRequest): Promise<EmbeddingResponse> {
    const apiKey = this.configService.get("MISTRAL_API_KEY");
    const model = this.getModel();
    if (!apiKey || !model) {
      throw new Error("Mistral embedding configuration is incomplete");
    }

    const response = await fetch(`${this.configService.get("MISTRAL_OCR_BASE_URL")}/v1/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: input.texts,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Mistral embeddings request failed with status ${response.status}${errorBody ? `: ${errorBody}` : ""}`,
      );
    }

    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const { dimensions, embeddings } = assertEmbeddings(
      this.provider,
      model,
      (payload.data ?? []).map((item) => item.embedding ?? []),
    );

    return {
      provider: this.provider,
      model,
      dimensions,
      embeddings,
    };
  }
}
