import { Inject, Injectable } from "@nestjs/common";
import type { EmbeddingProvider as EmbeddingProviderId } from "@openkeep/types";

import { AppConfigService } from "../common/config/app-config.service";
import type { EmbeddingProvider, EmbeddingRequest, EmbeddingResponse } from "./provider.types";

@Injectable()
export class EmbeddingProviderRegistry {
  private readonly providers: Map<EmbeddingProviderId, EmbeddingProvider>;

  constructor(
    @Inject(AppConfigService) private readonly configService: AppConfigService,
    @Inject("OPENAI_EMBEDDING_PROVIDER")
    openAiProvider: EmbeddingProvider,
    @Inject("GEMINI_EMBEDDING_PROVIDER")
    geminiProvider: EmbeddingProvider,
    @Inject("VOYAGE_EMBEDDING_PROVIDER")
    voyageProvider: EmbeddingProvider,
    @Inject("MISTRAL_EMBEDDING_PROVIDER")
    mistralProvider: EmbeddingProvider,
  ) {
    this.providers = new Map<EmbeddingProviderId, EmbeddingProvider>([
      [openAiProvider.provider, openAiProvider],
      [geminiProvider.provider, geminiProvider],
      [voyageProvider.provider, voyageProvider],
      [mistralProvider.provider, mistralProvider],
    ]);
  }

  getActiveProviderId(): EmbeddingProviderId | null {
    return this.configService.get("ACTIVE_EMBEDDING_PROVIDER") ?? null;
  }

  isConfigured(): boolean {
    const providerId = this.getActiveProviderId();
    if (!providerId) {
      return false;
    }

    const provider = this.providers.get(providerId);
    return Boolean(provider?.isConfigured() && provider.getModel());
  }

  getActiveProviderModel(): string | null {
    const providerId = this.getActiveProviderId();
    if (!providerId) {
      return null;
    }

    return this.requireProvider(providerId).getModel();
  }

  async embed(input: EmbeddingRequest): Promise<EmbeddingResponse> {
    const providerId = this.getActiveProviderId();
    if (!providerId) {
      throw new Error("Semantic indexing is not configured");
    }

    return this.requireProvider(providerId).embed(input);
  }

  private requireProvider(providerId: EmbeddingProviderId): EmbeddingProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Unknown embedding provider: ${providerId}`);
    }

    if (!provider.isConfigured() || !provider.getModel()) {
      throw new Error(`Embedding provider ${providerId} is not configured`);
    }

    return provider;
  }
}
