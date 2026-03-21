import { randomUUID } from "crypto";
import { resolve } from "path";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq, sql } from "drizzle-orm";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { GenericContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  documentFiles,
  documents,
  processingJobs,
} from "@openkeep/db";
import { createApp } from "../src/bootstrap";
import { DatabaseService } from "../src/common/db/database.service";
import { ObjectStorageService } from "../src/common/storage/storage.service";

const shouldRun = process.env.RUN_TESTCONTAINERS === "1";
const migrationsFolder = resolve(__dirname, "../../../packages/db/migrations");

describe.skipIf(!shouldRun)("API integration (Postgres + MinIO)", () => {
  let app: NestFastifyApplication;
  let databaseService: DatabaseService;
  let postgresContainer: Awaited<ReturnType<GenericContainer["start"]>>;
  let minioContainer: Awaited<ReturnType<GenericContainer["start"]>>;
  let storageService: ObjectStorageService;
  let accessToken = "";
  let apiToken = "";
  let ownerUserId = "";

  beforeAll(async () => {
    postgresContainer = await new GenericContainer("postgres:16-alpine")
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
    process.env.SKIP_EXTERNAL_INIT = "false";
    process.env.OCR_LANGUAGES = "deu+eng";
    process.env.REVIEW_CONFIDENCE_THRESHOLD = "0.65";
    process.env.OCR_EMPTY_TEXT_THRESHOLD = "20";
    process.env.PROCESSING_RETRY_LIMIT = "2";
    process.env.PROCESSING_RETRY_DELAY_SECONDS = "1";

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
        fullText: "Invoice 2025 paid amount due",
        issueDate: new Date(Date.UTC(2025, 0, 10)),
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
    expect(searchResponse.body.items.some((item: { id: string }) => item.id === readyDocument.id)).toBe(
      true,
    );

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
});
