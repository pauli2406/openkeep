import { Controller, Get, Inject, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { providerConfig } from "@openkeep/config";
import type { FastifyReply } from "fastify";

import { AppConfigService } from "../common/config/app-config.service";
import { DatabaseService } from "../common/db/database.service";
import { MetricsService } from "../common/metrics/metrics.service";
import { ObjectStorageService } from "../common/storage/storage.service";
import { DocumentsService } from "../documents/documents.service";
import { DOCUMENT_PROCESSING_QUEUE } from "../processing/constants";
import { BossService } from "../processing/boss.service";

@ApiTags("health")
@Controller()
export class HealthController {
  constructor(
    @Inject(AppConfigService) private readonly configService: AppConfigService,
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(ObjectStorageService) private readonly storageService: ObjectStorageService,
    @Inject(BossService) private readonly bossService: BossService,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
    @Inject(MetricsService) private readonly metricsService: MetricsService,
  ) {}

  @Get("health")
  status() {
    return {
      status: "ok",
      provider: providerConfig(this.configService.all()),
    };
  }

  @Get("health/live")
  live() {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("health/ready")
  async ready() {
    const checks = {
      database: false,
      objectStorage: false,
      queue: false,
    };

    try {
      await this.databaseService.pool.query("SELECT 1");
      checks.database = true;
    } catch {
      checks.database = false;
    }

    try {
      await this.storageService.ensureReady();
      checks.objectStorage = true;
    } catch {
      checks.objectStorage = false;
    }

    try {
      await this.bossService.ensureReady();
      checks.queue = true;
    } catch {
      checks.queue = false;
    }

    return {
      status: Object.values(checks).every(Boolean) ? "ok" : "degraded",
      checks,
    };
  }

  @Get("metrics")
  async metrics(@Res() reply: FastifyReply) {
    const [documentsPendingReview, documentsPendingReviewByReason, queueDepth] = await Promise.all([
      this.documentsService.countPendingReviewDocuments(),
      this.documentsService.countPendingReviewDocumentsByReason(),
      this.bossService.getQueueDepth(DOCUMENT_PROCESSING_QUEUE),
    ]);

    reply.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    return reply.send(
      this.metricsService.renderPrometheus({
        documentsPendingReview,
        documentsPendingReviewByReason,
        queueDepth,
      }),
    );
  }
}
