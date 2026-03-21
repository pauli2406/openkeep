import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  auditEvents,
  correspondents,
  documentFiles,
  documentPages,
  documentTagLinks,
  documentTextBlocks,
  documentTypes,
  documents,
  processingJobs,
  tags,
} from "@openkeep/db";
import type { DocumentMetadata, ReviewEvidence, ReviewReason } from "@openkeep/types";
import { and, eq, sql } from "drizzle-orm";
import { readFile } from "fs/promises";
import slugify from "slugify";

import { AppConfigService } from "../common/config/app-config.service";
import { DatabaseService } from "../common/db/database.service";
import { MetricsService } from "../common/metrics/metrics.service";
import { ObjectStorageService } from "../common/storage/storage.service";
import {
  ANSWER_PROVIDER,
  DOCUMENT_PROCESSING_QUEUE,
  EMBEDDING_PROVIDER,
  METADATA_EXTRACTOR,
  OCR_PROVIDER,
} from "./constants";
import { BossService } from "./boss.service";
import type {
  AnswerProvider,
  EmbeddingProvider,
  MetadataExtractor,
  OcrProvider,
  OcrResult,
} from "./provider.types";

interface DocumentProcessingPayload {
  documentId: string;
  force?: boolean;
  processingJobId?: string;
  retryCount?: number;
}

@Injectable()
export class ProcessingService {
  private readonly logger = new Logger(ProcessingService.name);

  constructor(
    @Inject(AppConfigService) private readonly configService: AppConfigService,
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(ObjectStorageService) private readonly storageService: ObjectStorageService,
    @Inject(BossService) private readonly bossService: BossService,
    @Inject(MetricsService) private readonly metricsService: MetricsService,
    @Inject(OCR_PROVIDER) private readonly ocrProvider: OcrProvider,
    @Inject(METADATA_EXTRACTOR) private readonly metadataExtractor: MetadataExtractor,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddingProvider: EmbeddingProvider,
    @Inject(ANSWER_PROVIDER) private readonly answerProvider: AnswerProvider,
  ) {}

  async enqueueDocumentProcessing(documentId: string, force: boolean) {
    const [job] = await this.databaseService.db
      .insert(processingJobs)
      .values({
        documentId,
        queueName: DOCUMENT_PROCESSING_QUEUE,
        status: "queued",
        payload: {
          documentId,
          force,
          retryCount: 0,
        },
      })
      .returning();

    await this.bossService.publish(DOCUMENT_PROCESSING_QUEUE, {
      documentId,
      force,
      processingJobId: job.id,
      retryCount: 0,
    });

    this.logStructured("log", "document.processing_enqueued", {
      documentId,
      processingJobId: job.id,
      force,
    });

    return {
      queued: true as const,
      documentId,
      processingJobId: job.id,
    };
  }

  async processDocument(payload: DocumentProcessingPayload): Promise<void> {
    const retryCount = payload.retryCount ?? 0;
    const [record] = await this.databaseService.db
      .select({
        documentId: documents.id,
        title: documents.title,
        mimeType: documents.mimeType,
        existingSearchablePdfStorageKey: documents.searchablePdfStorageKey,
        storageKey: documentFiles.storageKey,
        originalFilename: documentFiles.originalFilename,
      })
      .from(documents)
      .innerJoin(documentFiles, eq(documents.fileId, documentFiles.id))
      .where(eq(documents.id, payload.documentId))
      .limit(1);

    if (!record) {
      throw new NotFoundException("Document not found");
    }

    const tempPaths: string[] = [];
    await this.markProcessing(record.documentId, payload.processingJobId, retryCount);
    const tempFile = await this.storageService.downloadToTempFile(record.storageKey);
    tempPaths.push(tempFile);
    this.logStructured("log", "document.processing_started", {
      documentId: payload.documentId,
      processingJobId: payload.processingJobId,
      retryCount,
    });

    const processStartedAt = Date.now();

    try {
      void this.embeddingProvider;
      void this.answerProvider;

      const ocrStartedAt = Date.now();
      const ocr = await this.ocrProvider.extract({
        filePath: tempFile,
        mimeType: record.mimeType,
        filename: record.originalFilename,
      });
      this.metricsService.observeOcrDuration((Date.now() - ocrStartedAt) / 1000);
      tempPaths.push(...(ocr.temporaryPaths ?? []));

      const extractionStartedAt = Date.now();
      const metadata = await this.metadataExtractor.extract({
        documentId: payload.documentId,
        title: record.title,
        mimeType: record.mimeType,
        ocr,
      });
      this.metricsService.observeMetadataExtractionDuration(
        (Date.now() - extractionStartedAt) / 1000,
      );

      const correspondentId = metadata.correspondentName
        ? await this.ensureCorrespondent(metadata.correspondentName)
        : null;
      const documentTypeId = metadata.documentTypeName
        ? await this.ensureDocumentType(metadata.documentTypeName)
        : null;
      const tagIds = await this.ensureTags(metadata.tags);
      const blocks = ocr.pages.flatMap((page) =>
        page.lines.map((line) => ({
          documentId: payload.documentId,
          pageNumber: page.pageNumber,
          lineIndex: line.lineIndex,
          boundingBox: line.boundingBox,
          text: line.text,
        })),
      );
      const reviewReasons = this.resolveReviewReasons(ocr, metadata);
      const reviewStatus = reviewReasons.length > 0 ? "pending" : "not_required";
      const searchablePdfStorageKey = await this.persistSearchablePdf(
        payload.documentId,
        payload.processingJobId,
        ocr.searchablePdfPath,
      );
      const documentMetadata = this.buildDocumentMetadata({
        metadata,
        ocr,
        reviewReasons,
      });

      await this.databaseService.db.transaction(async (tx) => {
        await tx.delete(documentPages).where(eq(documentPages.documentId, payload.documentId));
        await tx
          .delete(documentTextBlocks)
          .where(eq(documentTextBlocks.documentId, payload.documentId));
        await tx
          .delete(documentTagLinks)
          .where(eq(documentTagLinks.documentId, payload.documentId));

        if (ocr.pages.length > 0) {
          await tx.insert(documentPages).values(
            ocr.pages.map((page) => ({
              documentId: payload.documentId,
              pageNumber: page.pageNumber,
              width: page.width,
              height: page.height,
            })),
          );
        }

        if (blocks.length > 0) {
          await tx.insert(documentTextBlocks).values(blocks);
        }

        if (tagIds.length > 0) {
          await tx.insert(documentTagLinks).values(
            tagIds.map((tagId) => ({
              documentId: payload.documentId,
              tagId,
            })),
          );
        }

        await tx
          .update(documents)
          .set({
            status: "ready",
            language: metadata.language,
            fullText: ocr.text,
            pageCount: ocr.pages.length,
            issueDate: metadata.issueDate,
            dueDate: metadata.dueDate,
            amount: metadata.amount === null ? null : metadata.amount.toFixed(2),
            currency: metadata.currency,
            referenceNumber: metadata.referenceNumber,
            confidence: metadata.confidence.toFixed(2),
            reviewStatus,
            reviewReasons,
            reviewedAt: null,
            reviewNote: null,
            searchablePdfStorageKey,
            lastProcessingError: null,
            correspondentId,
            documentTypeId,
            metadata: documentMetadata,
            processedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(documents.id, payload.documentId));

        await tx
          .update(processingJobs)
          .set({
            status: "completed",
            attempts: retryCount + 1,
            lastError: null,
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(this.processingJobWhere(payload));

        await tx.insert(auditEvents).values({
          documentId: payload.documentId,
          eventType:
            reviewStatus === "pending" ? "document.processed_review_pending" : "document.processed",
          payload: {
            confidence: metadata.confidence,
            reviewReasons,
            retryCount,
          },
        });
      });

      if (
        record.existingSearchablePdfStorageKey &&
        searchablePdfStorageKey &&
        record.existingSearchablePdfStorageKey !== searchablePdfStorageKey
      ) {
        await this.storageService
          .deleteObject(record.existingSearchablePdfStorageKey)
          .catch(() => undefined);
      }

      this.metricsService.incrementProcessingJobsTotal("completed");
      this.logStructured(
        "log",
        reviewStatus === "pending"
          ? "document.processing_completed_review_pending"
          : "document.processing_completed",
        {
        documentId: payload.documentId,
        processingJobId: payload.processingJobId,
        retryCount,
        reviewStatus,
        reviewReasons,
        durationMs: Date.now() - processStartedAt,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown processing failure";
      const finalFailure = retryCount >= this.configService.get("PROCESSING_RETRY_LIMIT");

      if (finalFailure) {
        await this.handleFinalFailure(payload, retryCount, message);
        this.metricsService.incrementProcessingJobsTotal("failed");
      } else {
        await this.handleRetryableFailure(payload, retryCount, message);
        this.metricsService.incrementProcessingRetriesTotal();
        this.metricsService.incrementProcessingJobsTotal("retry");
        this.logStructured("warn", "document.processing_retry_scheduled", {
          documentId: payload.documentId,
          processingJobId: payload.processingJobId,
          retryCount,
          error: message,
        });
      }

      if (finalFailure) {
        this.logStructured("error", "document.processing_failed_final", {
          documentId: payload.documentId,
          processingJobId: payload.processingJobId,
          retryCount,
          error: message,
        });
      }

      throw error;
    } finally {
      await Promise.all(tempPaths.map((path) => this.storageService.removeTempFile(path)));
    }
  }

  private resolveReviewReasons(ocr: OcrResult, metadata: { confidence: number; reviewReasons: ReviewReason[] }) {
    const reasons = new Set<ReviewReason>([...ocr.reviewReasons, ...metadata.reviewReasons]);

    if (ocr.text.trim().length < this.configService.get("OCR_EMPTY_TEXT_THRESHOLD")) {
      reasons.add("ocr_empty");
    }

    if (metadata.confidence < this.configService.get("REVIEW_CONFIDENCE_THRESHOLD")) {
      reasons.add("low_confidence");
    }

    return [...reasons];
  }

  private async persistSearchablePdf(
    documentId: string,
    processingJobId: string | undefined,
    searchablePdfPath: string | undefined,
  ): Promise<string | null> {
    if (!searchablePdfPath) {
      return null;
    }

    const buffer = await readFile(searchablePdfPath).catch(() => null);
    if (!buffer) {
      return null;
    }

    const suffix = processingJobId ?? `${Date.now()}`;
    const storageKey = `documents/${documentId}/derived/searchable-${suffix}.pdf`;
    await this.storageService.uploadBuffer(storageKey, buffer, "application/pdf");
    return storageKey;
  }

  private async handleRetryableFailure(
    payload: DocumentProcessingPayload,
    retryCount: number,
    message: string,
  ): Promise<void> {
    await this.databaseService.db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({
          status: "processing",
          lastProcessingError: message,
          reviewStatus: "not_required",
          reviewReasons: [],
          reviewedAt: null,
          reviewNote: null,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, payload.documentId));

      await tx
        .update(processingJobs)
        .set({
          status: "running",
          attempts: retryCount + 1,
          lastError: message,
          updatedAt: new Date(),
        })
        .where(this.processingJobWhere(payload));

      await tx.insert(auditEvents).values({
        documentId: payload.documentId,
        eventType: "document.processing_retry_scheduled",
        payload: {
          error: message,
          retryCount,
        },
      });
    });
  }

  private async handleFinalFailure(
    payload: DocumentProcessingPayload,
    retryCount: number,
    message: string,
  ): Promise<void> {
    const reviewReasons: ReviewReason[] = ["processing_failed"];
    if (/unsupported/i.test(message)) {
      reviewReasons.push("unsupported_format");
    }

    await this.databaseService.db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({
          status: "failed",
          reviewStatus: "pending",
          reviewReasons,
          reviewedAt: null,
          reviewNote: null,
          lastProcessingError: message,
          processedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(documents.id, payload.documentId));

      await tx
        .update(processingJobs)
        .set({
          status: "failed",
          attempts: retryCount + 1,
          lastError: message,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(this.processingJobWhere(payload));

      await tx.insert(auditEvents).values({
        documentId: payload.documentId,
        eventType: "document.processing_failed",
        payload: {
          error: message,
          retryCount,
          reviewReasons,
        },
      });
    });
  }

  private async markProcessing(
    documentId: string,
    processingJobId: string | undefined,
    retryCount: number,
  ): Promise<void> {
    await this.databaseService.db
      .update(documents)
      .set({
        status: "processing",
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    await this.databaseService.db
      .update(processingJobs)
      .set({
        status: "running",
        attempts: retryCount + 1,
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        processingJobId
          ? eq(processingJobs.id, processingJobId)
          : and(
              eq(processingJobs.documentId, documentId),
              eq(processingJobs.queueName, DOCUMENT_PROCESSING_QUEUE),
            ),
      );
  }

  private processingJobWhere(payload: DocumentProcessingPayload) {
    return payload.processingJobId
      ? eq(processingJobs.id, payload.processingJobId)
      : and(
          eq(processingJobs.documentId, payload.documentId),
          eq(processingJobs.queueName, DOCUMENT_PROCESSING_QUEUE),
        );
  }

  private async ensureCorrespondent(name: string): Promise<string> {
    const normalizedName = name.trim().toLowerCase().replace(/\s+/g, " ");
    const [existing] = await this.databaseService.db
      .select({ id: correspondents.id })
      .from(correspondents)
      .where(eq(correspondents.normalizedName, normalizedName))
      .limit(1);

    if (existing) {
      return existing.id;
    }

    const [created] = await this.databaseService.db
      .insert(correspondents)
      .values({
        name: name.trim(),
        slug: this.createSlug(name),
        normalizedName,
      })
      .returning({ id: correspondents.id });

    return created.id;
  }

  private async ensureDocumentType(name: string): Promise<string> {
    const slug = this.createSlug(name);
    const [existing] = await this.databaseService.db
      .select({ id: documentTypes.id })
      .from(documentTypes)
      .where(eq(documentTypes.slug, slug))
      .limit(1);

    if (existing) {
      return existing.id;
    }

    const [created] = await this.databaseService.db
      .insert(documentTypes)
      .values({
        name,
        slug,
      })
      .returning({ id: documentTypes.id });

    return created.id;
  }

  private async ensureTags(tagNames: string[]): Promise<string[]> {
    const ids: string[] = [];

    for (const name of [...new Set(tagNames.map((tag) => tag.trim()).filter(Boolean))]) {
      const slug = this.createSlug(name);
      const [existing] = await this.databaseService.db
        .select({ id: tags.id })
        .from(tags)
        .where(eq(tags.slug, slug))
        .limit(1);

      if (existing) {
        ids.push(existing.id);
        continue;
      }

      const [created] = await this.databaseService.db
        .insert(tags)
        .values({
          name,
          slug,
        })
        .returning({ id: tags.id });
      ids.push(created.id);
    }

    return ids;
  }

  private createSlug(input: string): string {
    return slugify(input, {
      lower: true,
      strict: true,
      trim: true,
    }).slice(0, 255);
  }

  private logStructured(
    level: "log" | "warn" | "error",
    event: string,
    payload: Record<string, unknown>,
  ): void {
    const message = JSON.stringify({
      event,
      ...payload,
    });
    this.logger[level](message);
  }

  private buildDocumentMetadata(input: {
    metadata: { confidence: number; metadata: Record<string, unknown> };
    ocr: OcrResult;
    reviewReasons: ReviewReason[];
  }): DocumentMetadata {
    const reviewEvidenceRecord =
      input.metadata.metadata.reviewEvidence &&
      typeof input.metadata.metadata.reviewEvidence === "object" &&
      input.metadata.metadata.reviewEvidence !== null
        ? (input.metadata.metadata.reviewEvidence as Record<string, unknown>)
        : {};
    const reviewEvidence: ReviewEvidence = {
      documentClass:
        reviewEvidenceRecord.documentClass === "invoice" ? "invoice" : "generic",
      requiredFields: Array.isArray(reviewEvidenceRecord.requiredFields)
        ? (reviewEvidenceRecord.requiredFields as ReviewEvidence["requiredFields"])
        : [],
      missingFields: Array.isArray(reviewEvidenceRecord.missingFields)
        ? (reviewEvidenceRecord.missingFields as ReviewEvidence["missingFields"])
        : [],
      extracted:
        reviewEvidenceRecord.extracted &&
        typeof reviewEvidenceRecord.extracted === "object" &&
        reviewEvidenceRecord.extracted !== null
          ? {
              correspondent: Boolean(
                (reviewEvidenceRecord.extracted as Record<string, unknown>).correspondent,
              ),
              issueDate: Boolean(
                (reviewEvidenceRecord.extracted as Record<string, unknown>).issueDate,
              ),
              amount: Boolean(
                (reviewEvidenceRecord.extracted as Record<string, unknown>).amount,
              ),
              currency: Boolean(
                (reviewEvidenceRecord.extracted as Record<string, unknown>).currency,
              ),
            }
          : {
              correspondent: false,
              issueDate: false,
              amount: false,
              currency: false,
            },
      activeReasons: input.reviewReasons,
      confidence: input.metadata.confidence,
      confidenceThreshold: this.configService.get("REVIEW_CONFIDENCE_THRESHOLD"),
      ocrTextLength: input.ocr.text.trim().length,
      ocrEmptyThreshold: this.configService.get("OCR_EMPTY_TEXT_THRESHOLD"),
    };

    return {
      ...input.metadata.metadata,
      pageCount: input.ocr.pages.length,
      normalizationStrategy: input.ocr.normalizationStrategy,
      searchablePdfGenerated: Boolean(input.ocr.searchablePdfPath),
      reviewReasons: input.reviewReasons,
      reviewEvidence,
    };
  }
}
