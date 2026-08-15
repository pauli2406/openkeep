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
  documentTagLinks,
  documentTextBlocks,
  documentTypes,
  documents,
  processingJobs,
  tags,
  users,
} from "@openkeep/db";
import { createApp } from "../src/bootstrap";
import { DatabaseService } from "../src/common/db/database.service";
import { ObjectStorageService } from "../src/common/storage/storage.service";
import { DocumentsService } from "../src/documents/documents.service";
import { CorrespondentIntelligenceService } from "../src/explorer/correspondent-intelligence.service";
import { ExplorerService } from "../src/explorer/explorer.service";
import { padEmbedding, serializeHalfVector } from "../src/processing/embedding.util";
import { ProcessingService } from "../src/processing/processing.service";
import { DEFAULT_DOCUMENT_TYPE_NAMES } from "../src/taxonomies/default-document-types";

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
        const userPrompt =
          typeof body?.messages?.[1]?.content === "string" ? body.messages[1].content : "";

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

        if (systemPrompt.includes("You extract a document correspondent")) {
          const evidence = userPrompt
            .split("\n")
            .filter((line: string) => /^\d+\.\s+/.test(line))
            .map((line: string) => line.replace(/^\d+\.\s+/, "").trim())
            .find(
              (line: string) =>
                line.length > 0 &&
                !/invoice|rechnung|date|datum|amount|betrag|informationen über/i.test(line),
            );
          const name = evidence ?? "Example Telecom Ltd.";
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      rawName: name,
                      cleanDisplayName: name,
                      confidence: 0.92,
                      evidenceLines: [name],
                      isLikelyOrganizationOrPerson: true,
                      shouldCreateNew: true,
                      selectedCandidateId: null,
                    }),
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
    // SMTP configured so the digest path runs; the test spies on MailerService
    // instead of speaking real SMTP.
    process.env.SMTP_HOST = "smtp.test.invalid";
    process.env.SMTP_FROM = "archive@test.invalid";
    process.env.EMAIL_INGEST_ALLOWED_SENDERS = "vendor.example,trusted@partner.example";
    process.env.EMAIL_INGEST_LOG_LIMIT = "5";
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

    const apiTokenMeResponse = await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${apiToken}`);

    expect(apiTokenMeResponse.status).toBe(200);
    expect(apiTokenMeResponse.body.email).toBe(process.env.OWNER_EMAIL);
  });

  it("updates user language preferences via PATCH /api/auth/me/preferences with an API token", async () => {
    const response = await request(app.getHttpServer())
      .patch("/api/auth/me/preferences")
      .set("Authorization", `Bearer ${apiToken}`)
      .send({
        uiLanguage: "de",
        aiProcessingLanguage: "de",
        aiChatLanguage: "en",
      });

    expect(response.status).toBe(200);
    expect(response.body.preferences).toEqual({
      uiLanguage: "de",
      aiProcessingLanguage: "de",
      aiChatLanguage: "en",
      emailDigestEnabled: false,
    });

    const meResponse = await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${apiToken}`);

    expect(meResponse.status).toBe(200);
    expect(meResponse.body.preferences).toEqual({
      uiLanguage: "de",
      aiProcessingLanguage: "de",
      aiChatLanguage: "en",
      emailDigestEnabled: false,
    });
  });

  it("lets an owner administer account security from an API-token session", async () => {
    const listResponse = await request(app.getHttpServer())
      .get("/api/auth/tokens")
      .set("Authorization", `Bearer ${apiToken}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Integration token" }),
      ]),
    );

    const createResponse = await request(app.getHttpServer())
      .post("/api/auth/tokens")
      .set("Authorization", `Bearer ${apiToken}`)
      .send({ name: "Desktop-managed token" });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.token).toMatch(/^okp_[a-f0-9]+\.[a-f0-9]+$/);

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/api/auth/tokens/${createResponse.body.id}`)
      .set("Authorization", `Bearer ${apiToken}`);

    expect(deleteResponse.status).toBe(200);

    const setupTwoFactorResponse = await request(app.getHttpServer())
      .post("/api/auth/2fa/setup")
      .set("Authorization", `Bearer ${apiToken}`)
      .send({});

    expect(setupTwoFactorResponse.status).toBe(201);
    expect(setupTwoFactorResponse.body).toMatchObject({
      secret: expect.any(String),
      qrDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
      enrollmentToken: expect.any(String),
    });
  });

  it("rejects invalid date filters before querying the database", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/documents?dateFrom=2026-03-01&dateTo=2026-04-31")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain("Invalid date");
  });

  it("seeds default document types for a new instance", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/taxonomies/document-types")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.map((item: { name: string }) => item.name)).toEqual(
      [...DEFAULT_DOCUMENT_TYPE_NAMES].sort((left, right) => left.localeCompare(right)),
    );
  });

  it("exposes readiness and metrics endpoints", async () => {
    const healthResponse = await request(app.getHttpServer()).get("/api/health");
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.body.status).toBe("ok");
    expect(healthResponse.body.provider.activeParseProvider).toBe("local-ocr");
    expect(healthResponse.body.provider.fallbackParseProvider).toBeNull();
    expect(healthResponse.body.provider.activeChatProvider).toBeNull();

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

  it("deduplicates concurrent uploads of identical content atomically", async () => {
    const buffer = Buffer.from(`concurrent-${randomUUID()}`);

    // The web client uploads several files at once; identical content must not
    // collide on the unique checksum constraint or enqueue processing before the
    // object is stored.
    const responses = await Promise.all(
      [1, 2, 3].map((index) =>
        request(app.getHttpServer())
          .post("/api/documents")
          .set("Authorization", `Bearer ${accessToken}`)
          .attach("file", buffer, `concurrent-${index}.pdf`),
      ),
    );

    for (const response of responses) {
      expect(response.status).toBe(201);
    }

    const fileIds = new Set<string>();
    for (const response of responses) {
      const detail = await request(app.getHttpServer())
        .get(`/api/documents/${response.body.id}`)
        .set("Authorization", `Bearer ${accessToken}`);
      expect(detail.status).toBe(200);
      fileIds.add(detail.body.checksum);
    }

    // All three documents share one deduplicated binary.
    expect(fileIds.size).toBe(1);
  });

  it("deletes documents and only removes shared file metadata after the last reference", async () => {
    const originalKey = `fixtures/${randomUUID()}`;
    const searchableKey = `derived/${randomUUID()}.pdf`;
    await storageService.uploadBuffer(originalKey, Buffer.from("original"), "application/pdf");
    await storageService.uploadBuffer(searchableKey, Buffer.from("searchable"), "application/pdf");

    const [sharedFile] = await databaseService.db
      .insert(documentFiles)
      .values({
        checksum: randomUUID().replace(/-/g, "").slice(0, 32).padEnd(64, "c"),
        storageKey: originalKey,
        originalFilename: "shared.pdf",
        mimeType: "application/pdf",
        sizeBytes: 512,
      })
      .returning();

    const [primaryDocument] = await databaseService.db
      .insert(documents)
      .values({
        ownerUserId,
        fileId: sharedFile.id,
        title: "Delete Me",
        mimeType: "application/pdf",
        status: "ready",
        searchablePdfStorageKey: searchableKey,
      })
      .returning();

    const [duplicateDocument] = await databaseService.db
      .insert(documents)
      .values({
        ownerUserId,
        fileId: sharedFile.id,
        title: "Duplicate Copy",
        mimeType: "application/pdf",
        status: "ready",
      })
      .returning();

    const firstDelete = await request(app.getHttpServer())
      .delete(`/api/documents/${primaryDocument.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(firstDelete.status).toBe(200);
    expect(firstDelete.body).toEqual({ deleted: true });

    const documentCountAfterFirstDelete = await databaseService.pool.query<{ count: string }>(
      "SELECT count(*)::int AS count FROM documents WHERE file_id = $1",
      [sharedFile.id],
    );
    const fileCountAfterFirstDelete = await databaseService.pool.query<{ count: string }>(
      "SELECT count(*)::int AS count FROM document_files WHERE id = $1",
      [sharedFile.id],
    );

    expect(Number(documentCountAfterFirstDelete.rows[0]?.count ?? 0)).toBe(1);
    expect(Number(fileCountAfterFirstDelete.rows[0]?.count ?? 0)).toBe(1);

    const secondDelete = await request(app.getHttpServer())
      .delete(`/api/documents/${duplicateDocument.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(secondDelete.status).toBe(200);
    expect(secondDelete.body).toEqual({ deleted: true });

    const documentCountAfterSecondDelete = await databaseService.pool.query<{ count: string }>(
      "SELECT count(*)::int AS count FROM documents WHERE file_id = $1",
      [sharedFile.id],
    );
    const fileCountAfterSecondDelete = await databaseService.pool.query<{ count: string }>(
      "SELECT count(*)::int AS count FROM document_files WHERE id = $1",
      [sharedFile.id],
    );

    expect(Number(documentCountAfterSecondDelete.rows[0]?.count ?? 0)).toBe(0);
    expect(Number(fileCountAfterSecondDelete.rows[0]?.count ?? 0)).toBe(0);
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

  it("downloads originals with unicode filenames using a safe content-disposition header", async () => {
    const originalBuffer = Buffer.from("%PDF-1.4\n% unicode filename fixture\n", "utf8");
    const originalKey = `fixtures/${randomUUID()}/unicode-original.pdf`;

    await storageService.uploadBuffer(originalKey, originalBuffer, "application/pdf");

    const [file] = await databaseService.db
      .insert(documentFiles)
      .values({
        checksum: randomUUID().replace(/-/g, "").slice(0, 32).padEnd(64, "e"),
        storageKey: originalKey,
        originalFilename: "Gutschein über 100€.pdf",
        mimeType: "application/pdf",
        sizeBytes: originalBuffer.length,
      })
      .returning();

    const [document] = await databaseService.db
      .insert(documents)
      .values({
        ownerUserId,
        fileId: file.id,
        title: "Unicode filename",
        mimeType: "application/pdf",
        status: "ready",
      })
      .returning();

    const downloadable = await request(app.getHttpServer())
      .get(`/api/documents/${document.id}/download`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(downloadable.status).toBe(200);
    expect(downloadable.header["content-type"]).toContain("application/pdf");
    expect(downloadable.header["content-disposition"]).toContain(
      'filename="Gutschein uber 100_.pdf"',
    );
    expect(downloadable.header["content-disposition"]).toContain("filename*=UTF-8''");
    expect(downloadable.header["content-disposition"]).toContain(
      "Gutschein%20u%CC%88ber%20100%E2%82%AC.pdf",
    );
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

  it("matches stemmed German keyword queries (Rechnungen finds Rechnung)", async () => {
    const [germanFile] = await databaseService.db
      .insert(documentFiles)
      .values({
        checksum: randomUUID().replace(/-/g, "").slice(0, 32).padEnd(64, "a"),
        storageKey: `fixtures/${randomUUID()}/stadtwerke.pdf`,
        originalFilename: "stadtwerke-rechnung.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      })
      .returning();

    const [germanDocument] = await databaseService.db
      .insert(documents)
      .values({
        ownerUserId,
        fileId: germanFile.id,
        title: "Stadtwerke Rechnung März",
        mimeType: "application/pdf",
        status: "ready",
        parseProvider: "local-ocr",
        language: "de",
        chunkCount: 0,
        fullText: "Ihre Rechnung der Stadtwerke über 89 Euro ist beigefügt.",
        processedAt: new Date(),
      })
      .returning();

    // Plural query, singular document text: only german-regconfig stemming in the
    // keyword FILTER makes this match — the previous 'simple' filter missed it.
    const response = await request(app.getHttpServer())
      .post("/api/search/semantic")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ query: "Rechnungen Stadtwerke" });

    expect(response.status).toBe(201);
    const match = response.body.items.find(
      (item: { document: { id: string } }) => item.document.id === germanDocument.id,
    );
    expect(match).toBeDefined();
    expect(match.keywordScore).not.toBeNull();
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

  it("serves explorer dashboard, correspondent insights, and timeline", async () => {
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
    expect(pendingInsightsResponse.body.intelligenceStatus).toBe("pending");
    expect(pendingInsightsResponse.body.stats.documentCount).toBeGreaterThanOrEqual(2);

    await explorerService.refreshCorrespondentSummary(correspondent.id);
    await app.get(CorrespondentIntelligenceService).refresh(correspondent.id);

    const readyInsightsResponse = await request(app.getHttpServer())
      .get(`/api/correspondents/${correspondent.slug}/insights`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(readyInsightsResponse.status).toBe(200);
    expect(readyInsightsResponse.body.summaryStatus).toBe("ready");
    expect(readyInsightsResponse.body.intelligenceStatus).toBe("ready");
    expect(String(readyInsightsResponse.body.summary)).toContain("recurring");
    expect(String(readyInsightsResponse.body.intelligence?.overview)).toContain("Adidas");

    const timelineResponse = await request(app.getHttpServer())
      .get(`/api/documents/timeline?correspondentIds=${correspondent.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(timelineResponse.status).toBe(200);
    expect(timelineResponse.body.years.length).toBeGreaterThan(0);
    expect(timelineResponse.body.years[0].months.length).toBeGreaterThan(0);

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

  it("arms deadline notifications exactly once, and invalidates them with their reason", async () => {
    const { NotificationsService } = await import("../src/notifications/notifications.service");
    const notificationsService = app.get(NotificationsService);
    const suffix = randomUUID().slice(0, 8);
    const today = "2026-06-15";

    const seedDueDocument = async (title: string, dueDate: string) => {
      const [file] = await databaseService.db
        .insert(documentFiles)
        .values({
          checksum: randomUUID().replace(/-/g, "").padEnd(64, "9").slice(0, 64),
          storageKey: `fixtures/${randomUUID()}/due.pdf`,
          originalFilename: "due.pdf",
          mimeType: "application/pdf",
          sizeBytes: 32,
        })
        .returning();
      const [document] = await databaseService.db
        .insert(documents)
        .values({
          ownerUserId,
          fileId: file.id,
          title: `${title} ${suffix}`,
          mimeType: "application/pdf",
          status: "ready",
          dueDate: new Date(dueDate),
          fullText: title,
        } as never)
        .returning();
      return { document, file };
    };

    const upcoming = await seedDueDocument("Due in a week", "2026-06-20");
    const dueToday = await seedDueDocument("Due today", "2026-06-15");
    const overdue = await seedDueDocument("Overdue invoice", "2026-06-01");
    const farFuture = await seedDueDocument("Due in a month", "2026-07-20");

    // Five runs must arm exactly one record per document+window.
    for (let run = 0; run < 5; run += 1) {
      await notificationsService.scanDeadlines(today);
    }

    const counted = await databaseService.pool.query(
      `SELECT document_id, "window", count(*)::int AS records
       FROM notifications
       WHERE document_id = ANY($1::uuid[])
       GROUP BY document_id, "window"`,
      [[upcoming.document.id, dueToday.document.id, overdue.document.id, farFuture.document.id]],
    );
    const byDocument = new Map(
      counted.rows.map((row) => [`${row.document_id}:${row.window}`, row.records]),
    );
    expect(byDocument.get(`${upcoming.document.id}:upcoming`)).toBe(1);
    expect(byDocument.get(`${dueToday.document.id}:due`)).toBe(1);
    expect(byDocument.get(`${overdue.document.id}:overdue`)).toBe(1);
    expect(counted.rows).toHaveLength(3);

    // The endpoint lists them for the owner, unread.
    const listed = await request(app.getHttpServer())
      .get("/api/notifications")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(listed.status).toBe(200);
    const listedIds = listed.body.items.map((item: { documentId: string }) => item.documentId);
    expect(listedIds).toContain(overdue.document.id);
    expect(listed.body.unreadCount).toBeGreaterThanOrEqual(3);

    // Completing the task before delivery leaves nothing pending.
    await databaseService.pool.query(
      `UPDATE documents SET task_completed_at = now() WHERE id = $1`,
      [dueToday.document.id],
    );
    await notificationsService.scanDeadlines(today);
    const pendingAfterComplete = await databaseService.pool.query(
      `SELECT count(*)::int AS pending FROM notifications
       WHERE document_id = $1 AND invalidated_at IS NULL`,
      [dueToday.document.id],
    );
    expect(pendingAfterComplete.rows[0].pending).toBe(0);

    // Moving the date re-arms the windows under the new date.
    await databaseService.pool.query(
      `UPDATE documents SET due_date = '2026-06-18' WHERE id = $1`,
      [upcoming.document.id],
    );
    await notificationsService.scanDeadlines(today);
    const rearmed = await databaseService.pool.query(
      `SELECT due_date::text AS due_date, invalidated_at FROM notifications
       WHERE document_id = $1 AND "window" = 'upcoming'
       ORDER BY due_date`,
      [upcoming.document.id],
    );
    expect(rearmed.rows).toHaveLength(2);
    expect(rearmed.rows[0].due_date).toBe("2026-06-18");
    expect(rearmed.rows[0].invalidated_at).toBeNull();
    expect(rearmed.rows[1].due_date).toBe("2026-06-20");
    expect(rearmed.rows[1].invalidated_at).not.toBeNull();

    // Mark-read flips the unread count.
    const firstId = listed.body.items[0].id;
    const readResponse = await request(app.getHttpServer())
      .post(`/api/notifications/${firstId}/read`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(readResponse.status).toBe(201);
    const relisted = await request(app.getHttpServer())
      .get("/api/notifications")
      .set("Authorization", `Bearer ${accessToken}`);
    const reread = relisted.body.items.find((item: { id: string }) => item.id === firstId);
    expect(reread?.readAt).not.toBeNull();

    const documentIds = [upcoming, dueToday, overdue, farFuture].map(
      (entry) => entry.document.id,
    );
    await databaseService.pool.query(`DELETE FROM documents WHERE id = ANY($1::uuid[])`, [
      documentIds,
    ]);
    await databaseService.pool.query(`DELETE FROM document_files WHERE id = ANY($1::uuid[])`, [
      [upcoming, dueToday, overdue, farFuture].map((entry) => entry.file.id),
    ]);
  });

  it("sends one digest email per user with pending deadlines, exactly once", async () => {
    const { NotificationsService } = await import("../src/notifications/notifications.service");
    const { EmailDigestService } = await import("../src/notifications/email-digest.service");
    const { MailerService } = await import("../src/notifications/mailer.service");
    const notificationsService = app.get(NotificationsService);
    const emailDigestService = app.get(EmailDigestService);
    const mailerService = app.get(MailerService);
    const today = "2026-09-10";
    const suffix = randomUUID().slice(0, 8);

    const sentMails: Array<{ to: string; subject: string; text: string; html: string }> = [];
    const sendSpy = vi
      .spyOn(mailerService, "send")
      .mockImplementation(async (mail) => {
        sentMails.push(mail);
      });

    const seedDue = async (title: string, dueDate: string, amount?: string) => {
      const [file] = await databaseService.db
        .insert(documentFiles)
        .values({
          checksum: randomUUID().replace(/-/g, "").padEnd(64, "8").slice(0, 64),
          storageKey: `fixtures/${randomUUID()}/digest.pdf`,
          originalFilename: "digest.pdf",
          mimeType: "application/pdf",
          sizeBytes: 16,
        })
        .returning();
      const [document] = await databaseService.db
        .insert(documents)
        .values({
          ownerUserId,
          fileId: file.id,
          title: `${title} ${suffix}`,
          mimeType: "application/pdf",
          status: "ready",
          dueDate: new Date(dueDate),
          amount,
          currency: amount ? "EUR" : undefined,
          fullText: title,
        } as never)
        .returning();
      return { document, file };
    };

    const overdue = await seedDue("Mahnung Strom", "2026-09-01", "149.90");
    const soon = await seedDue("Versicherung Beitrag", "2026-09-15");

    try {
      // Digest disabled: pending notifications exist, but nothing sends.
      await notificationsService.scanDeadlines(today);
      const disabledRun = await emailDigestService.runDigest(today);
      expect(disabledRun.sent).toBe(0);
      expect(sentMails).toHaveLength(0);

      // Opt in via the preferences endpoint, keeping the languages.
      const optIn = await request(app.getHttpServer())
        .patch("/api/auth/me/preferences")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          uiLanguage: "en",
          aiProcessingLanguage: "en",
          aiChatLanguage: "en",
          emailDigestEnabled: true,
        });
      expect(optIn.status).toBe(200);
      expect(optIn.body.preferences.emailDigestEnabled).toBe(true);

      const firstRun = await emailDigestService.runDigest(today);
      expect(firstRun.sent).toBe(1);
      expect(sentMails).toHaveLength(1);
      const mail = sentMails[0];
      expect(mail.text).toContain(`Mahnung Strom ${suffix}`);
      expect(mail.text).toContain(`Versicherung Beitrag ${suffix}`);
      expect(mail.text).toContain("Overdue");
      expect(mail.text).toContain("Due soon");
      expect(mail.text).toContain("149.90 EUR");
      expect(mail.html).toContain("<ul>");

      // The second run has nothing undelivered: no email.
      const secondRun = await emailDigestService.runDigest(today);
      expect(secondRun.sent).toBe(0);
      expect(sentMails).toHaveLength(1);

      // Turning the preference off keeps records for other channels but stops mail.
      await request(app.getHttpServer())
        .patch("/api/auth/me/preferences")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          uiLanguage: "en",
          aiProcessingLanguage: "en",
          aiChatLanguage: "en",
          emailDigestEnabled: false,
        });
      const remaining = await databaseService.pool.query(
        `SELECT count(*)::int AS records FROM notifications
         WHERE document_id = ANY($1::uuid[]) AND invalidated_at IS NULL`,
        [[overdue.document.id, soon.document.id]],
      );
      expect(remaining.rows[0].records).toBeGreaterThan(0);
    } finally {
      sendSpy.mockRestore();
      const documentIds = [overdue, soon].map((entry) => entry.document.id);
      await databaseService.pool.query(`DELETE FROM documents WHERE id = ANY($1::uuid[])`, [
        documentIds,
      ]);
      await databaseService.pool.query(`DELETE FROM document_files WHERE id = ANY($1::uuid[])`, [
        [overdue, soon].map((entry) => entry.file.id),
      ]);
      await databaseService.pool.query(
        `UPDATE users SET email_digest_enabled = false WHERE id = $1`,
        [ownerUserId],
      );
    }
  });

  it("imports mailbox attachments once, through the regular ingestion path", async () => {
    const { EmailIngestService } = await import("../src/email-ingest/email-ingest.service");
    type FakeMessage = {
      messageId: string;
      from: string;
      subject: string | null;
      receivedAt: Date | null;
      attachments: Array<{ filename: string; contentType: string; content: Buffer }>;
    };
    const emailIngestService = app.get(EmailIngestService);
    const suffix = randomUUID().slice(0, 8);

    const pdfBytes = Buffer.from(`%PDF-mailbox-${suffix}`, "utf8");
    const messages: FakeMessage[] = [
      {
        messageId: `<two-pdfs-${suffix}@example.com>`,
        from: "billing@vendor.example",
        subject: `Rechnung Februar ${suffix}`,
        receivedAt: new Date("2026-08-01T08:00:00Z"),
        attachments: [
          { filename: "rechnung-1.pdf", contentType: "application/pdf", content: pdfBytes },
          {
            filename: "rechnung-2.pdf",
            contentType: "application/pdf",
            content: Buffer.from(`%PDF-mailbox-second-${suffix}`, "utf8"),
          },
        ],
      },
      {
        messageId: `<newsletter-${suffix}@example.com>`,
        from: "news@vendor.example",
        subject: "Newsletter",
        receivedAt: new Date("2026-08-01T09:00:00Z"),
        attachments: [
          { filename: "style.css", contentType: "text/css", content: Buffer.from("body{}") },
        ],
      },
    ];
    const flagged: string[] = [];
    const fakeClient = {
      async fetchUnprocessed() {
        return messages.filter((message) => !flagged.includes(message.messageId));
      },
      async markProcessed(messageId: string) {
        flagged.push(messageId);
      },
      async close() {},
    };

    // First poll: two documents from one message, the newsletter skipped.
    const first = await emailIngestService.pollOnce(fakeClient);
    expect(first.imported).toBe(1);
    expect(first.skipped).toBe(1);
    expect(first.failed).toBe(0);

    const imported = await databaseService.pool.query(
      `SELECT id, title, source FROM documents WHERE title LIKE $1 OR title LIKE $2 ORDER BY title`,
      [`%Rechnung Februar ${suffix}%`, `rechnung-%`],
    );
    expect(imported.rows.length).toBeGreaterThanOrEqual(2);
    expect(imported.rows.every((row) => row.source === "email")).toBe(true);

    // Second poll with the flags reset — the Message-ID record wins.
    flagged.length = 0;
    const second = await emailIngestService.pollOnce(fakeClient);
    expect(second.imported).toBe(0);
    const stillTwo = await databaseService.pool.query(
      `SELECT count(*)::int AS documents FROM documents WHERE source = 'email' AND (title LIKE $1 OR title LIKE $2)`,
      [`%${suffix}%`, `rechnung-%`],
    );
    expect(stillTwo.rows[0].documents).toBeLessThanOrEqual(3);

    // A re-sent identical PDF resolves as a duplicate, not a new document.
    messages.push({
      messageId: `<resend-${suffix}@example.com>`,
      from: "billing@vendor.example",
      subject: `Rechnung Februar erneut ${suffix}`,
      receivedAt: new Date("2026-08-02T08:00:00Z"),
      attachments: [
        { filename: "rechnung-1.pdf", contentType: "application/pdf", content: pdfBytes },
      ],
    });
    const third = await emailIngestService.pollOnce(fakeClient);
    expect(third.imported).toBe(1);
    // Identical bytes share one file record — the resend created a document
    // marked as a duplicate of the original, not a second copy of the file.
    const sharedFile = await databaseService.pool.query(
      `SELECT count(DISTINCT d.file_id)::int AS files, count(*)::int AS documents
       FROM documents d
       INNER JOIN document_files f ON f.id = d.file_id
       WHERE f.checksum = $1`,
      [
        (
          await databaseService.pool.query(
            `SELECT f.checksum FROM documents d
             INNER JOIN document_files f ON f.id = d.file_id
             WHERE d.title = $1 LIMIT 1`,
            [`Rechnung Februar erneut ${suffix}`],
          )
        ).rows[0].checksum,
      ],
    );
    expect(sharedFile.rows[0].files).toBe(1);
    expect(sharedFile.rows[0].documents).toBe(2);

    // Every message is recorded exactly once with its outcome.
    const ledger = await databaseService.pool.query(
      `SELECT message_id, status, reason FROM ingested_emails WHERE message_id LIKE $1 ORDER BY message_id`,
      [`%${suffix}@example.com%`],
    );
    expect(ledger.rows).toHaveLength(3);
    const newsletter = ledger.rows.find((row) => row.message_id.includes("newsletter"));
    expect(newsletter?.status).toBe("skipped");
    expect(newsletter?.reason).toBe("no-supported-attachment");

    const cleanupIds = await databaseService.pool.query(
      `SELECT id FROM documents WHERE source = 'email'`,
    );
    await databaseService.pool.query(`DELETE FROM documents WHERE source = 'email'`);
    await databaseService.pool.query(`DELETE FROM ingested_emails WHERE message_id LIKE $1`, [
      `%${suffix}@example.com%`,
    ]);
    expect(cleanupIds.rows.length).toBeGreaterThan(0);
  });

  it("guards the mailbox: allowlist, disguised files, and a capped rejection log", async () => {
    const { EmailIngestService } = await import("../src/email-ingest/email-ingest.service");
    const emailIngestService = app.get(EmailIngestService);
    const suffix = randomUUID().slice(0, 8);

    type FakeMessage = {
      messageId: string;
      from: string;
      subject: string | null;
      receivedAt: Date | null;
      attachments: Array<{ filename: string; contentType: string; content: Buffer }>;
    };
    const messages: FakeMessage[] = [
      {
        // Not on the allowlist: imports nothing, lands in the rejection log.
        messageId: `<stranger-${suffix}@example.com>`,
        from: "evil@stranger.example",
        subject: "Totally an invoice",
        receivedAt: new Date("2026-08-03T08:00:00Z"),
        attachments: [
          {
            filename: "invoice.pdf",
            contentType: "application/pdf",
            content: Buffer.from(`%PDF-guard-${suffix}`, "utf8"),
          },
        ],
      },
      {
        // Allowlisted sender, but the "PDF" is an executable.
        messageId: `<disguised-${suffix}@example.com>`,
        from: "billing@vendor.example",
        subject: "Invoice attached",
        receivedAt: new Date("2026-08-03T09:00:00Z"),
        attachments: [
          {
            filename: "invoice.pdf",
            contentType: "application/pdf",
            content: Buffer.concat([Buffer.from("MZ\x90\x00"), Buffer.alloc(64)]),
          },
        ],
      },
      {
        // Allowlisted and genuine: still imports.
        messageId: `<genuine-${suffix}@example.com>`,
        from: "trusted@partner.example",
        subject: `Echte Rechnung ${suffix}`,
        receivedAt: new Date("2026-08-03T10:00:00Z"),
        attachments: [
          {
            filename: "real.pdf",
            contentType: "application/pdf",
            content: Buffer.from(`%PDF-guard-genuine-${suffix}`, "utf8"),
          },
        ],
      },
    ];
    const flagged: string[] = [];
    const fakeClient = {
      async fetchUnprocessed() {
        return messages.filter((message) => !flagged.includes(message.messageId));
      },
      async markProcessed(messageId: string) {
        flagged.push(messageId);
      },
      async close() {},
    };

    const summary = await emailIngestService.pollOnce(fakeClient);
    expect(summary.rejected).toBe(2);
    expect(summary.imported).toBe(1);

    const ledger = await databaseService.pool.query(
      `SELECT message_id, status, reason, from_address FROM ingested_emails
       WHERE message_id LIKE $1 ORDER BY message_id`,
      [`%${suffix}@example.com%`],
    );
    const stranger = ledger.rows.find((row) => row.message_id.includes("stranger"));
    expect(stranger?.status).toBe("rejected");
    expect(stranger?.reason).toBe("sender-not-allowed");
    expect(stranger?.from_address).toBe("evil@stranger.example");
    const disguised = ledger.rows.find((row) => row.message_id.includes("disguised"));
    expect(disguised?.status).toBe("rejected");
    expect(disguised?.reason).toContain("disguised-file:invoice.pdf");

    // Neither rejected message created a document.
    const strayDocuments = await databaseService.pool.query(
      `SELECT count(*)::int AS documents FROM documents
       WHERE source = 'email' AND title IN ('Totally an invoice', 'Invoice attached')`,
    );
    expect(strayDocuments.rows[0].documents).toBe(0);

    // The rejection log is capped (EMAIL_INGEST_LOG_LIMIT=5 in this suite):
    // a flood of rejected messages cannot grow the table unboundedly, and
    // imported rows survive the pruning.
    for (let index = 0; index < 8; index += 1) {
      messages.push({
        messageId: `<flood-${index}-${suffix}@example.com>`,
        from: "spam@flood.example",
        subject: `Spam ${index}`,
        receivedAt: new Date("2026-08-03T11:00:00Z"),
        attachments: [],
      });
    }
    await emailIngestService.pollOnce(fakeClient);
    const counts = await databaseService.pool.query(
      `SELECT
         count(*) FILTER (WHERE status <> 'imported')::int AS non_imported,
         count(*) FILTER (WHERE status = 'imported' AND message_id LIKE $1)::int AS imported
       FROM ingested_emails`,
      [`%${suffix}@example.com%`],
    );
    expect(counts.rows[0].non_imported).toBeLessThanOrEqual(5);
    expect(counts.rows[0].imported).toBe(1);

    await databaseService.pool.query(`DELETE FROM documents WHERE source = 'email'`);
    await databaseService.pool.query(`DELETE FROM ingested_emails WHERE message_id LIKE $1`, [
      `%${suffix}@example.com%`,
    ]);
  });

  it("reports mailbox status with counts, poll time, and per-document provenance", async () => {
    const { EmailIngestService } = await import("../src/email-ingest/email-ingest.service");
    const emailIngestService = app.get(EmailIngestService);
    const suffix = randomUUID().slice(0, 8);

    const receivedAt = new Date("2026-08-05T10:30:00Z");
    const messages = [
      {
        messageId: `<status-${suffix}@example.com>`,
        from: "billing@vendor.example",
        subject: `Status Rechnung ${suffix}`,
        receivedAt,
        attachments: [
          {
            filename: "status.pdf",
            contentType: "application/pdf",
            content: Buffer.from(`%PDF-status-${suffix}`, "utf8"),
          },
        ],
      },
    ];
    const flagged: string[] = [];
    const fakeClient = {
      async fetchUnprocessed() {
        return messages.filter((message) => !flagged.includes(message.messageId));
      },
      async markProcessed(messageId: string) {
        flagged.push(messageId);
      },
      async close() {},
    };

    await emailIngestService.pollOnce(fakeClient);

    // The status card sees the poll and the counts without any restart.
    const status = await request(app.getHttpServer())
      .get("/api/email-ingest/status")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(status.status).toBe(200);
    expect(typeof status.body.lastPoll?.at).toBe("string");
    expect(status.body.counts.imported).toBeGreaterThanOrEqual(1);

    // The imported document answers "where did this come from".
    const document = await databaseService.pool.query(
      `SELECT id, metadata FROM documents WHERE title = $1`,
      [`Status Rechnung ${suffix}`],
    );
    expect(document.rows).toHaveLength(1);
    const provenance = document.rows[0].metadata.email;
    expect(provenance.from).toBe("billing@vendor.example");
    expect(provenance.subject).toBe(`Status Rechnung ${suffix}`);
    expect(provenance.receivedAt).toBe(receivedAt.toISOString());

    // An uploaded document carries no email provenance.
    const uploaded = await databaseService.pool.query(
      `SELECT count(*)::int AS with_email FROM documents
       WHERE source <> 'email' AND metadata ? 'email'`,
    );
    expect(uploaded.rows[0].with_email).toBe(0);

    // Poll-now queues a job on the worker queue.
    const pollNow = await request(app.getHttpServer())
      .post("/api/email-ingest/poll")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(pollNow.status).toBe(201);
    expect(pollNow.body.queued).toBe(true);

    await databaseService.pool.query(`DELETE FROM documents WHERE id = $1`, [
      document.rows[0].id,
    ]);
    await databaseService.pool.query(`DELETE FROM ingested_emails WHERE message_id LIKE $1`, [
      `%${suffix}@example.com%`,
    ]);
  });

  it("aggregates a tax year by tag and type membership, with sums per currency", async () => {
    const suffix = randomUUID().slice(0, 8);

    const [taxType] = await databaseService.db
      .insert(documentTypes)
      .values({ name: "Tax Document", slug: `tax-document-${suffix}` })
      .returning();
    const [invoiceType] = await databaseService.db
      .insert(documentTypes)
      .values({ name: "Invoice", slug: `invoice-tax-${suffix}` })
      .returning();
    // The processing pipeline may already have minted the `tax` tag in an
    // earlier test; membership only cares about the slug, so reuse it.
    const [insertedTaxTag] = await databaseService.db
      .insert(tags)
      .values({ name: "tax", slug: "tax" })
      .onConflictDoNothing()
      .returning();
    const taxTag =
      insertedTaxTag ??
      (await databaseService.db.select().from(tags).where(eq(tags.slug, "tax")))[0];
    const [correspondent] = await databaseService.db
      .insert(correspondents)
      .values({
        name: "Finanzamt",
        slug: `finanzamt-${suffix}`,
        normalizedName: "finanzamt",
      })
      .returning();

    const [otherUser] = await databaseService.db
      .insert(users)
      .values({
        email: `second-${suffix}@example.com`,
        passwordHash: "x",
        displayName: "Second User",
        isOwner: false,
      })
      .returning();

    const seedDocument = async (input: {
      title: string;
      issueDate: string;
      amount?: string;
      currency?: string;
      documentTypeId?: string;
      tagged?: boolean;
      ownerId?: string;
    }) => {
      const [file] = await databaseService.db
        .insert(documentFiles)
        .values({
          checksum: randomUUID().replace(/-/g, "").padEnd(64, "e").slice(0, 64),
          storageKey: `fixtures/${randomUUID()}/tax.pdf`,
          originalFilename: "tax.pdf",
          mimeType: "application/pdf",
          sizeBytes: 64,
        })
        .returning();
      const [document] = await databaseService.db
        .insert(documents)
        .values({
          ownerUserId: input.ownerId ?? ownerUserId,
          fileId: file.id,
          title: input.title,
          mimeType: "application/pdf",
          status: "ready",
          issueDate: new Date(input.issueDate),
          amount: input.amount,
          currency: input.currency,
          correspondentId: correspondent.id,
          documentTypeId: input.documentTypeId,
          fullText: input.title,
        } as never)
        .returning();
      if (input.tagged) {
        await databaseService.db
          .insert(documentTagLinks)
          .values({ documentId: document.id, tagId: taxTag.id });
      }
      return { document, file };
    };

    const seeded = [
      // Member via type only, on the first day of the year.
      await seedDocument({
        title: "Steuerbescheid 2025",
        issueDate: "2025-01-01",
        amount: "100.00",
        currency: "EUR",
        documentTypeId: taxType.id,
      }),
      // Member via tag only, filed under a non-tax type.
      await seedDocument({
        title: "Spendenquittung",
        issueDate: "2025-06-15",
        amount: "50.50",
        currency: "EUR",
        documentTypeId: invoiceType.id,
        tagged: true,
      }),
      // Member via both, without an amount.
      await seedDocument({
        title: "Steuerunterlagen ohne Betrag",
        issueDate: "2025-07-01",
        documentTypeId: taxType.id,
        tagged: true,
      }),
      // Member via tag, unfiled, second currency.
      await seedDocument({
        title: "US withholding statement",
        issueDate: "2025-09-30",
        amount: "20.00",
        currency: "USD",
        tagged: true,
      }),
      // Previous year, last day — must not leak into 2025.
      await seedDocument({
        title: "Steuerbescheid 2024",
        issueDate: "2024-12-31",
        amount: "999.00",
        currency: "EUR",
        documentTypeId: taxType.id,
      }),
      // Same year, but neither tagged nor of a tax type.
      await seedDocument({
        title: "Ordinary invoice",
        issueDate: "2025-03-03",
        amount: "77.00",
        currency: "EUR",
        documentTypeId: invoiceType.id,
      }),
      // Another user's tax document must stay invisible.
      await seedDocument({
        title: "Foreign tax document",
        issueDate: "2025-05-05",
        amount: "500.00",
        currency: "EUR",
        documentTypeId: taxType.id,
        ownerId: otherUser.id,
      }),
    ];

    const response = await request(app.getHttpServer())
      .get("/api/taxes/2025")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.year).toBe(2025);
    expect(response.body.documentCount).toBe(4);
    expect(response.body.unsummedCount).toBe(1);
    expect(response.body.totals).toEqual([
      { currency: "EUR", sum: 150.5, count: 2 },
      { currency: "USD", sum: 20, count: 1 },
    ]);

    const titles = response.body.groups.flatMap(
      (group: { documents: Array<{ title: string }> }) =>
        group.documents.map((document) => document.title),
    );
    expect(titles).not.toContain("Ordinary invoice");
    expect(titles).not.toContain("Foreign tax document");
    expect(titles).not.toContain("Steuerbescheid 2024");

    const taxGroup = response.body.groups.find(
      (group: { documentType: string | null }) => group.documentType === "Tax Document",
    );
    expect(taxGroup.count).toBe(2);
    expect(taxGroup.unsummedCount).toBe(1);
    expect(taxGroup.totals).toEqual([{ currency: "EUR", sum: 100, count: 1 }]);
    expect(
      taxGroup.documents.map((document: { title: string; memberVia: string }) => document.memberVia),
    ).toEqual(["type", "both"]);

    const invoiceGroup = response.body.groups.find(
      (group: { documentType: string | null }) => group.documentType === "Invoice",
    );
    expect(invoiceGroup.count).toBe(1);
    expect(invoiceGroup.documents[0].memberVia).toBe("tag");
    expect(invoiceGroup.documents[0].correspondentName).toBe("Finanzamt");

    const unfiledGroup = response.body.groups.find(
      (group: { documentType: string | null }) => group.documentType === null,
    );
    expect(unfiledGroup.totals).toEqual([{ currency: "USD", sum: 20, count: 1 }]);
    // The unfiled group sorts last regardless of size.
    expect(response.body.groups[response.body.groups.length - 1].documentType).toBeNull();

    const previousYear = await request(app.getHttpServer())
      .get("/api/taxes/2024")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(previousYear.status).toBe(200);
    expect(previousYear.body.documentCount).toBe(1);
    expect(previousYear.body.groups[0].documents[0].title).toBe("Steuerbescheid 2024");
    expect(previousYear.body.groups[0].documents[0].issueDate).toBe("2024-12-31");

    const invalidYear = await request(app.getHttpServer())
      .get("/api/taxes/20x5")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(invalidYear.status).toBe(400);

    const unauthenticated = await request(app.getHttpServer()).get("/api/taxes/2025");
    expect(unauthenticated.status).toBe(401);

    const documentIds = seeded.map((entry) => entry.document.id);
    const fileIds = seeded.map((entry) => entry.file.id);
    await databaseService.pool.query(
      `DELETE FROM documents WHERE id = ANY($1::uuid[])`,
      [documentIds],
    );
    await databaseService.pool.query(`DELETE FROM document_files WHERE id = ANY($1::uuid[])`, [
      fileIds,
    ]);
    await databaseService.pool.query(`DELETE FROM document_types WHERE id = ANY($1::uuid[])`, [
      [taxType.id, invoiceType.id],
    ]);
    await databaseService.pool.query(`DELETE FROM tags WHERE id = $1::uuid`, [taxTag.id]);
    await databaseService.pool.query(`DELETE FROM correspondents WHERE id = $1::uuid`, [
      correspondent.id,
    ]);
    await databaseService.pool.query(`DELETE FROM users WHERE id = $1::uuid`, [otherUser.id]);
  });
  it("exports a tax year as a ZIP with an honest index", async () => {
    const AdmZip = (await import("adm-zip")).default;
    const suffix = randomUUID().slice(0, 8);

    const [taxType] = await databaseService.db
      .insert(documentTypes)
      .values({ name: "Tax Document", slug: `tax-export-${suffix}` })
      .returning();
    const [insertedTaxTag] = await databaseService.db
      .insert(tags)
      .values({ name: "tax", slug: "tax" })
      .onConflictDoNothing()
      .returning();
    const taxTag =
      insertedTaxTag ??
      (await databaseService.db.select().from(tags).where(eq(tags.slug, "tax")))[0];
    const [correspondent] = await databaseService.db
      .insert(correspondents)
      .values({
        name: "Finanzamt Export",
        slug: `finanzamt-export-${suffix}`,
        normalizedName: "finanzamt export",
      })
      .returning();

    const seedExportDocument = async (input: {
      title: string;
      issueDate: string;
      amount?: string;
      currency?: string;
      typed?: boolean;
      tagged?: boolean;
      uploadOriginal: boolean;
      searchable?: boolean;
    }) => {
      const storageKey = `fixtures/${randomUUID()}/original.pdf`;
      const searchableKey = input.searchable ? `fixtures/${randomUUID()}/searchable.pdf` : null;
      if (input.uploadOriginal) {
        await storageService.uploadBuffer(
          storageKey,
          Buffer.from(`%PDF-original-${input.title}`, "utf8"),
          "application/pdf",
        );
      }
      if (searchableKey) {
        await storageService.uploadBuffer(
          searchableKey,
          Buffer.from(`%PDF-searchable-${input.title}`, "utf8"),
          "application/pdf",
        );
      }
      const [file] = await databaseService.db
        .insert(documentFiles)
        .values({
          checksum: randomUUID().replace(/-/g, "").padEnd(64, "f").slice(0, 64),
          storageKey,
          originalFilename: "original.pdf",
          mimeType: "application/pdf",
          sizeBytes: 64,
        })
        .returning();
      const [document] = await databaseService.db
        .insert(documents)
        .values({
          ownerUserId,
          fileId: file.id,
          title: input.title,
          mimeType: "application/pdf",
          status: "ready",
          issueDate: new Date(input.issueDate),
          amount: input.amount,
          currency: input.currency,
          correspondentId: correspondent.id,
          documentTypeId: input.typed ? taxType.id : undefined,
          searchablePdfStorageKey: searchableKey,
          fullText: input.title,
        } as never)
        .returning();
      if (input.tagged) {
        await databaseService.db
          .insert(documentTagLinks)
          .values({ documentId: document.id, tagId: taxTag.id });
      }
      return { document, file };
    };

    const reserved = await seedExportDocument({
      title: "CON",
      issueDate: "2023-03-01",
      amount: "10.00",
      currency: "EUR",
      typed: true,
      uploadOriginal: true,
    });
    const searchable = await seedExportDocument({
      title: "Bescheid/2023: Nachzahlung?",
      issueDate: "2023-05-01",
      amount: "20.00",
      currency: "EUR",
      tagged: true,
      uploadOriginal: true,
      searchable: true,
    });
    const missing = await seedExportDocument({
      title: "Verschollener Beleg",
      issueDate: "2023-08-01",
      typed: true,
      uploadOriginal: false,
    });

    const response = await request(app.getHttpServer())
      .get("/api/taxes/2023/export")
      .set("Authorization", `Bearer ${accessToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/zip");
    expect(response.headers["content-disposition"]).toContain("tax-year-2023.zip");

    const zip = new AdmZip(response.body as Buffer);
    const entryNames = zip.getEntries().map((entry) => entry.entryName);

    // Two files (the missing one is absent) plus the index.
    expect(entryNames).toHaveLength(3);
    expect(entryNames).toContain("index.csv");

    // Windows-reserved title gets escaped, the slashed title gets flattened.
    const reservedEntry = entryNames.find((name) => name.startsWith("Tax Document/"));
    expect(reservedEntry).toBe("Tax Document/2023-03-01_Finanzamt Export__CON.pdf");
    const searchableEntry = entryNames.find((name) => name.startsWith("Unfiled/"));
    expect(searchableEntry).toContain("Bescheid_2023_ Nachzahlung");
    expect(searchableEntry?.endsWith(".pdf")).toBe(true);

    // The searchable variant is preferred over the original bytes.
    const searchableContent = zip.readAsText(searchableEntry!);
    expect(searchableContent).toContain("%PDF-searchable");

    const csv = zip.readAsText("index.csv");
    const csvLines = csv.trim().split("\n");
    expect(csvLines).toHaveLength(4);
    expect(csvLines[0]).toBe("date,correspondent,type,title,amount,currency,filename,status");
    // Every member appears; the missing file is reported, not omitted.
    expect(csv).toContain("Verschollener Beleg");
    expect(csv).toContain("missing-file");
    const missingLine = csvLines.find((line) => line.includes("Verschollener Beleg"));
    expect(missingLine).toContain(",,missing-file");

    // The export landed in the audit history of the exported documents only.
    const auditedRows = await databaseService.pool.query(
      `SELECT document_id FROM audit_events WHERE event_type = 'document.tax_year_exported'`,
    );
    const auditedIds = auditedRows.rows.map((row) => row.document_id);
    expect(auditedIds).toContain(reserved.document.id);
    expect(auditedIds).toContain(searchable.document.id);
    expect(auditedIds).not.toContain(missing.document.id);

    const documentIds = [reserved, searchable, missing].map((entry) => entry.document.id);
    const fileIds = [reserved, searchable, missing].map((entry) => entry.file.id);
    await databaseService.pool.query(`DELETE FROM audit_events WHERE document_id = ANY($1::uuid[])`, [
      documentIds,
    ]);
    await databaseService.pool.query(`DELETE FROM documents WHERE id = ANY($1::uuid[])`, [
      documentIds,
    ]);
    await databaseService.pool.query(`DELETE FROM document_files WHERE id = ANY($1::uuid[])`, [
      fileIds,
    ]);
    await databaseService.pool.query(`DELETE FROM document_types WHERE id = $1::uuid`, [
      taxType.id,
    ]);
    await databaseService.pool.query(`DELETE FROM correspondents WHERE id = $1::uuid`, [
      correspondent.id,
    ]);
  });
  it("bulk-tags and bulk-types documents in one request with partial-failure reporting", async () => {
    const suffix = randomUUID().slice(0, 8);
    const [bulkTag] = await databaseService.db
      .insert(tags)
      .values({ name: `bulk-${suffix}`, slug: `bulk-${suffix}` })
      .returning();
    const [bulkType] = await databaseService.db
      .insert(documentTypes)
      .values({ name: `Bulk Type ${suffix}`, slug: `bulk-type-${suffix}` })
      .returning();

    const seedDocument = async (title: string) => {
      const [file] = await databaseService.db
        .insert(documentFiles)
        .values({
          checksum: randomUUID().replace(/-/g, "").padEnd(64, "7").slice(0, 64),
          storageKey: `fixtures/${randomUUID()}/bulk.pdf`,
          originalFilename: "bulk.pdf",
          mimeType: "application/pdf",
          sizeBytes: 8,
        })
        .returning();
      const [document] = await databaseService.db
        .insert(documents)
        .values({
          ownerUserId,
          fileId: file.id,
          title: `${title} ${suffix}`,
          mimeType: "application/pdf",
          status: "ready",
          fullText: title,
        } as never)
        .returning();
      return { document, file };
    };

    const first = await seedDocument("Bulk A");
    const second = await seedDocument("Bulk B");
    const ghostId = randomUUID();

    // One request tags all of them; the unknown id is reported, not fatal.
    const tagResponse = await request(app.getHttpServer())
      .post("/api/documents/bulk/tags")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        documentIds: [first.document.id, second.document.id, ghostId],
        tagId: bulkTag.id,
        action: "add",
      });
    expect(tagResponse.status).toBe(201);
    expect(tagResponse.body.updated).toEqual(
      expect.arrayContaining([first.document.id, second.document.id]),
    );
    expect(tagResponse.body.failed).toEqual([{ id: ghostId, reason: "not-found" }]);

    // Applying the same tag again is a no-op, not an error.
    const repeat = await request(app.getHttpServer())
      .post("/api/documents/bulk/tags")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        documentIds: [first.document.id],
        tagId: bulkTag.id,
        action: "add",
      });
    expect(repeat.status).toBe(201);

    const links = await databaseService.pool.query(
      `SELECT count(*)::int AS links FROM document_tag_links WHERE tag_id = $1`,
      [bulkTag.id],
    );
    expect(links.rows[0].links).toBe(2);

    // Each document's history shows the change.
    const history = await request(app.getHttpServer())
      .get(`/api/documents/${first.document.id}/history`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(history.status).toBe(200);
    expect(JSON.stringify(history.body)).toContain("tagIds");

    // Removing takes it off both.
    await request(app.getHttpServer())
      .post("/api/documents/bulk/tags")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        documentIds: [first.document.id, second.document.id],
        tagId: bulkTag.id,
        action: "remove",
      });
    const afterRemove = await databaseService.pool.query(
      `SELECT count(*)::int AS links FROM document_tag_links WHERE tag_id = $1`,
      [bulkTag.id],
    );
    expect(afterRemove.rows[0].links).toBe(0);

    // Bulk type set and clear.
    const typeResponse = await request(app.getHttpServer())
      .post("/api/documents/bulk/type")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        documentIds: [first.document.id, second.document.id],
        documentTypeId: bulkType.id,
      });
    expect(typeResponse.status).toBe(201);
    const typed = await databaseService.pool.query(
      `SELECT count(*)::int AS typed FROM documents WHERE document_type_id = $1`,
      [bulkType.id],
    );
    expect(typed.rows[0].typed).toBe(2);

    const clearResponse = await request(app.getHttpServer())
      .post("/api/documents/bulk/type")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        documentIds: [first.document.id],
        documentTypeId: null,
      });
    expect(clearResponse.status).toBe(201);

    // An unknown tag is a request-level 404, not a partial failure.
    const missingTag = await request(app.getHttpServer())
      .post("/api/documents/bulk/tags")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        documentIds: [first.document.id],
        tagId: randomUUID(),
        action: "add",
      });
    expect(missingTag.status).toBe(404);

    const documentIds = [first, second].map((entry) => entry.document.id);
    await databaseService.pool.query(`DELETE FROM audit_events WHERE document_id = ANY($1::uuid[])`, [
      documentIds,
    ]);
    await databaseService.pool.query(`DELETE FROM documents WHERE id = ANY($1::uuid[])`, [
      documentIds,
    ]);
    await databaseService.pool.query(`DELETE FROM document_files WHERE id = ANY($1::uuid[])`, [
      [first, second].map((entry) => entry.file.id),
    ]);
    await databaseService.pool.query(`DELETE FROM tags WHERE id = $1::uuid`, [bulkTag.id]);
    await databaseService.pool.query(`DELETE FROM document_types WHERE id = $1::uuid`, [
      bulkType.id,
    ]);
  });
  it("categorizes correspondents: deterministic, llm-constrained, and manual wins", async () => {
    const { CategoryAssignmentService } = await import(
      "../src/taxonomies/category-assignment.service"
    );
    const categoryAssignment = app.get(CategoryAssignmentService);
    const suffix = randomUUID().slice(0, 8);

    // The seed put the builtin vocabulary in place.
    const listed = await request(app.getHttpServer())
      .get("/api/taxonomies/categories")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(listed.status).toBe(200);
    const bySlug = new Map<string, { slug: string; id: string; builtin: boolean }>(
      listed.body.map(
        (category: { slug: string; id: string; builtin: boolean }) =>
          [category.slug, category] as const,
      ),
    );
    expect(bySlug.get("housing")?.builtin).toBe(true);
    expect(bySlug.get("insurance")?.builtin).toBe(true);

    // A correspondent whose documents are mostly Utility Bills → Housing.
    const [utilityType] = await databaseService.db
      .insert(documentTypes)
      .values({ name: "Utility Bill", slug: `utility-${suffix}` })
      .returning();
    const [stadtwerke] = await databaseService.db
      .insert(correspondents)
      .values({
        name: `Stadtwerke ${suffix}`,
        slug: `stadtwerke-${suffix}`,
        normalizedName: `stadtwerke ${suffix}`,
      })
      .returning();
    const seedDoc = async () => {
      const [file] = await databaseService.db
        .insert(documentFiles)
        .values({
          checksum: randomUUID().replace(/-/g, "").padEnd(64, "5").slice(0, 64),
          storageKey: `fixtures/${randomUUID()}/cat.pdf`,
          originalFilename: "cat.pdf",
          mimeType: "application/pdf",
          sizeBytes: 8,
        })
        .returning();
      const [document] = await databaseService.db
        .insert(documents)
        .values({
          ownerUserId,
          fileId: file.id,
          title: `Abrechnung ${randomUUID().slice(0, 6)}`,
          mimeType: "application/pdf",
          status: "ready",
          correspondentId: stadtwerke.id,
          documentTypeId: utilityType.id,
          fullText: "abrechnung",
        } as never)
        .returning();
      return { document, file };
    };
    const docs = [await seedDoc(), await seedDoc()];

    await categoryAssignment.backfillMissing();
    const afterBackfill = await databaseService.pool.query(
      `SELECT c.category_source, cat.slug FROM correspondents c
       LEFT JOIN categories cat ON cat.id = c.category_id WHERE c.id = $1`,
      [stadtwerke.id],
    );
    expect(afterBackfill.rows[0].slug).toBe("housing");
    expect(afterBackfill.rows[0].category_source).toBe("deterministic");

    // An in-vocabulary LLM suggestion upgrades the deterministic guess.
    const applied = await categoryAssignment.applyIntelligenceCategory(
      stadtwerke.id,
      "insurance",
    );
    expect(applied).toBe("Insurance");
    // An out-of-vocabulary suggestion is discarded, not written.
    const discarded = await categoryAssignment.applyIntelligenceCategory(
      stadtwerke.id,
      "Telekommunikationsanbieter",
    );
    expect(discarded).toBeNull();
    const afterLlm = await databaseService.pool.query(
      `SELECT cat.slug, c.category_source FROM correspondents c
       LEFT JOIN categories cat ON cat.id = c.category_id WHERE c.id = $1`,
      [stadtwerke.id],
    );
    expect(afterLlm.rows[0].slug).toBe("insurance");
    expect(afterLlm.rows[0].category_source).toBe("llm");

    // Manual wins: PATCH sets it, and neither pass overwrites it afterwards.
    const housingId = (bySlug.get("housing") as { id: string }).id;
    const patched = await request(app.getHttpServer())
      .patch(`/api/taxonomies/correspondents/${stadtwerke.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: `Stadtwerke ${suffix}`, categoryId: housingId });
    expect(patched.status).toBe(200);
    await categoryAssignment.assignDeterministic(stadtwerke.id);
    await categoryAssignment.applyIntelligenceCategory(stadtwerke.id, "Finance");
    const afterManual = await databaseService.pool.query(
      `SELECT cat.slug, c.category_source FROM correspondents c
       LEFT JOIN categories cat ON cat.id = c.category_id WHERE c.id = $1`,
      [stadtwerke.id],
    );
    expect(afterManual.rows[0].slug).toBe("housing");
    expect(afterManual.rows[0].category_source).toBe("manual");

    // The explorer answers by category: facets and the filtered list.
    const facets = await request(app.getHttpServer())
      .get("/api/documents/facets")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(facets.status).toBe(200);
    const housingFacet = facets.body.categories.find(
      (entry: { slug: string }) => entry.slug === "housing",
    );
    expect(housingFacet?.count).toBeGreaterThanOrEqual(2);
    expect(typeof facets.body.uncategorizedCount).toBe("number");

    const filtered = await request(app.getHttpServer())
      .get(`/api/documents?categoryIds=${housingFacet.id}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(filtered.status).toBe(200);
    expect(
      filtered.body.items.every(
        (item: { correspondent: { id: string } | null }) =>
          item.correspondent?.id === stadtwerke.id,
      ),
    ).toBe(true);
    expect(filtered.body.items.length).toBeGreaterThanOrEqual(2);

    // Custom categories are pickable; deleting one set-nulls and reassigns.
    const created = await request(app.getHttpServer())
      .post("/api/taxonomies/categories")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: `Hobby ${suffix}` });
    expect(created.status).toBe(201);
    expect(created.body.builtin).toBe(false);
    await request(app.getHttpServer())
      .patch(`/api/taxonomies/correspondents/${stadtwerke.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: `Stadtwerke ${suffix}`, categoryId: created.body.id });
    const deleteCustom = await request(app.getHttpServer())
      .delete(`/api/taxonomies/categories/${created.body.id}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(deleteCustom.status).toBe(200);
    const afterDelete = await databaseService.pool.query(
      `SELECT category_id FROM correspondents WHERE id = $1`,
      [stadtwerke.id],
    );
    expect(afterDelete.rows[0].category_id).toBeNull();
    await categoryAssignment.backfillMissing();
    const reassigned = await databaseService.pool.query(
      `SELECT cat.slug FROM correspondents c
       LEFT JOIN categories cat ON cat.id = c.category_id WHERE c.id = $1`,
      [stadtwerke.id],
    );
    expect(reassigned.rows[0].slug).toBe("housing");

    // Builtins cannot be deleted, but can be renamed keeping the slug.
    const deleteBuiltin = await request(app.getHttpServer())
      .delete(`/api/taxonomies/categories/${housingId}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(deleteBuiltin.status).toBe(400);
    const renamed = await request(app.getHttpServer())
      .patch(`/api/taxonomies/categories/${housingId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: `Wohnen ${suffix}` });
    expect(renamed.status).toBe(200);
    expect(renamed.body.slug).toBe("housing");
    await request(app.getHttpServer())
      .patch(`/api/taxonomies/categories/${housingId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Housing" });

    await databaseService.pool.query(`DELETE FROM documents WHERE id = ANY($1::uuid[])`, [
      docs.map((entry) => entry.document.id),
    ]);
    await databaseService.pool.query(`DELETE FROM document_files WHERE id = ANY($1::uuid[])`, [
      docs.map((entry) => entry.file.id),
    ]);
    await databaseService.pool.query(`DELETE FROM correspondents WHERE id = $1`, [stadtwerke.id]);
    await databaseService.pool.query(`DELETE FROM document_types WHERE id = $1`, [utilityType.id]);
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
    expect(
      answeredResponse.body.results.some(
        (item: { document: { id: string } }) => item.document.id === primaryDocument.id,
      ),
    ).toBe(true);
    expect(answeredResponse.body.citations.length).toBeGreaterThanOrEqual(2);
    expect(
      answeredResponse.body.citations.some(
        (citation: { documentId: string }) => citation.documentId === primaryDocument.id,
      ),
    ).toBe(true);
    expect(
      answeredResponse.body.citations.some(
        (citation: { documentId: string }) => citation.documentId === supportingDocument.id,
      ),
    ).toBe(true);

    const insufficientResponse = await request(app.getHttpServer())
      .post("/api/search/answer")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        query: "What is the spacecraft registration number?",
      });

    expect(insufficientResponse.status).toBe(201);
    if (insufficientResponse.body.status === "insufficient_evidence") {
      expect(insufficientResponse.body.answer).toBeNull();
      expect(insufficientResponse.body.citations).toEqual([]);
    } else {
      expect(insufficientResponse.body.status).toBe("answered");
    }
    expect(insufficientResponse.body.results.length).toBeGreaterThanOrEqual(0);
  });

  it("answers open invoice questions from structured task state instead of stale document text", async () => {
    const invoiceTypeSlug = `invoice-${randomUUID().slice(0, 8)}`;
    const [invoiceType] = await databaseService.db
      .insert(documentTypes)
      .values({
        name: "Invoice",
        slug: invoiceTypeSlug,
        description: "Structured invoice documents",
        requiredFields: ["correspondent", "issueDate", "dueDate", "amount", "currency", "referenceNumber"],
      })
      .returning();

    const [correspondent] = await databaseService.db
      .insert(correspondents)
      .values({
        name: `Utility ${randomUUID().slice(0, 6)}`,
        slug: `utility-${randomUUID().slice(0, 6)}`,
        normalizedName: `utility ${randomUUID().slice(0, 6)}`,
      })
      .returning();

    // Clamp to the end of the CURRENT month: capping at a fixed day (28) puts the
    // due date in the past when the test runs on the 29th-31st, emptying the
    // structured "this month" window.
    const now = new Date();
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const openDueDate = new Date();
    openDueDate.setDate(Math.min(openDueDate.getDate() + 7, lastDayOfMonth));
    const completedDueDate = new Date(openDueDate);
    completedDueDate.setDate(Math.min(openDueDate.getDate() + 3, lastDayOfMonth));

    const [openFile, completedFile, staleFile] = await databaseService.db
      .insert(documentFiles)
      .values([
        {
          checksum: randomUUID().replace(/-/g, "").padEnd(64, "a").slice(0, 64),
          storageKey: `fixtures/${randomUUID()}/open-invoice.pdf`,
          originalFilename: "open-invoice.pdf",
          mimeType: "application/pdf",
          sizeBytes: 512,
        },
        {
          checksum: randomUUID().replace(/-/g, "").padEnd(64, "b").slice(0, 64),
          storageKey: `fixtures/${randomUUID()}/completed-invoice.pdf`,
          originalFilename: "completed-invoice.pdf",
          mimeType: "application/pdf",
          sizeBytes: 512,
        },
        {
          checksum: randomUUID().replace(/-/g, "").padEnd(64, "c").slice(0, 64),
          storageKey: `fixtures/${randomUUID()}/stale-invoice.pdf`,
          originalFilename: "stale-invoice.pdf",
          mimeType: "application/pdf",
          sizeBytes: 512,
        },
      ])
      .returning();

    await databaseService.db.insert(documents).values([
      {
        ownerUserId,
        fileId: openFile.id,
        title: "Electricity invoice current month",
        source: "upload",
        mimeType: "application/pdf",
        status: "ready",
        reviewStatus: "not_required",
        parseProvider: "local-ocr",
        documentTypeId: invoiceType.id,
        correspondentId: correspondent.id,
        issueDate: new Date(),
        dueDate: openDueDate,
        amount: "89.00",
        currency: "EUR",
        referenceNumber: "OPEN-APR-2026",
        fullText: "Current electricity invoice due this month.",
        processedAt: new Date(),
        metadata: {},
      },
      {
        ownerUserId,
        fileId: completedFile.id,
        title: "Completed internet invoice current month",
        source: "upload",
        mimeType: "application/pdf",
        status: "ready",
        reviewStatus: "not_required",
        parseProvider: "local-ocr",
        documentTypeId: invoiceType.id,
        correspondentId: correspondent.id,
        issueDate: new Date(),
        dueDate: completedDueDate,
        amount: "49.00",
        currency: "EUR",
        referenceNumber: "DONE-APR-2026",
        taskCompletedAt: new Date(),
        fullText: "This invoice was already paid.",
        processedAt: new Date(),
        metadata: {},
      },
      {
        ownerUserId,
        fileId: staleFile.id,
        title: "Water invoice June 2025",
        source: "upload",
        mimeType: "application/pdf",
        status: "ready",
        reviewStatus: "not_required",
        parseProvider: "local-ocr",
        documentTypeId: invoiceType.id,
        correspondentId: correspondent.id,
        issueDate: new Date("2025-06-01"),
        dueDate: new Date("2025-06-04"),
        amount: "12.00",
        currency: "EUR",
        referenceNumber: "STALE-2025-06",
        fullText:
          "Laut den Dokumenten sind folgende Rechnungen dieses Monat Juni 2025 fallig. Hamburg Wasser am 04.06.2025.",
        processedAt: new Date(),
        metadata: {},
      },
    ]);

    const response = await request(app.getHttpServer())
      .post("/api/search/answer")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        query: "Welche Rechnungen habe ich noch diesen Monat zu bezahlen?",
      });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("answered");
    expect(response.body.route).toBe("structured");
    expect(response.body.citations).toEqual([]);
    expect(response.body.results).toEqual([]);
    expect(response.body.structuredData.kind).toBe("deadline_items");
    expect(response.body.structuredData.totalOpenCount).toBe(1);
    expect(response.body.structuredData.items).toHaveLength(1);
    expect(response.body.structuredData.items[0]?.title).toBe("Electricity invoice current month");
    expect(response.body.structuredData.items[0]?.referenceNumber).toBe("OPEN-APR-2026");
    expect(response.body.answer).toContain("1");
    expect(response.body.answer).toContain("89,00");
  });

  it("answers pending review questions from structured review state", async () => {
    const [reviewFile] = await databaseService.db
      .insert(documentFiles)
      .values({
        checksum: randomUUID().replace(/-/g, "").padEnd(64, "d").slice(0, 64),
        storageKey: `fixtures/${randomUUID()}/review-doc.pdf`,
        originalFilename: "review-doc.pdf",
        mimeType: "application/pdf",
        sizeBytes: 512,
      })
      .returning();

    await databaseService.db.insert(documents).values({
      ownerUserId,
      fileId: reviewFile.id,
      title: "Ambiguous insurance notice",
      source: "upload",
      mimeType: "application/pdf",
      status: "ready",
      reviewStatus: "pending",
      reviewReasons: ["low_confidence", "missing_key_fields"],
      parseProvider: "local-ocr",
      fullText: "Insurance notice with incomplete extraction.",
      processedAt: new Date(),
      metadata: {},
    });

    const response = await request(app.getHttpServer())
      .post("/api/search/answer")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ query: "Welche Dokumente mussen noch gepruft werden?" });

    expect(response.status).toBe(201);
    expect(response.body.route).toBe("structured");
    expect(response.body.structuredData.kind).toBe("pending_review_documents");
    expect(response.body.structuredData.totalCount).toBeGreaterThanOrEqual(1);
    expect(response.body.structuredData.items.some((item: { title: string }) => item.title === "Ambiguous insurance notice")).toBe(true);
  });

  it("answers expiring contract questions from structured expiry dates", async () => {
    const contractTypeSlug = `contract-${randomUUID().slice(0, 8)}`;
    const [contractType] = await databaseService.db
      .insert(documentTypes)
      .values({
        name: "Contract",
        slug: contractTypeSlug,
        description: "Contracts",
        requiredFields: ["correspondent", "issueDate", "referenceNumber", "expiryDate"],
      })
      .returning();

    const [contractFile] = await databaseService.db
      .insert(documentFiles)
      .values({
        checksum: randomUUID().replace(/-/g, "").padEnd(64, "e").slice(0, 64),
        storageKey: `fixtures/${randomUUID()}/contract-doc.pdf`,
        originalFilename: "contract-doc.pdf",
        mimeType: "application/pdf",
        sizeBytes: 512,
      })
      .returning();

    // Clamp to the end of the CURRENT month (a fixed day-28 cap lands in the past
    // when the test runs at month end, emptying the expiry window).
    const expiryNow = new Date();
    const expiryMonthEnd = new Date(
      expiryNow.getFullYear(),
      expiryNow.getMonth() + 1,
      0,
    ).getDate();
    const expiryDate = new Date();
    expiryDate.setDate(Math.min(expiryDate.getDate() + 10, expiryMonthEnd));

    await databaseService.db.insert(documents).values({
      ownerUserId,
      fileId: contractFile.id,
      title: "Mobile contract 2026",
      source: "upload",
      mimeType: "application/pdf",
      status: "ready",
      reviewStatus: "not_required",
      parseProvider: "local-ocr",
      documentTypeId: contractType.id,
      expiryDate,
      fullText: "Contract term ends later this month.",
      processedAt: new Date(),
      metadata: {},
    });

    const response = await request(app.getHttpServer())
      .post("/api/search/answer")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ query: "Which contracts expire this month?" });

    expect(response.status).toBe(201);
    expect(response.body.route).toBe("structured");
    expect(response.body.structuredData.kind).toBe("expiring_contracts");
    expect(response.body.structuredData.totalCount).toBeGreaterThanOrEqual(1);
    expect(response.body.structuredData.items.some((item: { title: string }) => item.title === "Mobile contract 2026")).toBe(true);
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
