import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from "@nestjs/common";
import {
  auditEvents,
  correspondents,
  documentChunkEmbeddings,
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
import type { AuthenticatedPrincipal } from "../auth/auth.types";
import { AppConfigService } from "../common/config/app-config.service";
import { DatabaseService } from "../common/db/database.service";
import { ObjectStorageService } from "../common/storage/storage.service";
import { DocumentsService } from "../documents/documents.service";
import {
  ArchiveImportResult,
  ArchiveSnapshot,
  ArchiveSnapshotSchema,
  type WatchFolderScanHistoryItem,
  WatchFolderScanItem,
  WatchFolderScanRequest,
  WatchFolderScanResponse,
  type WatchFolderScanSummary,
} from "@openkeep/types";
import { createHash } from "crypto";
import { lookup as lookupMimeType } from "mime-types";
import { mkdir, readFile, readdir, rename } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

interface SnapshotUploadPlan {
  key: string;
  buffer: Buffer;
  contentType: string;
}

interface UploadedObjectBackup {
  key: string;
  contentType: string;
  previousBuffer: Buffer | null;
}

const SUPPORTED_WATCH_FOLDER_MIME_TYPES = new Set([
  "application/pdf",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/tif",
  "image/tiff",
  "image/webp",
]);

const WATCH_FOLDER_SCAN_HISTORY_LIMIT = 5;

@Injectable()
export class ArchiveService {
  constructor(
    @Inject(AppConfigService) private readonly configService: AppConfigService,
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(ObjectStorageService) private readonly storageService: ObjectStorageService,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
  ) {}

  async exportSnapshot(): Promise<ArchiveSnapshot> {
    const [
      tagRows,
      correspondentRows,
      documentTypeRows,
      fileRows,
      documentRows,
      tagLinkRows,
      pageRows,
      textBlockRows,
      chunkRows,
      embeddingRows,
      processingJobRows,
      auditEventRows,
    ] = await Promise.all([
      this.databaseService.db.select().from(tags),
      this.databaseService.db.select().from(correspondents),
      this.databaseService.db.select().from(documentTypes),
      this.databaseService.db.select().from(documentFiles),
      this.databaseService.db.select().from(documents),
      this.databaseService.db.select().from(documentTagLinks),
      this.databaseService.db.select().from(documentPages),
      this.databaseService.db.select().from(documentTextBlocks),
      this.databaseService.db.select().from(documentChunks),
      this.databaseService.pool.query<{
        document_id: string;
        chunk_index: number;
        provider: string;
        model: string;
        dimensions: number;
        embedding_literal: string;
        content_hash: string;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT document_id,
                chunk_index,
                provider::text AS provider,
                model,
                dimensions,
                embedding::text AS embedding_literal,
                content_hash,
                created_at,
                updated_at
         FROM document_chunk_embeddings`,
      ),
      this.databaseService.db.select().from(processingJobs),
      this.databaseService.db.select().from(auditEvents),
    ]);

    const fileContents = await Promise.all(
      fileRows.map(async (file) => ({
        id: file.id,
        contentBase64:
          (await this.storageService.downloadToBuffer(file.storageKey).catch(() => null))?.toString(
            "base64",
          ) ?? null,
      })),
    );
    const fileContentMap = new Map(fileContents.map((item) => [item.id, item.contentBase64]));

    const derivedStorageKeys = [
      ...new Set(
        documentRows
          .map((document) => document.searchablePdfStorageKey)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const derivedObjects = await Promise.all(
      derivedStorageKeys.map(async (storageKey) => ({
        storageKey,
        contentBase64:
          (await this.storageService.downloadToBuffer(storageKey).catch(() => null))?.toString(
            "base64",
          ) ?? null,
      })),
    );

    return ArchiveSnapshotSchema.parse({
      version: 1,
      exportedAt: new Date().toISOString(),
      tags: tagRows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
      correspondents: correspondentRows.map((row) => ({
        ...row,
        summaryGeneratedAt: row.summaryGeneratedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      documentTypes: documentTypeRows.map((row) => ({
        ...row,
        requiredFields: Array.isArray(row.requiredFields) ? row.requiredFields : [],
        createdAt: row.createdAt.toISOString(),
      })),
      files: fileRows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        contentBase64: fileContentMap.get(row.id) ?? null,
      })),
      documents: documentRows.map((row) => ({
        ...row,
        metadata: this.normalizeExportedDocumentMetadata(row.metadata, row.parseProvider),
        amount: row.amount === null ? null : Number(row.amount),
        confidence: row.confidence === null ? null : Number(row.confidence),
        issueDate: row.issueDate ? row.issueDate.toISOString().slice(0, 10) : null,
        dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
        expiryDate: row.expiryDate ? row.expiryDate.toISOString().slice(0, 10) : null,
        holderName: row.holderName,
        issuingAuthority: row.issuingAuthority,
        reviewedAt: row.reviewedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        processedAt: row.processedAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(),
      })),
      documentTagLinks: tagLinkRows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
      documentPages: pageRows,
      documentTextBlocks: textBlockRows.map((row) => ({
        ...row,
        pageNumber: row.pageNumber,
      })),
      documentChunks: chunkRows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
      documentChunkEmbeddings: embeddingRows.rows.map((row) => ({
        documentId: row.document_id,
        chunkIndex: row.chunk_index,
        provider: row.provider as ArchiveSnapshot["documentChunkEmbeddings"][number]["provider"],
        model: row.model,
        dimensions: row.dimensions,
        embeddingLiteral: row.embedding_literal,
        contentHash: row.content_hash,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
      processingJobs: processingJobRows.map((row) => ({
        ...row,
        startedAt: row.startedAt?.toISOString() ?? null,
        finishedAt: row.finishedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      auditEvents: auditEventRows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
      derivedObjects,
    });
  }

  async importSnapshot(
    snapshotInput: unknown,
    principal: AuthenticatedPrincipal,
    mode: "replace" | "merge",
  ): Promise<ArchiveImportResult> {
    const snapshot = this.parseSnapshot(snapshotInput);
    this.assertSnapshotConsistency(snapshot);

    const uploadPlans = this.buildSnapshotUploadPlans(snapshot);
    const backups = await this.uploadSnapshotObjects(uploadPlans);

    try {
      await this.databaseService.db.transaction(async (tx) => {
        if (mode === "replace") {
          await tx.execute(sql`TRUNCATE TABLE
            document_chunk_embeddings,
            document_chunks,
            document_text_blocks,
            document_pages,
            document_tag_links,
            processing_jobs,
            audit_events,
            documents,
            document_files,
            tags,
            document_types,
            correspondents
            RESTART IDENTITY CASCADE`);
        }

        await this.upsertReferenceData(tx, snapshot);
        await this.upsertFiles(tx, snapshot);
        await this.upsertDocuments(tx, snapshot, principal.userId);

        if (mode === "merge") {
          const snapshotDocumentIds = snapshot.documents.map((document) => document.id);
          if (snapshotDocumentIds.length > 0) {
            await tx
              .delete(documentTagLinks)
              .where(inArray(documentTagLinks.documentId, snapshotDocumentIds));
            await tx
              .delete(documentPages)
              .where(inArray(documentPages.documentId, snapshotDocumentIds));
            await tx
              .delete(documentTextBlocks)
              .where(inArray(documentTextBlocks.documentId, snapshotDocumentIds));
            await tx
              .delete(documentChunks)
              .where(inArray(documentChunks.documentId, snapshotDocumentIds));
            await tx
              .delete(documentChunkEmbeddings)
              .where(inArray(documentChunkEmbeddings.documentId, snapshotDocumentIds));
          }
        }

        await this.insertDocumentScopedRows(tx, snapshot);
        await this.upsertEmbeddings(tx, snapshot);
        await this.upsertProcessingJobs(tx, snapshot);
        await this.upsertAuditEvents(tx, snapshot, principal.userId);
      });
    } catch (error) {
      await this.rollbackUploadedObjects(backups);
      throw error;
    }

    await this.databaseService.db.insert(auditEvents).values({
      actorUserId: principal.userId,
      eventType: "archive.import_completed",
      payload: {
        version: snapshot.version,
        mode,
        documentCount: snapshot.documents.length,
        fileCount: snapshot.files.length,
      },
    });

    return {
      imported: true,
      mode,
      documentCount: snapshot.documents.length,
      fileCount: snapshot.files.length,
    };
  }

  private normalizeExportedDocumentMetadata(
    metadata: unknown,
    parseProvider: string | null,
  ): Record<string, unknown> {
    const normalized =
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? { ...(metadata as Record<string, unknown>) }
        : {};

    const parse =
      normalized.parse && typeof normalized.parse === "object" && !Array.isArray(normalized.parse)
        ? { ...(normalized.parse as Record<string, unknown>) }
        : null;
    const chunking =
      normalized.chunking &&
      typeof normalized.chunking === "object" &&
      !Array.isArray(normalized.chunking)
        ? { ...(normalized.chunking as Record<string, unknown>) }
        : null;

    const parseStrategy =
      typeof parse?.strategy === "string"
        ? parse.strategy
        : typeof normalized.parseStrategy === "string"
          ? normalized.parseStrategy
          : typeof normalized.normalizationStrategy === "string"
            ? normalized.normalizationStrategy
            : "unknown";

    const metadataParseProvider =
      typeof parse?.provider === "string"
        ? parse.provider
        : typeof normalized.parseProvider === "string"
          ? normalized.parseProvider
          : typeof parseProvider === "string"
            ? parseProvider
            : "local-ocr";

    if (parse || normalized.parseProvider || normalized.parseStrategy) {
      normalized.parse = {
        ...(parse ?? {}),
        provider: metadataParseProvider,
        strategy: parseStrategy,
      };
    }

    const chunkCount =
      typeof chunking?.chunkCount === "number"
        ? chunking.chunkCount
        : typeof normalized.chunkCount === "number"
          ? normalized.chunkCount
          : 0;

    if (chunking || typeof normalized.chunkCount === "number") {
      normalized.chunking = {
        ...(chunking ?? {}),
        strategy:
          typeof chunking?.strategy === "string" ? chunking.strategy : "normalized-parse-v1",
        chunkCount,
      };
    }

    return normalized;
  }

  async scanWatchFolder(
    principal: AuthenticatedPrincipal,
    request: WatchFolderScanRequest,
  ): Promise<WatchFolderScanResponse> {
    const configuredPath = this.configService.get("WATCH_FOLDER_PATH");
    if (!configuredPath) {
      throw new ConflictException("WATCH_FOLDER_PATH is not configured");
    }

    const filePaths = await this.listFilesRecursive(configuredPath);
    const items: WatchFolderScanItem[] = [];

    for (const filePath of filePaths) {
      const relativePath = relative(configuredPath, filePath);
      let mimeType: string | null = null;

      try {
        const detectedMimeType = lookupMimeType(filePath);
        mimeType = typeof detectedMimeType === "string" ? detectedMimeType : null;

        if (!mimeType) {
          items.push(
            await this.finalizeWatchFolderItem({
              configuredPath,
              sourcePath: filePath,
              relativePath,
              dryRun: request.dryRun,
              action: request.dryRun ? "planned" : "unsupported",
              reason: request.dryRun ? "would_fail_unsupported" : "unsupported_file_type",
              destinationDirectory: "failed",
              mimeType: null,
              failureCode: "mime_type_missing",
              detail: "Could not determine a MIME type from the file extension.",
            }),
          );
          continue;
        }

        if (!this.isSupportedWatchFolderMimeType(mimeType)) {
          items.push(
            await this.finalizeWatchFolderItem({
              configuredPath,
              sourcePath: filePath,
              relativePath,
              dryRun: request.dryRun,
              action: request.dryRun ? "planned" : "unsupported",
              reason: request.dryRun ? "would_fail_unsupported" : "unsupported_file_type",
              destinationDirectory: "failed",
              mimeType,
              failureCode: "mime_type_not_allowed",
              detail: `Unsupported watch-folder MIME type: ${mimeType}`,
            }),
          );
          continue;
        }

        const buffer = await readFile(filePath);
        const checksum = createHash("sha256").update(buffer).digest("hex");
        const [existingFile] = await this.databaseService.db
          .select({ id: documentFiles.id })
          .from(documentFiles)
          .where(eq(documentFiles.checksum, checksum))
          .limit(1);

        if (existingFile) {
          items.push(
            await this.finalizeWatchFolderItem({
              configuredPath,
              sourcePath: filePath,
              relativePath,
              dryRun: request.dryRun,
              action: request.dryRun ? "planned" : "duplicate",
              reason: request.dryRun ? "would_skip_duplicate" : "duplicate_checksum",
              destinationDirectory: "processed",
              mimeType,
              failureCode: null,
              detail: null,
            }),
          );
          continue;
        }

        if (request.dryRun) {
          items.push({
            path: filePath,
            action: "planned",
            destinationPath: null,
            documentId: null,
            reason: "would_import",
            mimeType,
            failureCode: null,
            detail: null,
          });
          continue;
        }

        const imported = await this.documentsService.uploadDocument({
          principal,
          buffer,
          filename: basename(filePath),
          mimeType,
          metadata: {
            title: basename(filePath),
            source: "watch-folder",
          },
        });

        const finalized = await this.finalizeWatchFolderItem({
          configuredPath,
          sourcePath: filePath,
          relativePath,
          dryRun: false,
          action: "imported",
          reason: "imported",
          destinationDirectory: "processed",
          checksum,
          documentId: imported.id,
          mimeType,
          failureCode: null,
          detail: null,
        });
        items.push(finalized);
      } catch (error) {
        items.push(
          await this.finalizeWatchFolderItem({
            configuredPath,
            sourcePath: filePath,
            relativePath,
            dryRun: request.dryRun,
            action: request.dryRun ? "planned" : "failed",
            reason: request.dryRun ? "would_fail_upload" : "upload_failed",
            destinationDirectory: "failed",
            mimeType,
            failureCode: "upload_failed",
            detail: error instanceof Error ? error.message : "Unknown upload failure",
          }).catch(() => ({
            path: filePath,
            action: request.dryRun ? "planned" : "failed",
            destinationPath: null,
            documentId: null,
            reason: request.dryRun ? "would_fail_upload" : "upload_failed",
            mimeType,
            failureCode: "upload_failed",
            detail: error instanceof Error ? error.message : "Unknown upload failure",
          })),
        );
      }
    }

    const summary = this.buildWatchFolderSummary(items);

    await this.databaseService.db.insert(auditEvents).values({
      actorUserId: principal.userId,
      eventType: "archive.watch_folder_scanned",
      payload: {
        configuredPath,
        dryRun: request.dryRun,
        totalCount: summary.total,
        importedCount: summary.imported,
        duplicateCount: summary.duplicate,
        unsupportedCount: summary.unsupported,
        failedCount: summary.failed,
        plannedCount: summary.planned,
      },
    });

    const history = await this.listWatchFolderScanHistory();

    return {
      configuredPath,
      dryRun: request.dryRun,
      summary,
      items,
      history,
    };
  }

  private parseSnapshot(snapshotInput: unknown): ArchiveSnapshot {
    try {
      return ArchiveSnapshotSchema.parse(snapshotInput);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new BadRequestException({
          message: "Invalid archive snapshot",
          issues: error.issues,
        });
      }

      throw error;
    }
  }

  private assertSnapshotConsistency(snapshot: ArchiveSnapshot): void {
    if (snapshot.version !== 1) {
      throw new BadRequestException(`Unsupported snapshot version: ${snapshot.version}`);
    }

    const fileIds = new Set(snapshot.files.map((file) => file.id));
    const tagIds = new Set(snapshot.tags.map((tag) => tag.id));
    const correspondentIds = new Set(snapshot.correspondents.map((item) => item.id));
    const documentTypeIds = new Set(snapshot.documentTypes.map((item) => item.id));
    const documentIds = new Set(snapshot.documents.map((document) => document.id));
    const chunkKeys = new Set(
      snapshot.documentChunks.map((chunk) => `${chunk.documentId}:${chunk.chunkIndex}`),
    );
    const derivedKeys = new Set(snapshot.derivedObjects.map((item) => item.storageKey));

    for (const file of snapshot.files) {
      if (file.contentBase64 === null) {
        throw new BadRequestException(`Snapshot file payload missing for ${file.storageKey}`);
      }
    }

    for (const document of snapshot.documents) {
      if (!fileIds.has(document.fileId)) {
        throw new BadRequestException(
          `Document ${document.id} references missing file ${document.fileId}`,
        );
      }
      if (document.correspondentId && !correspondentIds.has(document.correspondentId)) {
        throw new BadRequestException(
          `Document ${document.id} references missing correspondent ${document.correspondentId}`,
        );
      }
      if (document.documentTypeId && !documentTypeIds.has(document.documentTypeId)) {
        throw new BadRequestException(
          `Document ${document.id} references missing document type ${document.documentTypeId}`,
        );
      }
      if (
        document.searchablePdfStorageKey &&
        !derivedKeys.has(document.searchablePdfStorageKey)
      ) {
        throw new BadRequestException(
          `Document ${document.id} references missing derived object ${document.searchablePdfStorageKey}`,
        );
      }
    }

    for (const derived of snapshot.derivedObjects) {
      if (derived.contentBase64 === null) {
        throw new BadRequestException(
          `Derived object payload missing for ${derived.storageKey}`,
        );
      }
    }

    for (const row of snapshot.documentTagLinks) {
      if (!documentIds.has(row.documentId) || !tagIds.has(row.tagId)) {
        throw new BadRequestException(
          `Invalid document_tag_link reference ${row.documentId} -> ${row.tagId}`,
        );
      }
    }

    for (const row of snapshot.documentPages) {
      if (!documentIds.has(row.documentId)) {
        throw new BadRequestException(
          `Document page ${row.id} references missing document ${row.documentId}`,
        );
      }
    }

    for (const row of snapshot.documentTextBlocks) {
      if (!documentIds.has(row.documentId)) {
        throw new BadRequestException(
          `Document text block ${row.id} references missing document ${row.documentId}`,
        );
      }
    }

    for (const row of snapshot.documentChunks) {
      if (!documentIds.has(row.documentId)) {
        throw new BadRequestException(
          `Document chunk ${row.id} references missing document ${row.documentId}`,
        );
      }
    }

    for (const embedding of snapshot.documentChunkEmbeddings) {
      if (!documentIds.has(embedding.documentId)) {
        throw new BadRequestException(
          `Embedding references missing document ${embedding.documentId}`,
        );
      }
      if (!chunkKeys.has(`${embedding.documentId}:${embedding.chunkIndex}`)) {
        throw new BadRequestException(
          `Embedding references missing chunk ${embedding.documentId}:${embedding.chunkIndex}`,
        );
      }
    }

    for (const job of snapshot.processingJobs) {
      if (!documentIds.has(job.documentId)) {
        throw new BadRequestException(
          `Processing job ${job.id} references missing document ${job.documentId}`,
        );
      }
    }

    for (const event of snapshot.auditEvents) {
      if (event.documentId && !documentIds.has(event.documentId)) {
        throw new BadRequestException(
          `Audit event ${event.id} references missing document ${event.documentId}`,
        );
      }
    }
  }

  private buildSnapshotUploadPlans(snapshot: ArchiveSnapshot): SnapshotUploadPlan[] {
    return [
      ...snapshot.files.map((file) => ({
        key: file.storageKey,
        buffer: Buffer.from(file.contentBase64!, "base64"),
        contentType: file.mimeType,
      })),
      ...snapshot.derivedObjects.map((object) => ({
        key: object.storageKey,
        buffer: Buffer.from(object.contentBase64!, "base64"),
        contentType: "application/pdf",
      })),
    ];
  }

  private async uploadSnapshotObjects(
    plans: SnapshotUploadPlan[],
  ): Promise<UploadedObjectBackup[]> {
    const backups: UploadedObjectBackup[] = [];

    try {
      for (const plan of plans) {
        const previousBuffer = await this.storageService
          .downloadToBuffer(plan.key)
          .catch(() => null);
        backups.push({
          key: plan.key,
          contentType: plan.contentType,
          previousBuffer,
        });
        await this.storageService.uploadBuffer(plan.key, plan.buffer, plan.contentType);
      }
    } catch (error) {
      await this.rollbackUploadedObjects(backups);
      throw error;
    }

    return backups;
  }

  private async rollbackUploadedObjects(backups: UploadedObjectBackup[]): Promise<void> {
    for (const backup of backups.reverse()) {
      if (backup.previousBuffer) {
        await this.storageService
          .uploadBuffer(backup.key, backup.previousBuffer, backup.contentType)
          .catch(() => undefined);
      } else {
        await this.storageService.deleteObject(backup.key).catch(() => undefined);
      }
    }
  }

  private async upsertReferenceData(
    tx: Parameters<Parameters<DatabaseService["db"]["transaction"]>[0]>[0],
    snapshot: ArchiveSnapshot,
  ) {
    if (snapshot.tags.length > 0) {
      await tx
        .insert(tags)
        .values(
          snapshot.tags.map((row) => ({
            ...row,
            createdAt: this.parseTimestamp(row.createdAt),
          })),
        )
        .onConflictDoUpdate({
          target: tags.id,
          set: {
            name: sql`excluded.name`,
            slug: sql`excluded.slug`,
            createdAt: sql`excluded.created_at`,
          },
        });
    }

    if (snapshot.correspondents.length > 0) {
      await tx
        .insert(correspondents)
        .values(
          snapshot.correspondents.map((row) => ({
            ...row,
            summaryGeneratedAt: row.summaryGeneratedAt
              ? this.parseTimestamp(row.summaryGeneratedAt)
              : null,
            createdAt: this.parseTimestamp(row.createdAt),
          })),
        )
        .onConflictDoUpdate({
          target: correspondents.id,
          set: {
            name: sql`excluded.name`,
            slug: sql`excluded.slug`,
            normalizedName: sql`excluded.normalized_name`,
            summary: sql`excluded.summary`,
            summaryGeneratedAt: sql`excluded.summary_generated_at`,
            createdAt: sql`excluded.created_at`,
          },
        });
    }

    if (snapshot.documentTypes.length > 0) {
      await tx
        .insert(documentTypes)
        .values(
          snapshot.documentTypes.map((row) => ({
            ...row,
            requiredFields: row.requiredFields ?? [],
            createdAt: this.parseTimestamp(row.createdAt),
          })),
        )
        .onConflictDoUpdate({
          target: documentTypes.id,
          set: {
            name: sql`excluded.name`,
            slug: sql`excluded.slug`,
            description: sql`excluded.description`,
            requiredFields: sql`excluded.required_fields`,
            createdAt: sql`excluded.created_at`,
          },
        });
    }
  }

  private async upsertFiles(
    tx: Parameters<Parameters<DatabaseService["db"]["transaction"]>[0]>[0],
    snapshot: ArchiveSnapshot,
  ) {
    if (snapshot.files.length === 0) {
      return;
    }

    await tx
      .insert(documentFiles)
      .values(
        snapshot.files.map((row) => ({
          id: row.id,
          checksum: row.checksum,
          storageKey: row.storageKey,
          originalFilename: row.originalFilename,
          mimeType: row.mimeType,
          sizeBytes: row.sizeBytes,
          createdAt: this.parseTimestamp(row.createdAt),
        })),
      )
      .onConflictDoUpdate({
        target: documentFiles.id,
        set: {
          checksum: sql`excluded.checksum`,
          storageKey: sql`excluded.storage_key`,
          originalFilename: sql`excluded.original_filename`,
          mimeType: sql`excluded.mime_type`,
          sizeBytes: sql`excluded.size_bytes`,
          createdAt: sql`excluded.created_at`,
        },
      });
  }

  private async upsertDocuments(
    tx: Parameters<Parameters<DatabaseService["db"]["transaction"]>[0]>[0],
    snapshot: ArchiveSnapshot,
    ownerUserId: string,
  ) {
    if (snapshot.documents.length === 0) {
      return;
    }

    await tx
      .insert(documents)
      .values(
        snapshot.documents.map((row) => ({
          ...row,
          ownerUserId,
          amount: row.amount === null ? null : row.amount.toFixed(2),
          confidence: row.confidence === null ? null : row.confidence.toFixed(2),
          issueDate: this.parseDateOnly(row.issueDate),
          dueDate: this.parseDateOnly(row.dueDate),
          expiryDate: this.parseDateOnly(row.expiryDate),
          holderName: row.holderName,
          issuingAuthority: row.issuingAuthority,
          reviewedAt: row.reviewedAt ? this.parseTimestamp(row.reviewedAt) : null,
          createdAt: this.parseTimestamp(row.createdAt),
          processedAt: row.processedAt ? this.parseTimestamp(row.processedAt) : null,
          updatedAt: this.parseTimestamp(row.updatedAt),
        })),
      )
      .onConflictDoUpdate({
        target: documents.id,
        set: {
          ownerUserId,
          fileId: sql`excluded.file_id`,
          title: sql`excluded.title`,
          source: sql`excluded.source`,
          status: sql`excluded.status`,
          mimeType: sql`excluded.mime_type`,
          language: sql`excluded.language`,
          fullText: sql`excluded.full_text`,
          pageCount: sql`excluded.page_count`,
          issueDate: sql`excluded.issue_date`,
          dueDate: sql`excluded.due_date`,
          expiryDate: sql`excluded.expiry_date`,
          amount: sql`excluded.amount`,
          currency: sql`excluded.currency`,
          referenceNumber: sql`excluded.reference_number`,
          holderName: sql`excluded.holder_name`,
          issuingAuthority: sql`excluded.issuing_authority`,
          confidence: sql`excluded.confidence`,
          reviewStatus: sql`excluded.review_status`,
          reviewReasons: sql`excluded.review_reasons`,
          reviewedAt: sql`excluded.reviewed_at`,
          reviewNote: sql`excluded.review_note`,
          searchablePdfStorageKey: sql`excluded.searchable_pdf_storage_key`,
          parseProvider: sql`excluded.parse_provider`,
          chunkCount: sql`excluded.chunk_count`,
          embeddingStatus: sql`excluded.embedding_status`,
          embeddingProvider: sql`excluded.embedding_provider`,
          embeddingModel: sql`excluded.embedding_model`,
          lastProcessingError: sql`excluded.last_processing_error`,
          correspondentId: sql`excluded.correspondent_id`,
          documentTypeId: sql`excluded.document_type_id`,
          metadata: sql`excluded.metadata`,
          createdAt: sql`excluded.created_at`,
          processedAt: sql`excluded.processed_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  private async insertDocumentScopedRows(
    tx: Parameters<Parameters<DatabaseService["db"]["transaction"]>[0]>[0],
    snapshot: ArchiveSnapshot,
  ) {
    if (snapshot.documentTagLinks.length > 0) {
      await tx.insert(documentTagLinks).values(
        snapshot.documentTagLinks.map((row) => ({
          ...row,
          createdAt: this.parseTimestamp(row.createdAt),
        })),
      );
    }

    if (snapshot.documentPages.length > 0) {
      await tx.insert(documentPages).values(snapshot.documentPages);
    }

    if (snapshot.documentTextBlocks.length > 0) {
      await tx.insert(documentTextBlocks).values(snapshot.documentTextBlocks);
    }

    if (snapshot.documentChunks.length > 0) {
      await tx.insert(documentChunks).values(
        snapshot.documentChunks.map((row) => ({
          ...row,
          createdAt: this.parseTimestamp(row.createdAt),
        })),
      );
    }
  }

  private async upsertEmbeddings(
    tx: Parameters<Parameters<DatabaseService["db"]["transaction"]>[0]>[0],
    snapshot: ArchiveSnapshot,
  ) {
    for (const embedding of snapshot.documentChunkEmbeddings) {
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
          ${embedding.documentId}::uuid,
          ${embedding.chunkIndex},
          ${embedding.provider}::embedding_provider,
          ${embedding.model},
          ${embedding.dimensions},
          ${embedding.embeddingLiteral}::halfvec,
          ${embedding.contentHash},
          ${this.parseTimestamp(embedding.createdAt)}::timestamptz,
          ${this.parseTimestamp(embedding.updatedAt)}::timestamptz
        )
        ON CONFLICT (document_id, chunk_index, provider, model)
        DO UPDATE SET
          dimensions = EXCLUDED.dimensions,
          embedding = EXCLUDED.embedding,
          content_hash = EXCLUDED.content_hash,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at
      `);
    }
  }

  private async upsertProcessingJobs(
    tx: Parameters<Parameters<DatabaseService["db"]["transaction"]>[0]>[0],
    snapshot: ArchiveSnapshot,
  ) {
    if (snapshot.processingJobs.length === 0) {
      return;
    }

    await tx
      .insert(processingJobs)
      .values(
        snapshot.processingJobs.map((row) => ({
          ...row,
          startedAt: row.startedAt ? this.parseTimestamp(row.startedAt) : null,
          finishedAt: row.finishedAt ? this.parseTimestamp(row.finishedAt) : null,
          createdAt: this.parseTimestamp(row.createdAt),
          updatedAt: this.parseTimestamp(row.updatedAt),
        })),
      )
      .onConflictDoUpdate({
        target: processingJobs.id,
        set: {
          documentId: sql`excluded.document_id`,
          queueName: sql`excluded.queue_name`,
          status: sql`excluded.status`,
          attempts: sql`excluded.attempts`,
          payload: sql`excluded.payload`,
          lastError: sql`excluded.last_error`,
          startedAt: sql`excluded.started_at`,
          finishedAt: sql`excluded.finished_at`,
          createdAt: sql`excluded.created_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  private async upsertAuditEvents(
    tx: Parameters<Parameters<DatabaseService["db"]["transaction"]>[0]>[0],
    snapshot: ArchiveSnapshot,
    actorUserId: string,
  ) {
    if (snapshot.auditEvents.length === 0) {
      return;
    }

    await tx
      .insert(auditEvents)
      .values(
        snapshot.auditEvents.map((row) => ({
          ...row,
          actorUserId: row.actorUserId ? actorUserId : null,
          createdAt: this.parseTimestamp(row.createdAt),
        })),
      )
      .onConflictDoUpdate({
        target: auditEvents.id,
        set: {
          actorUserId: sql`excluded.actor_user_id`,
          documentId: sql`excluded.document_id`,
          eventType: sql`excluded.event_type`,
          payload: sql`excluded.payload`,
          createdAt: sql`excluded.created_at`,
        },
      });
  }

  private async listFilesRecursive(root: string): Promise<string[]> {
    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = join(root, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "processed" || entry.name === "failed") {
            return [];
          }

          return this.listFilesRecursive(fullPath);
        }

        return entry.isFile() ? [fullPath] : [];
      }),
    );

    return nested.flat();
  }

  private async finalizeWatchFolderItem(input: {
    configuredPath: string;
    sourcePath: string;
    relativePath: string;
    dryRun: boolean;
    action: WatchFolderScanItem["action"];
    reason: string;
    destinationDirectory: "processed" | "failed";
    mimeType: string | null;
    failureCode: WatchFolderScanItem["failureCode"];
    detail: string | null;
    checksum?: string;
    documentId?: string;
  }): Promise<WatchFolderScanItem> {
    if (input.dryRun) {
      return {
        path: input.sourcePath,
        action: input.action,
        destinationPath: null,
        documentId: input.documentId ?? null,
        reason: input.reason,
        mimeType: input.mimeType,
        failureCode: input.failureCode,
        detail: input.detail,
      };
    }

    const destinationPath = await this.moveWatchFolderFile({
      configuredPath: input.configuredPath,
      sourcePath: input.sourcePath,
      relativePath: input.relativePath,
      destinationDirectory: input.destinationDirectory,
      checksum: input.checksum,
    });

    return {
      path: input.sourcePath,
      action: input.action,
      destinationPath,
      documentId: input.documentId ?? null,
      reason: input.reason,
      mimeType: input.mimeType,
      failureCode: input.failureCode,
      detail: input.detail,
    };
  }

  private isSupportedWatchFolderMimeType(mimeType: string): boolean {
    return mimeType.startsWith("text/") || SUPPORTED_WATCH_FOLDER_MIME_TYPES.has(mimeType);
  }

  private buildWatchFolderSummary(items: WatchFolderScanItem[]): WatchFolderScanSummary {
    return {
      total: items.length,
      imported: items.filter((item) => item.action === "imported").length,
      duplicate: items.filter((item) => item.action === "duplicate").length,
      unsupported: items.filter((item) => item.action === "unsupported").length,
      failed: items.filter((item) => item.action === "failed").length,
      planned: items.filter((item) => item.action === "planned").length,
    };
  }

  private async listWatchFolderScanHistory(): Promise<WatchFolderScanHistoryItem[]> {
    const rows = await this.databaseService.db
      .select({
        id: auditEvents.id,
        createdAt: auditEvents.createdAt,
        payload: auditEvents.payload,
      })
      .from(auditEvents)
      .where(eq(auditEvents.eventType, "archive.watch_folder_scanned"))
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
      .limit(WATCH_FOLDER_SCAN_HISTORY_LIMIT);

    return rows.map((row) => {
      const payload =
        row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
          ? (row.payload as Record<string, unknown>)
          : {};

      return {
        scannedAt: row.createdAt.toISOString(),
        dryRun: payload.dryRun === true,
        imported: this.readWatchFolderHistoryCount(payload, "importedCount"),
        duplicate: this.readWatchFolderHistoryCount(payload, "duplicateCount"),
        unsupported: this.readWatchFolderHistoryCount(payload, "unsupportedCount"),
        failed: this.readWatchFolderHistoryCount(payload, "failedCount"),
        planned: this.readWatchFolderHistoryCount(payload, "plannedCount"),
      };
    });
  }

  private readWatchFolderHistoryCount(payload: Record<string, unknown>, key: string): number {
    const value = payload[key];
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
  }

  private async moveWatchFolderFile(input: {
    configuredPath: string;
    sourcePath: string;
    relativePath: string;
    destinationDirectory: "processed" | "failed";
    checksum?: string;
  }): Promise<string> {
    const targetBase = join(input.configuredPath, input.destinationDirectory, input.relativePath);
    let targetPath = targetBase;

    try {
      await mkdir(dirname(targetPath), { recursive: true });
      await rename(input.sourcePath, targetPath);
      return targetPath;
    } catch {
      const extension = extname(targetBase);
      const stem = targetBase.slice(0, targetBase.length - extension.length);
      targetPath = `${stem}.${input.checksum?.slice(0, 8) ?? "moved"}${extension}`;
      await mkdir(dirname(targetPath), { recursive: true });
      await rename(input.sourcePath, targetPath);
      return targetPath;
    }
  }

  private parseTimestamp(value: string): Date {
    return new Date(value);
  }

  private parseDateOnly(value: string | null): Date | null {
    if (!value) {
      return null;
    }

    return new Date(`${value}T00:00:00.000Z`);
  }
}
