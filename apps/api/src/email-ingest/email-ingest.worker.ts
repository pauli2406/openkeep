import { Inject, Injectable, OnModuleInit } from "@nestjs/common";

import { AppConfigService } from "../common/config/app-config.service";
import { BossService } from "../processing/boss.service";
import { EMAIL_INGEST_QUEUE } from "../processing/constants";
import { EmailIngestService } from "./email-ingest.service";

@Injectable()
export class EmailIngestWorker implements OnModuleInit {
  constructor(
    @Inject(BossService) private readonly bossService: BossService,
    @Inject(EmailIngestService) private readonly emailIngestService: EmailIngestService,
    @Inject(AppConfigService) private readonly configService: AppConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.bossService.work(EMAIL_INGEST_QUEUE, async () => {
      await this.emailIngestService.pollOnce();
    });
    await this.bossService.schedule(
      EMAIL_INGEST_QUEUE,
      this.configService.get("EMAIL_INGEST_CRON"),
    );
  }
}
