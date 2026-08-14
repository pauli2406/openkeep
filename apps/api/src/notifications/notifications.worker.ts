import { Inject, Injectable, OnModuleInit } from "@nestjs/common";

import { BossService } from "../processing/boss.service";
import { DEADLINE_SCAN_QUEUE } from "../processing/constants";
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
  ) {}

  async onModuleInit(): Promise<void> {
    await this.bossService.work(DEADLINE_SCAN_QUEUE, async () => {
      await this.notificationsService.scanDeadlines();
    });
    await this.bossService.schedule(DEADLINE_SCAN_QUEUE, DEADLINE_SCAN_CRON);
  }
}
