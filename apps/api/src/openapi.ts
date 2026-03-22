import "reflect-metadata";

import { writeFile } from "fs/promises";
import { resolve } from "path";
import { documentStatuses, parseProviders, reviewReasons } from "@openkeep/types";

import { createApp } from "./bootstrap";

function patchGeneratedDocument(document: Record<string, any>) {
  document.paths ??= {};

  document.paths["/api/documents/review"] = {
    get: {
      operationId: "DocumentsController_listReviewDocuments",
      summary: "List documents currently waiting for review",
      tags: ["documents"],
      security: [{ bearer: [] }],
      parameters: [
        {
          name: "processingStatus",
          required: false,
          in: "query",
          schema: {
            type: "string",
            enum: [...documentStatuses],
          },
        },
        {
          name: "reason",
          required: false,
          in: "query",
          schema: {
            type: "string",
            enum: [...reviewReasons],
          },
        },
        {
          name: "page",
          required: false,
          in: "query",
          schema: {
            type: "integer",
            minimum: 1,
            default: 1,
          },
        },
        {
          name: "pageSize",
          required: false,
          in: "query",
          schema: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: 20,
          },
        },
      ],
      responses: {
        200: {
          description: "Review queue response",
          content: {
            "application/json": {
              schema: {
                type: "object",
              },
            },
          },
        },
      },
    },
  };

  document.paths["/api/documents/{id}/review/resolve"] = {
    post: {
      operationId: "DocumentsController_resolveReview",
      summary: "Resolve review state for a document",
      tags: ["documents"],
      security: [{ bearer: [] }],
      parameters: [
        {
          name: "id",
          required: true,
          in: "path",
          schema: {
            type: "string",
          },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                reviewNote: {
                  type: "string",
                  nullable: true,
                },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: "Updated document after review resolution",
        },
      },
    },
  };

  document.paths["/api/documents/{id}/review/requeue"] = {
    post: {
      operationId: "DocumentsController_requeueReview",
      summary: "Requeue a document from the review queue for processing",
      tags: ["documents"],
      security: [{ bearer: [] }],
      parameters: [
        {
          name: "id",
          required: true,
          in: "path",
          schema: {
            type: "string",
          },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                force: {
                  type: "boolean",
                  default: true,
                },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: "Queued processing job metadata",
        },
      },
    },
  };

  const reprocessPath = document.paths["/api/documents/{id}/reprocess"]?.post;
  if (reprocessPath) {
    reprocessPath.summary ??= "Reprocess a document with an optional OCR provider override";
    reprocessPath.requestBody = {
      required: false,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              parseProvider: {
                type: "string",
                enum: [...parseProviders],
              },
            },
          },
        },
      },
    };
  }

  document.paths["/api/health/providers"] = {
    get: {
      operationId: "HealthController_providers",
      summary: "List configured parse and embedding providers with availability",
      tags: ["health"],
      parameters: [],
      responses: {
        200: {
          description: "Provider availability response",
          content: {
            "application/json": {
              schema: {
                type: "object",
              },
            },
          },
        },
      },
    },
  };

  document.paths["/api/health/ready"] = {
    get: {
      operationId: "HealthController_ready",
      summary: "Run readiness checks for database, object storage, and queue",
      tags: ["health"],
      parameters: [],
      responses: {
        200: {
          description: "Readiness status response",
          content: {
            "application/json": {
              schema: {
                type: "object",
              },
            },
          },
        },
      },
    },
  };

  document.paths["/api/health/status"] = {
    get: {
      operationId: "HealthController_status_detail",
      summary: "Get queue depths, document counts, and recent processing jobs",
      tags: ["health"],
      parameters: [],
      responses: {
        200: {
          description: "Processing and queue activity response",
          content: {
            "application/json": {
              schema: {
                type: "object",
              },
            },
          },
        },
      },
    },
  };
}

async function generateOpenApi() {
  process.env.SKIP_EXTERNAL_INIT = "true";
  process.env.JWT_ACCESS_SECRET ??= "openkeep-docs-access-secret-123456789";
  process.env.JWT_REFRESH_SECRET ??= "openkeep-docs-refresh-secret-123456789";
  const { app, document } = await createApp();
  patchGeneratedDocument(document as Record<string, any>);
  const serialized = JSON.stringify(document, null, 2);
  const repoRootOpenApiPath = resolve(__dirname, "../../../openapi.json");
  const localOpenApiPath = resolve(process.cwd(), "openapi.json");

  await Promise.all([
    writeFile(repoRootOpenApiPath, serialized),
    writeFile(localOpenApiPath, serialized),
  ]);
  await app.close();
}

generateOpenApi();
