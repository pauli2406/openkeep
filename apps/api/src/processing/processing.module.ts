import { Module } from "@nestjs/common";

import {
  ANSWER_PROVIDER,
  EMBEDDING_PROVIDER,
  METADATA_EXTRACTOR,
  OCR_PROVIDER,
} from "./constants";
import { BossService } from "./boss.service";
import { DeterministicMetadataExtractor } from "./deterministic-metadata.extractor";
import { HybridMetadataExtractor } from "./hybrid-metadata.extractor";
import { LocalOcrProvider } from "./local-ocr.provider";
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
    LocalOcrProvider,
    DeterministicMetadataExtractor,
    HybridMetadataExtractor,
    NoopEmbeddingProvider,
    NoopAnswerProvider,
    {
      provide: OCR_PROVIDER,
      useExisting: LocalOcrProvider,
    },
    {
      provide: METADATA_EXTRACTOR,
      useExisting: HybridMetadataExtractor,
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
  exports: [BossService, ProcessingService, OCR_PROVIDER, METADATA_EXTRACTOR],
})
export class ProcessingModule {}

