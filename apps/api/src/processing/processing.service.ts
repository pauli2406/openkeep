import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  auditEvents,
  correspondentAliases,
  documentChunkEmbeddings,
  correspondents,
  documentChunks,
  documentFiles,
  documentPages,
  documentTagLinks,
  documentTextBlocks,
  documentTypes,
  documents,
  processingJobs,
  tags,
} from "@openkeep/db";
import {
  AnswerQueryResponse,
  DocumentMetadata,
  EmbeddingProvider as EmbeddingProviderId,
  ManualOverrides,
  ParseProviderSchema,
  QueueDocumentEmbeddingPayload,
  ReviewEvidence,
  ReviewReason,
  SemanticSearchResult,
} from "@openkeep/types";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { readFile } from "fs/promises";
import slugify from "slugify";

import { AppConfigService } from "../common/config/app-config.service";
import { DatabaseService } from "../common/db/database.service";
import { MetricsService } from "../common/metrics/metrics.service";
import { ObjectStorageService } from "../common/storage/storage.service";
import {
  ANSWER_PROVIDER,
  CHUNKER,
  DOCUMENT_PARSE_PROVIDER,
  DOCUMENT_EMBEDDING_QUEUE,
  DOCUMENT_PROCESSING_QUEUE,
  EMBEDDING_PROVIDER_REGISTRY,
  METADATA_EXTRACTOR,
} from "./constants";
import { BossService } from "./boss.service";
import { CorrespondentResolutionService } from "./correspondent-resolution.service";
import { DocumentTypePolicyService } from "./document-type-policy.service";
import { DocumentParseProviderRegistry } from "./document-parse.registry";
import { EmbeddingProviderRegistry } from "./embedding-provider.registry";
import { padEmbedding, serializeHalfVector } from "./embedding.util";
import { normalizeCorrespondentName } from "./normalization.util";
import type {
  AnswerProvider,
  Chunker,
  ChunkingInput,
  DocumentParseInput,
  EmbeddingJobInput,
  MetadataExtractor,
} from "./provider.types";

interface DocumentProcessingPayload {
  documentId: string;
  force?: boolean;
  processingJobId?: string;
  retryCount?: number;
  parseProvider?: DocumentMetadata["parseProvider"];
  fallbackParseProvider?: DocumentMetadata["parseProvider"] | null;
}

export interface EmbeddingJobQueueResult {
  queued: true;
  documentId: string;
  embeddingJobId: string;
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
    @Inject(CorrespondentResolutionService)
    private readonly correspondentResolutionService: CorrespondentResolutionService,
    @Inject(DocumentTypePolicyService)
    private readonly documentTypePolicyService: DocumentTypePolicyService,
    @Inject(DOCUMENT_PARSE_PROVIDER)
    private readonly parseProviderRegistry: DocumentParseProviderRegistry,
    @Inject(EMBEDDING_PROVIDER_REGISTRY)
    private readonly embeddingProviderRegistry: EmbeddingProviderRegistry,
    @Inject(METADATA_EXTRACTOR) private readonly metadataExtractor: MetadataExtractor,
    @Inject(CHUNKER) private readonly chunker: Chunker,
    @Inject(ANSWER_PROVIDER) private readonly answerProvider: AnswerProvider,
  ) {}

  async enqueueDocumentProcessing(documentId: string, force: boolean, overrideParseProvider?: string) {
    let parseProvider = this.parseProviderRegistry.getActiveProviderId();
    if (overrideParseProvider) {
      const parsed = ParseProviderSchema.safeParse(overrideParseProvider);
      if (!parsed.success) {
        throw new BadRequestException(`Invalid parse provider: ${overrideParseProvider}`);
      }
      parseProvider = parsed.data;
    }
    const fallbackParseProvider = this.parseProviderRegistry.getFallbackProviderId();
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
          parseProvider,
          fallbackParseProvider,
        },
      })
      .returning();

    await this.bossService.publish(DOCUMENT_PROCESSING_QUEUE, {
      documentId,
      force,
      processingJobId: job.id,
      retryCount: 0,
      parseProvider,
      fallbackParseProvider,
    });

    this.logStructured("log", "document.processing_enqueued", {
      documentId,
      processingJobId: job.id,
      force,
      parseProvider,
      fallbackParseProvider,
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
        metadata: documents.metadata,
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
      void this.answerProvider;

      const parseStartedAt = Date.now();
      const { parsed, fallbackUsed, fallbackProvider } =
        await this.parseProviderRegistry.parseWithConfiguredProvider({
          filePath: tempFile,
          mimeType: record.mimeType,
          filename: record.originalFilename,
        },
        {
          activeProviderId: payload.parseProvider,
          fallbackProviderId: payload.fallbackParseProvider,
        });
      this.metricsService.observeOcrDuration((Date.now() - parseStartedAt) / 1000);
      this.metricsService.observeParseDuration(
        parsed.provider,
        (Date.now() - parseStartedAt) / 1000,
      );
      tempPaths.push(...(parsed.temporaryPaths ?? []));

      const extractionStartedAt = Date.now();
      const metadata = await this.metadataExtractor.extract({
        documentId: payload.documentId,
        title: record.title,
        mimeType: record.mimeType,
        parsed,
      });
      this.metricsService.observeMetadataExtractionDuration(
        (Date.now() - extractionStartedAt) / 1000,
      );
      const chunkStartedAt = Date.now();
      const chunks = await this.chunker.chunk({
        documentId: payload.documentId,
        parsed,
      });
      this.metricsService.observeChunkGenerationDuration(
        (Date.now() - chunkStartedAt) / 1000,
      );

      const correspondentId = metadata.correspondentName
        ? await this.ensureCorrespondent(metadata.correspondentName)
        : null;
      const documentTypeId = metadata.documentTypeName
        ? await this.ensureDocumentType(metadata.documentTypeName)
        : null;
      const tagIds = await this.ensureTags(metadata.tags);
      const blocks = parsed.pages.flatMap((page) =>
        page.lines.map((line) => ({
          documentId: payload.documentId,
          pageNumber: page.pageNumber,
          lineIndex: line.lineIndex,
          boundingBox: line.boundingBox,
          text: line.text,
        })),
      );
      const reviewReasons = this.resolveReviewReasons(parsed, metadata);
      const reviewStatus = reviewReasons.length > 0 ? "pending" : "not_required";
      const searchablePdfStorageKey = await this.persistSearchablePdf(
        payload.documentId,
        payload.processingJobId,
        parsed.searchablePdfPath,
      );
      const mergedArchiveFields = this.applyManualOverrides(
        record.metadata,
        {
          issueDate: metadata.issueDate,
          dueDate: metadata.dueDate,
          expiryDate: metadata.expiryDate,
          amount: metadata.amount,
          currency: metadata.currency,
          referenceNumber: metadata.referenceNumber,
          holderName: metadata.holderName,
          issuingAuthority: metadata.issuingAuthority,
          correspondentId,
          documentTypeId,
          tagIds,
        },
      );
      const extractedCorrespondent = this.readCorrespondentExtraction(metadata.metadata);
      const documentMetadata = this.buildDocumentMetadata({
        metadata,
        existingMetadata: record.metadata,
        parsed,
        chunks,
        reviewReasons,
        fallbackUsed,
        fallbackProvider,
        embeddingConfigured: this.embeddingProviderRegistry.isConfigured(),
        embeddingProvider: this.embeddingProviderRegistry.getActiveProviderId(),
        embeddingModel: this.embeddingProviderRegistry.getActiveProviderModel(),
      });

      await this.databaseService.db.transaction(async (tx) => {
        await tx.delete(documentPages).where(eq(documentPages.documentId, payload.documentId));
        await tx
          .delete(documentTextBlocks)
          .where(eq(documentTextBlocks.documentId, payload.documentId));
        await tx.delete(documentChunks).where(eq(documentChunks.documentId, payload.documentId));
        await tx
          .delete(documentTagLinks)
          .where(eq(documentTagLinks.documentId, payload.documentId));

        if (parsed.pages.length > 0) {
          await tx.insert(documentPages).values(
            parsed.pages.map((page) => ({
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

        if (chunks.length > 0) {
          await tx.insert(documentChunks).values(chunks);
        }

        if (mergedArchiveFields.tagIds.length > 0) {
          await tx.insert(documentTagLinks).values(
            mergedArchiveFields.tagIds.map((tagId) => ({
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
            fullText: parsed.text,
            pageCount: parsed.pages.length,
            issueDate: mergedArchiveFields.issueDate,
            dueDate: mergedArchiveFields.dueDate,
            expiryDate: mergedArchiveFields.expiryDate,
            amount:
              mergedArchiveFields.amount === null ? null : mergedArchiveFields.amount.toFixed(2),
            currency: mergedArchiveFields.currency,
            referenceNumber: mergedArchiveFields.referenceNumber,
            holderName: mergedArchiveFields.holderName,
            issuingAuthority: mergedArchiveFields.issuingAuthority,
            confidence: metadata.confidence.toFixed(2),
            parseProvider: parsed.provider,
            chunkCount: chunks.length,
            embeddingStatus: this.embeddingProviderRegistry.isConfigured()
              ? chunks.length > 0
                ? "queued"
                : "ready"
              : "not_configured",
            embeddingProvider: this.embeddingProviderRegistry.getActiveProviderId(),
            embeddingModel: this.embeddingProviderRegistry.getActiveProviderModel(),
            reviewStatus,
            reviewReasons,
            reviewedAt: null,
            reviewNote: null,
            searchablePdfStorageKey,
            lastProcessingError: null,
            correspondentId: mergedArchiveFields.correspondentId,
            documentTypeId: mergedArchiveFields.documentTypeId,
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
            parseProvider: parsed.provider,
            fallbackUsed,
            fallbackProvider,
            chunkCount: chunks.length,
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
      this.metricsService.incrementParseJobsTotal(parsed.provider, "completed");
      if (fallbackUsed) {
        this.metricsService.incrementParseFallbackUsageTotal();
      }
      if (
        extractedCorrespondent.rawName &&
        mergedArchiveFields.correspondentId &&
        mergedArchiveFields.correspondentId === correspondentId
      ) {
        await this.correspondentResolutionService.persistAlias({
          correspondentId: mergedArchiveFields.correspondentId,
          alias: extractedCorrespondent.rawName,
          source:
            extractedCorrespondent.matchStrategy === "llm_choice" ||
            extractedCorrespondent.matchStrategy === "new"
              ? "llm"
              : "import",
          confidence: extractedCorrespondent.confidence,
          canonicalName: metadata.correspondentName,
        });
        await this.correspondentResolutionService.applyAliasToUnresolvedDocuments({
          correspondentId: mergedArchiveFields.correspondentId,
          alias: extractedCorrespondent.rawName,
          resolvedName: metadata.correspondentName ?? extractedCorrespondent.resolvedName ?? "",
          confidence: extractedCorrespondent.confidence,
          matchStrategy:
            extractedCorrespondent.matchStrategy === "exact" ||
            extractedCorrespondent.matchStrategy === "alias" ||
            extractedCorrespondent.matchStrategy === "fuzzy" ||
            extractedCorrespondent.matchStrategy === "llm_choice"
              ? extractedCorrespondent.matchStrategy
              : "alias",
        });
      }
      await this.enqueueDocumentEmbedding(record.documentId, Boolean(payload.force)).catch(
        async (error) => {
          const message =
            error instanceof Error ? error.message : "Unknown embedding enqueue failure";
          await this.databaseService.db
            .update(documents)
            .set({
              embeddingStatus: "failed",
              embeddingProvider: this.embeddingProviderRegistry.getActiveProviderId(),
              embeddingModel: this.embeddingProviderRegistry.getActiveProviderModel(),
              updatedAt: new Date(),
            })
            .where(eq(documents.id, record.documentId));
          this.logStructured("error", "document.embedding_enqueue_failed", {
            documentId: record.documentId,
            error: message,
          });
        },
      );
      this.logStructured(
        "log",
        reviewStatus === "pending"
          ? "document.processing_completed_review_pending"
          : "document.processing_completed",
        {
        documentId: payload.documentId,
        processingJobId: payload.processingJobId,
        retryCount,
        parseProvider: parsed.provider,
        fallbackUsed,
        fallbackProvider,
        reviewStatus,
        reviewReasons,
        chunkCount: chunks.length,
        durationMs: Date.now() - processStartedAt,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown processing failure";
      const finalFailure = retryCount >= this.configService.get("PROCESSING_RETRY_LIMIT");

      if (finalFailure) {
        await this.handleFinalFailure(payload, retryCount, message);
        this.metricsService.incrementProcessingJobsTotal("failed");
        if (payload.parseProvider) {
          this.metricsService.incrementParseJobsTotal(payload.parseProvider, "failed");
        }
      } else {
        await this.handleRetryableFailure(payload, retryCount, message);
        this.metricsService.incrementProcessingRetriesTotal();
        this.metricsService.incrementProcessingJobsTotal("retry");
        if (payload.parseProvider) {
          this.metricsService.incrementParseJobsTotal(payload.parseProvider, "retry");
        }
        this.logStructured("warn", "document.processing_retry_scheduled", {
          documentId: payload.documentId,
          processingJobId: payload.processingJobId,
          retryCount,
          parseProvider: payload.parseProvider,
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

  isSemanticIndexingConfigured(): boolean {
    return this.embeddingProviderRegistry.isConfigured();
  }

  getActiveEmbeddingConfiguration(): {
    provider: EmbeddingProviderId | null;
    model: string | null;
  } {
    return {
      provider: this.embeddingProviderRegistry.getActiveProviderId(),
      model: this.embeddingProviderRegistry.getActiveProviderModel(),
    };
  }

  async embedQuery(text: string) {
    return this.embeddingProviderRegistry.embed({
      texts: [text],
      inputType: "query",
    });
  }

  async answerQuestion(input: {
    question: string;
    results: SemanticSearchResult[];
    maxCitations: number;
  }): Promise<Pick<AnswerQueryResponse, "status" | "answer" | "reasoning" | "citations">> {
    return this.answerProvider.answer(input);
  }

  async enqueueDocumentEmbedding(
    documentId: string,
    force: boolean,
  ): Promise<EmbeddingJobQueueResult | null> {
    if (!this.embeddingProviderRegistry.isConfigured()) {
      return null;
    }

    const embeddingProvider = this.embeddingProviderRegistry.getActiveProviderId();
    const embeddingModel = this.embeddingProviderRegistry.getActiveProviderModel();
    if (!embeddingProvider || !embeddingModel) {
      return null;
    }

    const [document] = await this.databaseService.db
      .select({
        id: documents.id,
        status: documents.status,
        chunkCount: documents.chunkCount,
      })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);

    if (!document || document.status !== "ready" || document.chunkCount === 0) {
      return null;
    }

    const [job] = await this.databaseService.db
      .insert(processingJobs)
      .values({
        documentId,
        queueName: DOCUMENT_EMBEDDING_QUEUE,
        status: "queued",
        payload: {
          documentId,
          force,
          retryCount: 0,
          embeddingProvider,
          embeddingModel,
        } satisfies QueueDocumentEmbeddingPayload,
      })
      .returning();

    await this.databaseService.db
      .update(documents)
      .set({
        embeddingStatus: "queued",
        embeddingProvider,
        embeddingModel,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    await this.bossService.publish(DOCUMENT_EMBEDDING_QUEUE, {
      documentId,
      force,
      embeddingJobId: job.id,
      retryCount: 0,
      embeddingProvider,
      embeddingModel,
    } satisfies QueueDocumentEmbeddingPayload);

    this.logStructured("log", "document.embedding_enqueued", {
      documentId,
      embeddingJobId: job.id,
      force,
      embeddingProvider,
      embeddingModel,
    });

    return {
      queued: true,
      documentId,
      embeddingJobId: job.id,
    };
  }

  async processDocumentEmbedding(payload: EmbeddingJobInput): Promise<void> {
    const retryCount = payload.retryCount ?? 0;
    const activeProvider = this.embeddingProviderRegistry.getActiveProviderId();
    const activeModel = this.embeddingProviderRegistry.getActiveProviderModel();
    const embeddingProvider = activeProvider ?? payload.embeddingProvider;
    const embeddingModel = activeModel ?? payload.embeddingModel;

    if (!embeddingProvider || !embeddingModel || !this.embeddingProviderRegistry.isConfigured()) {
      throw new Error("Semantic indexing is not configured");
    }

    const [document] = await this.databaseService.db
      .select({
        id: documents.id,
        status: documents.status,
        chunkCount: documents.chunkCount,
        title: documents.title,
        correspondentName: correspondents.name,
      })
      .from(documents)
      .leftJoin(correspondents, eq(documents.correspondentId, correspondents.id))
      .where(eq(documents.id, payload.documentId))
      .limit(1);

    if (!document) {
      throw new NotFoundException("Document not found");
    }

    const chunks = await this.databaseService.db
      .select({
        documentId: documentChunks.documentId,
        chunkIndex: documentChunks.chunkIndex,
        heading: documentChunks.heading,
        text: documentChunks.text,
        pageFrom: documentChunks.pageFrom,
        pageTo: documentChunks.pageTo,
        strategyVersion: documentChunks.strategyVersion,
        contentHash: documentChunks.contentHash,
        metadata: documentChunks.metadata,
      })
      .from(documentChunks)
      .where(eq(documentChunks.documentId, payload.documentId))
      .orderBy(documentChunks.chunkIndex);

    await this.markEmbeddingIndexing(payload.documentId, payload.embeddingJobId, retryCount);

    if (document.status !== "ready" || chunks.length === 0) {
      await this.completeEmbeddingJobWithoutChanges(payload, retryCount, embeddingProvider, embeddingModel);
      return;
    }

    const existingEmbeddings = await this.databaseService.db
      .select({
        chunkIndex: documentChunkEmbeddings.chunkIndex,
        contentHash: documentChunkEmbeddings.contentHash,
      })
      .from(documentChunkEmbeddings)
      .where(
        and(
          eq(documentChunkEmbeddings.documentId, payload.documentId),
          eq(documentChunkEmbeddings.provider, embeddingProvider),
          eq(documentChunkEmbeddings.model, embeddingModel),
        ),
      );

    const existingByChunkIndex = new Map(
      existingEmbeddings.map((item) => [item.chunkIndex, item.contentHash]),
    );
    const chunksToEmbed = payload.force
      ? chunks
      : chunks.filter((chunk) => existingByChunkIndex.get(chunk.chunkIndex) !== chunk.contentHash);
    const removedChunkIndexes = existingEmbeddings
      .map((item) => item.chunkIndex)
      .filter((chunkIndex) => !chunks.some((chunk) => chunk.chunkIndex === chunkIndex));
    const startedAt = Date.now();

    try {
      if (chunksToEmbed.length > 0) {
        // Build contextual prefix for embedding enrichment
        const contextParts: string[] = [];
        if (document.title) {
          contextParts.push(`Document: ${document.title}`);
        }
        if (document.correspondentName) {
          contextParts.push(`Correspondent: ${document.correspondentName}`);
        }
        const contextPrefix = contextParts.length > 0 ? `[${contextParts.join(" | ")}]\n` : "";

        const embedded = await this.embeddingProviderRegistry.embed({
          texts: chunksToEmbed.map((chunk) => {
            const parts: string[] = [];
            if (contextPrefix) {
              parts.push(contextPrefix.trimEnd());
            }
            if (chunk.heading) {
              parts.push(`[Section: ${chunk.heading}]`);
            }
            parts.push(chunk.text);
            return parts.join("\n");
          }),
          inputType: "document",
        });

        if (
          embedded.provider !== embeddingProvider ||
          embedded.model !== embeddingModel
        ) {
          throw new Error("Embedding provider returned mismatched provider metadata");
        }

        await this.databaseService.db.transaction(async (tx) => {
          for (let index = 0; index < chunksToEmbed.length; index += 1) {
            const chunk = chunksToEmbed[index];
            const embedding = padEmbedding(embedded.embeddings[index] ?? []);
            await tx.execute(sql`
              INSERT INTO document_chunk_embeddings (
                document_id,
                chunk_index,
                provider,
                model,
                dimensions,
                embedding,
                content_hash,
                created_at,
                updated_at
              )
              VALUES (
                ${payload.documentId}::uuid,
                ${chunk.chunkIndex},
                ${embeddingProvider}::embedding_provider,
                ${embeddingModel},
                ${embedded.dimensions},
                ${serializeHalfVector(embedding)}::halfvec,
                ${chunk.contentHash},
                now(),
                now()
              )
              ON CONFLICT (document_id, chunk_index, provider, model)
              DO UPDATE SET
                dimensions = EXCLUDED.dimensions,
                embedding = EXCLUDED.embedding,
                content_hash = EXCLUDED.content_hash,
                updated_at = now()
            `);
          }

          if (removedChunkIndexes.length > 0) {
            await tx
              .delete(documentChunkEmbeddings)
              .where(
                and(
                  eq(documentChunkEmbeddings.documentId, payload.documentId),
                  eq(documentChunkEmbeddings.provider, embeddingProvider),
                  eq(documentChunkEmbeddings.model, embeddingModel),
                  inArray(documentChunkEmbeddings.chunkIndex, removedChunkIndexes),
                ),
              );
          }

          await tx
            .update(documents)
            .set({
              embeddingStatus: "ready",
              embeddingProvider,
              embeddingModel,
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
            .where(this.embeddingJobWhere(payload));

          await tx.insert(auditEvents).values({
            documentId: payload.documentId,
            eventType: "document.embeddings_indexed",
            payload: {
              embeddingProvider,
              embeddingModel,
              retryCount,
              embeddedChunkCount: chunksToEmbed.length,
              totalChunkCount: chunks.length,
            },
          });
        });
      } else {
        await this.databaseService.db.transaction(async (tx) => {
          await tx
            .update(documents)
            .set({
              embeddingStatus: "ready",
              embeddingProvider,
              embeddingModel,
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
            .where(this.embeddingJobWhere(payload));
        });
      }

      this.metricsService.incrementEmbeddingJobsTotal(embeddingProvider, "completed");
      this.metricsService.observeEmbeddingDuration(
        embeddingProvider,
        (Date.now() - startedAt) / 1000,
      );
      this.metricsService.incrementEmbeddedChunksTotal(embeddingProvider, chunksToEmbed.length);
      this.logStructured("log", "document.embedding_completed", {
        documentId: payload.documentId,
        embeddingJobId: payload.embeddingJobId,
        embeddingProvider,
        embeddingModel,
        retryCount,
        embeddedChunkCount: chunksToEmbed.length,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown embedding failure";
      const finalFailure = retryCount >= this.configService.get("PROCESSING_RETRY_LIMIT");

      if (finalFailure) {
        await this.handleFinalEmbeddingFailure(payload, retryCount, message, embeddingProvider, embeddingModel);
        this.metricsService.incrementEmbeddingJobsTotal(embeddingProvider, "failed");
        this.logStructured("error", "document.embedding_failed_final", {
          documentId: payload.documentId,
          embeddingJobId: payload.embeddingJobId,
          retryCount,
          embeddingProvider,
          embeddingModel,
          error: message,
        });
      } else {
        await this.handleRetryableEmbeddingFailure(
          payload,
          retryCount,
          message,
          embeddingProvider,
          embeddingModel,
        );
        this.metricsService.incrementEmbeddingJobsTotal(embeddingProvider, "retry");
        this.logStructured("warn", "document.embedding_retry_scheduled", {
          documentId: payload.documentId,
          embeddingJobId: payload.embeddingJobId,
          retryCount,
          embeddingProvider,
          embeddingModel,
          error: message,
        });
      }

      throw error;
    }
  }

  private resolveReviewReasons(
    parsed: {
      text: string;
      reviewReasons: ReviewReason[];
      warnings: string[];
    },
    metadata: { confidence: number; reviewReasons: ReviewReason[] },
  ) {
    const reasons = new Set<ReviewReason>([...parsed.reviewReasons, ...metadata.reviewReasons]);

    if (parsed.text.trim().length < this.configService.get("OCR_EMPTY_TEXT_THRESHOLD")) {
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

  private async handleRetryableEmbeddingFailure(
    payload: EmbeddingJobInput,
    retryCount: number,
    message: string,
    embeddingProvider: EmbeddingProviderId,
    embeddingModel: string,
  ): Promise<void> {
    await this.databaseService.db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({
          embeddingStatus: "queued",
          embeddingProvider,
          embeddingModel,
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
        .where(this.embeddingJobWhere(payload));
    });
  }

  private async handleFinalEmbeddingFailure(
    payload: EmbeddingJobInput,
    retryCount: number,
    message: string,
    embeddingProvider: EmbeddingProviderId,
    embeddingModel: string,
  ): Promise<void> {
    await this.databaseService.db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({
          embeddingStatus: "failed",
          embeddingProvider,
          embeddingModel,
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
        .where(this.embeddingJobWhere(payload));

      await tx.insert(auditEvents).values({
        documentId: payload.documentId,
        eventType: "document.embedding_failed",
        payload: {
          error: message,
          retryCount,
          embeddingProvider,
          embeddingModel,
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

  private async markEmbeddingIndexing(
    documentId: string,
    embeddingJobId: string | undefined,
    retryCount: number,
  ): Promise<void> {
    await this.databaseService.db
      .update(documents)
      .set({
        embeddingStatus: "indexing",
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
        embeddingJobId
          ? eq(processingJobs.id, embeddingJobId)
          : and(
              eq(processingJobs.documentId, documentId),
              eq(processingJobs.queueName, DOCUMENT_EMBEDDING_QUEUE),
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

  private embeddingJobWhere(payload: EmbeddingJobInput) {
    return payload.embeddingJobId
      ? eq(processingJobs.id, payload.embeddingJobId)
      : and(
          eq(processingJobs.documentId, payload.documentId),
          eq(processingJobs.queueName, DOCUMENT_EMBEDDING_QUEUE),
        );
  }

  private async completeEmbeddingJobWithoutChanges(
    payload: EmbeddingJobInput,
    retryCount: number,
    embeddingProvider: EmbeddingProviderId,
    embeddingModel: string,
  ): Promise<void> {
    await this.databaseService.db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({
          embeddingStatus: "ready",
          embeddingProvider,
          embeddingModel,
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
        .where(this.embeddingJobWhere(payload));
    });
  }

  private async ensureCorrespondent(name: string): Promise<string> {
    const normalizedName = normalizeCorrespondentName(name) ?? name.trim().toLowerCase().replace(/\s+/g, " ");
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

  async persistManualCorrespondentAlias(input: {
    documentId: string;
    correspondentId: string;
    canonicalName: string | null;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    const extraction = this.readCorrespondentExtraction(input.metadata);
    if (!extraction.rawName) {
      return;
    }

    await this.correspondentResolutionService.persistAlias({
      correspondentId: input.correspondentId,
      alias: extraction.rawName,
      source: "manual",
      confidence: extraction.confidence,
      canonicalName: input.canonicalName,
    });

    await this.correspondentResolutionService.applyAliasToUnresolvedDocuments({
      correspondentId: input.correspondentId,
      alias: extraction.rawName,
      resolvedName: input.canonicalName ?? extraction.resolvedName ?? extraction.rawName,
      confidence: extraction.confidence,
      matchStrategy: "alias",
    });
  }

  private async ensureDocumentType(name: string): Promise<string> {
    const canonicalName = (await this.documentTypePolicyService.resolveCanonicalName(name)) ?? name;
    const slug = this.createSlug(canonicalName);
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
        name: canonicalName,
        slug,
        requiredFields: (await this.documentTypePolicyService.getPolicy(canonicalName)).requiredFields,
      })
      .returning({ id: documentTypes.id });

    this.documentTypePolicyService.invalidateCache();

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

  private applyManualOverrides(
    existingMetadata: Record<string, unknown>,
    extracted: {
      issueDate: Date | null;
      dueDate: Date | null;
      expiryDate: Date | null;
      amount: number | null;
      currency: string | null;
      referenceNumber: string | null;
      holderName: string | null;
      issuingAuthority: string | null;
      correspondentId: string | null;
      documentTypeId: string | null;
      tagIds: string[];
    },
  ) {
    const manualOverrides = this.readManualOverrides(existingMetadata);

    return {
      issueDate: this.isFieldLocked(manualOverrides, "issueDate")
        ? this.toDateOrNull(manualOverrides.values.issueDate)
        : extracted.issueDate,
      dueDate: this.isFieldLocked(manualOverrides, "dueDate")
        ? this.toDateOrNull(manualOverrides.values.dueDate)
        : extracted.dueDate,
      expiryDate: this.isFieldLocked(manualOverrides, "expiryDate")
        ? this.toDateOrNull(manualOverrides.values.expiryDate)
        : extracted.expiryDate,
      amount: this.isFieldLocked(manualOverrides, "amount")
        ? manualOverrides.values.amount ?? null
        : extracted.amount,
      currency: this.isFieldLocked(manualOverrides, "currency")
        ? manualOverrides.values.currency ?? null
        : extracted.currency,
      referenceNumber: this.isFieldLocked(manualOverrides, "referenceNumber")
        ? manualOverrides.values.referenceNumber ?? null
        : extracted.referenceNumber,
      holderName: this.isFieldLocked(manualOverrides, "holderName")
        ? manualOverrides.values.holderName ?? null
        : extracted.holderName,
      issuingAuthority: this.isFieldLocked(manualOverrides, "issuingAuthority")
        ? manualOverrides.values.issuingAuthority ?? null
        : extracted.issuingAuthority,
      correspondentId: this.isFieldLocked(manualOverrides, "correspondentId")
        ? manualOverrides.values.correspondentId ?? null
        : extracted.correspondentId,
      documentTypeId: this.isFieldLocked(manualOverrides, "documentTypeId")
        ? manualOverrides.values.documentTypeId ?? null
        : extracted.documentTypeId,
      tagIds: this.isFieldLocked(manualOverrides, "tagIds")
        ? manualOverrides.values.tagIds ?? []
        : extracted.tagIds,
    };
  }

  private readManualOverrides(metadata: Record<string, unknown>): ManualOverrides {
    const manual =
      metadata.manual && typeof metadata.manual === "object" ? metadata.manual : undefined;
    const record = manual as Record<string, unknown> | undefined;
    const values =
      record?.values && typeof record.values === "object"
        ? (record.values as Record<string, unknown>)
        : {};

    return {
      lockedFields: Array.isArray(record?.lockedFields)
        ? record!.lockedFields.filter((value): value is ManualOverrides["lockedFields"][number] =>
            typeof value === "string",
          )
        : [],
      values: {
        issueDate: typeof values.issueDate === "string" || values.issueDate === null
          ? (values.issueDate as string | null)
          : undefined,
        dueDate: typeof values.dueDate === "string" || values.dueDate === null
          ? (values.dueDate as string | null)
          : undefined,
        expiryDate: typeof values.expiryDate === "string" || values.expiryDate === null
          ? (values.expiryDate as string | null)
          : undefined,
        amount: typeof values.amount === "number" || values.amount === null
          ? (values.amount as number | null)
          : undefined,
        currency: typeof values.currency === "string" || values.currency === null
          ? (values.currency as string | null)
          : undefined,
        referenceNumber:
          typeof values.referenceNumber === "string" || values.referenceNumber === null
            ? (values.referenceNumber as string | null)
            : undefined,
        holderName:
          typeof values.holderName === "string" || values.holderName === null
            ? (values.holderName as string | null)
            : undefined,
        issuingAuthority:
          typeof values.issuingAuthority === "string" || values.issuingAuthority === null
            ? (values.issuingAuthority as string | null)
            : undefined,
        correspondentId:
          typeof values.correspondentId === "string" || values.correspondentId === null
            ? (values.correspondentId as string | null)
            : undefined,
        documentTypeId:
          typeof values.documentTypeId === "string" || values.documentTypeId === null
            ? (values.documentTypeId as string | null)
            : undefined,
        tagIds: Array.isArray(values.tagIds)
          ? values.tagIds.filter((value): value is string => typeof value === "string")
          : undefined,
      },
      updatedAt: typeof record?.updatedAt === "string" ? record.updatedAt : null,
      updatedByUserId: typeof record?.updatedByUserId === "string" ? record.updatedByUserId : null,
    };
  }

  private isFieldLocked(
    manualOverrides: ManualOverrides,
    field: keyof ManualOverrides["values"],
  ): boolean {
    return manualOverrides.lockedFields.includes(field as ManualOverrides["lockedFields"][number]);
  }

  private toDateOrNull(value: string | null | undefined): Date | null {
    if (!value) {
      return null;
    }

    return new Date(`${value}T00:00:00.000Z`);
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
    existingMetadata: Record<string, unknown>;
    parsed: {
      provider: DocumentMetadata["parseProvider"];
      parseStrategy: string;
      pages: Array<{ pageNumber: number }>;
      tables: unknown[];
      keyValues: unknown[];
      chunkHints: unknown[];
      text: string;
      searchablePdfPath?: string;
      warnings: string[];
      providerMetadata: Record<string, unknown>;
    };
    chunks: Array<{ chunkIndex: number }>;
    reviewReasons: ReviewReason[];
    fallbackUsed: boolean;
    fallbackProvider: DocumentMetadata["parseProvider"] | null;
    embeddingConfigured: boolean;
    embeddingProvider: EmbeddingProviderId | null;
    embeddingModel: string | null;
  }): DocumentMetadata {
    const reviewEvidenceRecord =
      input.metadata.metadata.reviewEvidence &&
      typeof input.metadata.metadata.reviewEvidence === "object" &&
      input.metadata.metadata.reviewEvidence !== null
        ? (input.metadata.metadata.reviewEvidence as Record<string, unknown>)
        : {};
    const extractedRecord =
      reviewEvidenceRecord.extracted &&
      typeof reviewEvidenceRecord.extracted === "object" &&
      reviewEvidenceRecord.extracted !== null
        ? (reviewEvidenceRecord.extracted as Record<string, unknown>)
        : {};
    const emptyExtracted = this.documentTypePolicyService.emptyExtracted();
    const reviewEvidence: ReviewEvidence = {
      documentClass:
        reviewEvidenceRecord.documentClass === "invoice" ? "invoice" : "generic",
      requiredFields: Array.isArray(reviewEvidenceRecord.requiredFields)
        ? (reviewEvidenceRecord.requiredFields as ReviewEvidence["requiredFields"])
        : [],
      missingFields: Array.isArray(reviewEvidenceRecord.missingFields)
        ? (reviewEvidenceRecord.missingFields as ReviewEvidence["missingFields"])
        : [],
      extracted: {
        correspondent: Boolean(extractedRecord.correspondent ?? emptyExtracted.correspondent),
        issueDate: Boolean(extractedRecord.issueDate ?? emptyExtracted.issueDate),
        dueDate: Boolean(extractedRecord.dueDate ?? emptyExtracted.dueDate),
        amount: Boolean(extractedRecord.amount ?? emptyExtracted.amount),
        currency: Boolean(extractedRecord.currency ?? emptyExtracted.currency),
        referenceNumber: Boolean(
          extractedRecord.referenceNumber ?? emptyExtracted.referenceNumber,
        ),
        expiryDate: Boolean(extractedRecord.expiryDate ?? emptyExtracted.expiryDate),
        holderName: Boolean(extractedRecord.holderName ?? emptyExtracted.holderName),
        issuingAuthority: Boolean(
          extractedRecord.issuingAuthority ?? emptyExtracted.issuingAuthority,
        ),
      },
      activeReasons: input.reviewReasons,
      confidence: input.metadata.confidence,
      confidenceThreshold: this.configService.get("REVIEW_CONFIDENCE_THRESHOLD"),
      ocrTextLength: input.parsed.text.trim().length,
      ocrEmptyThreshold: this.configService.get("OCR_EMPTY_TEXT_THRESHOLD"),
    };

    return {
      ...input.metadata.metadata,
      ...(this.readManualOverrides(input.existingMetadata).lockedFields.length > 0
        ? { manual: this.readManualOverrides(input.existingMetadata) }
        : {}),
      parseProvider: input.parsed.provider ?? undefined,
      parseStrategy: input.parsed.parseStrategy,
      pageCount: input.parsed.pages.length,
      chunkCount: input.chunks.length,
      normalizationStrategy: input.parsed.parseStrategy,
      searchablePdfGenerated: Boolean(input.parsed.searchablePdfPath),
      parse: {
        provider: input.parsed.provider ?? "local-ocr",
        strategy: input.parsed.parseStrategy,
        fallbackUsed: input.fallbackUsed,
        warnings: input.parsed.warnings,
        keyValueCount: input.parsed.keyValues.length,
        tableCount: input.parsed.tables.length,
        providerMetadata: {
          ...input.parsed.providerMetadata,
          fallbackProvider: input.fallbackProvider,
        },
      },
      chunking: {
        strategy: "normalized-parse-v1",
        chunkCount: input.chunks.length,
        usedProviderHints: input.parsed.chunkHints.length > 0,
      },
      embedding: {
        provider: input.embeddingProvider ?? undefined,
        model: input.embeddingModel ?? undefined,
        configured: input.embeddingConfigured,
        chunkCount: input.chunks.length,
      },
      reviewReasons: input.reviewReasons,
      reviewEvidence,
    };
  }

  private readCorrespondentExtraction(metadata: Record<string, unknown>) {
    const extraction =
      metadata.correspondentExtraction &&
      typeof metadata.correspondentExtraction === "object" &&
      metadata.correspondentExtraction !== null
        ? (metadata.correspondentExtraction as Record<string, unknown>)
        : {};

    return {
      rawName:
        typeof extraction.rawName === "string" && extraction.rawName.trim().length > 0
          ? extraction.rawName.trim()
          : null,
      resolvedName:
        typeof extraction.resolvedName === "string" && extraction.resolvedName.trim().length > 0
          ? extraction.resolvedName.trim()
          : null,
      matchStrategy:
        typeof extraction.matchStrategy === "string" ? extraction.matchStrategy : null,
      confidence:
        typeof extraction.confidence === "number" ? extraction.confidence : null,
      rawNameNormalized:
        typeof extraction.rawNameNormalized === "string" ? extraction.rawNameNormalized : null,
    };
  }
}
