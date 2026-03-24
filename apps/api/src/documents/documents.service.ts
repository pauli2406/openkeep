import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  auditEvents,
  correspondents,
  documentChunkEmbeddings,
  documentChunks,
  documentFiles,
  documentTagLinks,
  documentTextBlocks,
  documentTypes,
  documents,
  processingJobs,
  tags,
  users,
} from "@openkeep/db";
import type {
  AnswerQueryRequest,
  AnswerQueryResponse,
  AuditEvent,
  BatchReprocessDocumentsRequest,
  BatchReprocessDocumentsResponse,
  DeleteDocumentResponse,
  Document,
  DocumentAskResponse,
  DocumentMetadata,
  DocumentSummaryResponse,
  DocumentTextBlock,
  DocumentHistoryResponse,
  EmbeddingProvider,
  EmbeddingStatus,
  ListReviewDocumentsRequest,
  ManualOverrideField,
  ManualOverrides,
  ProcessingJobSummary,
  ReindexEmbeddingsRequest,
  ResolveReviewRequest,
  RequeueDocumentProcessingRequest,
  ReviewReason,
  SemanticMatchedChunk,
  SemanticSearchRequest,
  SemanticSearchResponse,
  SearchDocumentsRequest,
  SearchDocumentsResponse,
  UpdateDocumentInput,
  UploadDocumentMetadata,
} from "@openkeep/types";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { createHash } from "crypto";
import { lookup as lookupMimeType } from "mime-types";
import type { Readable } from "stream";

import { type AuthenticatedPrincipal } from "../auth/auth.types";
import { DatabaseService } from "../common/db/database.service";
import { MetricsService } from "../common/metrics/metrics.service";
import { ObjectStorageService } from "../common/storage/storage.service";
import { CorrespondentIntelligenceService } from "../explorer/correspondent-intelligence.service";
import { padEmbedding, serializeHalfVector } from "../processing/embedding.util";
import { LlmAnswerProvider } from "../processing/llm-answer.provider";
import { LlmService } from "../processing/llm.service";
import { dateToIso, normalizeCurrencyCode, parseDateOnly } from "../processing/normalization.util";
import { ProcessingService } from "../processing/processing.service";
import { rankHybridResults } from "../search/semantic-ranking.util";

interface UploadDocumentInput {
  principal: AuthenticatedPrincipal;
  buffer: Buffer;
  filename: string;
  mimeType?: string;
  metadata?: Partial<UploadDocumentMetadata>;
}

interface DocumentRow {
  id: string;
  title: string;
  source: Document["source"];
  mimeType: string;
  status: Document["status"];
  language: string | null;
  issueDate: Date | null;
  dueDate: Date | null;
  taskCompletedAt: Date | null;
  expiryDate: Date | null;
  amount: string | number | null;
  currency: string | null;
  referenceNumber: string | null;
  holderName: string | null;
  issuingAuthority: string | null;
  confidence: string | number | null;
  reviewStatus: Document["reviewStatus"];
  reviewReasons: ReviewReason[];
  reviewedAt: Date | null;
  reviewNote: string | null;
  searchablePdfStorageKey: string | null;
  parseProvider: Document["parseProvider"];
  chunkCount: number;
  embeddingStatus: EmbeddingStatus;
  embeddingProvider: EmbeddingProvider | null;
  embeddingModel: string | null;
  lastProcessingError: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  processedAt: Date | null;
  checksum: string;
  storageKey: string;
  correspondentId: string | null;
  correspondentName: string | null;
  correspondentSlug: string | null;
  documentTypeId: string | null;
  documentTypeName: string | null;
  documentTypeSlug: string | null;
  documentTypeDescription: string | null;
  documentTypeRequiredFields: Document["documentType"] extends infer T
    ? T extends { requiredFields: infer Fields }
      ? Fields | null
      : null
    : null;
}

const MANUAL_OVERRIDE_FIELDS: ManualOverrideField[] = [
  "issueDate",
  "dueDate",
  "expiryDate",
  "amount",
  "currency",
  "referenceNumber",
  "holderName",
  "issuingAuthority",
  "correspondentId",
  "documentTypeId",
  "tagIds",
];

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(ObjectStorageService) private readonly storageService: ObjectStorageService,
    @Inject(forwardRef(() => ProcessingService))
    private readonly processingService: ProcessingService,
    @Inject(MetricsService) private readonly metricsService: MetricsService,
    @Inject(forwardRef(() => CorrespondentIntelligenceService))
    private readonly correspondentIntelligenceService: CorrespondentIntelligenceService,
    @Inject(LlmService) private readonly llmService: LlmService,
    @Inject(LlmAnswerProvider) private readonly llmAnswerProvider: LlmAnswerProvider,
  ) {}

  async uploadDocument(input: UploadDocumentInput): Promise<Document> {
    if (input.buffer.length === 0) {
      throw new BadRequestException("Uploaded file is empty");
    }

    const checksum = this.computeChecksum(input.buffer);
    const mimeType =
      input.mimeType ||
      lookupMimeType(input.filename) ||
      "application/octet-stream";
    const title = input.metadata?.title?.trim() || input.filename;
    const source = input.metadata?.source ?? "upload";

    const existingFile = await this.findFileByChecksum(checksum);
    const fileRecord =
      existingFile ??
      (
        await this.databaseService.db
          .insert(documentFiles)
          .values({
            checksum,
            storageKey: `documents/${checksum}`,
            originalFilename: input.filename,
            mimeType,
            sizeBytes: input.buffer.length,
          })
          .returning()
      )[0];

    if (!existingFile) {
      await this.storageService.uploadBuffer(fileRecord.storageKey, input.buffer, mimeType);
    }

    const [document] = await this.databaseService.db
      .insert(documents)
      .values({
        ownerUserId: input.principal.userId,
        fileId: fileRecord.id,
        title,
        source,
        mimeType,
      })
      .returning();

    this.metricsService.incrementUploadsTotal();
    await this.recordAuditEvent({
      actorUserId: input.principal.userId,
      documentId: document.id,
      eventType: "document.uploaded",
      payload: {
        source,
        filename: input.filename,
        mimeType,
        checksum,
      },
    });
    await this.processingService.enqueueDocumentProcessing(document.id, false);
    return this.getDocument(document.id);
  }

  async listDocuments(request: SearchDocumentsRequest): Promise<SearchDocumentsResponse> {
    const filters = request.filters ?? {};
    const sort = request.sort ?? "createdAt";
    const direction = request.direction === "asc" ? "asc" : "desc";
    const page = request.page ?? 1;
    const pageSize = request.pageSize ?? 20;
    const { whereSql, params } = this.buildDocumentFilterQuery(filters);
    const hasTextQuery = Boolean(request.query?.trim());

    const langRegconfig = `CASE d.language WHEN 'de' THEN 'german'::regconfig WHEN 'en' THEN 'english'::regconfig ELSE 'simple'::regconfig END`;

    let snippetSql = "NULL::text AS snippet";
    let rankSql = "0::float AS rank";
    if (hasTextQuery) {
      params.push(request.query!.trim());
      const placeholder = `$${params.length}`;
      snippetSql = `ts_headline(${langRegconfig}, coalesce(d.full_text, ''), websearch_to_tsquery('simple', ${placeholder}), 'MaxFragments=2, MaxWords=18, MinWords=5') AS snippet`;
      rankSql = `ts_rank_cd(to_tsvector(${langRegconfig}, coalesce(d.full_text, '')), websearch_to_tsquery('simple', ${placeholder})) AS rank`;
    }

    const baseWhere = hasTextQuery
      ? `${whereSql} AND to_tsvector('simple', coalesce(d.full_text, '')) @@ websearch_to_tsquery('simple', $${params.length})`
      : whereSql;

    const normalizedFilters = {
      ...filters,
      correspondentIds:
        filters.correspondentIds && filters.correspondentIds.length > 0
          ? filters.correspondentIds
          : filters.correspondentId
            ? [filters.correspondentId]
            : undefined,
      documentTypeIds:
        filters.documentTypeIds && filters.documentTypeIds.length > 0
          ? filters.documentTypeIds
          : filters.documentTypeId
            ? [filters.documentTypeId]
            : undefined,
      statuses:
        filters.statuses && filters.statuses.length > 0
          ? filters.statuses
          : filters.status
            ? [filters.status]
            : undefined,
    };

    if (normalizedFilters.correspondentIds?.length === 0) {
      delete normalizedFilters.correspondentIds;
    }
    if (normalizedFilters.documentTypeIds?.length === 0) {
      delete normalizedFilters.documentTypeIds;
    }
    if (normalizedFilters.statuses?.length === 0) {
      delete normalizedFilters.statuses;
    }

    if (
      normalizedFilters.correspondentIds &&
      normalizedFilters.correspondentIds.length === 1 &&
      !filters.correspondentId
    ) {
      normalizedFilters.correspondentId = normalizedFilters.correspondentIds[0];
    }
    if (
      normalizedFilters.documentTypeIds &&
      normalizedFilters.documentTypeIds.length === 1 &&
      !filters.documentTypeId
    ) {
      normalizedFilters.documentTypeId = normalizedFilters.documentTypeIds[0];
    }
    if (
      normalizedFilters.statuses &&
      normalizedFilters.statuses.length === 1 &&
      !filters.status
    ) {
      normalizedFilters.status = normalizedFilters.statuses[0];
    }

    const orderColumns = {
      createdAt: "d.created_at",
      issueDate: "d.issue_date",
      dueDate: "d.due_date",
      title: "d.title",
    } as const;
    const orderColumn = orderColumns[sort];

    // Default to relevance sorting when a text query is present and no explicit sort was requested
    const useRelevanceSort = hasTextQuery && !request.sort;
    const orderBySql = useRelevanceSort
      ? `rank DESC, d.id DESC`
      : `${orderColumn} ${direction}, d.id DESC`;

    const totalResult = await this.databaseService.pool.query<{ total: string }>(
      `SELECT count(*)::int AS total FROM documents d WHERE ${baseWhere}`,
      params,
    );

    const listResult = await this.databaseService.pool.query<{
      id: string;
      snippet: string | null;
    }>(
      `SELECT d.id, ${snippetSql}, ${rankSql}
       FROM documents d
       WHERE ${baseWhere}
       ORDER BY ${orderBySql}
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize],
    );

    const documentsById = await this.getDocumentsByIds(
      listResult.rows.map((row) => row.id),
      request.query,
    );
    const snippetMap = new Map(
      listResult.rows
        .filter((row) => row.snippet)
        .map((row) => [row.id, [row.snippet as string]]),
    );

    return {
      items: documentsById.map((document) => ({
        ...document,
        snippets: snippetMap.get(document.id) ?? document.snippets,
      })),
      total: Number(totalResult.rows[0]?.total ?? 0),
      page,
      pageSize,
      appliedFilters: normalizedFilters,
    };
  }

  async listReviewDocuments(
    request: ListReviewDocumentsRequest,
  ): Promise<SearchDocumentsResponse> {
    const page = request.page ?? 1;
    const pageSize = request.pageSize ?? 20;
    const params: unknown[] = ["pending"];
    const clauses: string[] = ["d.review_status = $1"];

    if (request.processingStatus) {
      params.push(request.processingStatus);
      clauses.push(`d.status = $${params.length}`);
    }

    if (request.reason) {
      params.push(request.reason);
      clauses.push(`d.review_reasons ? $${params.length}`);
    }

    const totalResult = await this.databaseService.pool.query<{ total: string }>(
      `SELECT count(*)::int AS total
       FROM documents d
       WHERE ${clauses.join(" AND ")}`,
      params,
    );

    const listResult = await this.databaseService.pool.query<{ id: string }>(
      `SELECT d.id
       FROM documents d
       WHERE ${clauses.join(" AND ")}
       ORDER BY d.updated_at DESC, d.id DESC
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize],
    );

    return {
      items: await this.getDocumentsByIds(listResult.rows.map((row) => row.id)),
      total: Number(totalResult.rows[0]?.total ?? 0),
      page,
      pageSize,
      appliedFilters: {
        status: request.processingStatus,
      },
    };
  }

  async getBrowseFacets() {
    const [years, correspondentFacets, typeFacets, tagFacets, amountRange, statusFacets] =
      await Promise.all([
      this.databaseService.pool.query<{
        year: string;
        count: string;
      }>(
        `SELECT extract(year from coalesce(issue_date, created_at::date))::int AS year,
                count(*)::int AS count
         FROM documents
         GROUP BY year
         ORDER BY year DESC`,
      ),
      this.databaseService.pool.query<{
        id: string;
        name: string;
        slug: string;
        count: string;
      }>(
        `SELECT c.id, c.name, c.slug, count(*)::int AS count
         FROM documents d
         INNER JOIN correspondents c ON c.id = d.correspondent_id
         GROUP BY c.id
         ORDER BY count DESC, c.name ASC`,
      ),
      this.databaseService.pool.query<{
        id: string;
        name: string;
        slug: string;
        count: string;
      }>(
        `SELECT dt.id, dt.name, dt.slug, count(*)::int AS count
         FROM documents d
         INNER JOIN document_types dt ON dt.id = d.document_type_id
         GROUP BY dt.id
         ORDER BY count DESC, dt.name ASC`,
      ),
      this.databaseService.pool.query<{
        id: string;
        name: string;
        slug: string;
        count: string;
      }>(
        `SELECT t.id, t.name, t.slug, count(*)::int AS count
         FROM document_tag_links dtl
         INNER JOIN tags t ON t.id = dtl.tag_id
         GROUP BY t.id
         ORDER BY count DESC, t.name ASC`,
      ),
      this.databaseService.pool.query<{
        min_amount: string | null;
        max_amount: string | null;
      }>(
        `SELECT min(amount)::text AS min_amount,
                max(amount)::text AS max_amount
         FROM documents
         WHERE amount IS NOT NULL`,
      ),
      this.databaseService.pool.query<{
        status: string;
        count: string;
      }>(
        `SELECT status::text AS status, count(*)::int AS count
         FROM documents
         GROUP BY status
         ORDER BY status ASC`,
      ),
    ]);

    return {
      years: years.rows.map((row) => ({
        year: Number(row.year),
        count: Number(row.count),
      })),
      correspondents: correspondentFacets.rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        count: Number(row.count),
      })),
      documentTypes: typeFacets.rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        count: Number(row.count),
      })),
      tags: tagFacets.rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        count: Number(row.count),
      })),
      amountRange: {
        min:
          amountRange.rows[0]?.min_amount === null
            ? null
            : Number(amountRange.rows[0]?.min_amount ?? 0),
        max:
          amountRange.rows[0]?.max_amount === null
            ? null
            : Number(amountRange.rows[0]?.max_amount ?? 0),
      },
      statuses: statusFacets.rows.map((row) => ({
        status: row.status,
        count: Number(row.count),
      })),
    };
  }

  async getDocument(documentId: string): Promise<Document> {
    const docs = await this.getDocumentsByIds([documentId]);
    const document = docs[0];

    if (!document) {
      throw new NotFoundException("Document not found");
    }

    return document;
  }

  async getDocumentText(documentId: string): Promise<{
    documentId: string;
    blocks: DocumentTextBlock[];
  }> {
    await this.getDocument(documentId);
    const blocks = await this.databaseService.db
      .select({
        documentId: documentTextBlocks.documentId,
        page: documentTextBlocks.pageNumber,
        lineIndex: documentTextBlocks.lineIndex,
        boundingBox: documentTextBlocks.boundingBox,
        text: documentTextBlocks.text,
      })
      .from(documentTextBlocks)
      .where(eq(documentTextBlocks.documentId, documentId))
      .orderBy(documentTextBlocks.pageNumber, documentTextBlocks.lineIndex);

    return { documentId, blocks };
  }

  async downloadDocument(documentId: string): Promise<{
    filename: string;
    mimeType: string;
    stream: Readable;
  }> {
    const [row] = await this.databaseService.db
      .select({
        storageKey: documentFiles.storageKey,
        originalFilename: documentFiles.originalFilename,
        mimeType: documentFiles.mimeType,
      })
      .from(documents)
      .innerJoin(documentFiles, eq(documents.fileId, documentFiles.id))
      .where(eq(documents.id, documentId))
      .limit(1);

    if (!row) {
      throw new NotFoundException("Document not found");
    }

    const stream = await this.storageService.getObjectStream(row.storageKey);
    if (!stream) {
      throw new NotFoundException("Document file missing from storage");
    }

    return {
      filename: row.originalFilename,
      mimeType: row.mimeType,
      stream: stream as unknown as Readable,
    };
  }

  async downloadSearchableDocument(documentId: string): Promise<{
    filename: string;
    mimeType: string;
    stream: Readable;
  }> {
    const [row] = await this.databaseService.db
      .select({
        searchablePdfStorageKey: documents.searchablePdfStorageKey,
        originalFilename: documentFiles.originalFilename,
      })
      .from(documents)
      .innerJoin(documentFiles, eq(documents.fileId, documentFiles.id))
      .where(eq(documents.id, documentId))
      .limit(1);

    if (!row) {
      throw new NotFoundException("Document not found");
    }

    if (!row.searchablePdfStorageKey) {
      throw new NotFoundException("Searchable PDF not available");
    }

    const stream = await this.storageService.getObjectStream(row.searchablePdfStorageKey);
    if (!stream) {
      throw new NotFoundException("Searchable PDF missing from storage");
    }

    return {
      filename: this.toSearchablePdfFilename(row.originalFilename),
      mimeType: "application/pdf",
      stream: stream as unknown as Readable,
    };
  }

  async updateDocument(
    documentId: string,
    input: UpdateDocumentInput,
    principal: AuthenticatedPrincipal,
  ): Promise<Document> {
    const existing = await this.getDocument(documentId);
    const previousCorrespondentId = existing.correspondent?.id ?? null;
    const manualOverrides = this.buildManualOverrides(existing, input, principal.userId);

    await this.databaseService.db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({
          title: input.title,
          dueDate:
            input.dueDate === undefined
              ? undefined
              : input.dueDate === null
                ? null
                : parseDateOnly(input.dueDate),
          taskCompletedAt:
            input.taskCompletedAt === undefined
              ? undefined
              : input.taskCompletedAt === null
                ? null
                : new Date(input.taskCompletedAt),
          expiryDate:
            input.expiryDate === undefined
              ? undefined
              : input.expiryDate === null
                ? null
                : parseDateOnly(input.expiryDate),
          issueDate:
            input.issueDate === undefined
              ? undefined
              : input.issueDate === null
                ? null
                : parseDateOnly(input.issueDate),
          amount:
            typeof input.amount === "number"
              ? input.amount.toFixed(2)
              : input.amount === null
                ? null
                : undefined,
          currency:
            input.currency === undefined
              ? undefined
              : input.currency === null
                ? null
                : normalizeCurrencyCode(input.currency),
          referenceNumber: input.referenceNumber ?? undefined,
          holderName: input.holderName ?? undefined,
          issuingAuthority: input.issuingAuthority ?? undefined,
          correspondentId:
            input.correspondentId === null ? null : input.correspondentId ?? undefined,
          documentTypeId:
            input.documentTypeId === null ? null : input.documentTypeId ?? undefined,
          status: input.status,
          metadata: this.withManualMetadata(existing.metadata, manualOverrides),
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId));

      if (input.tagIds) {
        await tx.delete(documentTagLinks).where(eq(documentTagLinks.documentId, documentId));
        if (input.tagIds.length > 0) {
          await tx.insert(documentTagLinks).values(
            input.tagIds.map((tagId) => ({
              documentId,
              tagId,
            })),
          );
        }
      }
    });

    await this.recordAuditEvent({
      actorUserId: principal.userId,
      documentId,
      eventType: "document.metadata_updated",
      payload: {
        changedFields: Object.keys(input).filter((key) => key !== "clearLockedFields"),
        clearLockedFields: input.clearLockedFields ?? [],
      },
    });

    const updated = await this.getDocument(documentId);

    if (typeof input.correspondentId === "string") {
      await this.processingService.persistManualCorrespondentAlias({
        documentId,
        correspondentId: input.correspondentId,
        canonicalName: updated.correspondent?.name ?? null,
        metadata: updated.metadata,
      });
    }

    const currentCorrespondentId = updated.correspondent?.id ?? null;
    if (previousCorrespondentId && previousCorrespondentId !== currentCorrespondentId) {
      await this.correspondentIntelligenceService.enqueueRefresh(previousCorrespondentId);
    }
    if (currentCorrespondentId) {
      await this.correspondentIntelligenceService.enqueueRefresh(currentCorrespondentId);
    }

    return updated;
  }

  async deleteDocument(
    documentId: string,
    principal: AuthenticatedPrincipal,
  ): Promise<DeleteDocumentResponse> {
    const [target] = await this.databaseService.db
      .select({
        id: documents.id,
        title: documents.title,
        status: documents.status,
        fileId: documents.fileId,
        storageKey: documentFiles.storageKey,
        searchablePdfStorageKey: documents.searchablePdfStorageKey,
      })
      .from(documents)
      .innerJoin(documentFiles, eq(documents.fileId, documentFiles.id))
      .where(eq(documents.id, documentId))
      .limit(1);

    if (!target) {
      throw new NotFoundException("Document not found");
    }

    if (target.status === "processing") {
      throw new BadRequestException("Document is currently processing and cannot be deleted");
    }

    let deleteOriginalFile = false;

    await this.databaseService.db.transaction(async (tx) => {
      await tx.delete(documents).where(eq(documents.id, documentId));

      const [{ count }] = await tx
        .select({
          count: sql<number>`count(*)::int`,
        })
        .from(documents)
        .where(eq(documents.fileId, target.fileId));

      if (count === 0) {
        await tx.delete(documentFiles).where(eq(documentFiles.id, target.fileId));
        deleteOriginalFile = true;
      }
    });

    if (target.searchablePdfStorageKey) {
      await this.storageService.deleteObject(target.searchablePdfStorageKey).catch(() => undefined);
    }

    if (deleteOriginalFile) {
      await this.storageService.deleteObject(target.storageKey).catch(() => undefined);
    }

    await this.recordAuditEvent({
      actorUserId: principal.userId,
      eventType: "document.deleted",
      payload: {
        documentId,
        title: target.title,
        deletedOriginalFile: deleteOriginalFile,
        deletedSearchablePdf: Boolean(target.searchablePdfStorageKey),
      },
    });

    return { deleted: true };
  }

  async resolveReview(
    documentId: string,
    input: ResolveReviewRequest,
    principal: AuthenticatedPrincipal,
  ): Promise<Document> {
    await this.getDocument(documentId);
    await this.databaseService.db
      .update(documents)
      .set({
        reviewStatus: "resolved",
        reviewNote: input.reviewNote ?? null,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    await this.recordAuditEvent({
      actorUserId: principal.userId,
      documentId,
      eventType: "document.review_resolved",
      payload: {
        reviewNote: input.reviewNote ?? null,
      },
    });

    return this.getDocument(documentId);
  }

  async requeueReview(
    documentId: string,
    input: RequeueDocumentProcessingRequest,
    principal: AuthenticatedPrincipal,
  ): Promise<{ queued: true; documentId: string; processingJobId: string }> {
    const document = await this.getDocument(documentId);
    if (document.status === "processing") {
      throw new BadRequestException("Document is already processing");
    }

    await this.databaseService.db
      .update(documents)
      .set({
        reviewStatus: "not_required",
        reviewReasons: [],
        reviewedAt: null,
        reviewNote: null,
        lastProcessingError: null,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    const queued = await this.processingService.enqueueDocumentProcessing(documentId, input.force);
    await this.recordAuditEvent({
      actorUserId: principal.userId,
      documentId,
      eventType: "document.review_requeued",
      payload: {
        force: input.force,
        processingJobId: queued.processingJobId,
      },
    });

    return queued;
  }

  async reprocessDocument(
    documentId: string,
    principal: AuthenticatedPrincipal,
    parseProvider?: string,
  ) {
    const document = await this.getDocument(documentId);
    if (document.status === "processing") {
      throw new BadRequestException("Document is already processing");
    }

    const queued = await this.processingService.enqueueDocumentProcessing(
      documentId,
      true,
      parseProvider,
    );
    await this.recordAuditEvent({
      actorUserId: principal.userId,
      documentId,
      eventType: "document.reprocess_requested",
      payload: {
        parseProvider: parseProvider ?? null,
        processingJobId: queued.processingJobId,
      },
    });

    return queued;
  }

  async batchReprocessDocuments(
    input: BatchReprocessDocumentsRequest,
    principal: AuthenticatedPrincipal,
  ): Promise<BatchReprocessDocumentsResponse> {
    const targetDocumentIds = await this.resolveBatchReprocessDocumentIds(input);
    const queuedDocumentIds: string[] = [];
    const skippedDocumentIds: string[] = [];

    if (targetDocumentIds.length === 0) {
      return {
        queued: true,
        queuedCount: 0,
        skippedCount: 0,
        queuedDocumentIds,
        skippedDocumentIds,
      };
    }

    const rows = await this.databaseService.db
      .select({
        id: documents.id,
        status: documents.status,
      })
      .from(documents)
      .where(inArray(documents.id, targetDocumentIds));

    const statusById = new Map(rows.map((row) => [row.id, row.status]));

    for (const documentId of targetDocumentIds) {
      if (statusById.get(documentId) === "processing") {
        skippedDocumentIds.push(documentId);
        continue;
      }

      const queued = await this.processingService.enqueueDocumentProcessing(
        documentId,
        true,
        input.parseProvider,
      );

      queuedDocumentIds.push(documentId);
      await this.recordAuditEvent({
        actorUserId: principal.userId,
        documentId,
        eventType: "document.reprocess_requested",
        payload: {
          parseProvider: input.parseProvider ?? null,
          processingJobId: queued.processingJobId,
          bulk: true,
        },
      });
    }

    await this.recordAuditEvent({
      actorUserId: principal.userId,
      eventType: "document.bulk_reprocess_requested",
      payload: {
        scope: input.scope,
        parseProvider: input.parseProvider ?? null,
        requestedCount: targetDocumentIds.length,
        queuedCount: queuedDocumentIds.length,
        skippedCount: skippedDocumentIds.length,
      },
    });

    return {
      queued: true,
      queuedCount: queuedDocumentIds.length,
      skippedCount: skippedDocumentIds.length,
      queuedDocumentIds,
      skippedDocumentIds,
    };
  }

  async reembedDocument(documentId: string, principal: AuthenticatedPrincipal) {
    if (!this.processingService.isSemanticIndexingConfigured()) {
      throw new ConflictException("Semantic indexing is not configured");
    }

    const document = await this.getDocument(documentId);
    if (document.status !== "ready") {
      throw new BadRequestException("Only ready documents can be embedded");
    }

    const queued = await this.processingService.enqueueDocumentEmbedding(documentId, true);
    if (!queued) {
      throw new BadRequestException("Document has no chunks to embed");
    }

    await this.recordAuditEvent({
      actorUserId: principal.userId,
      documentId,
      eventType: "document.reembed_requested",
      payload: {
        embeddingJobId: queued.embeddingJobId,
      },
    });

    return queued;
  }

  async reindexEmbeddings(request: ReindexEmbeddingsRequest) {
    if (!this.processingService.isSemanticIndexingConfigured()) {
      throw new ConflictException("Semantic indexing is not configured");
    }

    const candidateIds = request.documentIds?.length
      ? request.documentIds
      : await this.listDocumentIdsByFilters(request.filters);
    const targetIds =
      request.scope === "all"
        ? candidateIds
        : await this.filterStaleDocumentIds(candidateIds);

    let queued = 0;
    let skipped = 0;
    const embeddingJobIds: string[] = [];

    for (const documentId of targetIds) {
      const result = await this.processingService.enqueueDocumentEmbedding(documentId, true);
      if (result) {
        queued += 1;
        embeddingJobIds.push(result.embeddingJobId);
      } else {
        skipped += 1;
      }
    }

    return {
      queued,
      skipped,
      totalCandidates: candidateIds.length,
      totalTargets: targetIds.length,
      scope: request.scope ?? "stale",
      embeddingJobIds,
    };
  }

  async semanticSearch(request: SemanticSearchRequest): Promise<SemanticSearchResponse> {
    if (!this.processingService.isSemanticIndexingConfigured()) {
      throw new ConflictException("Semantic indexing is not configured");
    }

    const { provider, model } = this.processingService.getActiveEmbeddingConfiguration();
    if (!provider || !model) {
      throw new ConflictException("Semantic indexing is not configured");
    }

    const queryText = request.query.trim();
    const page = request.page ?? 1;
    const pageSize = request.pageSize ?? 20;
    const maxChunkMatches = request.maxChunkMatches ?? 3;
    const filters = request.filters ?? {};
    const startedAt = Date.now();
    const semanticEmbedding = await this.processingService.embedQuery(queryText);
    const embeddingLiteral = serializeHalfVector(padEmbedding(semanticEmbedding.embeddings[0]!));
    const { whereSql, params } = this.buildDocumentFilterQuery(filters);

    const keywordRows = await this.databaseService.pool.query<{
      id: string;
      rank: string;
    }>(
      `SELECT d.id, ts_rank_cd(
          to_tsvector(CASE d.language WHEN 'de' THEN 'german'::regconfig WHEN 'en' THEN 'english'::regconfig ELSE 'simple'::regconfig END, coalesce(d.full_text, '')),
          websearch_to_tsquery('simple', $${params.length + 1})
       ) AS rank
       FROM documents d
       WHERE ${whereSql}
         AND to_tsvector('simple', coalesce(d.full_text, '')) @@ websearch_to_tsquery('simple', $${params.length + 1})
       ORDER BY rank DESC, d.id DESC`,
      [...params, queryText],
    );

    const semanticRows = await this.databaseService.pool.query<{
      id: string;
      distance: string;
    }>(
      `SELECT d.id, MIN(e.embedding <=> $${params.length + 1}::halfvec)::text AS distance
       FROM documents d
       INNER JOIN document_chunk_embeddings e
         ON e.document_id = d.id
        AND e.provider = $${params.length + 2}::embedding_provider
        AND e.model = $${params.length + 3}
       WHERE ${whereSql}
       GROUP BY d.id
       ORDER BY MIN(e.embedding <=> $${params.length + 1}::halfvec) ASC, d.id DESC`,
      [...params, embeddingLiteral, provider, model],
    );

    const keywordRankMap = new Map<string, number>();
    const keywordScoreMap = new Map<string, number>();
    keywordRows.rows.forEach((row, index) => {
      keywordRankMap.set(row.id, index + 1);
      keywordScoreMap.set(row.id, Number(row.rank));
    });

    const semanticRankMap = new Map<string, number>();
    const semanticScoreMap = new Map<string, number>();
    semanticRows.rows.forEach((row, index) => {
      semanticRankMap.set(row.id, index + 1);
      semanticScoreMap.set(row.id, 1 - Number(row.distance));
    });

    const candidateIds = [...new Set([...keywordRankMap.keys(), ...semanticRankMap.keys()])];
    const combined = rankHybridResults(
      candidateIds.map((id) => ({
        id,
        keywordRank: keywordRankMap.get(id),
        semanticRank: semanticRankMap.get(id),
        semanticScore: semanticScoreMap.get(id) ?? null,
        keywordScore: keywordScoreMap.get(id) ?? null,
      })),
    );

    const total = combined.length;
    const paged = combined.slice((page - 1) * pageSize, page * pageSize);
    const documentsById = await this.getDocumentsByIds(
      paged.map((item) => item.id),
      queryText,
    );
    const documentMap = new Map(documentsById.map((document) => [document.id, document]));
    const matchedChunksByDocument = await this.loadSemanticMatchedChunks(
      paged.map((item) => item.id),
      provider,
      model,
      embeddingLiteral,
      maxChunkMatches,
    );

    this.metricsService.incrementSemanticQueriesTotal();
    this.metricsService.observeSemanticQueryDuration((Date.now() - startedAt) / 1000);

    return {
      items: paged
        .map((item) => {
          const document = documentMap.get(item.id);
          if (!document) {
            return null;
          }

          return {
            document,
            score: item.score,
            semanticScore: item.semanticScore,
            keywordScore: item.keywordScore,
            matchedChunks: matchedChunksByDocument.get(item.id) ?? [],
          };
        })
        .filter(Boolean) as SemanticSearchResponse["items"],
      total,
      page,
      pageSize,
      appliedFilters: filters,
    };
  }

  async answerQuery(request: AnswerQueryRequest): Promise<AnswerQueryResponse> {
    const results = await this.semanticSearch({
      query: request.query,
      filters: request.filters,
      page: 1,
      pageSize: request.maxDocuments,
      maxChunkMatches: request.maxChunkMatches,
    });

    const answered = await this.processingService.answerQuestion({
      question: request.query,
      results: results.items,
      maxCitations: request.maxCitations,
    });

    return {
      ...answered,
      results: results.items,
    };
  }

  // ---------------------------------------------------------------------------
  // Streaming answer (for unified search)
  // ---------------------------------------------------------------------------

  async *streamAnswer(request: AnswerQueryRequest): AsyncGenerator<string> {
    const results = await this.semanticSearch({
      query: request.query,
      filters: request.filters,
      page: 1,
      pageSize: request.maxDocuments,
      maxChunkMatches: request.maxChunkMatches,
    });

    // Send search results first
    yield `event: search-results\ndata: ${JSON.stringify({ results: results.items })}\n\n`;

    // Stream the LLM answer
    const stream = this.llmAnswerProvider.streamAnswer({
      question: request.query,
      results: results.items,
      maxCitations: request.maxCitations,
    });

    let fullAnswer = "";
    let citations: unknown[] = [];

    for await (const chunk of stream) {
      if (chunk.done) {
        if (chunk.citations) {
          citations = chunk.citations;
        }

        break;
      }

      fullAnswer += chunk.text;
      yield `event: answer-token\ndata: ${JSON.stringify({ text: chunk.text })}\n\n`;
    }

    yield `event: done\ndata: ${JSON.stringify({
      status: fullAnswer.length > 0 ? "answered" : "insufficient_evidence",
      fullAnswer: fullAnswer || null,
      citations,
    })}\n\n`;
  }

  // ---------------------------------------------------------------------------
  // Per-document AI: Summary
  // ---------------------------------------------------------------------------

  async *streamDocumentSummary(documentId: string, force = false): AsyncGenerator<string> {
    const document = await this.getDocument(documentId);

    // Check for cached summary (skip if force-regenerating)
    if (!force) {
      const metadata = document.metadata as Record<string, unknown>;
      if (metadata.summary && typeof metadata.summary === "string") {
        yield `event: cached\ndata: ${JSON.stringify({
          summary: metadata.summary,
          provider: metadata.summaryProvider ?? "unknown",
          model: metadata.summaryModel ?? "unknown",
          generatedAt: metadata.summaryGeneratedAt ?? new Date().toISOString(),
        })}\n\n`;
        return;
      }
    }

    if (!this.llmService.isConfigured()) {
      yield `event: error\ndata: ${JSON.stringify({ message: "No LLM provider configured" })}\n\n`;
      return;
    }

    // Load document text
    const fullText = await this.getDocumentFullText(documentId);
    if (!fullText || fullText.trim().length < 20) {
      yield `event: error\ndata: ${JSON.stringify({ message: "Document has insufficient text for summarization" })}\n\n`;
      return;
    }

    // Truncate to fit context (approx 12k chars for safety)
    const truncatedText = fullText.slice(0, 12_000);
    const providerInfo = this.llmService.getProviderInfo()!;

    const docContext = [
      document.title ? `Title: ${document.title}` : null,
      document.correspondent?.name ? `Correspondent: ${document.correspondent.name}` : null,
      document.documentType?.name ? `Type: ${document.documentType.name}` : null,
      document.issueDate ? `Issue Date: ${document.issueDate}` : null,
      document.language ? `Language: ${document.language}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    const stream = this.llmService.stream({
      messages: [
        {
          role: "system",
          content: [
            "You are a document summarization assistant. Produce a concise, high-level summary.",
            "",
            "Rules:",
            "- Start with 1-2 sentences describing what the document is and its main purpose.",
            "- Then use a short bullet list (5-10 bullets max) for the most important facts: key dates, monetary amounts, parties involved, obligations, and deadlines.",
            "- Do NOT list every single field or data point from the document. Focus on what matters most.",
            "- Use markdown formatting: **bold** for emphasis, `code` for reference numbers/IDs.",
            "- Keep the total summary under 200 words.",
            "- Answer in the same language as the document content.",
            "- Do NOT invent information not present in the document.",
          ].join("\n"),
        },
        {
          role: "user",
          content: `${docContext ? `[${docContext}]\n\n` : ""}${truncatedText}`,
        },
      ],
      temperature: 0.1,
      maxTokens: 800,
    });

    let fullSummary = "";

    for await (const chunk of stream) {
      if (chunk.done) {
        break;
      }

      fullSummary += chunk.text;
      yield `event: summary-token\ndata: ${JSON.stringify({ text: chunk.text })}\n\n`;
    }

    // If the LLM returned nothing (e.g. API error, empty response), surface it
    if (fullSummary.trim().length === 0) {
      yield `event: error\ndata: ${JSON.stringify({ message: "LLM returned an empty summary. Check your API key and provider configuration." })}\n\n`;
      return;
    }

    // Persist summary to metadata
    if (fullSummary.trim().length > 0) {
      const now = new Date().toISOString();
      await this.databaseService.pool.query(
        `UPDATE documents SET metadata = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                coalesce(metadata, '{}'::jsonb),
                '{summary}', $2::jsonb
              ),
              '{summaryProvider}', $3::jsonb
            ),
            '{summaryModel}', $4::jsonb
          ),
          '{summaryGeneratedAt}', $5::jsonb
        ) WHERE id = $1`,
        [
          documentId,
          JSON.stringify(fullSummary.trim()),
          JSON.stringify(providerInfo.provider),
          JSON.stringify(providerInfo.model),
          JSON.stringify(now),
        ],
      );
    }

    yield `event: done\ndata: ${JSON.stringify({
      summary: fullSummary.trim(),
      provider: providerInfo.provider,
      model: providerInfo.model,
      generatedAt: new Date().toISOString(),
    })}\n\n`;
  }

  // ---------------------------------------------------------------------------
  // Per-document AI: Q&A
  // ---------------------------------------------------------------------------

  async *streamDocumentAnswer(documentId: string, question: string): AsyncGenerator<string> {
    const document = await this.getDocument(documentId);

    if (!this.llmService.isConfigured()) {
      yield `event: error\ndata: ${JSON.stringify({ message: "No LLM provider configured" })}\n\n`;
      return;
    }

    // Try vector-based chunk retrieval first
    let contextChunks: Array<{ text: string; heading: string | null; pageFrom: number | null; pageTo: number | null; score: number }> = [];

    if (
      this.processingService.isSemanticIndexingConfigured() &&
      document.embeddingStatus === "ready"
    ) {
      const { provider, model } = this.processingService.getActiveEmbeddingConfiguration();
      if (provider && model) {
        const queryEmbedding = await this.processingService.embedQuery(question);
        const embeddingLiteral = serializeHalfVector(padEmbedding(queryEmbedding.embeddings[0]!));

        const result = await this.databaseService.pool.query<{
          chunk_index: number;
          heading: string | null;
          text: string;
          page_from: number | null;
          page_to: number | null;
          distance: string;
        }>(
          `SELECT dc.chunk_index, dc.heading, dc.text, dc.page_from, dc.page_to,
                  (e.embedding <=> $1::halfvec)::float8 AS distance
           FROM document_chunks dc
           INNER JOIN document_chunk_embeddings e
             ON e.document_id = dc.document_id
            AND e.chunk_index = dc.chunk_index
            AND e.provider = $3::embedding_provider
            AND e.model = $4
           WHERE dc.document_id = $2
           ORDER BY e.embedding <=> $1::halfvec ASC
           LIMIT 6`,
          [embeddingLiteral, documentId, provider, model],
        );

        contextChunks = result.rows.map((row) => ({
          text: row.text,
          heading: row.heading,
          pageFrom: row.page_from,
          pageTo: row.page_to,
          score: 1 - Number(row.distance),
        }));
      }
    }

    // Fallback: load raw chunks by position
    if (contextChunks.length === 0) {
      const chunks = await this.databaseService.pool.query<{
        chunk_index: number;
        heading: string | null;
        text: string;
        page_from: number | null;
        page_to: number | null;
      }>(
        `SELECT chunk_index, heading, text, page_from, page_to
         FROM document_chunks
         WHERE document_id = $1
         ORDER BY chunk_index ASC
         LIMIT 8`,
        [documentId],
      );

      contextChunks = chunks.rows.map((row) => ({
        text: row.text,
        heading: row.heading,
        pageFrom: row.page_from,
        pageTo: row.page_to,
        score: 0.5,
      }));
    }

    if (contextChunks.length === 0) {
      yield `event: error\ndata: ${JSON.stringify({ message: "Document has no text chunks for Q&A" })}\n\n`;
      return;
    }

    // Build context prompt
    const contextSections = contextChunks.map((chunk, i) => {
      const pageLabel =
        chunk.pageFrom && chunk.pageTo && chunk.pageFrom !== chunk.pageTo
          ? `Pages ${chunk.pageFrom}-${chunk.pageTo}`
          : chunk.pageFrom
            ? `Page ${chunk.pageFrom}`
            : "Unknown page";

      return `[Excerpt ${i + 1}, ${pageLabel}${chunk.heading ? `, Section: ${chunk.heading}` : ""}]\n${chunk.text}`;
    });

    const stream = this.llmService.stream({
      messages: [
        {
          role: "system",
          content: [
            `You are answering a question about the document "${document.title}".`,
            "Base your answer ONLY on the provided excerpts.",
            "If the excerpts don't contain enough information, say so clearly.",
            "Cite specific pages when referencing information (e.g., 'On page 3...').",
            "Be concise and direct. Answer in the same language as the question.",
          ].join("\n"),
        },
        {
          role: "user",
          content: `## Document Excerpts\n\n${contextSections.join("\n\n---\n\n")}\n\n---\n\n## Question\n${question}`,
        },
      ],
      temperature: 0.1,
      maxTokens: 1024,
    });

    // Send citations first
    const citations = contextChunks
      .filter((c) => c.score >= 0.4)
      .slice(0, 4)
      .map((chunk, i) => ({
        chunkIndex: i,
        pageFrom: chunk.pageFrom,
        pageTo: chunk.pageTo,
        quote: chunk.text.replace(/\s+/g, " ").trim().slice(0, 280),
        score: chunk.score,
      }));

    yield `event: citations\ndata: ${JSON.stringify({ citations })}\n\n`;

    let fullAnswer = "";

    for await (const chunk of stream) {
      if (chunk.done) {
        break;
      }

      fullAnswer += chunk.text;
      yield `event: answer-token\ndata: ${JSON.stringify({ text: chunk.text })}\n\n`;
    }

    yield `event: done\ndata: ${JSON.stringify({
      status: fullAnswer.length > 0 ? "answered" : "insufficient_evidence",
      answer: fullAnswer || null,
      citations,
    })}\n\n`;
  }

  // ---------------------------------------------------------------------------
  // Per-document AI: Q&A History
  // ---------------------------------------------------------------------------

  async getDocumentQaHistory(documentId: string, userId: string) {
    const result = await this.databaseService.pool.query<{
      id: string;
      question: string;
      answer: string;
      citations: string;
      created_at: string;
    }>(
      `SELECT id, question, answer, citations, created_at
       FROM document_qa_history
       WHERE document_id = $1 AND user_id = $2
       ORDER BY created_at ASC`,
      [documentId, userId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      question: row.question,
      answer: row.answer,
      citations: typeof row.citations === "string" ? JSON.parse(row.citations) : row.citations,
      createdAt: row.created_at,
    }));
  }

  async saveDocumentQaEntry(
    documentId: string,
    userId: string,
    question: string,
    answer: string,
    citations: Array<{
      chunkIndex: number;
      pageFrom: number | null;
      pageTo: number | null;
      quote: string;
      score: number;
    }>,
  ) {
    const result = await this.databaseService.pool.query<{ id: string; created_at: string }>(
      `INSERT INTO document_qa_history (document_id, user_id, question, answer, citations)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, created_at`,
      [documentId, userId, question, answer, JSON.stringify(citations)],
    );

    return {
      id: result.rows[0].id,
      question,
      answer,
      citations,
      createdAt: result.rows[0].created_at,
    };
  }

  async deleteDocumentQaHistory(documentId: string, userId: string) {
    await this.databaseService.pool.query(
      `DELETE FROM document_qa_history WHERE document_id = $1 AND user_id = $2`,
      [documentId, userId],
    );
  }

  // ---------------------------------------------------------------------------
  // Helper: get full text for a document
  // ---------------------------------------------------------------------------

  private async getDocumentFullText(documentId: string): Promise<string | null> {
    const result = await this.databaseService.pool.query<{ full_text: string | null }>(
      `SELECT full_text FROM documents WHERE id = $1`,
      [documentId],
    );

    return result.rows[0]?.full_text ?? null;
  }

  async getDocumentHistory(documentId: string): Promise<DocumentHistoryResponse> {
    await this.getDocument(documentId);
    const rows = await this.databaseService.db
      .select({
        id: auditEvents.id,
        actorUserId: auditEvents.actorUserId,
        actorDisplayName: users.displayName,
        actorEmail: users.email,
        documentId: auditEvents.documentId,
        eventType: auditEvents.eventType,
        payload: auditEvents.payload,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .leftJoin(users, eq(auditEvents.actorUserId, users.id))
      .where(eq(auditEvents.documentId, documentId))
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id));

    return {
      documentId,
      items: rows.map((row) => ({
        id: row.id,
        actorUserId: row.actorUserId,
        actorDisplayName: row.actorDisplayName,
        actorEmail: row.actorEmail,
        documentId: row.documentId,
        eventType: row.eventType,
        payload: row.payload,
        createdAt: row.createdAt.toISOString(),
      }) satisfies AuditEvent),
    };
  }

  async countPendingReviewDocuments(): Promise<number> {
    const result = await this.databaseService.pool.query<{ count: string }>(
      `SELECT count(*)::int AS count
       FROM documents
       WHERE review_status = 'pending'`,
    );

    return Number(result.rows[0]?.count ?? 0);
  }

  async countPendingReviewDocumentsByReason(): Promise<Array<{ reason: ReviewReason; count: number }>> {
    const result = await this.databaseService.pool.query<{
      reason: ReviewReason;
      count: string;
    }>(
      `SELECT review_reason AS reason, count(*)::int AS count
       FROM (
         SELECT jsonb_array_elements_text(review_reasons) AS review_reason
         FROM documents
         WHERE review_status = 'pending'
       ) expanded
       GROUP BY review_reason
       ORDER BY review_reason ASC`,
    );

    return result.rows.map((row) => ({
      reason: row.reason,
      count: Number(row.count),
    }));
  }

  async countStaleEmbeddingDocuments(): Promise<number> {
    if (!this.processingService.isSemanticIndexingConfigured()) {
      return 0;
    }

    const readyDocumentIds = await this.listDocumentIdsByFilters({ status: "ready" });
    const staleIds = await this.filterStaleDocumentIds(readyDocumentIds);
    return staleIds.length;
  }

  buildDocumentFilterQuery(filters: SearchDocumentsRequest["filters"] = {}) {
    const clauses: string[] = ["1=1"];
    const params: unknown[] = [];

    const push = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (filters?.year) {
      const placeholder = push(filters.year);
      clauses.push(
        `extract(year from coalesce(d.issue_date, d.created_at::date)) = ${placeholder}`,
      );
    }

    if (filters?.dateFrom) {
      const placeholder = push(filters.dateFrom);
      clauses.push(`coalesce(d.issue_date, d.created_at::date) >= ${placeholder}::date`);
    }

    if (filters?.dateTo) {
      const placeholder = push(filters.dateTo);
      clauses.push(`coalesce(d.issue_date, d.created_at::date) <= ${placeholder}::date`);
    }

    const correspondentIds = filters?.correspondentIds?.length
      ? filters.correspondentIds
      : filters?.correspondentId
        ? [filters.correspondentId]
        : undefined;
    if (correspondentIds?.length) {
      const placeholder = push(correspondentIds);
      clauses.push(`d.correspondent_id = ANY(${placeholder}::uuid[])`);
    }

    const documentTypeIds = filters?.documentTypeIds?.length
      ? filters.documentTypeIds
      : filters?.documentTypeId
        ? [filters.documentTypeId]
        : undefined;
    if (documentTypeIds?.length) {
      const placeholder = push(documentTypeIds);
      clauses.push(`d.document_type_id = ANY(${placeholder}::uuid[])`);
    }

    const statuses = filters?.statuses?.length
      ? filters.statuses
      : filters?.status
        ? [filters.status]
        : undefined;
    if (statuses?.length) {
      const placeholder = push(statuses);
      clauses.push(`d.status = ANY(${placeholder}::document_status[])`);
    }

    if (filters?.tags && filters.tags.length > 0) {
      const placeholder = push(filters.tags);
      clauses.push(
        `exists (
          select 1
          from document_tag_links dtl
          where dtl.document_id = d.id and dtl.tag_id = any(${placeholder}::uuid[])
        )`,
      );
    }

    if (filters?.amountMin !== undefined) {
      const placeholder = push(filters.amountMin);
      clauses.push(`d.amount IS NOT NULL AND d.amount >= ${placeholder}::numeric`);
    }

    if (filters?.amountMax !== undefined) {
      const placeholder = push(filters.amountMax);
      clauses.push(`d.amount IS NOT NULL AND d.amount <= ${placeholder}::numeric`);
    }

    return {
      whereSql: clauses.join(" AND "),
      params,
    };
  }

  private async listDocumentIdsByFilters(filters: SearchDocumentsRequest["filters"] = {}) {
    const { whereSql, params } = this.buildDocumentFilterQuery(filters);
    const result = await this.databaseService.pool.query<{ id: string }>(
      `SELECT d.id
       FROM documents d
       WHERE ${whereSql}
       ORDER BY d.id ASC`,
      params,
    );

    return result.rows.map((row) => row.id);
  }

  private async resolveBatchReprocessDocumentIds(
    input: BatchReprocessDocumentsRequest,
  ): Promise<string[]> {
    if (input.scope === "all") {
      return this.listDocumentIdsByFilters({});
    }

    if (input.scope === "filtered") {
      return this.listDocumentIdsByFilters(input.filters ?? {});
    }

    return [...new Set((input.documentIds ?? []).filter(Boolean))];
  }

  private async filterStaleDocumentIds(documentIds: string[]) {
    if (documentIds.length === 0) {
      return [];
    }

    const embeddingState = await this.loadEmbeddingStateByDocument(documentIds);
    return documentIds.filter((documentId) => embeddingState.get(documentId)?.stale ?? false);
  }

  async getDocumentsByIds(ids: string[], searchTerm?: string): Promise<Document[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.databaseService.db
      .select({
        id: documents.id,
        title: documents.title,
        source: documents.source,
        mimeType: documents.mimeType,
        status: documents.status,
        language: documents.language,
        issueDate: documents.issueDate,
        dueDate: documents.dueDate,
        taskCompletedAt: documents.taskCompletedAt,
        expiryDate: documents.expiryDate,
        amount: documents.amount,
        currency: documents.currency,
        referenceNumber: documents.referenceNumber,
        holderName: documents.holderName,
        issuingAuthority: documents.issuingAuthority,
        confidence: documents.confidence,
        reviewStatus: documents.reviewStatus,
        reviewReasons: documents.reviewReasons,
        reviewedAt: documents.reviewedAt,
        reviewNote: documents.reviewNote,
        searchablePdfStorageKey: documents.searchablePdfStorageKey,
        parseProvider: documents.parseProvider,
        chunkCount: documents.chunkCount,
        embeddingStatus: documents.embeddingStatus,
        embeddingProvider: documents.embeddingProvider,
        embeddingModel: documents.embeddingModel,
        lastProcessingError: documents.lastProcessingError,
        metadata: documents.metadata,
        createdAt: documents.createdAt,
        processedAt: documents.processedAt,
        checksum: documentFiles.checksum,
        storageKey: documentFiles.storageKey,
        correspondentId: correspondents.id,
        correspondentName: correspondents.name,
        correspondentSlug: correspondents.slug,
        documentTypeId: documentTypes.id,
        documentTypeName: documentTypes.name,
        documentTypeSlug: documentTypes.slug,
        documentTypeDescription: documentTypes.description,
        documentTypeRequiredFields: documentTypes.requiredFields,
      })
      .from(documents)
      .innerJoin(documentFiles, eq(documents.fileId, documentFiles.id))
      .leftJoin(correspondents, eq(documents.correspondentId, correspondents.id))
      .leftJoin(documentTypes, eq(documents.documentTypeId, documentTypes.id))
      .where(inArray(documents.id, ids));

    const tagsByDocument = await this.loadTagsByDocument(ids);
    const linesByDocument = await this.loadMatchingLines(ids, searchTerm);
    const latestProcessingJobsByDocument = await this.loadLatestJobsByDocument(
      ids,
      "document.process",
    );
    const latestEmbeddingJobsByDocument = await this.loadLatestJobsByDocument(
      ids,
      "document.embed",
    );
    const embeddingStateByDocument = await this.loadEmbeddingStateByDocument(ids);

    const map = new Map(
      rows.map((row) => [
        row.id,
        this.toDocument(
          row as DocumentRow,
          tagsByDocument.get(row.id) ?? [],
          latestProcessingJobsByDocument.get(row.id) ?? null,
          latestEmbeddingJobsByDocument.get(row.id) ?? null,
          embeddingStateByDocument.get(row.id) ?? {
            stale: false,
            indexedChunkCount: 0,
            totalChunkCount: row.chunkCount ?? 0,
          },
          linesByDocument.get(row.id),
        ),
      ]),
    );

    return ids.map((id) => map.get(id)).filter(Boolean) as Document[];
  }

  private async findFileByChecksum(checksum: string) {
    const [file] = await this.databaseService.db
      .select()
      .from(documentFiles)
      .where(eq(documentFiles.checksum, checksum))
      .limit(1);

    return file;
  }

  private async loadTagsByDocument(ids: string[]) {
    const rows = await this.databaseService.db
      .select({
        documentId: documentTagLinks.documentId,
        id: tags.id,
        name: tags.name,
        slug: tags.slug,
      })
      .from(documentTagLinks)
      .innerJoin(tags, eq(documentTagLinks.tagId, tags.id))
      .where(inArray(documentTagLinks.documentId, ids));

    const map = new Map<string, Array<{ id: string; name: string; slug: string }>>();
    for (const row of rows) {
      const existing = map.get(row.documentId) ?? [];
      existing.push({
        id: row.id,
        name: row.name,
        slug: row.slug,
      });
      map.set(row.documentId, existing);
    }

    return map;
  }

  private async loadLatestJobsByDocument(
    ids: string[],
    queueName: "document.process" | "document.embed",
  ): Promise<Map<string, ProcessingJobSummary>> {
    const rows = await this.databaseService.db
      .select({
        id: processingJobs.id,
        documentId: processingJobs.documentId,
        status: processingJobs.status,
        attempts: processingJobs.attempts,
        lastError: processingJobs.lastError,
        startedAt: processingJobs.startedAt,
        finishedAt: processingJobs.finishedAt,
        createdAt: processingJobs.createdAt,
        updatedAt: processingJobs.updatedAt,
      })
      .from(processingJobs)
      .where(and(inArray(processingJobs.documentId, ids), eq(processingJobs.queueName, queueName)))
      .orderBy(desc(processingJobs.createdAt), desc(processingJobs.id));

    const map = new Map<string, ProcessingJobSummary>();
    for (const row of rows) {
      if (map.has(row.documentId)) {
        continue;
      }

      map.set(row.documentId, {
        id: row.id,
        status: row.status,
        attempts: row.attempts,
        lastError: row.lastError,
        startedAt: row.startedAt?.toISOString() ?? null,
        finishedAt: row.finishedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
    }

    return map;
  }

  private async loadEmbeddingStateByDocument(
    ids: string[],
  ): Promise<
    Map<
      string,
      {
        stale: boolean;
        indexedChunkCount: number;
        totalChunkCount: number;
      }
    >
  > {
    if (ids.length === 0 || !this.processingService.isSemanticIndexingConfigured()) {
      return new Map();
    }

    const { provider, model } = this.processingService.getActiveEmbeddingConfiguration();
    if (!provider || !model) {
      return new Map();
    }

    const result = await this.databaseService.pool.query<{
      document_id: string;
      total_chunk_count: string;
      indexed_chunk_count: string;
      matching_hash_count: string;
    }>(
      `SELECT dc.document_id,
              count(*)::int AS total_chunk_count,
              count(e.chunk_index)::int AS indexed_chunk_count,
              count(*) FILTER (WHERE e.content_hash = dc.content_hash)::int AS matching_hash_count
       FROM document_chunks dc
       LEFT JOIN document_chunk_embeddings e
         ON e.document_id = dc.document_id
        AND e.chunk_index = dc.chunk_index
        AND e.provider = $2::embedding_provider
        AND e.model = $3
       WHERE dc.document_id = ANY($1::uuid[])
       GROUP BY dc.document_id`,
      [ids, provider, model],
    );

    return new Map(
      result.rows.map((row) => {
        const totalChunkCount = Number(row.total_chunk_count);
        const indexedChunkCount = Number(row.indexed_chunk_count);
        const matchingHashCount = Number(row.matching_hash_count);

        return [
          row.document_id,
          {
            stale: indexedChunkCount !== totalChunkCount || matchingHashCount !== totalChunkCount,
            indexedChunkCount,
            totalChunkCount,
          },
        ];
      }),
    );
  }

  private async loadMatchingLines(ids: string[], searchTerm?: string) {
    if (!searchTerm?.trim()) {
      return new Map<string, DocumentTextBlock[]>();
    }

    const normalizedSearch = `%${searchTerm.trim().slice(0, 120).replace(/\s+/g, "%")}%`;
    const rows = await this.databaseService.db
      .select({
        documentId: documentTextBlocks.documentId,
        page: documentTextBlocks.pageNumber,
        lineIndex: documentTextBlocks.lineIndex,
        boundingBox: documentTextBlocks.boundingBox,
        text: documentTextBlocks.text,
      })
      .from(documentTextBlocks)
      .where(
        and(
          inArray(documentTextBlocks.documentId, ids),
          sql`${documentTextBlocks.text} ILIKE ${normalizedSearch}`,
        ),
      )
      .orderBy(documentTextBlocks.documentId, documentTextBlocks.pageNumber, documentTextBlocks.lineIndex);

    const map = new Map<string, DocumentTextBlock[]>();
    for (const row of rows) {
      const existing = map.get(row.documentId) ?? [];
      if (existing.length >= 3) {
        continue;
      }

      existing.push({
        documentId: row.documentId,
        page: row.page,
        lineIndex: row.lineIndex,
        boundingBox: row.boundingBox,
        text: row.text,
      });
      map.set(row.documentId, existing);
    }

    return map;
  }

  private async loadSemanticMatchedChunks(
    ids: string[],
    provider: EmbeddingProvider,
    model: string,
    embeddingLiteral: string,
    maxChunkMatches: number,
  ): Promise<Map<string, SemanticMatchedChunk[]>> {
    if (ids.length === 0) {
      return new Map();
    }

    const result = await this.databaseService.pool.query<{
      document_id: string;
      chunk_index: number;
      heading: string | null;
      text: string;
      page_from: number | null;
      page_to: number | null;
      distance: string;
      similarity: string;
    }>(
      `WITH ranked AS (
         SELECT dc.document_id,
                dc.chunk_index,
                dc.heading,
                dc.text,
                dc.page_from,
                dc.page_to,
                (e.embedding <=> $4::halfvec)::float8 AS distance,
                (1 - (e.embedding <=> $4::halfvec)::float8) AS similarity,
                row_number() OVER (
                  PARTITION BY dc.document_id
                  ORDER BY e.embedding <=> $4::halfvec ASC, dc.chunk_index ASC
                ) AS chunk_rank
         FROM document_chunks dc
         INNER JOIN document_chunk_embeddings e
           ON e.document_id = dc.document_id
          AND e.chunk_index = dc.chunk_index
          AND e.provider = $2::embedding_provider
          AND e.model = $3
         WHERE dc.document_id = ANY($1::uuid[])
       )
       SELECT document_id,
              chunk_index,
              heading,
              text,
              page_from,
              page_to,
              distance::text,
              similarity::text
       FROM ranked
       WHERE chunk_rank <= $5
       ORDER BY document_id ASC, chunk_rank ASC`,
      [ids, provider, model, embeddingLiteral, maxChunkMatches],
    );

    const map = new Map<string, SemanticMatchedChunk[]>();
    for (const row of result.rows) {
      const existing = map.get(row.document_id) ?? [];
      existing.push({
        chunkIndex: row.chunk_index,
        heading: row.heading,
        text: row.text,
        pageFrom: row.page_from,
        pageTo: row.page_to,
        score: Number(row.similarity),
        distance: Number(row.distance),
      });
      map.set(row.document_id, existing);
    }

    return map;
  }

  private toDocument(
    row: DocumentRow,
    documentTags: Array<{ id: string; name: string; slug: string }>,
    latestProcessingJob: ProcessingJobSummary | null,
    latestEmbeddingJob: ProcessingJobSummary | null,
    embeddingState: {
      stale: boolean;
      indexedChunkCount: number;
      totalChunkCount: number;
    },
    matchingLines?: DocumentTextBlock[],
  ): Document {
    const semanticConfigured = this.processingService.isSemanticIndexingConfigured();
    const resolvedEmbeddingStatus: EmbeddingStatus = !semanticConfigured
      ? "not_configured"
      : row.embeddingStatus === "queued" ||
          row.embeddingStatus === "indexing" ||
          row.embeddingStatus === "failed"
        ? row.embeddingStatus
        : embeddingState.stale
          ? "stale"
          : row.chunkCount > 0
            ? "ready"
            : row.embeddingStatus;

    return {
      id: row.id,
      title: row.title,
      source: row.source,
      mimeType: row.mimeType,
      checksum: row.checksum,
      storageKey: row.storageKey,
      status: row.status,
      language: row.language,
      issueDate: dateToIso(row.issueDate),
      dueDate: dateToIso(row.dueDate),
      taskCompletedAt: row.taskCompletedAt?.toISOString() ?? null,
      expiryDate: dateToIso(row.expiryDate),
      amount: row.amount === null ? null : Number(row.amount),
      currency: row.currency,
      referenceNumber: row.referenceNumber,
      holderName: row.holderName,
      issuingAuthority: row.issuingAuthority,
      correspondent:
        row.correspondentId && row.correspondentName && row.correspondentSlug
          ? {
              id: row.correspondentId,
              name: row.correspondentName,
              slug: row.correspondentSlug,
            }
          : null,
      documentType:
        row.documentTypeId && row.documentTypeName && row.documentTypeSlug
          ? {
              id: row.documentTypeId,
              name: row.documentTypeName,
              slug: row.documentTypeSlug,
              description: row.documentTypeDescription,
              requiredFields: Array.isArray(row.documentTypeRequiredFields)
                ? row.documentTypeRequiredFields
                : [],
            }
          : null,
      tags: documentTags,
      confidence: row.confidence === null ? null : Number(row.confidence),
      reviewStatus: row.reviewStatus,
      reviewReasons: row.reviewReasons ?? [],
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewNote: row.reviewNote,
      searchablePdfAvailable: Boolean(row.searchablePdfStorageKey),
      parseProvider: row.parseProvider ?? null,
      chunkCount: row.chunkCount ?? 0,
      embeddingStatus: resolvedEmbeddingStatus,
      embeddingProvider: row.embeddingProvider,
      embeddingModel: row.embeddingModel,
      embeddingsStale: semanticConfigured && embeddingState.stale,
      lastProcessingError: row.lastProcessingError,
      latestProcessingJob,
      latestEmbeddingJob,
      metadata: this.toDocumentMetadata(row.metadata),
      createdAt: row.createdAt.toISOString(),
      processedAt: row.processedAt?.toISOString() ?? null,
      matchingLines,
    };
  }

  private buildManualOverrides(
    existing: Document,
    input: UpdateDocumentInput,
    userId: string,
  ): ManualOverrides | undefined {
    const hadManualChanges =
      (input.clearLockedFields?.length ?? 0) > 0 ||
      MANUAL_OVERRIDE_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(input, field));

    if (!hadManualChanges) {
      return existing.metadata.manual;
    }

    const nextLockedFields = new Set(existing.metadata.manual?.lockedFields ?? []);
    const nextValues: ManualOverrides["values"] = {
      ...(existing.metadata.manual?.values ?? {}),
    };

    for (const field of input.clearLockedFields ?? []) {
      nextLockedFields.delete(field);
      delete nextValues[field];
    }

    const assignIfPresent = <K extends ManualOverrideField>(
      field: K,
      value: ManualOverrides["values"][K],
    ) => {
      if (!Object.prototype.hasOwnProperty.call(input, field)) {
        return;
      }

      nextLockedFields.add(field);
      if (value === undefined) {
        delete nextValues[field];
        return;
      }

      nextValues[field] = value;
    };

    assignIfPresent("issueDate", input.issueDate ?? null);
    assignIfPresent("dueDate", input.dueDate ?? null);
    assignIfPresent("expiryDate", input.expiryDate ?? null);
    assignIfPresent("amount", input.amount ?? null);
    assignIfPresent(
      "currency",
      input.currency === undefined ? undefined : normalizeCurrencyCode(input.currency),
    );
    assignIfPresent("referenceNumber", input.referenceNumber ?? null);
    assignIfPresent("holderName", input.holderName ?? null);
    assignIfPresent("issuingAuthority", input.issuingAuthority ?? null);
    assignIfPresent("correspondentId", input.correspondentId ?? null);
    assignIfPresent("documentTypeId", input.documentTypeId ?? null);
    assignIfPresent("tagIds", input.tagIds);

    if (nextLockedFields.size === 0) {
      return undefined;
    }

    return {
      lockedFields: [...nextLockedFields],
      values: nextValues,
      updatedAt: new Date().toISOString(),
      updatedByUserId: userId,
    };
  }

  private withManualMetadata(
    metadata: DocumentMetadata,
    manualOverrides: ManualOverrides | undefined,
  ): DocumentMetadata {
    const nextMetadata: DocumentMetadata = {
      ...metadata,
    };

    if (manualOverrides) {
      nextMetadata.manual = manualOverrides;
    } else {
      delete nextMetadata.manual;
    }

    return nextMetadata;
  }

  private async recordAuditEvent(input: {
    actorUserId?: string | null;
    documentId?: string | null;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.databaseService.db.insert(auditEvents).values({
      actorUserId: input.actorUserId ?? null,
      documentId: input.documentId ?? null,
      eventType: input.eventType,
      payload: input.payload,
    });
  }

  private computeChecksum(buffer: Buffer): string {
    return createHash("sha256").update(buffer).digest("hex");
  }

  private toSearchablePdfFilename(originalFilename: string): string {
    const normalized = originalFilename.replace(/\.[^.]+$/, "");
    return `${normalized}.searchable.pdf`;
  }

  private toDocumentMetadata(metadata: Record<string, unknown> | null | undefined): DocumentMetadata {
    return {
      detectedKeywords: [],
      reviewReasons: [],
      chunkCount: 0,
      embedding: {
        configured: this.processingService.isSemanticIndexingConfigured(),
      },
      ...(metadata ?? {}),
    };
  }
}
