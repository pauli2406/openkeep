import { Inject, Injectable, OnModuleInit } from "@nestjs/common";

import { BossService } from "../processing/boss.service";
import {
  CORRESPONDENT_INTELLIGENCE_QUEUE,
  CORRESPONDENT_SUMMARY_QUEUE,
} from "../processing/constants";
import { CorrespondentIntelligenceService } from "./correspondent-intelligence.service";
import { ExplorerService } from "./explorer.service";

@Injectable()
export class ExplorerWorker implements OnModuleInit {
  constructor(
    @Inject(BossService) private readonly bossService: BossService,
    @Inject(ExplorerService) private readonly explorerService: ExplorerService,
    @Inject(CorrespondentIntelligenceService)
    private readonly correspondentIntelligenceService: CorrespondentIntelligenceService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.bossService.work<{ correspondentId: string }>(
      CORRESPONDENT_SUMMARY_QUEUE,
      async (payload) => {
        await this.explorerService.refreshCorrespondentSummary(payload.correspondentId);
      },
    );

    await this.bossService.work<{ correspondentId: string }>(
      CORRESPONDENT_INTELLIGENCE_QUEUE,
      async (payload) => {
        await this.correspondentIntelligenceService.refresh(payload.correspondentId);
      },
    );
  }
}
