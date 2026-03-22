import { Module } from "@nestjs/common";

import {
  ANSWER_PROVIDER,
  CHUNKER,
  DOCUMENT_PARSE_PROVIDER,
  EMBEDDING_PROVIDER_REGISTRY,
  METADATA_EXTRACTOR,
} from "./constants";
import { AmazonTextractParseProvider } from "./amazon-textract.provider";
import { BossService } from "./boss.service";
import { DeterministicMetadataExtractor } from "./deterministic-metadata.extractor";
import { DeterministicChunker } from "./deterministic-chunker";
import { DocumentParseProviderRegistry } from "./document-parse.registry";
import { EmbeddingProviderRegistry } from "./embedding-provider.registry";
import { GeminiEmbeddingProvider } from "./gemini-embedding.provider";
import {
  GoogleDocumentAiEnterpriseOcrProvider,
  GoogleGeminiLayoutParseProvider,
} from "./google-document-ai.providers";
import { HybridMetadataExtractor } from "./hybrid-metadata.extractor";
import { LocalDocumentParseProvider } from "./local-ocr.provider";
import { MistralEmbeddingProvider } from "./mistral-embedding.provider";
import { AzureDocumentIntelligenceParseProvider } from "./azure-document-intelligence.provider";
import { MistralOcrParseProvider } from "./mistral-ocr.provider";
import { OpenAiEmbeddingProvider } from "./openai-embedding.provider";
import { ProcessingService } from "./processing.service";
import { VoyageEmbeddingProvider } from "./voyage-embedding.provider";

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
    OpenAiEmbeddingProvider,
    GeminiEmbeddingProvider,
    VoyageEmbeddingProvider,
    MistralEmbeddingProvider,
    EmbeddingProviderRegistry,
    DeterministicMetadataExtractor,
    HybridMetadataExtractor,
    DeterministicChunker,
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
      provide: "OPENAI_EMBEDDING_PROVIDER",
      useExisting: OpenAiEmbeddingProvider,
    },
    {
      provide: "GEMINI_EMBEDDING_PROVIDER",
      useExisting: GeminiEmbeddingProvider,
    },
    {
      provide: "VOYAGE_EMBEDDING_PROVIDER",
      useExisting: VoyageEmbeddingProvider,
    },
    {
      provide: "MISTRAL_EMBEDDING_PROVIDER",
      useExisting: MistralEmbeddingProvider,
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
      provide: EMBEDDING_PROVIDER_REGISTRY,
      useExisting: EmbeddingProviderRegistry,
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
    EMBEDDING_PROVIDER_REGISTRY,
  ],
})
export class ProcessingModule {}
