import { Inject, Injectable, OnModuleInit } from "@nestjs/common";

import { BossService } from "../processing/boss.service";
import { CORRESPONDENT_SUMMARY_QUEUE } from "../processing/constants";
import { ExplorerService } from "./explorer.service";

@Injectable()
export class ExplorerWorker implements OnModuleInit {
  constructor(
    @Inject(BossService) private readonly bossService: BossService,
    @Inject(ExplorerService) private readonly explorerService: ExplorerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.bossService.work<{ correspondentId: string }>(
      CORRESPONDENT_SUMMARY_QUEUE,
      async (payload) => {
        await this.explorerService.refreshCorrespondentSummary(payload.correspondentId);
      },
    );
  }
}
