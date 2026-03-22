import {
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
import { WatchFolderScanRequest, WatchFolderScanResponse } from "@openkeep/types";
import { createHash } from "crypto";
import { lookup as lookupMimeType } from "mime-types";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";

@Injectable()
export class ArchiveService {
  constructor(
    @Inject(AppConfigService) private readonly configService: AppConfigService,
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(ObjectStorageService) private readonly storageService: ObjectStorageService,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
  ) {}

  async exportSnapshot() {
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
        contentBase64: (
          await this.storageService.downloadToBuffer(file.storageKey).catch(() => null)
        )?.toString("base64"),
      })),
    );
    const fileContentMap = new Map(fileContents.map((item) => [item.id, item.contentBase64 ?? null]));

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

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      tags: tagRows,
      correspondents: correspondentRows,
      documentTypes: documentTypeRows,
      files: fileRows.map((file) => ({
        ...file,
        createdAt: file.createdAt.toISOString(),
        contentBase64: fileContentMap.get(file.id),
      })),
      documents: documentRows.map((document) => ({
        ...document,
        createdAt: document.createdAt.toISOString(),
        processedAt: document.processedAt?.toISOString() ?? null,
        updatedAt: document.updatedAt.toISOString(),
        reviewedAt: document.reviewedAt?.toISOString() ?? null,
      })),
      documentTagLinks: tagLinkRows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
      documentPages: pageRows,
      documentTextBlocks: textBlockRows,
      documentChunks: chunkRows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
      documentChunkEmbeddings: embeddingRows.rows.map((row) => ({
        documentId: row.document_id,
        chunkIndex: row.chunk_index,
        provider: row.provider,
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
    };
  }

  async importSnapshot(
    snapshot: Record<string, unknown>,
    principal: AuthenticatedPrincipal,
    mode: "replace" | "merge",
  ): Promise<{ imported: true }> {
    if (mode !== "replace") {
      throw new ConflictException("Only replace import mode is currently implemented");
    }

    const files = this.readArray(snapshot.files);
    const docs = this.readArray(snapshot.documents);
    const derivedObjects = this.readArray(snapshot.derivedObjects);
    const snapshotTags = this.readArray(snapshot.tags);
    const snapshotCorrespondents = this.readArray(snapshot.correspondents);
    const snapshotDocumentTypes = this.readArray(snapshot.documentTypes);
    const snapshotDocumentTagLinks = this.readArray(snapshot.documentTagLinks);
    const snapshotDocumentPages = this.readArray(snapshot.documentPages);
    const snapshotDocumentTextBlocks = this.readArray(snapshot.documentTextBlocks);
    const snapshotDocumentChunks = this.readArray(snapshot.documentChunks);
    const snapshotProcessingJobs = this.readArray(snapshot.processingJobs);
    const snapshotAuditEvents = this.readArray(snapshot.auditEvents);

    await this.databaseService.db.transaction(async (tx) => {
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

      if (snapshotTags.length > 0) {
        await tx.insert(tags).values(
          snapshotTags.map((row) => ({
            ...row,
            createdAt: this.parseTimestamp(row.createdAt),
          })) as typeof tags.$inferInsert[],
        );
      }
      if (snapshotCorrespondents.length > 0) {
        await tx
          .insert(correspondents)
          .values(
            snapshotCorrespondents.map((row) => ({
              ...row,
              createdAt: this.parseTimestamp(row.createdAt),
            })) as typeof correspondents.$inferInsert[],
          );
      }
      if (snapshotDocumentTypes.length > 0) {
        await tx
          .insert(documentTypes)
          .values(
            snapshotDocumentTypes.map((row) => ({
              ...row,
              createdAt: this.parseTimestamp(row.createdAt),
            })) as typeof documentTypes.$inferInsert[],
          );
      }
      if (files.length > 0) {
        await tx.insert(documentFiles).values(
          files.map((file) => ({
            ...file,
            createdAt: this.parseTimestamp(file.createdAt),
          })) as typeof documentFiles.$inferInsert[],
        );
      }
      if (docs.length > 0) {
        await tx.insert(documents).values(
          docs.map((document) => ({
            ...document,
            ownerUserId: principal.userId,
            createdAt: this.parseTimestamp(document.createdAt),
            processedAt: document.processedAt ? this.parseTimestamp(document.processedAt) : null,
            updatedAt: this.parseTimestamp(document.updatedAt),
            reviewedAt: document.reviewedAt ? this.parseTimestamp(document.reviewedAt) : null,
            issueDate: this.parseDateOnly(document.issueDate),
            dueDate: this.parseDateOnly(document.dueDate),
          })) as typeof documents.$inferInsert[],
        );
      }
      if (snapshotDocumentTagLinks.length > 0) {
        await tx.insert(documentTagLinks).values(
          snapshotDocumentTagLinks.map((row) => ({
            ...row,
            createdAt: this.parseTimestamp(row.createdAt),
          })) as typeof documentTagLinks.$inferInsert[],
        );
      }
      if (snapshotDocumentPages.length > 0) {
        await tx.insert(documentPages).values(
          snapshotDocumentPages as typeof documentPages.$inferInsert[],
        );
      }
      if (snapshotDocumentTextBlocks.length > 0) {
        await tx.insert(documentTextBlocks).values(
          snapshotDocumentTextBlocks as typeof documentTextBlocks.$inferInsert[],
        );
      }
      if (snapshotDocumentChunks.length > 0) {
        await tx.insert(documentChunks).values(
          snapshotDocumentChunks.map((row) => ({
            ...row,
            createdAt: this.parseTimestamp(row.createdAt),
          })) as typeof documentChunks.$inferInsert[],
        );
      }
      if (snapshotProcessingJobs.length > 0) {
        await tx.insert(processingJobs).values(
          snapshotProcessingJobs.map((row) => ({
            ...row,
            startedAt: row.startedAt ? this.parseTimestamp(row.startedAt) : null,
            finishedAt: row.finishedAt ? this.parseTimestamp(row.finishedAt) : null,
            createdAt: this.parseTimestamp(row.createdAt),
            updatedAt: this.parseTimestamp(row.updatedAt),
          })) as typeof processingJobs.$inferInsert[],
        );
      }
      if (snapshotAuditEvents.length > 0) {
        await tx.insert(auditEvents).values(
          snapshotAuditEvents.map((row) => ({
            ...row,
            actorUserId: row.actorUserId ? principal.userId : null,
            createdAt: this.parseTimestamp(row.createdAt),
          })) as typeof auditEvents.$inferInsert[],
        );
      }
    });

    for (const file of files) {
      if (typeof file.storageKey === "string" && typeof file.contentBase64 === "string") {
        await this.storageService.uploadBuffer(
          file.storageKey,
          Buffer.from(file.contentBase64, "base64"),
          typeof file.mimeType === "string" ? file.mimeType : "application/octet-stream",
        );
      }
    }

    for (const derived of derivedObjects) {
      if (typeof derived.storageKey === "string" && typeof derived.contentBase64 === "string") {
        await this.storageService.uploadBuffer(
          derived.storageKey,
          Buffer.from(derived.contentBase64, "base64"),
          "application/pdf",
        );
      }
    }

    const embeddings = this.readArray(snapshot.documentChunkEmbeddings);
    for (const embedding of embeddings) {
      await this.databaseService.pool.query(
        `INSERT INTO document_chunk_embeddings (
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
           $1::uuid,
           $2,
           $3::embedding_provider,
           $4,
           $5,
           $6::halfvec,
           $7,
           $8::timestamptz,
           $9::timestamptz
         )`,
        [
          embedding.documentId,
          embedding.chunkIndex,
          embedding.provider,
          embedding.model,
          embedding.dimensions,
          embedding.embeddingLiteral,
          embedding.contentHash,
          embedding.createdAt,
          embedding.updatedAt,
        ],
      );
    }

    await this.databaseService.db.insert(auditEvents).values({
      actorUserId: principal.userId,
      eventType: "archive.import_completed",
      payload: {
        version: snapshot.version ?? null,
        documentCount: docs.length,
      },
    });

    return { imported: true };
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
    const importedDocumentIds: string[] = [];
    const skippedFiles: string[] = [];
    const errors: string[] = [];

    for (const filePath of filePaths) {
      try {
        const buffer = await readFile(filePath);
        const checksum = createHash("sha256").update(buffer).digest("hex");
        const [existingFile] = await this.databaseService.db
          .select({ id: documentFiles.id })
          .from(documentFiles)
          .where(eq(documentFiles.checksum, checksum))
          .limit(1);

        if (existingFile) {
          skippedFiles.push(filePath);
          continue;
        }

        if (request.dryRun) {
          skippedFiles.push(filePath);
          continue;
        }

        const imported = await this.documentsService.uploadDocument({
          principal,
          buffer,
          filename: filePath.split("/").pop() ?? filePath,
          mimeType: lookupMimeType(filePath) || "application/octet-stream",
          metadata: {
            title: filePath.split("/").pop() ?? filePath,
            source: "watch-folder",
          },
        });
        importedDocumentIds.push(imported.id);
      } catch (error) {
        errors.push(
          `${filePath}: ${error instanceof Error ? error.message : "Unknown watch-folder error"}`,
        );
      }
    }

    await this.databaseService.db.insert(auditEvents).values({
      actorUserId: principal.userId,
      eventType: "archive.watch_folder_scanned",
      payload: {
        configuredPath,
        importedCount: importedDocumentIds.length,
        skippedCount: skippedFiles.length,
        errorCount: errors.length,
        dryRun: request.dryRun,
      },
    });

    return {
      configuredPath,
      importedDocumentIds,
      skippedFiles,
      errors,
    };
  }

  private async listFilesRecursive(root: string): Promise<string[]> {
    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = join(root, entry.name);
        if (entry.isDirectory()) {
          return this.listFilesRecursive(fullPath);
        }

        return entry.isFile() ? [fullPath] : [];
      }),
    );

    return nested.flat();
  }

  private readArray(value: unknown): Array<Record<string, any>> {
    return Array.isArray(value)
      ? value.filter((item): item is Record<string, any> => Boolean(item && typeof item === "object"))
      : [];
  }

  private parseTimestamp(value: unknown): Date {
    return new Date(String(value));
  }

  private parseDateOnly(value: unknown): Date | null {
    if (!value) {
      return null;
    }

    const raw = String(value);
    return new Date(raw.includes("T") ? raw : `${raw}T00:00:00.000Z`);
  }
}
