import { Inject, Injectable } from "@nestjs/common";
import type { ParseProvider } from "@openkeep/types";

import { AppConfigService } from "../common/config/app-config.service";
import type { DocumentParseInput, DocumentParseProvider } from "./provider.types";

interface ParseRegistryResult {
  parsed: Awaited<ReturnType<DocumentParseProvider["parse"]>>;
  fallbackUsed: boolean;
  fallbackProvider: ParseProvider | null;
}

@Injectable()
export class DocumentParseProviderRegistry {
  private readonly providers: Map<ParseProvider, DocumentParseProvider>;

  constructor(
    @Inject(AppConfigService) private readonly configService: AppConfigService,
    @Inject("LOCAL_PARSE_PROVIDER") localProvider: DocumentParseProvider,
    @Inject("GOOGLE_DOCUMENT_AI_ENTERPRISE_PROVIDER")
    googleEnterpriseProvider: DocumentParseProvider,
    @Inject("GOOGLE_GEMINI_LAYOUT_PROVIDER")
    googleGeminiLayoutProvider: DocumentParseProvider,
    @Inject("AMAZON_TEXTRACT_PROVIDER") amazonTextractProvider: DocumentParseProvider,
    @Inject("AZURE_DOCUMENT_INTELLIGENCE_PROVIDER")
    azureDocumentIntelligenceProvider: DocumentParseProvider,
    @Inject("MISTRAL_OCR_PROVIDER") mistralOcrProvider: DocumentParseProvider,
  ) {
    this.providers = new Map<ParseProvider, DocumentParseProvider>([
      [localProvider.provider, localProvider],
      [googleEnterpriseProvider.provider, googleEnterpriseProvider],
      [googleGeminiLayoutProvider.provider, googleGeminiLayoutProvider],
      [amazonTextractProvider.provider, amazonTextractProvider],
      [azureDocumentIntelligenceProvider.provider, azureDocumentIntelligenceProvider],
      [mistralOcrProvider.provider, mistralOcrProvider],
    ]);
  }

  getActiveProviderId(): ParseProvider {
    return this.configService.get("ACTIVE_PARSE_PROVIDER");
  }

  getFallbackProviderId(): ParseProvider | null {
    return this.configService.get("FALLBACK_PARSE_PROVIDER") ?? null;
  }

  async parseWithConfiguredProvider(input: DocumentParseInput): Promise<ParseRegistryResult> {
    const activeProvider = this.requireProvider(this.getActiveProviderId());
    const fallbackProviderId = this.getFallbackProviderId();

    try {
      return {
        parsed: await activeProvider.parse(input),
        fallbackUsed: false,
        fallbackProvider: null,
      };
    } catch (error) {
      if (!fallbackProviderId || fallbackProviderId === activeProvider.provider) {
        throw error;
      }

      const fallbackProvider = this.requireProvider(fallbackProviderId);
      return {
        parsed: await fallbackProvider.parse(input),
        fallbackUsed: true,
        fallbackProvider: fallbackProvider.provider,
      };
    }
  }

  private requireProvider(providerId: ParseProvider): DocumentParseProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Unknown parse provider: ${providerId}`);
    }

    return provider;
  }
}
