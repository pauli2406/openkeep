import { Inject, Injectable } from "@nestjs/common";

import { AppConfigService } from "../common/config/app-config.service";
import { assertEmbeddings } from "./embedding.util";
import type { EmbeddingProvider, EmbeddingRequest, EmbeddingResponse } from "./provider.types";

@Injectable()
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "voyage" as const;

  constructor(@Inject(AppConfigService) private readonly configService: AppConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.configService.get("VOYAGE_API_KEY") &&
        this.configService.get("VOYAGE_EMBEDDING_MODEL"),
    );
  }

  getModel(): string | null {
    return this.configService.get("VOYAGE_EMBEDDING_MODEL") ?? null;
  }

  async embed(input: EmbeddingRequest): Promise<EmbeddingResponse> {
    const apiKey = this.configService.get("VOYAGE_API_KEY");
    const model = this.getModel();
    if (!apiKey || !model) {
      throw new Error("Voyage embedding configuration is incomplete");
    }

    const response = await fetch(`${this.configService.get("VOYAGE_API_BASE_URL")}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: input.texts,
        input_type: input.inputType === "query" ? "query" : "document",
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Voyage embeddings request failed with status ${response.status}${errorBody ? `: ${errorBody}` : ""}`,
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
