import { Inject, Injectable, OnModuleInit } from "@nestjs/common";

import { DOCUMENT_EMBEDDING_QUEUE, DOCUMENT_PROCESSING_QUEUE } from "./constants";
import { BossService } from "./boss.service";
import { ProcessingService } from "./processing.service";

@Injectable()
export class ProcessingWorker implements OnModuleInit {
  constructor(
    @Inject(BossService) private readonly bossService: BossService,
    @Inject(ProcessingService) private readonly processingService: ProcessingService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.bossService.work<{
      documentId: string;
      force?: boolean;
      processingJobId?: string;
      retryCount?: number;
    }>(DOCUMENT_PROCESSING_QUEUE, async (payload, _bossJobId, retryCount) => {
      await this.processingService.processDocument({
        ...payload,
        retryCount,
      });
    });

    await this.bossService.work<{
      documentId: string;
      force?: boolean;
      embeddingJobId?: string;
      retryCount?: number;
      embeddingProvider?: string;
      embeddingModel?: string;
    }>(DOCUMENT_EMBEDDING_QUEUE, async (payload, _bossJobId, retryCount) => {
      await this.processingService.processDocumentEmbedding({
        ...payload,
        force: payload.force ?? false,
        embeddingProvider: payload.embeddingProvider as
          | "openai"
          | "google-gemini"
          | "voyage"
          | "mistral"
          | undefined,
        retryCount,
      });
    });
  }
}
