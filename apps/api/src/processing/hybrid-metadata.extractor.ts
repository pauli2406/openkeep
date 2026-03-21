import { Inject, Injectable } from "@nestjs/common";

import { AppConfigService } from "../common/config/app-config.service";
import { DeterministicMetadataExtractor } from "./deterministic-metadata.extractor";
import type {
  MetadataExtractionInput,
  MetadataExtractionResult,
  MetadataExtractor,
} from "./provider.types";

@Injectable()
export class HybridMetadataExtractor implements MetadataExtractor {
  constructor(
    @Inject(DeterministicMetadataExtractor)
    private readonly deterministicExtractor: DeterministicMetadataExtractor,
    @Inject(AppConfigService) private readonly configService: AppConfigService,
  ) {}

  async extract(input: MetadataExtractionInput): Promise<MetadataExtractionResult> {
    const result = await this.deterministicExtractor.extract(input);

    return {
      ...result,
      metadata: {
        ...result.metadata,
        providerMode: this.configService.get("PROVIDER_MODE"),
        cloudEnrichmentConfigured:
          Boolean(this.configService.get("OPENAI_API_KEY")) ||
          Boolean(this.configService.get("GEMINI_API_KEY")),
      },
    };
  }
}
