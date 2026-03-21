import { Inject, Injectable, OnModuleInit } from "@nestjs/common";

import { DOCUMENT_PROCESSING_QUEUE } from "./constants";
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
  }
}
