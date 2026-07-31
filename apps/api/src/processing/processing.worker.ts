import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import { AppConfigService } from "../common/config/app-config.service";
import { DOCUMENT_EMBEDDING_QUEUE, DOCUMENT_PROCESSING_QUEUE } from "./constants";
import { BossService } from "./boss.service";
import { ProcessingService } from "./processing.service";

@Injectable()
export class ProcessingWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProcessingWorker.name);
  private reaperTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(AppConfigService) private readonly configService: AppConfigService,
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

    if (!this.configService.get("SKIP_EXTERNAL_INIT")) {
      const staleMinutes = this.configService.get("PROCESSING_STALE_MINUTES");
      const intervalMs = Math.max(1, Math.floor(staleMinutes / 2)) * 60_000;
      await this.runStaleReaper();
      this.reaperTimer = setInterval(() => {
        void this.runStaleReaper();
      }, intervalMs);
      this.reaperTimer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.reaperTimer) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }
  }

  private async runStaleReaper(): Promise<void> {
    try {
      const reaped = await this.processingService.reapStaleProcessingDocuments();
      if (reaped > 0) {
        this.logger.warn(`Reaped ${reaped} stale processing document(s)`);
      }
    } catch (error) {
      this.logger.error(
        `Stale processing reaper failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
