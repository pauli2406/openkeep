import { Inject, Injectable, OnModuleInit } from "@nestjs/common";

import { AppConfigService } from "../common/config/app-config.service";
import { BossService } from "../processing/boss.service";
import { DEADLINE_SCAN_QUEUE, EMAIL_DIGEST_QUEUE } from "../processing/constants";
import { EmailDigestService } from "./email-digest.service";
import { NotificationsService } from "./notifications.service";

/**
 * Hourly rather than daily: the scan is idempotent, and an hourly tick means
 * a deadline crosses its window within an hour of local midnight in whatever
 * timezone the archive runs in — without any midnight-alignment logic.
 */
const DEADLINE_SCAN_CRON = "0 * * * *";

@Injectable()
export class NotificationsWorker implements OnModuleInit {
  constructor(
    @Inject(BossService) private readonly bossService: BossService,
    @Inject(NotificationsService) private readonly notificationsService: NotificationsService,
    @Inject(EmailDigestService) private readonly emailDigestService: EmailDigestService,
    @Inject(AppConfigService) private readonly configService: AppConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.bossService.work(DEADLINE_SCAN_QUEUE, async () => {
      await this.notificationsService.scanDeadlines();
    });
    await this.bossService.schedule(DEADLINE_SCAN_QUEUE, DEADLINE_SCAN_CRON);

    // The digest hour is a wall-clock promise, so the cron runs in the
    // archive's zone when one is configured.
    await this.bossService.work(EMAIL_DIGEST_QUEUE, async () => {
      await this.emailDigestService.runDigest();
    });
    await this.bossService.schedule(
      EMAIL_DIGEST_QUEUE,
      this.configService.get("EMAIL_DIGEST_CRON"),
      { tz: this.configService.get("ARCHIVE_TIMEZONE") },
    );
  }
}
