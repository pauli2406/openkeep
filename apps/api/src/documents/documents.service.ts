import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  correspondents,
  documentFiles,
  documentTagLinks,
  documentTextBlocks,
  documentTypes,
  documents,
  processingJobs,
  tags,
} from "@openkeep/db";
import type {
  Document,
  DocumentMetadata,
  DocumentTextBlock,
  ListReviewDocumentsRequest,
  ProcessingJobSummary,
  ResolveReviewRequest,
  RequeueDocumentProcessingRequest,
  ReviewReason,
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
import { dateToIso, normalizeCurrencyCode, parseDateOnly } from "../processing/normalization.util";
import { ProcessingService } from "../processing/processing.service";

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
  amount: string | number | null;
  currency: string | null;
  referenceNumber: string | null;
  confidence: string | number | null;
  reviewStatus: Document["reviewStatus"];
  reviewReasons: ReviewReason[];
  reviewedAt: Date | null;
  reviewNote: string | null;
  searchablePdfStorageKey: string | null;
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
}

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(ObjectStorageService) private readonly storageService: ObjectStorageService,
    @Inject(ProcessingService) private readonly processingService: ProcessingService,
    @Inject(MetricsService) private readonly metricsService: MetricsService,
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
    await this.processingService.enqueueDocumentProcessing(document.id, false);
    return this.getDocument(document.id);
  }

  async listDocuments(request: SearchDocumentsRequest): Promise<SearchDocumentsResponse> {
    const filters = request.filters ?? {};
    const sort = request.sort ?? "createdAt";
    const direction = request.direction === "asc" ? "asc" : "desc";
    const page = request.page ?? 1;
    const pageSize = request.pageSize ?? 20;
    const clauses: string[] = ["1=1"];
    const params: unknown[] = [];

    const push = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };

    let snippetSql = "NULL::text AS snippet";
    if (request.query?.trim()) {
      const placeholder = push(request.query.trim());
      clauses.push(
        `to_tsvector('simple', coalesce(d.full_text, '')) @@ websearch_to_tsquery('simple', ${placeholder})`,
      );
      snippetSql = `ts_headline('simple', coalesce(d.full_text, ''), websearch_to_tsquery('simple', ${placeholder}), 'MaxFragments=2, MaxWords=18, MinWords=5') AS snippet`;
    }

    if (filters.year) {
      const placeholder = push(filters.year);
      clauses.push(
        `extract(year from coalesce(d.issue_date, d.created_at::date)) = ${placeholder}`,
      );
    }

    if (filters.dateFrom) {
      const placeholder = push(filters.dateFrom);
      clauses.push(`coalesce(d.issue_date, d.created_at::date) >= ${placeholder}::date`);
    }

    if (filters.dateTo) {
      const placeholder = push(filters.dateTo);
      clauses.push(`coalesce(d.issue_date, d.created_at::date) <= ${placeholder}::date`);
    }

    if (filters.correspondentId) {
      const placeholder = push(filters.correspondentId);
      clauses.push(`d.correspondent_id = ${placeholder}::uuid`);
    }

    if (filters.documentTypeId) {
      const placeholder = push(filters.documentTypeId);
      clauses.push(`d.document_type_id = ${placeholder}::uuid`);
    }

    if (filters.status) {
      const placeholder = push(filters.status);
      clauses.push(`d.status = ${placeholder}`);
    }

    if (filters.tags && filters.tags.length > 0) {
      const placeholder = push(filters.tags);
      clauses.push(
        `exists (
          select 1
          from document_tag_links dtl
          where dtl.document_id = d.id and dtl.tag_id = any(${placeholder}::uuid[])
        )`,
      );
    }

    const orderColumns = {
      createdAt: "d.created_at",
      issueDate: "d.issue_date",
      dueDate: "d.due_date",
      title: "d.title",
    } as const;
    const orderColumn = orderColumns[sort];
    const baseWhere = clauses.join(" AND ");

    const totalResult = await this.databaseService.pool.query<{ total: string }>(
      `SELECT count(*)::int AS total FROM documents d WHERE ${baseWhere}`,
      params,
    );

    const listResult = await this.databaseService.pool.query<{
      id: string;
      snippet: string | null;
    }>(
      `SELECT d.id, ${snippetSql}
       FROM documents d
       WHERE ${baseWhere}
       ORDER BY ${orderColumn} ${direction}, d.id DESC
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
      appliedFilters: filters,
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
    const [years, correspondentFacets, typeFacets, tagFacets] = await Promise.all([
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

  async updateDocument(documentId: string, input: UpdateDocumentInput): Promise<Document> {
    await this.getDocument(documentId);

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
          correspondentId:
            input.correspondentId === null ? null : input.correspondentId ?? undefined,
          documentTypeId:
            input.documentTypeId === null ? null : input.documentTypeId ?? undefined,
          status: input.status,
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

    return this.getDocument(documentId);
  }

  async resolveReview(documentId: string, input: ResolveReviewRequest): Promise<Document> {
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

    return this.getDocument(documentId);
  }

  async requeueReview(
    documentId: string,
    input: RequeueDocumentProcessingRequest,
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

    return this.processingService.enqueueDocumentProcessing(documentId, input.force);
  }

  async reprocessDocument(documentId: string) {
    const document = await this.getDocument(documentId);
    if (document.status === "processing") {
      throw new BadRequestException("Document is already processing");
    }

    return this.processingService.enqueueDocumentProcessing(documentId, true);
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
        amount: documents.amount,
        currency: documents.currency,
        referenceNumber: documents.referenceNumber,
        confidence: documents.confidence,
        reviewStatus: documents.reviewStatus,
        reviewReasons: documents.reviewReasons,
        reviewedAt: documents.reviewedAt,
        reviewNote: documents.reviewNote,
        searchablePdfStorageKey: documents.searchablePdfStorageKey,
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
      })
      .from(documents)
      .innerJoin(documentFiles, eq(documents.fileId, documentFiles.id))
      .leftJoin(correspondents, eq(documents.correspondentId, correspondents.id))
      .leftJoin(documentTypes, eq(documents.documentTypeId, documentTypes.id))
      .where(inArray(documents.id, ids));

    const tagsByDocument = await this.loadTagsByDocument(ids);
    const linesByDocument = await this.loadMatchingLines(ids, searchTerm);
    const latestJobsByDocument = await this.loadLatestJobsByDocument(ids);

    const map = new Map(
      rows.map((row) => [
        row.id,
        this.toDocument(
          row as DocumentRow,
          tagsByDocument.get(row.id) ?? [],
          latestJobsByDocument.get(row.id) ?? null,
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
      .where(inArray(processingJobs.documentId, ids))
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

  private toDocument(
    row: DocumentRow,
    documentTags: Array<{ id: string; name: string; slug: string }>,
    latestProcessingJob: ProcessingJobSummary | null,
    matchingLines?: DocumentTextBlock[],
  ): Document {
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
      amount: row.amount === null ? null : Number(row.amount),
      currency: row.currency,
      referenceNumber: row.referenceNumber,
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
            }
          : null,
      tags: documentTags,
      confidence: row.confidence === null ? null : Number(row.confidence),
      reviewStatus: row.reviewStatus,
      reviewReasons: row.reviewReasons ?? [],
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewNote: row.reviewNote,
      searchablePdfAvailable: Boolean(row.searchablePdfStorageKey),
      lastProcessingError: row.lastProcessingError,
      latestProcessingJob,
      metadata: this.toDocumentMetadata(row.metadata),
      createdAt: row.createdAt.toISOString(),
      processedAt: row.processedAt?.toISOString() ?? null,
      matchingLines,
    };
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
      ...(metadata ?? {}),
    };
  }
}
