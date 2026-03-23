import { randomUUID } from "crypto";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { resolve } from "path";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { desc, eq, sql } from "drizzle-orm";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { GenericContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  correspondents,
  documentChunks,
  documentChunkEmbeddings,
  documentFiles,
  documentPages,
  documentTextBlocks,
  documentTypes,
  documents,
  processingJobs,
  tags,
} from "@openkeep/db";
import { createApp } from "../src/bootstrap";
import { DatabaseService } from "../src/common/db/database.service";
import { ObjectStorageService } from "../src/common/storage/storage.service";
import { DocumentsService } from "../src/documents/documents.service";
import { ExplorerService } from "../src/explorer/explorer.service";
import { padEmbedding, serializeHalfVector } from "../src/processing/embedding.util";
import { ProcessingService } from "../src/processing/processing.service";

const shouldRun = process.env.RUN_TESTCONTAINERS === "1";
const migrationsFolder = resolve(__dirname, "../../../packages/db/migrations");

describe.skipIf(!shouldRun)("API integration (Postgres + MinIO)", () => {
  let app: NestFastifyApplication;
  let databaseService: DatabaseService;
  let postgresContainer: Awaited<ReturnType<GenericContainer["start"]>>;
  let minioContainer: Awaited<ReturnType<GenericContainer["start"]>>;
  let storageService: ObjectStorageService;
  let processingService: ProcessingService;
  let documentsService: DocumentsService;
  let explorerService: ExplorerService;
  let accessToken = "";
  let apiToken = "";
  let ownerUserId = "";
  let watchFolderPath = "";
  const originalFetch = global.fetch;

  beforeAll(async () => {
    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://api.openai.com/v1/embeddings") {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        const inputs = Array.isArray(body.input) ? body.input : [body.input];
        return new Response(
          JSON.stringify({
            data: inputs.map((text: string, index: number) => ({
              index,
              embedding: text.toLowerCase().includes("invoice") ? [0.9, 0.1, 0.2] : [0.1, 0.9, 0.2],
            })),
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (url === "https://api.openai.com/v1/chat/completions") {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        const systemPrompt =
          typeof body?.messages?.[0]?.content === "string" ? body.messages[0].content : "";

        if (systemPrompt.includes("You summarize personal document correspondents")) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content:
                      "Adidas appears to be a recurring retailer in your archive. The documents are mainly invoices and receipts tied to purchases over time.",
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      }

      return originalFetch(input as any, init);
    }) as typeof fetch;

    postgresContainer = await new GenericContainer("pgvector/pgvector:pg16")
      .withEnvironment({
        POSTGRES_DB: "openkeep",
        POSTGRES_USER: "openkeep",
        POSTGRES_PASSWORD: "openkeep",
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage("database system is ready to accept connections"))
      .start();

    minioContainer = await new GenericContainer(
      "minio/minio:RELEASE.2025-02-18T16-25-55Z",
    )
      .withCommand(["server", "/data", "--console-address", ":9001"])
      .withEnvironment({
        MINIO_ROOT_USER: "openkeep",
        MINIO_ROOT_PASSWORD: "openkeep123",
      })
      .withExposedPorts(9000, 9001)
      .withWaitStrategy(Wait.forHttp("/minio/health/live", 9000))
      .start();

    process.env.NODE_ENV = "test";
    process.env.API_BASE_URL = "http://localhost:3000";
    process.env.PORT = "0";
    process.env.DATABASE_URL = `postgres://openkeep:openkeep@${postgresContainer.getHost()}:${postgresContainer.getMappedPort(5432)}/openkeep`;
    process.env.PG_BOSS_SCHEMA = "pgboss";
    process.env.MINIO_ENDPOINT = minioContainer.getHost();
    process.env.MINIO_PORT = String(minioContainer.getMappedPort(9000));
    process.env.MINIO_USE_SSL = "false";
    process.env.MINIO_ACCESS_KEY = "openkeep";
    process.env.MINIO_SECRET_KEY = "openkeep123";
    process.env.MINIO_BUCKET = "documents";
    process.env.JWT_ACCESS_SECRET = "test-access-secret-test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret-test-refresh-secret";
    process.env.OWNER_EMAIL = "owner@test.local";
    process.env.OWNER_PASSWORD = "super-secure-owner-password";
    process.env.OWNER_NAME = "OpenKeep Test Owner";
    process.env.ACTIVE_EMBEDDING_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
    process.env.SKIP_EXTERNAL_INIT = "false";
    process.env.OCR_LANGUAGES = "deu+eng";
    process.env.REVIEW_CONFIDENCE_THRESHOLD = "0.65";
    process.env.OCR_EMPTY_TEXT_THRESHOLD = "20";
    process.env.PROCESSING_RETRY_LIMIT = "2";
    process.env.PROCESSING_RETRY_DELAY_SECONDS = "1";
    watchFolderPath = await mkdtemp(`${tmpdir()}/openkeep-watch-`);
    process.env.WATCH_FOLDER_PATH = watchFolderPath;

    const { pool, db } = await import("@openkeep/db").then((module) =>
      module.createDatabase(process.env.DATABASE_URL!),
    );
    await migrate(db, { migrationsFolder });
    await pool.end();

    const created = await createApp();
    app = created.app;
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    databaseService = app.get(DatabaseService);
    storageService = app.get(ObjectStorageService);
    processingService = app.get(ProcessingService);
    documentsService = app.get(DocumentsService);
    explorerService = app.get(ExplorerService);

    const loginResponse = await request(app.getHttpServer()).post("/api/auth/login").send({
      email: process.env.OWNER_EMAIL,
      password: process.env.OWNER_PASSWORD,
    });
    accessToken = loginResponse.body.accessToken;

    const meResponse = await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);
    ownerUserId = meResponse.body.id;

    const apiTokenResponse = await request(app.getHttpServer())
      .post("/api/auth/tokens")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        name: "Integration token",
      });
    apiToken = apiTokenResponse.body.token;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }

    global.fetch = originalFetch;
    await rm(watchFolderPath, { recursive: true, force: true }).catch(() => undefined);

    await postgresContainer?.stop();
    await minioContainer?.stop();
  });

  it("authenticates via owner login and API token", async () => {
    const meResponse = await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(meResponse.status).toBe(200);
    expect(meResponse.body.email).toBe(process.env.OWNER_EMAIL);

    const documentsResponse = await request(app.getHttpServer())
      .get("/api/documents")
      .set("Authorization", `Bearer ${apiToken}`);

    expect(documentsResponse.status).toBe(200);
    expect(Array.isArray(documentsResponse.body.items)).toBe(true);
  });

  it("exposes readiness and metrics endpoints", async () => {
    const healthResponse = await request(app.getHttpServer()).get("/api/health");
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.body.status).toBe("ok");
    expect(healthResponse.body.provider.activeParseProvider).toBe("local-ocr");
    expect(healthResponse.body.provider.fallbackParseProvider).toBeNull();

    const readinessResponse = await request(app.getHttpServer()).get("/api/health/ready");
    expect(readinessResponse.status).toBe(200);
    expect(readinessResponse.body.status).toBe("ok");
    expect(readinessResponse.body.checks).toEqual({
      database: true,
      objectStorage: true,
      queue: true,
    });

    const metricsResponse = await request(app.getHttpServer()).get("/api/metrics");
    expect(metricsResponse.status).toBe(200);
    expect(metricsResponse.text).toContain("openkeep_uploads_total");
    expect(metricsResponse.text).toContain('openkeep_document_processing_queue_depth{queue="document.process"}');
    expect(metricsResponse.text).toContain(
      'openkeep_documents_pending_review_by_reason{reason="low_confidence"}',
    );
  });

  it("uploads duplicate binaries without duplicating object metadata", async () => {
    const payload = Buffer.from(
      "Invoice Number: TXT-123\nInvoice Date: 2025-01-10\nAmount Due: EUR 42,50\n",
      "utf8",
    );

    const firstUpload = await request(app.getHttpServer())
      .post("/api/documents")
      .set("Authorization", `Bearer ${accessToken}`)
      .field("title", "January invoice")
      .attach("file", payload, {
        filename: "invoice.txt",
        contentType: "text/plain",
      });

    const secondUpload = await request(app.getHttpServer())
      .post("/api/documents")
      .set("Authorization", `Bearer ${accessToken}`)
      .field("title", "January invoice duplicate")
      .attach("file", payload, {
        filename: "invoice-duplicate.txt",
        contentType: "text/plain",
      });

    expect(firstUpload.status).toBe(201);
    expect(secondUpload.status).toBe(201);

    const fileCount = await databaseService.pool.query<{ count: string }>(
      "SELECT count(*)::int AS count FROM document_files",
    );
    const documentCount = await databaseService.pool.query<{ count: string }>(
      "SELECT count(*)::int AS count FROM documents",
    );
    const processingJobCount = await databaseService.pool.query<{ count: string }>(
      "SELECT count(*)::int AS count FROM processing_jobs",
    );

    expect(Number(fileCount.rows[0]?.count ?? 0)).toBe(1);
    expect(Number(documentCount.rows[0]?.count ?? 0)).toBe(2);
    expect(Number(processingJobCount.rows[0]?.count ?? 0)).toBe(2);
  });

  it("supports search, facets, and review resolve/requeue flows", async () => {
    const [readyFile] = await databaseService.db
      .insert(documentFiles)
      .values({
        checksum: randomUUID().replace(/-/g, "").slice(0, 32).padEnd(64, "a"),
        storageKey: `fixtures/${randomUUID()}`,
        originalFilename: "invoice-2025.pdf",
        mimeType: "application/pdf",
        sizeBytes: 128,
      })
      .returning();

    const [reviewFile] = await databaseService.db
      .insert(documentFiles)
      .values({
        checksum: randomUUID().replace(/-/g, "").slice(0, 32).padEnd(64, "b"),
        storageKey: `fixtures/${randomUUID()}`,
        originalFilename: "review-me.pdf",
        mimeType: "application/pdf",
        sizeBytes: 256,
      })
      .returning();

    const [readyDocument] = await databaseService.db
      .insert(documents)
      .values({
        ownerUserId,
        fileId: readyFile.id,
        title: "Invoice 2025",
        mimeType: "application/pdf",
        status: "ready",
        reviewStatus: "not_required",
        parseProvider: "local-ocr",
        chunkCount: 2,
        fullText: "Invoice 2025 paid amount due",
        issueDate: new Date(Date.UTC(2025, 0, 10)),
        metadata: {
          parse: {
            strategy: "plain-text",
            warnings: [],
          },
          chunking: {
            strategyVersion: "normalized-parse-v1",
            chunkCount: 2,
          },
        },
        processedAt: new Date(),
      })
      .returning();

    const [reviewDocument] = await databaseService.db
      .insert(documents)
      .values({
        ownerUserId,
        fileId: reviewFile.id,
        title: "Needs review",
        mimeType: "application/pdf",
        status: "ready",
        reviewStatus: "pending",
        reviewReasons: ["low_confidence"],
        metadata: {
          reviewEvidence: {
            documentClass: "invoice",
            requiredFields: ["correspondent", "issueDate", "amount", "currency"],
            missingFields: ["currency"],
            extracted: {
              correspondent: true,
              issueDate: true,
              amount: true,
              currency: false,
            },
            activeReasons: ["low_confidence", "missing_key_fields"],
            confidence: 0.4,
            confidenceThreshold: 0.65,
            ocrTextLength: 24,
            ocrEmptyThreshold: 20,
          },
        },
        fullText: "Scanned invoice with unclear text",
        confidence: "0.40",
        processedAt: new Date(),
      })
      .returning();

    const searchResponse = await request(app.getHttpServer())
      .get("/api/search/documents")
      .set("Authorization", `Bearer ${accessToken}`)
      .query({
        query: "Invoice 2025",
        year: 2025,
      });

    expect(searchResponse.status).toBe(200);
    const matchingItem = searchResponse.body.items.find(
      (item: { id: string }) => item.id === readyDocument.id,
    );
    expect(Boolean(matchingItem)).toBe(true);
    expect(matchingItem.parseProvider).toBe("local-ocr");
    expect(matchingItem.chunkCount).toBe(2);

    const facetsResponse = await request(app.getHttpServer())
      .get("/api/documents/facets")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(facetsResponse.status).toBe(200);
    expect(facetsResponse.body.years.some((entry: { year: number }) => entry.year === 2025)).toBe(
      true,
    );

    const reviewQueueResponse = await request(app.getHttpServer())
      .get("/api/documents/review")
      .set("Authorization", `Bearer ${accessToken}`)
      .query({
        reason: "low_confidence",
      });

    expect(reviewQueueResponse.status).toBe(200);
    expect(
      reviewQueueResponse.body.items.some((item: { id: string }) => item.id === reviewDocument.id),
    ).toBe(true);

    const resolveResponse = await request(app.getHttpServer())
      .post(`/api/documents/${reviewDocument.id}/review/resolve`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        reviewNote: "Reviewed manually",
      });

    expect(resolveResponse.status).toBe(201);
    expect(resolveResponse.body.reviewStatus).toBe("resolved");
    expect(resolveResponse.body.metadata.reviewEvidence.missingFields).toEqual(["currency"]);

    await databaseService.db
      .update(documents)
      .set({
        reviewStatus: "pending",
        reviewReasons: ["low_confidence"],
      })
      .where(eq(documents.id, reviewDocument.id));

    const requeueResponse = await request(app.getHttpServer())
      .post(`/api/documents/${reviewDocument.id}/review/requeue`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    expect(requeueResponse.status).toBe(201);
    expect(requeueResponse.body.queued).toBe(true);

    const [updatedDocument] = await databaseService.db
      .select({
        reviewStatus: documents.reviewStatus,
        jobCount: sql<number>`(
          SELECT count(*)
          FROM processing_jobs pj
          WHERE pj.document_id = ${reviewDocument.id}
        )`,
      })
      .from(documents)
      .where(eq(documents.id, reviewDocument.id))
      .limit(1);

    expect(updatedDocument?.reviewStatus).toBe("not_required");
    expect(Number(updatedDocument?.jobCount ?? 0)).toBeGreaterThan(0);
  });

  it("downloads searchable PDFs separately from the original binary", async () => {
    const searchablePdfBuffer = Buffer.from("%PDF-1.4\n% OpenKeep searchable fixture\n", "utf8");
    const originalKey = `fixtures/${randomUUID()}/original.pdf`;
    const searchableKey = `fixtures/${randomUUID()}/searchable.pdf`;

    await storageService.uploadBuffer(originalKey, Buffer.from("original"), "application/pdf");
    await storageService.uploadBuffer(searchableKey, searchablePdfBuffer, "application/pdf");

    const [file] = await databaseService.db
      .insert(documentFiles)
      .values({
        checksum: randomUUID().replace(/-/g, "").slice(0, 32).padEnd(64, "c"),
        storageKey: originalKey,
        originalFilename: "statement.pdf",
        mimeType: "application/pdf",
        sizeBytes: 512,
      })
      .returning();

    const [searchableDocument] = await databaseService.db
      .insert(documents)
      .values({
        ownerUserId,
        fileId: file.id,
        title: "Statement",
        mimeType: "application/pdf",
        status: "ready",
        searchablePdfStorageKey: searchableKey,
      })
      .returning();

    const downloadable = await request(app.getHttpServer())
      .get(`/api/documents/${searchableDocument.id}/download/searchable`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(downloadable.status).toBe(200);
    expect(downloadable.header["content-type"]).toContain("application/pdf");
    expect(downloadable.header["content-disposition"]).toContain("statement.searchable.pdf");

    const [withoutDerivedFile] = await databaseService.db
      .insert(documentFiles)
      .values({
        checksum: randomUUID().replace(/-/g, "").slice(0, 32).padEnd(64, "d"),
        storageKey: `fixtures/${randomUUID()}/plain.pdf`,
        originalFilename: "plain.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
      })
      .returning();

    const [withoutDerivedDocument] = await databaseService.db
      .insert(documents)
      .values({
        ownerUserId,
        fileId: withoutDerivedFile.id,
        title: "Plain",
        mimeType: "application/pdf",
        status: "ready",
      })
      .returning();

    const missing = await request(app.getHttpServer())
      .get(`/api/documents/${withoutDerivedDocument.id}/download/searchable`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(missing.status).toBe(404);
  });

  it("supports semantic search, embedding summaries, and manual reindexing", async () => {
    const [invoiceFile] = await databaseService.db
      .insert(documentFiles)
      .values({
        checksum: randomUUID().replace(/-/g, "").slice(0, 32).padEnd(64, "e"),
        storageKey: `fixtures/${randomUUID()}/invoice.pdf`,
        originalFilename: "invoice-2025.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      })
      .returning();

    const [contractFile] = await databaseService.db
      .insert(documentFiles)
      .values({
        checksum: randomUUID().replace(/-/g, "").slice(0, 32).padEnd(64, "f"),
        storageKey: `fixtures/${randomUUID()}/contract.pdf`,
        originalFilename: "contract.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      })
      .returning();

    const [invoiceDocument] = await databaseService.db
      .insert(documents)
      .values({
        ownerUserId,
        fileId: invoiceFile.id,
        title: "Power invoice 2025",
        mimeType: "application/pdf",
        status: "ready",
        parseProvider: "local-ocr",
        chunkCount: 1,
        embeddingStatus: "ready",
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        fullText: "Invoice 2025 electricity bill amount due",
        issueDate: new Date(Date.UTC(2025, 1, 3)),
        metadata: {
          embedding: {
            configured: true,
            provider: "openai",
            model: "text-embedding-3-small",
            chunkCount: 1,
          },
        },
        processedAt: new Date(),
      })
      .returning();

    const [contractDocument] = await databaseService.db
      .insert(documents)
      .values({
        ownerUserId,
        fileId: contractFile.id,
        title: "Insurance contract",
        mimeType: "application/pdf",
        status: "ready",
        parseProvider: "local-ocr",
        chunkCount: 1,
        embeddingStatus: "ready",
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        fullText: "Insurance contract coverage and policy terms",
        metadata: {
          embedding: {
            configured: true,
            provider: "openai",
            model: "text-embedding-3-small",
            chunkCount: 1,
          },
        },
        processedAt: new Date(),
      })
      .returning();

    await databaseService.db.insert(documentChunks).values([
      {
        documentId: invoiceDocument.id,
        chunkIndex: 0,
        heading: "Invoice",
        text: "Invoice 2025 electricity bill from municipal utility.",
        pageFrom: 1,
        pageTo: 1,
        strategyVersion: "normalized-parse-v1",
        contentHash: "1".repeat(64),
        metadata: {},
      },
      {
        documentId: contractDocument.id,
        chunkIndex: 0,
        heading: "Contract",
        text: "Insurance contract and policy terms for home coverage.",
        pageFrom: 1,
        pageTo: 1,
        strategyVersion: "normalized-parse-v1",
        contentHash: "2".repeat(64),
        metadata: {},
      },
    ]);

    await databaseService.pool.query(
      `INSERT INTO document_chunk_embeddings (
        document_id,
        chunk_index,
        provider,
        model,
        dimensions,
        embedding,
        content_hash
      )
      VALUES
        ($1::uuid, 0, 'openai', 'text-embedding-3-small', 3, $2::halfvec, $3),
        ($4::uuid, 0, 'openai', 'text-embedding-3-small', 3, $5::halfvec, $6)`,
      [
        invoiceDocument.id,
        serializeHalfVector(padEmbedding([0.9, 0.1, 0.2])),
        "1".repeat(64),
        contractDocument.id,
        serializeHalfVector(padEmbedding([0.1, 0.9, 0.2])),
        "2".repeat(64),
      ],
    );

    const semanticResponse = await request(app.getHttpServer())
      .post("/api/search/semantic")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        query: "all invoices from 2025",
        filters: {
          year: 2025,
        },
      });

    expect(semanticResponse.status).toBe(201);
    expect(semanticResponse.body.total).toBeGreaterThanOrEqual(1);
    expect(semanticResponse.body.items[0]?.document.id).toBe(invoiceDocument.id);
    expect(semanticResponse.body.items[0]?.matchedChunks[0]?.text).toContain("electricity bill");

    const docResponse = await request(app.getHttpServer())
      .get(`/api/documents/${invoiceDocument.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(docResponse.status).toBe(200);
    expect(docResponse.body.embeddingStatus).toBe("ready");
    expect(docResponse.body.embeddingProvider).toBe("openai");
    expect(docResponse.body.embeddingModel).toBe("text-embedding-3-small");
    expect(docResponse.body.latestProcessingJob).toBeNull();

    await databaseService.db
      .update(documentChunks)
      .set({
        contentHash: "3".repeat(64),
      })
      .where(eq(documentChunks.documentId, invoiceDocument.id));

    const staleResponse = await request(app.getHttpServer())
      .get(`/api/documents/${invoiceDocument.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(staleResponse.status).toBe(200);
    expect(staleResponse.body.embeddingStatus).toBe("stale");
    expect(staleResponse.body.embeddingsStale).toBe(true);

    const reindexResponse = await request(app.getHttpServer())
      .post("/api/embeddings/reindex")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        documentIds: [invoiceDocument.id, contractDocument.id],
        scope: "stale",
      });

    expect(reindexResponse.status).toBe(201);
    expect(reindexResponse.body.queued).toBe(1);
    expect(reindexResponse.body.totalTargets).toBe(1);

    const [embeddingJob] = await databaseService.db
      .select({
        queueName: processingJobs.queueName,
        payload: processingJobs.payload,
      })
      .from(processingJobs)
      .where(eq(processingJobs.documentId, invoiceDocument.id))
      .orderBy(desc(processingJobs.createdAt))
      .limit(1);

    expect(embeddingJob?.queueName).toBe("document.embed");

    const metricsResponse = await request(app.getHttpServer()).get("/api/metrics");
    expect(metricsResponse.status).toBe(200);
    expect(metricsResponse.text).toContain("openkeep_embedding_documents_stale");
    expect(metricsResponse.text).toContain('openkeep_document_processing_queue_depth{queue="document.embed"}');
  });

  it("preserves manual overrides across reprocessing and exposes document history", async () => {
    const uploadResponse = await request(app.getHttpServer())
      .post("/api/documents")
      .set("Authorization", `Bearer ${accessToken}`)
      .field("title", "Override invoice")
      .attach(
        "file",
        Buffer.from(
          "Invoice Number: TXT-999\nInvoice Date: 2025-02-10\nAmount Due: EUR 42,50\n",
          "utf8",
        ),
        {
          filename: "override-invoice.txt",
          contentType: "text/plain",
        },
      );

    expect(uploadResponse.status).toBe(201);
    const documentId = uploadResponse.body.id as string;

    await processingService.processDocument({
      documentId,
      force: true,
      parseProvider: "local-ocr",
    });

    const patchResponse = await request(app.getHttpServer())
      .patch(`/api/documents/${documentId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        amount: 99.99,
        currency: "USD",
      });

    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body.metadata.manual.lockedFields).toEqual(
      expect.arrayContaining(["amount", "currency"]),
    );

    await processingService.processDocument({
      documentId,
      force: true,
      parseProvider: "local-ocr",
    });

    const documentResponse = await request(app.getHttpServer())
      .get(`/api/documents/${documentId}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(documentResponse.status).toBe(200);
    expect(documentResponse.body.amount).toBe(99.99);
    expect(documentResponse.body.currency).toBe("USD");

    const historyResponse = await request(app.getHttpServer())
      .get(`/api/documents/${documentId}/history`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(historyResponse.status).toBe(200);
    expect(
      historyResponse.body.items.some((item: { eventType: string }) => item.eventType === "document.uploaded"),
    ).toBe(true);
    expect(
      historyResponse.body.items.some(
        (item: { eventType: string }) => item.eventType === "document.metadata_updated",
      ),
    ).toBe(true);
  });

  it("answers grounded questions with citations", async () => {
    const uploadResponse = await request(app.getHttpServer())
      .post("/api/documents")
      .set("Authorization", `Bearer ${accessToken}`)
      .field("title", "Answered invoice")
      .attach(
        "file",
        Buffer.from(
          "Invoice Number: TXT-321\nInvoice Date: 2025-03-01\nAmount Due: EUR 17,20\n",
          "utf8",
        ),
        {
          filename: "answer-invoice.txt",
          contentType: "text/plain",
        },
      );

    const documentId = uploadResponse.body.id as string;
    await processingService.processDocument({
      documentId,
      force: true,
      parseProvider: "local-ocr",
    });
    await processingService.processDocumentEmbedding({
      documentId,
      force: true,
      retryCount: 0,
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
    });

    const answerResponse = await request(app.getHttpServer())
      .post("/api/search/answer")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        query: "What is the invoice amount due?",
      });

    expect(answerResponse.status).toBe(201);
    expect(answerResponse.body.status).toBe("answered");
    expect(answerResponse.body.citations.length).toBeGreaterThan(0);
    expect(answerResponse.body.results.length).toBeGreaterThan(0);
    expect(
      answerResponse.body.results.some(
        (item: { document: { id: string } }) => item.document.id === documentId,
      ),
    ).toBe(true);
  });

  it("supports taxonomy CRUD and merge operations", async () => {
    const targetName = `Finance ${randomUUID().slice(0, 8)}`;
    const sourceName = `Bills ${randomUUID().slice(0, 8)}`;
    const createTargetResponse = await request(app.getHttpServer())
      .post("/api/taxonomies/tags")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: targetName });
    const createSourceResponse = await request(app.getHttpServer())
      .post("/api/taxonomies/tags")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: sourceName });

    expect(createTargetResponse.status).toBe(201);
    expect(createSourceResponse.status).toBe(201);

    const [file] = await databaseService.db
      .insert(documentFiles)
      .values({
        checksum: randomUUID().replace(/-/g, "").slice(0, 32).padEnd(64, "9"),
        storageKey: `fixtures/${randomUUID()}/merge.pdf`,
        originalFilename: "merge.pdf",
        mimeType: "application/pdf",
        sizeBytes: 128,
      })
      .returning();

    const [document] = await databaseService.db
      .insert(documents)
      .values({
        ownerUserId,
        fileId: file.id,
        title: "Merge me",
        mimeType: "application/pdf",
        status: "ready",
      })
      .returning();

    await databaseService.pool.query(
      `INSERT INTO document_tag_links (document_id, tag_id) VALUES ($1::uuid, $2::uuid)`,
      [document.id, createSourceResponse.body.id],
    );

    const mergeResponse = await request(app.getHttpServer())
      .post(`/api/taxonomies/tags/${createSourceResponse.body.id}/merge`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        targetId: createTargetResponse.body.id,
      });

    expect(mergeResponse.status).toBe(201);
    expect(mergeResponse.body.id).toBe(createTargetResponse.body.id);

    const tagLinkCount = await databaseService.pool.query<{ count: string }>(
      `SELECT count(*)::int AS count
       FROM document_tag_links
       WHERE document_id = $1::uuid AND tag_id = $2::uuid`,
      [document.id, createTargetResponse.body.id],
    );
    const deletedSource = await databaseService.db
      .select()
      .from(tags)
      .where(eq(tags.id, createSourceResponse.body.id));

    expect(Number(tagLinkCount.rows[0]?.count ?? 0)).toBe(1);
    expect(deletedSource).toHaveLength(0);
  });

  it("serves explorer dashboard, correspondent insights, timeline, and projection", async () => {
    const [correspondent] = await databaseService.db
      .insert(correspondents)
      .values({
        name: "Adidas",
        slug: `adidas-${randomUUID().slice(0, 8)}`,
        normalizedName: "adidas",
      })
      .returning();

    const [documentType] = await databaseService.db
      .insert(documentTypes)
      .values({
        name: "Invoice",
        slug: `invoice-${randomUUID().slice(0, 8)}`,
        description: "Billing document",
      })
      .returning();

    const [fileA] = await databaseService.db
      .insert(documentFiles)
      .values({
        checksum: randomUUID().replace(/-/g, "").slice(0, 32).padEnd(64, "c"),
        storageKey: `fixtures/${randomUUID()}/adidas-a.pdf`,
        originalFilename: "adidas-a.pdf",
        mimeType: "application/pdf",
        sizeBytes: 128,
      })
      .returning();
    const [fileB] = await databaseService.db
      .insert(documentFiles)
      .values({
        checksum: randomUUID().replace(/-/g, "").slice(0, 32).padEnd(64, "d"),
        storageKey: `fixtures/${randomUUID()}/adidas-b.pdf`,
        originalFilename: "adidas-b.pdf",
        mimeType: "application/pdf",
        sizeBytes: 128,
      })
      .returning();

    const [documentA] = await databaseService.db
      .insert(documents)
      .values({
        ownerUserId,
        fileId: fileA.id,
        title: "Adidas Invoice March",
        mimeType: "application/pdf",
        status: "ready",
        issueDate: new Date("2026-03-10"),
        dueDate: new Date("2026-03-31"),
        amount: "149.99",
        currency: "EUR",
        correspondentId: correspondent.id,
        documentTypeId: documentType.id,
        fullText: "Adidas invoice for shoes and sportswear.",
        chunkCount: 1,
        embeddingStatus: "ready",
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
      } as never)
      .returning();
    const [documentB] = await databaseService.db
      .insert(documents)
      .values({
        ownerUserId,
        fileId: fileB.id,
        title: "Adidas Receipt February",
        mimeType: "application/pdf",
        status: "ready",
        issueDate: new Date("2026-02-18"),
        amount: "89.50",
        currency: "EUR",
        correspondentId: correspondent.id,
        documentTypeId: documentType.id,
        fullText: "Adidas receipt for an online order.",
        chunkCount: 1,
        embeddingStatus: "ready",
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
      } as never)
      .returning();

    await databaseService.db.insert(documentChunks).values([
      {
        documentId: documentA.id,
        chunkIndex: 0,
        heading: "Invoice",
        text: "Adidas invoice for shoes and sportswear.",
        pageFrom: 1,
        pageTo: 1,
        strategyVersion: "test",
        contentHash: "a".repeat(64),
      },
      {
        documentId: documentB.id,
        chunkIndex: 0,
        heading: "Receipt",
        text: "Adidas receipt for an online order.",
        pageFrom: 1,
        pageTo: 1,
        strategyVersion: "test",
        contentHash: "b".repeat(64),
      },
    ]);

    await databaseService.pool.query(
      `INSERT INTO document_chunk_embeddings
        (document_id, chunk_index, provider, model, dimensions, embedding, content_hash)
       VALUES
        ($1::uuid, 0, 'openai', 'text-embedding-3-small', 3072, '${serializeHalfVector(
          padEmbedding([0.91, 0.11, 0.22]),
        )}'::halfvec, $2),
        ($3::uuid, 0, 'openai', 'text-embedding-3-small', 3072, '${serializeHalfVector(
          padEmbedding([0.88, 0.18, 0.2]),
        )}'::halfvec, $4)`,
      [documentA.id, "a".repeat(64), documentB.id, "b".repeat(64)],
    );

    const dashboardResponse = await request(app.getHttpServer())
      .get("/api/dashboard/insights")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(dashboardResponse.status).toBe(200);
    expect(
      dashboardResponse.body.topCorrespondents.some(
        (item: { name: string }) => item.name === "Adidas",
      ),
    ).toBe(true);

    const pendingInsightsResponse = await request(app.getHttpServer())
      .get(`/api/correspondents/${correspondent.slug}/insights`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(pendingInsightsResponse.status).toBe(200);
    expect(pendingInsightsResponse.body.summaryStatus).toBe("pending");
    expect(pendingInsightsResponse.body.stats.documentCount).toBeGreaterThanOrEqual(2);

    await explorerService.refreshCorrespondentSummary(correspondent.id);

    const readyInsightsResponse = await request(app.getHttpServer())
      .get(`/api/correspondents/${correspondent.slug}/insights`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(readyInsightsResponse.status).toBe(200);
    expect(readyInsightsResponse.body.summaryStatus).toBe("ready");
    expect(String(readyInsightsResponse.body.summary)).toContain("recurring retailer");

    const timelineResponse = await request(app.getHttpServer())
      .get(`/api/documents/timeline?correspondentIds=${correspondent.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(timelineResponse.status).toBe(200);
    expect(timelineResponse.body.years.length).toBeGreaterThan(0);
    expect(timelineResponse.body.years[0].months.length).toBeGreaterThan(0);

    const projectionResponse = await request(app.getHttpServer())
      .get(`/api/documents/projection?correspondentIds=${correspondent.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(projectionResponse.status).toBe(200);
    expect(projectionResponse.body.points.length).toBeGreaterThanOrEqual(2);
    expect(
      projectionResponse.body.points.every(
        (point: { x: number; y: number }) =>
          point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1,
      ),
    ).toBe(true);

    await databaseService.pool.query(
      `DELETE FROM document_chunk_embeddings WHERE document_id = ANY($1::uuid[])`,
      [[documentA.id, documentB.id]],
    );
    await databaseService.pool.query(
      `DELETE FROM document_chunks WHERE document_id = ANY($1::uuid[])`,
      [[documentA.id, documentB.id]],
    );
    await databaseService.pool.query(
      `DELETE FROM documents WHERE id = ANY($1::uuid[])`,
      [[documentA.id, documentB.id]],
    );
    await databaseService.pool.query(
      `DELETE FROM document_files WHERE id = ANY($1::uuid[])`,
      [[fileA.id, fileB.id]],
    );
    await databaseService.pool.query(
      `DELETE FROM document_types WHERE id = $1::uuid`,
      [documentType.id],
    );
    await databaseService.pool.query(
      `DELETE FROM correspondents WHERE id = $1::uuid`,
      [correspondent.id],
    );
  });

  it("scans the watch folder and exports and imports archive snapshots", async () => {
    const watchedFile = resolve(watchFolderPath, "watch-invoice.txt");
    await writeFile(
      watchedFile,
      "Invoice Number: WATCH-1\nInvoice Date: 2025-04-02\nAmount Due: EUR 55,00\n",
      "utf8",
    );

    const firstScan = await request(app.getHttpServer())
      .post("/api/archive/watch-folder/scan")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    expect(firstScan.status).toBe(201);
    expect(firstScan.body.summary.imported).toBe(1);
    expect(firstScan.body.items).toHaveLength(1);
    expect(firstScan.body.items[0]?.action).toBe("imported");
    expect(firstScan.body.items[0]?.documentId).toBeDefined();
    expect(firstScan.body.items[0]?.destinationPath).toContain("processed");
    expect(firstScan.body.items[0]?.mimeType).toBe("text/plain");
    expect(firstScan.body.items[0]?.failureCode).toBeNull();

    await writeFile(
      watchedFile,
      "Invoice Number: WATCH-1\nInvoice Date: 2025-04-02\nAmount Due: EUR 55,00\n",
      "utf8",
    );

    const secondScan = await request(app.getHttpServer())
      .post("/api/archive/watch-folder/scan")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    expect(secondScan.status).toBe(201);
    expect(secondScan.body.summary.duplicate).toBe(1);
    expect(secondScan.body.items).toHaveLength(1);
    expect(secondScan.body.items[0]?.action).toBe("duplicate");
    expect(secondScan.body.items[0]?.path).toContain("watch-invoice.txt");
    expect(secondScan.body.items[0]?.reason).toBe("duplicate_checksum");
    expect(secondScan.body.items[0]?.mimeType).toBe("text/plain");
    expect(secondScan.body.items[0]?.failureCode).toBeNull();
    expect(secondScan.body.history.length).toBeGreaterThan(0);

    const exportResponse = await request(app.getHttpServer())
      .get("/api/archive/export")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(exportResponse.status).toBe(200);
    expect(exportResponse.body.version).toBe(1);
    expect(exportResponse.body.documents.length).toBeGreaterThan(0);
    expect(
      exportResponse.body.files.some(
        (file: { contentBase64: string | null }) => typeof file.contentBase64 === "string",
      ),
    ).toBe(true);

    const importableSnapshot = {
      ...exportResponse.body,
      files: exportResponse.body.files.map((file: { contentBase64: string | null }) => ({
        ...file,
        contentBase64:
          file.contentBase64 ?? Buffer.from("placeholder-binary", "utf8").toString("base64"),
      })),
      derivedObjects: exportResponse.body.derivedObjects.map(
        (object: { contentBase64: string | null }) => ({
          ...object,
          contentBase64:
            object.contentBase64 ??
            Buffer.from("placeholder-derived", "utf8").toString("base64"),
        }),
      ),
    };

    const importResponse = await request(app.getHttpServer())
      .post("/api/archive/import")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        mode: "replace",
        snapshot: importableSnapshot,
      });

    expect(importResponse.status).toBe(201);
    expect(importResponse.body.imported).toBe(true);

    const documentsResponse = await request(app.getHttpServer())
      .get("/api/documents")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(documentsResponse.status).toBe(200);
    expect(documentsResponse.body.total).toBe(exportResponse.body.documents.length);
  });

  it("reports unsupported watch-folder MIME types with machine-readable failure details", async () => {
    const unsupportedFile = resolve(watchFolderPath, `unsupported-${randomUUID()}.bin`);
    await writeFile(unsupportedFile, Buffer.from([0xde, 0xad, 0xbe, 0xef]));

    const scanResponse = await request(app.getHttpServer())
      .post("/api/archive/watch-folder/scan")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    expect(scanResponse.status).toBe(201);
    expect(scanResponse.body.summary.unsupported).toBe(1);
    expect(scanResponse.body.items).toHaveLength(1);
    expect(scanResponse.body.items[0]?.action).toBe("unsupported");
    expect(scanResponse.body.items[0]?.reason).toBe("unsupported_file_type");
    expect(scanResponse.body.items[0]?.failureCode).toBe("mime_type_not_allowed");
    expect(scanResponse.body.items[0]?.mimeType).toBe("application/octet-stream");
    expect(String(scanResponse.body.items[0]?.detail)).toContain("Unsupported watch-folder MIME type");
    expect(scanResponse.body.items[0]?.destinationPath).toContain("/failed/");
    expect(scanResponse.body.history.length).toBeGreaterThan(0);
  });

  it("reports upload failures from the watch folder with structured error details", async () => {
    const failingFile = resolve(watchFolderPath, `upload-fails-${randomUUID()}.txt`);
    await writeFile(
      failingFile,
      "Invoice Number: FAIL-1\nInvoice Date: 2025-05-01\nAmount Due: EUR 19,99\n",
      "utf8",
    );

    const uploadSpy = vi
      .spyOn(documentsService, "uploadDocument")
      .mockRejectedValueOnce(new Error("simulated upload failure"));

    try {
      const scanResponse = await request(app.getHttpServer())
        .post("/api/archive/watch-folder/scan")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({});

      expect(scanResponse.status).toBe(201);
      expect(scanResponse.body.summary.failed).toBe(1);
      expect(scanResponse.body.items).toHaveLength(1);
      expect(scanResponse.body.items[0]?.action).toBe("failed");
      expect(scanResponse.body.items[0]?.reason).toBe("upload_failed");
      expect(scanResponse.body.items[0]?.failureCode).toBe("upload_failed");
      expect(scanResponse.body.items[0]?.mimeType).toBe("text/plain");
      expect(scanResponse.body.items[0]?.detail).toContain("simulated upload failure");
      expect(scanResponse.body.items[0]?.destinationPath).toContain("/failed/");
      expect(scanResponse.body.history.length).toBeGreaterThan(0);
    } finally {
      uploadSpy.mockRestore();
    }
  });

  it("merges partial archive snapshots by replacing scoped rows and preserving untouched documents", async () => {
    const timestamp = new Date().toISOString();
    const oldTagId = randomUUID();
    const replacementTagId = randomUUID();
    const targetFileKey = `fixtures/${randomUUID()}/merge-target.pdf`;
    const untouchedFileKey = `fixtures/${randomUUID()}/merge-untouched.pdf`;
    const targetDerivedKey = `fixtures/${randomUUID()}/merge-target.searchable.pdf`;
    const replacementDerivedKey = `fixtures/${randomUUID()}/merge-target.replaced.searchable.pdf`;

    await storageService.uploadBuffer(
      targetFileKey,
      Buffer.from("target-file-original", "utf8"),
      "application/pdf",
    );
    await storageService.uploadBuffer(
      untouchedFileKey,
      Buffer.from("untouched-file-original", "utf8"),
      "application/pdf",
    );
    await storageService.uploadBuffer(
      targetDerivedKey,
      Buffer.from("%PDF-target-original", "utf8"),
      "application/pdf",
    );
    await storageService.uploadBuffer(
      replacementDerivedKey,
      Buffer.from("%PDF-target-replaced", "utf8"),
      "application/pdf",
    );

    await databaseService.db.insert(tags).values({
      id: oldTagId,
      name: `Legacy ${randomUUID().slice(0, 8)}`,
      slug: `legacy-${randomUUID().slice(0, 8)}`,
    });

    const [targetFile] = await databaseService.db
      .insert(documentFiles)
      .values({
        checksum: "a".repeat(64),
        storageKey: targetFileKey,
        originalFilename: "merge-target.pdf",
        mimeType: "application/pdf",
        sizeBytes: 256,
      })
      .returning();

    const [untouchedFile] = await databaseService.db
      .insert(documentFiles)
      .values({
        checksum: "b".repeat(64),
        storageKey: untouchedFileKey,
        originalFilename: "merge-untouched.pdf",
        mimeType: "application/pdf",
        sizeBytes: 256,
      })
      .returning();

    const [targetDocument] = await databaseService.db
      .insert(documents)
      .values({
        ownerUserId,
        fileId: targetFile.id,
        title: "Merge target before",
        source: "upload",
        mimeType: "application/pdf",
        status: "ready",
        fullText: "old target text",
        pageCount: 1,
        reviewStatus: "not_required",
        searchablePdfStorageKey: targetDerivedKey,
        parseProvider: "local-ocr",
        chunkCount: 1,
        embeddingStatus: "ready",
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        metadata: {
          parse: {
            provider: "local-ocr",
            strategy: "fixture-old",
          },
          chunking: {
            strategy: "normalized-parse-v1",
            chunkCount: 1,
          },
        },
        processedAt: new Date(),
      })
      .returning();

    const [untouchedDocument] = await databaseService.db
      .insert(documents)
      .values({
        ownerUserId,
        fileId: untouchedFile.id,
        title: "Merge untouched",
        source: "upload",
        mimeType: "application/pdf",
        status: "ready",
        fullText: "untouched text",
        pageCount: 1,
        reviewStatus: "not_required",
        parseProvider: "local-ocr",
        chunkCount: 1,
        embeddingStatus: "ready",
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        metadata: {
          parse: {
            provider: "local-ocr",
            strategy: "fixture-untouched",
          },
          chunking: {
            strategy: "normalized-parse-v1",
            chunkCount: 1,
          },
        },
        processedAt: new Date(),
      })
      .returning();

    await databaseService.pool.query(
      `INSERT INTO document_tag_links (document_id, tag_id) VALUES
        ($1::uuid, $2::uuid),
        ($3::uuid, $2::uuid)`,
      [targetDocument.id, oldTagId, untouchedDocument.id],
    );

    await databaseService.db.insert(documentPages).values([
      {
        id: randomUUID(),
        documentId: targetDocument.id,
        pageNumber: 1,
        width: 1200,
        height: 1600,
      },
      {
        id: randomUUID(),
        documentId: untouchedDocument.id,
        pageNumber: 1,
        width: 1200,
        height: 1600,
      },
    ]);

    await databaseService.db.insert(documentTextBlocks).values([
      {
        id: randomUUID(),
        documentId: targetDocument.id,
        pageNumber: 1,
        lineIndex: 0,
        boundingBox: { x: 0, y: 0, width: 100, height: 20 },
        text: "old target block",
      },
      {
        id: randomUUID(),
        documentId: untouchedDocument.id,
        pageNumber: 1,
        lineIndex: 0,
        boundingBox: { x: 0, y: 0, width: 100, height: 20 },
        text: "untouched block",
      },
    ]);

    await databaseService.db.insert(documentChunks).values([
      {
        id: randomUUID(),
        documentId: targetDocument.id,
        chunkIndex: 0,
        heading: "Before",
        text: "old target chunk",
        pageFrom: 1,
        pageTo: 1,
        strategyVersion: "normalized-parse-v1",
        contentHash: "1".repeat(64),
        metadata: {},
      },
      {
        id: randomUUID(),
        documentId: untouchedDocument.id,
        chunkIndex: 0,
        heading: "Untouched",
        text: "untouched chunk",
        pageFrom: 1,
        pageTo: 1,
        strategyVersion: "normalized-parse-v1",
        contentHash: "2".repeat(64),
        metadata: {},
      },
    ]);

    await databaseService.pool.query(
      `INSERT INTO document_chunk_embeddings (
        document_id,
        chunk_index,
        provider,
        model,
        dimensions,
        embedding,
        content_hash
      )
      VALUES
        ($1::uuid, 0, 'openai', 'text-embedding-3-small', 3, $2::halfvec, $3),
        ($4::uuid, 0, 'openai', 'text-embedding-3-small', 3, $5::halfvec, $6)`,
      [
        targetDocument.id,
        serializeHalfVector(padEmbedding([0.9, 0.1, 0.2])),
        "1".repeat(64),
        untouchedDocument.id,
        serializeHalfVector(padEmbedding([0.1, 0.9, 0.2])),
        "2".repeat(64),
      ],
    );

    const mergeResponse = await request(app.getHttpServer())
      .post("/api/archive/import")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        mode: "merge",
        snapshot: {
          version: 1,
          exportedAt: timestamp,
          tags: [
            {
              id: replacementTagId,
              name: "Merged replacement",
              slug: `merged-replacement-${randomUUID().slice(0, 8)}`,
              createdAt: timestamp,
            },
          ],
          correspondents: [],
          documentTypes: [],
          files: [
            {
              id: targetFile.id,
              checksum: "c".repeat(64),
              storageKey: targetFileKey,
              originalFilename: "merge-target-updated.pdf",
              mimeType: "application/pdf",
              sizeBytes: 512,
              createdAt: timestamp,
              contentBase64: Buffer.from("target-file-replaced", "utf8").toString("base64"),
            },
          ],
          documents: [
            {
              id: targetDocument.id,
              ownerUserId,
              fileId: targetFile.id,
              title: "Merge target after",
              source: "upload",
              status: "ready",
              mimeType: "application/pdf",
              language: "en",
              fullText: "new target text",
              pageCount: 1,
              issueDate: "2025-06-01",
              dueDate: null,
              amount: 19.99,
              currency: "EUR",
              referenceNumber: "MERGED-42",
              confidence: 0.91,
              reviewStatus: "not_required",
              reviewReasons: [],
              reviewedAt: null,
              reviewNote: null,
              searchablePdfStorageKey: replacementDerivedKey,
              parseProvider: "local-ocr",
              chunkCount: 1,
              embeddingStatus: "ready",
              embeddingProvider: "openai",
              embeddingModel: "text-embedding-3-small",
              lastProcessingError: null,
              correspondentId: null,
              documentTypeId: null,
              metadata: {
                parse: {
                  provider: "local-ocr",
                  strategy: "fixture-new",
                },
                chunking: {
                  strategy: "normalized-parse-v1",
                  chunkCount: 1,
                },
              },
              createdAt: timestamp,
              processedAt: timestamp,
              updatedAt: timestamp,
            },
          ],
          documentTagLinks: [
            {
              documentId: targetDocument.id,
              tagId: replacementTagId,
              createdAt: timestamp,
            },
          ],
          documentPages: [
            {
              id: randomUUID(),
              documentId: targetDocument.id,
              pageNumber: 1,
              width: 1400,
              height: 1800,
            },
          ],
          documentTextBlocks: [
            {
              id: randomUUID(),
              documentId: targetDocument.id,
              pageNumber: 1,
              lineIndex: 0,
              boundingBox: { x: 0, y: 0, width: 120, height: 20 },
              text: "new target block",
            },
          ],
          documentChunks: [
            {
              id: randomUUID(),
              documentId: targetDocument.id,
              chunkIndex: 0,
              heading: "After",
              text: "new target chunk",
              pageFrom: 1,
              pageTo: 1,
              strategyVersion: "normalized-parse-v1",
              contentHash: "3".repeat(64),
              metadata: {},
              createdAt: timestamp,
            },
          ],
          documentChunkEmbeddings: [
            {
              documentId: targetDocument.id,
              chunkIndex: 0,
              provider: "openai",
              model: "text-embedding-3-small",
              dimensions: 3,
              embeddingLiteral: serializeHalfVector(padEmbedding([0.2, 0.3, 0.4])),
              contentHash: "3".repeat(64),
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ],
          processingJobs: [],
          auditEvents: [],
          derivedObjects: [
            {
              storageKey: replacementDerivedKey,
              contentBase64: Buffer.from("%PDF-merged", "utf8").toString("base64"),
            },
          ],
        },
      });

    expect(mergeResponse.status).toBe(201);
    expect(mergeResponse.body.mode).toBe("merge");
    expect(mergeResponse.body.documentCount).toBe(1);

    const [mergedTarget] = await databaseService.db
      .select({
        title: documents.title,
        fullText: documents.fullText,
        referenceNumber: documents.referenceNumber,
        searchablePdfStorageKey: documents.searchablePdfStorageKey,
      })
      .from(documents)
      .where(eq(documents.id, targetDocument.id))
      .limit(1);

    expect(mergedTarget?.title).toBe("Merge target after");
    expect(mergedTarget?.fullText).toBe("new target text");
    expect(mergedTarget?.referenceNumber).toBe("MERGED-42");
    expect(mergedTarget?.searchablePdfStorageKey).toBe(replacementDerivedKey);

    const targetTagLinks = await databaseService.pool.query<{ tag_id: string }>(
      `SELECT tag_id::text FROM document_tag_links WHERE document_id = $1::uuid ORDER BY tag_id`,
      [targetDocument.id],
    );
    const untouchedTagLinks = await databaseService.pool.query<{ tag_id: string }>(
      `SELECT tag_id::text FROM document_tag_links WHERE document_id = $1::uuid ORDER BY tag_id`,
      [untouchedDocument.id],
    );
    const targetTextBlocks = await databaseService.pool.query<{ text: string }>(
      `SELECT text FROM document_text_blocks WHERE document_id = $1::uuid`,
      [targetDocument.id],
    );
    const untouchedTextBlocks = await databaseService.pool.query<{ text: string }>(
      `SELECT text FROM document_text_blocks WHERE document_id = $1::uuid`,
      [untouchedDocument.id],
    );
    const targetChunks = await databaseService.pool.query<{ text: string; content_hash: string }>(
      `SELECT text, content_hash FROM document_chunks WHERE document_id = $1::uuid`,
      [targetDocument.id],
    );
    const untouchedChunks = await databaseService.pool.query<{ text: string; content_hash: string }>(
      `SELECT text, content_hash FROM document_chunks WHERE document_id = $1::uuid`,
      [untouchedDocument.id],
    );
    const targetEmbeddings = await databaseService.pool.query<{ content_hash: string }>(
      `SELECT content_hash FROM document_chunk_embeddings WHERE document_id = $1::uuid`,
      [targetDocument.id],
    );
    const untouchedEmbeddings = await databaseService.pool.query<{ content_hash: string }>(
      `SELECT content_hash FROM document_chunk_embeddings WHERE document_id = $1::uuid`,
      [untouchedDocument.id],
    );

    expect(targetTagLinks.rows.map((row) => row.tag_id)).toEqual([replacementTagId]);
    expect(untouchedTagLinks.rows.map((row) => row.tag_id)).toEqual([oldTagId]);
    expect(targetTextBlocks.rows.map((row) => row.text)).toEqual(["new target block"]);
    expect(untouchedTextBlocks.rows.map((row) => row.text)).toEqual(["untouched block"]);
    expect(targetChunks.rows).toEqual([
      { text: "new target chunk", content_hash: "3".repeat(64) },
    ]);
    expect(untouchedChunks.rows).toEqual([
      { text: "untouched chunk", content_hash: "2".repeat(64) },
    ]);
    expect(targetEmbeddings.rows.map((row) => row.content_hash)).toEqual(["3".repeat(64)]);
    expect(untouchedEmbeddings.rows.map((row) => row.content_hash)).toEqual(["2".repeat(64)]);
  });

  it("runs answer regression fixtures through semantic ranking and grounded answer selection", async () => {
    const [primaryFile] = await databaseService.db
      .insert(documentFiles)
      .values({
        checksum: "d".repeat(64),
        storageKey: `fixtures/${randomUUID()}/answer-primary.pdf`,
        originalFilename: "answer-primary.pdf",
        mimeType: "application/pdf",
        sizeBytes: 512,
      })
      .returning();

    const [supportingFile] = await databaseService.db
      .insert(documentFiles)
      .values({
        checksum: "e".repeat(64),
        storageKey: `fixtures/${randomUUID()}/answer-supporting.pdf`,
        originalFilename: "answer-supporting.pdf",
        mimeType: "application/pdf",
        sizeBytes: 512,
      })
      .returning();

    const [primaryDocument] = await databaseService.db
      .insert(documents)
      .values({
        ownerUserId,
        fileId: primaryFile.id,
        title: "Electricity invoice April 2025",
        source: "upload",
        mimeType: "application/pdf",
        status: "ready",
        reviewStatus: "not_required",
        parseProvider: "local-ocr",
        chunkCount: 2,
        embeddingStatus: "ready",
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        fullText:
          "Invoice amount due EUR 42.50 for April electricity service. Please pay by 2025-04-30.",
        processedAt: new Date(),
        metadata: {
          embedding: {
            configured: true,
            provider: "openai",
            model: "text-embedding-3-small",
            chunkCount: 2,
          },
        },
      })
      .returning();

    const [supportingDocument] = await databaseService.db
      .insert(documents)
      .values({
        ownerUserId,
        fileId: supportingFile.id,
        title: "Phone invoice April 2025",
        source: "upload",
        mimeType: "application/pdf",
        status: "ready",
        reviewStatus: "not_required",
        parseProvider: "local-ocr",
        chunkCount: 1,
        embeddingStatus: "ready",
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        fullText:
          "Invoice total due is EUR 42.50 for April phone service with payment due at month end.",
        processedAt: new Date(),
        metadata: {
          embedding: {
            configured: true,
            provider: "openai",
            model: "text-embedding-3-small",
            chunkCount: 1,
          },
        },
      })
      .returning();

    await databaseService.db.insert(documentChunks).values([
      {
        documentId: primaryDocument.id,
        chunkIndex: 0,
        heading: "Summary",
        text: "Invoice amount due is EUR 42.50 for April electricity service.",
        pageFrom: 1,
        pageTo: 1,
        strategyVersion: "normalized-parse-v1",
        contentHash: "4".repeat(64),
        metadata: {},
      },
      {
        documentId: primaryDocument.id,
        chunkIndex: 1,
        heading: "Summary duplicate",
        text: "Invoice amount due is EUR 42.50 for April electricity service",
        pageFrom: 1,
        pageTo: 1,
        strategyVersion: "normalized-parse-v1",
        contentHash: "5".repeat(64),
        metadata: {},
      },
      {
        documentId: supportingDocument.id,
        chunkIndex: 0,
        heading: "Billing",
        text: "The invoice total shown on this phone bill is EUR 42.50.",
        pageFrom: 2,
        pageTo: 2,
        strategyVersion: "normalized-parse-v1",
        contentHash: "6".repeat(64),
        metadata: {},
      },
    ]);

    await databaseService.pool.query(
      `INSERT INTO document_chunk_embeddings (
        document_id,
        chunk_index,
        provider,
        model,
        dimensions,
        embedding,
        content_hash
      )
      VALUES
        ($1::uuid, 0, 'openai', 'text-embedding-3-small', 3, $2::halfvec, $3),
        ($1::uuid, 1, 'openai', 'text-embedding-3-small', 3, $4::halfvec, $5),
        ($6::uuid, 0, 'openai', 'text-embedding-3-small', 3, $7::halfvec, $8)`,
      [
        primaryDocument.id,
        serializeHalfVector(padEmbedding([0.9, 0.1, 0.2])),
        "4".repeat(64),
        serializeHalfVector(padEmbedding([0.88, 0.12, 0.2])),
        "5".repeat(64),
        supportingDocument.id,
        serializeHalfVector(padEmbedding([0.86, 0.14, 0.2])),
        "6".repeat(64),
      ],
    );

    const answeredResponse = await request(app.getHttpServer())
      .post("/api/search/answer")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        query: "What is the invoice amount due?",
      });

    expect(answeredResponse.status).toBe(201);
    expect(answeredResponse.body.status).toBe("answered");
    expect(answeredResponse.body.answer).toContain("EUR 42.50");
    expect(answeredResponse.body.results[0]?.document.id).toBe(primaryDocument.id);
    expect(answeredResponse.body.citations).toHaveLength(2);
    expect(answeredResponse.body.citations[0]?.documentId).toBe(primaryDocument.id);
    expect(answeredResponse.body.citations[1]?.documentId).toBe(supportingDocument.id);

    const insufficientResponse = await request(app.getHttpServer())
      .post("/api/search/answer")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        query: "What is the policy number?",
      });

    expect(insufficientResponse.status).toBe(201);
    expect(insufficientResponse.body.status).toBe("insufficient_evidence");
    expect(insufficientResponse.body.answer).toBeNull();
    expect(insufficientResponse.body.citations).toEqual([]);
    expect(insufficientResponse.body.results.length).toBeGreaterThan(0);
  });

  it("rejects malformed archive snapshots before replacing stored data", async () => {
    const exportResponse = await request(app.getHttpServer())
      .get("/api/archive/export")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(exportResponse.status).toBe(200);
    expect(exportResponse.body.files.length).toBeGreaterThan(0);

    const malformedSnapshot = structuredClone(exportResponse.body);
    malformedSnapshot.files[0].contentBase64 = null;

    const failedImportResponse = await request(app.getHttpServer())
      .post("/api/archive/import")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        mode: "replace",
        snapshot: malformedSnapshot,
      });

    expect(failedImportResponse.status).toBe(400);
    expect(String(failedImportResponse.body.message)).toContain("payload missing");

    const documentsResponse = await request(app.getHttpServer())
      .get("/api/documents")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(documentsResponse.status).toBe(200);
    expect(documentsResponse.body.total).toBeGreaterThan(0);
  });
});
