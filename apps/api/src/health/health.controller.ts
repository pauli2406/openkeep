import { Controller, Get, Inject, Res } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { providerConfig } from "@openkeep/config";
import { embeddingProviders, parseProviders } from "@openkeep/types";
import type { FastifyReply } from "fastify";

import { AppConfigService } from "../common/config/app-config.service";
import { DatabaseService } from "../common/db/database.service";
import { MetricsService } from "../common/metrics/metrics.service";
import { ObjectStorageService } from "../common/storage/storage.service";
import { DocumentsService } from "../documents/documents.service";
import { DOCUMENT_EMBEDDING_QUEUE, DOCUMENT_PROCESSING_QUEUE } from "../processing/constants";
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
  @ApiOperation({ summary: "Get overall service health and configured providers" })
  @ApiOkResponse({ description: "Overall service health response" })
  status() {
    return {
      status: "ok",
      provider: providerConfig(this.configService.all()),
    };
  }

  @Get("health/providers")
  @ApiOperation({ summary: "List configured parse and embedding providers with availability" })
  @ApiOkResponse({ description: "Provider availability response" })
  providers() {
    const cfg = providerConfig(this.configService.all());

    const parseProviderAvailability: Record<string, boolean> = {
      "local-ocr": true,
      "google-document-ai-enterprise-ocr": cfg.hasGoogleCloudConfig,
      "google-document-ai-gemini-layout-parser": cfg.hasGoogleCloudConfig,
      "amazon-textract": cfg.hasAwsTextractConfig,
      "azure-ai-document-intelligence": cfg.hasAzureDocumentIntelligenceConfig,
      "mistral-ocr": cfg.hasMistralOcrConfig,
    };

    const embeddingProviderModel: Record<string, string | null> = {
      openai: cfg.openaiEmbeddingModel ?? null,
      "google-gemini": cfg.geminiEmbeddingModel ?? null,
      voyage: cfg.voyageEmbeddingModel ?? null,
      mistral: cfg.mistralEmbeddingModel ?? null,
    };

    const embeddingProviderAvailability: Record<string, boolean> = {
      openai: cfg.hasOpenAiKey && Boolean(cfg.openaiEmbeddingModel),
      "google-gemini": cfg.hasGeminiKey && Boolean(cfg.geminiEmbeddingModel),
      voyage: cfg.hasVoyageKey && Boolean(cfg.voyageEmbeddingModel),
      mistral: cfg.hasMistralEmbeddingConfig && Boolean(cfg.mistralEmbeddingModel),
    };

    return {
      activeParseProvider: cfg.activeParseProvider,
      fallbackParseProvider: cfg.fallbackParseProvider,
      activeChatProvider: cfg.activeChatProvider,
      activeEmbeddingProvider: cfg.activeEmbeddingProvider,
      parseProviders: parseProviders.map((id) => ({
        id,
        available: parseProviderAvailability[id] ?? false,
      })),
      embeddingProviders: embeddingProviders.map((id) => ({
        id,
        available: embeddingProviderAvailability[id] ?? false,
        model: embeddingProviderModel[id] ?? null,
      })),
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
  @ApiOperation({ summary: "Run readiness checks for database, object storage, and queue" })
  @ApiOkResponse({ description: "Readiness status response" })
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

  @Get("health/status")
  @ApiOperation({ summary: "Get queue depths, document counts, and recent processing jobs" })
  @ApiOkResponse({ description: "Processing and queue activity response" })
  async status_detail() {
    const [
      processingQueueDepth,
      embeddingQueueDepth,
      documentsByStatus,
      recentJobs,
      documentsPendingReview,
    ] = await Promise.all([
      this.bossService.getQueueDepth(DOCUMENT_PROCESSING_QUEUE),
      this.bossService.getQueueDepth(DOCUMENT_EMBEDDING_QUEUE),
      this.databaseService.pool.query<{ status: string; count: string }>(
        `SELECT status, count(*)::int AS count FROM documents GROUP BY status ORDER BY status`,
      ),
      this.databaseService.pool.query<{
        id: string;
        document_id: string;
        queue_name: string;
        status: string;
        attempts: number;
        last_error: string | null;
        started_at: string | null;
        finished_at: string | null;
        created_at: string;
      }>(
        `SELECT id, document_id, queue_name, status, attempts, last_error, started_at, finished_at, created_at
         FROM processing_jobs
         ORDER BY created_at DESC
         LIMIT 20`,
      ),
      this.documentsService.countPendingReviewDocuments(),
    ]);

    return {
      queues: {
        processing: { depth: processingQueueDepth },
        embedding: { depth: embeddingQueueDepth },
      },
      documents: {
        byStatus: Object.fromEntries(
          documentsByStatus.rows.map((r) => [r.status, Number(r.count)]),
        ),
        pendingReview: documentsPendingReview,
      },
      recentJobs: recentJobs.rows.map((r) => ({
        id: r.id,
        documentId: r.document_id,
        queueName: r.queue_name,
        status: r.status,
        attempts: r.attempts,
        lastError: r.last_error,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        createdAt: r.created_at,
      })),
    };
  }

  @Get("metrics")
  async metrics(@Res() reply: FastifyReply) {
    const [documentsPendingReview, documentsPendingReviewByReason, staleDocuments, processingQueueDepth, embeddingQueueDepth] = await Promise.all([
      this.documentsService.countPendingReviewDocuments(),
      this.documentsService.countPendingReviewDocumentsByReason(),
      this.documentsService.countStaleEmbeddingDocuments(),
      this.bossService.getQueueDepth(DOCUMENT_PROCESSING_QUEUE),
      this.bossService.getQueueDepth(DOCUMENT_EMBEDDING_QUEUE),
    ]);

    reply.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    return reply.send(
      this.metricsService.renderPrometheus({
        documentsPendingReview,
        documentsPendingReviewByReason,
        staleDocuments,
        queueDepths: [
          { queue: DOCUMENT_PROCESSING_QUEUE, depth: processingQueueDepth },
          { queue: DOCUMENT_EMBEDDING_QUEUE, depth: embeddingQueueDepth },
        ],
      }),
    );
  }
}
