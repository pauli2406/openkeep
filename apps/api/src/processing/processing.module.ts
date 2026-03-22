import { Module } from "@nestjs/common";

import {
  ANSWER_PROVIDER,
  CHUNKER,
  DOCUMENT_PARSE_PROVIDER,
  EMBEDDING_PROVIDER,
  METADATA_EXTRACTOR,
} from "./constants";
import { AmazonTextractParseProvider } from "./amazon-textract.provider";
import { BossService } from "./boss.service";
import { DeterministicMetadataExtractor } from "./deterministic-metadata.extractor";
import { DeterministicChunker } from "./deterministic-chunker";
import { DocumentParseProviderRegistry } from "./document-parse.registry";
import {
  GoogleDocumentAiEnterpriseOcrProvider,
  GoogleGeminiLayoutParseProvider,
} from "./google-document-ai.providers";
import { HybridMetadataExtractor } from "./hybrid-metadata.extractor";
import { LocalDocumentParseProvider } from "./local-ocr.provider";
import { AzureDocumentIntelligenceParseProvider } from "./azure-document-intelligence.provider";
import { MistralOcrParseProvider } from "./mistral-ocr.provider";
import { ProcessingService } from "./processing.service";

class NoopEmbeddingProvider {
  async embedChunks() {
    return [];
  }
}

class NoopAnswerProvider {
  async answer() {
    return "";
  }
}

@Module({
  providers: [
    BossService,
    ProcessingService,
    LocalDocumentParseProvider,
    GoogleDocumentAiEnterpriseOcrProvider,
    GoogleGeminiLayoutParseProvider,
    AmazonTextractParseProvider,
    AzureDocumentIntelligenceParseProvider,
    MistralOcrParseProvider,
    DocumentParseProviderRegistry,
    DeterministicMetadataExtractor,
    HybridMetadataExtractor,
    DeterministicChunker,
    NoopEmbeddingProvider,
    NoopAnswerProvider,
    {
      provide: "LOCAL_PARSE_PROVIDER",
      useExisting: LocalDocumentParseProvider,
    },
    {
      provide: "GOOGLE_DOCUMENT_AI_ENTERPRISE_PROVIDER",
      useExisting: GoogleDocumentAiEnterpriseOcrProvider,
    },
    {
      provide: "GOOGLE_GEMINI_LAYOUT_PROVIDER",
      useExisting: GoogleGeminiLayoutParseProvider,
    },
    {
      provide: "AMAZON_TEXTRACT_PROVIDER",
      useExisting: AmazonTextractParseProvider,
    },
    {
      provide: "AZURE_DOCUMENT_INTELLIGENCE_PROVIDER",
      useExisting: AzureDocumentIntelligenceParseProvider,
    },
    {
      provide: "MISTRAL_OCR_PROVIDER",
      useExisting: MistralOcrParseProvider,
    },
    {
      provide: DOCUMENT_PARSE_PROVIDER,
      useExisting: DocumentParseProviderRegistry,
    },
    {
      provide: METADATA_EXTRACTOR,
      useExisting: HybridMetadataExtractor,
    },
    {
      provide: CHUNKER,
      useExisting: DeterministicChunker,
    },
    {
      provide: EMBEDDING_PROVIDER,
      useExisting: NoopEmbeddingProvider,
    },
    {
      provide: ANSWER_PROVIDER,
      useExisting: NoopAnswerProvider,
    },
  ],
  exports: [
    BossService,
    ProcessingService,
    DOCUMENT_PARSE_PROVIDER,
    METADATA_EXTRACTOR,
    CHUNKER,
  ],
})
export class ProcessingModule {}
