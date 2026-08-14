import { Controller, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";

import { AccessAuthGuard } from "../auth/access-auth.guard";
import { BossService } from "../processing/boss.service";
import { EMAIL_INGEST_QUEUE } from "../processing/constants";
import { EmailIngestService } from "./email-ingest.service";

@ApiTags("email-ingest")
@ApiBearerAuth()
@UseGuards(AccessAuthGuard)
@Controller("email-ingest")
export class EmailIngestController {
  constructor(
    @Inject(EmailIngestService) private readonly emailIngestService: EmailIngestService,
    @Inject(BossService) private readonly bossService: BossService,
  ) {}

  @Get("status")
  @ApiOkResponse({
    description: "Mailbox configuration, last poll, outcome counts, and recent rejections",
  })
  async getStatus() {
    return this.emailIngestService.getStatus();
  }

  @Post("poll")
  @ApiCreatedResponse({ description: "Queues one mailbox poll on the worker" })
  async pollNow() {
    await this.bossService.publish(EMAIL_INGEST_QUEUE, {});
    return { queued: true };
  }
}
