import "reflect-metadata";

import { writeFile } from "fs/promises";
import { resolve } from "path";
import { documentStatuses, parseProviders, reviewReasons } from "@openkeep/types";

import { createApp } from "./bootstrap";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(code: number, description: string, schema?: Record<string, any>) {
  const resp: Record<string, any> = { description };
  if (schema) {
    resp.content = { "application/json": { schema } };
  }
  return { [code]: resp };
}

function json200(description: string, schema?: Record<string, any>) {
  return json(200, description, schema ?? { type: "object" });
}

function json201(description: string, schema?: Record<string, any>) {
  return json(201, description, schema ?? { type: "object" });
}

function idPathParam() {
  return { name: "id", required: true, in: "path", schema: { type: "string" } };
}

function paginationParams(defaults?: { page?: number; pageSize?: number }) {
  return [
    {
      name: "page",
      required: false,
      in: "query",
      schema: { type: "integer", minimum: 1, default: defaults?.page ?? 1 },
    },
    {
      name: "pageSize",
      required: false,
      in: "query",
      schema: { type: "integer", minimum: 1, maximum: 100, default: defaults?.pageSize ?? 20 },
    },
  ];
}

function bodyJson(schema: Record<string, any>, required = true) {
  return { required, content: { "application/json": { schema } } };
}

function nameBodySchema() {
  return { type: "object", required: ["name"], properties: { name: { type: "string" } } };
}

function mergeBodySchema() {
  return { type: "object", required: ["targetId"], properties: { targetId: { type: "string", format: "uuid" } } };
}

const docObj = { type: "object" } as const;
const docArr = { type: "array", items: { type: "object" } } as const;

// Shared document search query parameters
function documentSearchQueryParams() {
  return [
    { name: "query", required: false, in: "query", schema: { type: "string" } },
    { name: "year", required: false, in: "query", schema: { type: "integer", minimum: 1970, maximum: 2100 } },
    { name: "dateFrom", required: false, in: "query", schema: { type: "string" } },
    { name: "dateTo", required: false, in: "query", schema: { type: "string" } },
    { name: "correspondentId", required: false, in: "query", schema: { type: "string", format: "uuid" } },
    { name: "documentTypeId", required: false, in: "query", schema: { type: "string", format: "uuid" } },
    { name: "status", required: false, in: "query", schema: { type: "string", enum: [...documentStatuses] } },
    { name: "tags", required: false, in: "query", schema: { type: "string", description: "Comma-separated UUIDs" } },
    { name: "sort", required: false, in: "query", schema: { type: "string", enum: ["createdAt", "issueDate", "dueDate", "title"], default: "createdAt" } },
    { name: "direction", required: false, in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
    ...paginationParams(),
  ];
}

// ---------------------------------------------------------------------------
// Taxonomy helpers — 5 operations per entity (list, create, update, delete, merge)
// ---------------------------------------------------------------------------

function taxonomyPaths(
  entity: string,
  tag: string,
  opts?: { createExtra?: Record<string, any> },
) {
  const basePath = `/api/taxonomies/${entity}`;
  const idPath = `${basePath}/{id}`;
  const mergePath = `${idPath}/merge`;

  const createProps: Record<string, any> = { name: { type: "string" } };
  if (opts?.createExtra) {
    Object.assign(createProps, opts.createExtra);
  }
  const createSchema: Record<string, any> = {
    type: "object",
    required: ["name"],
    properties: createProps,
  };

  return {
    [basePath]: {
      get: {
        operationId: `TaxonomiesController_list${tag}`,
        summary: `List all ${entity}`,
        tags: ["taxonomies"],
        security: [{ bearer: [] }],
        parameters: [],
        responses: json200(`List of ${entity}`, docArr),
      },
      post: {
        operationId: `TaxonomiesController_create${tag.replace(/s$/, "")}`,
        summary: `Create a ${entity.replace(/s$/, "")}`,
        tags: ["taxonomies"],
        security: [{ bearer: [] }],
        parameters: [],
        requestBody: bodyJson(createSchema),
        responses: json201(`Created ${entity.replace(/s$/, "")}`, docObj),
      },
    },
    [idPath]: {
      patch: {
        operationId: `TaxonomiesController_update${tag.replace(/s$/, "")}`,
        summary: `Update a ${entity.replace(/s$/, "")}`,
        tags: ["taxonomies"],
        security: [{ bearer: [] }],
        parameters: [idPathParam()],
        requestBody: bodyJson({ type: "object", properties: createProps }),
        responses: json200(`Updated ${entity.replace(/s$/, "")}`, docObj),
      },
      delete: {
        operationId: `TaxonomiesController_delete${tag.replace(/s$/, "")}`,
        summary: `Delete a ${entity.replace(/s$/, "")}`,
        tags: ["taxonomies"],
        security: [{ bearer: [] }],
        parameters: [idPathParam()],
        responses: json200(`Deleted ${entity.replace(/s$/, "")}`),
      },
    },
    [mergePath]: {
      post: {
        operationId: `TaxonomiesController_merge${tag.replace(/s$/, "")}`,
        summary: `Merge a ${entity.replace(/s$/, "")} into another`,
        tags: ["taxonomies"],
        security: [{ bearer: [] }],
        parameters: [idPathParam()],
        requestBody: bodyJson(mergeBodySchema()),
        responses: json200(`Merged ${entity.replace(/s$/, "")}`, docObj),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Main patching function
// ---------------------------------------------------------------------------

function patchGeneratedDocument(document: Record<string, any>) {
  document.paths ??= {};

  // Helper to ensure response content on an auto-detected endpoint
  function ensureResponse(path: string, method: string, code: number, description: string, schema?: Record<string, any>) {
    const op = document.paths[path]?.[method];
    if (!op) return;
    op.responses ??= {};
    op.responses[code] ??= {};
    op.responses[code].description ??= description;
    if (schema && !op.responses[code].content) {
      op.responses[code].content = { "application/json": { schema } };
    }
  }

  // Helper to set parameters on an auto-detected endpoint
  function ensureParams(path: string, method: string, params: any[]) {
    const op = document.paths[path]?.[method];
    if (!op) return;
    if (!op.parameters || op.parameters.length === 0) {
      op.parameters = params;
    }
  }

  // Helper to ensure request body on an auto-detected endpoint
  function ensureRequestBody(path: string, method: string, schema: Record<string, any>, required = true) {
    const op = document.paths[path]?.[method];
    if (!op) return;
    if (!op.requestBody) {
      op.requestBody = bodyJson(schema, required);
    }
  }

  // =================================================================
  // Auth endpoints — response schemas
  // =================================================================
  ensureResponse("/api/auth/login", "post", 201, "Login response with tokens", docObj);
  ensureResponse("/api/auth/refresh", "post", 201, "Refreshed tokens", docObj);
  ensureResponse("/api/auth/setup", "post", 201, "Owner account created, tokens returned", docObj);
  ensureResponse("/api/auth/me", "get", 200, "Current user profile", docObj);
  ensureResponse("/api/auth/tokens", "get", 200, "List of API tokens", docArr);
  ensureResponse("/api/auth/tokens", "post", 201, "Newly created API token", docObj);
  ensureResponse("/api/auth/tokens/{id}", "delete", 200, "Token deleted");

  // =================================================================
  // Document endpoints — query params + response schemas
  // =================================================================

  // GET /api/documents — add query params + response
  ensureParams("/api/documents", "get", documentSearchQueryParams());
  ensureResponse("/api/documents", "get", 200, "Paginated document list", docObj);

  // POST /api/documents — upload response
  ensureResponse("/api/documents", "post", 201, "Uploaded document", docObj);

  // GET /api/documents/facets
  ensureResponse("/api/documents/facets", "get", 200, "Browse facets (years, correspondents, types, tags)", docObj);

  // GET /api/documents/review — replace entirely to get correct query params
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
          schema: { type: "string", enum: [...documentStatuses] },
        },
        {
          name: "reason",
          required: false,
          in: "query",
          schema: { type: "string", enum: [...reviewReasons] },
        },
        ...paginationParams(),
      ],
      responses: json200("Review queue response", docObj),
    },
  };

  // GET /api/documents/{id}
  ensureResponse("/api/documents/{id}", "get", 200, "Single document", docObj);

  // PATCH /api/documents/{id}
  ensureResponse("/api/documents/{id}", "patch", 200, "Updated document", docObj);

  // GET /api/documents/{id}/text
  ensureResponse("/api/documents/{id}/text", "get", 200, "Extracted text blocks", docObj);

  // GET /api/documents/{id}/history
  ensureResponse("/api/documents/{id}/history", "get", 200, "Document audit history", docObj);

  // GET /api/documents/{id}/download — binary, no JSON schema
  ensureResponse("/api/documents/{id}/download", "get", 200, "Original file download");
  ensureResponse("/api/documents/{id}/download/searchable", "get", 200, "Searchable PDF download");

  // POST /api/documents/{id}/review/resolve
  document.paths["/api/documents/{id}/review/resolve"] = {
    post: {
      operationId: "DocumentsController_resolveReview",
      summary: "Resolve review state for a document",
      tags: ["documents"],
      security: [{ bearer: [] }],
      parameters: [idPathParam()],
      requestBody: bodyJson(
        {
          type: "object",
          properties: {
            reviewNote: { type: "string", nullable: true },
          },
        },
        true,
      ),
      responses: json201("Updated document after review resolution", docObj),
    },
  };

  // POST /api/documents/{id}/review/requeue
  document.paths["/api/documents/{id}/review/requeue"] = {
    post: {
      operationId: "DocumentsController_requeueReview",
      summary: "Requeue a document from the review queue for processing",
      tags: ["documents"],
      security: [{ bearer: [] }],
      parameters: [idPathParam()],
      requestBody: bodyJson({
        type: "object",
        properties: {
          force: { type: "boolean", default: true },
        },
      }),
      responses: json201("Queued processing job metadata", docObj),
    },
  };

  // POST /api/documents/{id}/reprocess
  const reprocessPath = document.paths["/api/documents/{id}/reprocess"]?.post;
  if (reprocessPath) {
    reprocessPath.summary ??= "Reprocess a document with an optional OCR provider override";
    reprocessPath.requestBody = bodyJson(
      {
        type: "object",
        properties: {
          parseProvider: { type: "string", enum: [...parseProviders] },
        },
      },
      false,
    );
    reprocessPath.responses = json201("Queued processing job metadata", docObj);
  }

  // POST /api/documents/{id}/reembed
  ensureResponse("/api/documents/{id}/reembed", "post", 201, "Queued embedding job metadata", docObj);

  // POST /api/embeddings/reindex
  ensureResponse("/api/embeddings/reindex", "post", 201, "Reindex result summary", docObj);

  // =================================================================
  // Search endpoints — query params + response schemas + request bodies
  // =================================================================

  // GET /api/search/documents
  ensureParams("/api/search/documents", "get", documentSearchQueryParams());
  ensureResponse("/api/search/documents", "get", 200, "Paginated search results", docObj);

  // POST /api/search/semantic
  ensureRequestBody("/api/search/semantic", "post", {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string" },
      page: { type: "integer", minimum: 1, default: 1 },
      pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      maxChunkMatches: { type: "integer", minimum: 1, maximum: 10, default: 3 },
    },
  });
  ensureResponse("/api/search/semantic", "post", 201, "Semantic search results", docObj);

  // POST /api/search/answer
  ensureRequestBody("/api/search/answer", "post", {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string" },
      maxDocuments: { type: "integer", minimum: 1, maximum: 5, default: 3 },
      maxCitations: { type: "integer", minimum: 1, maximum: 8, default: 4 },
      maxChunkMatches: { type: "integer", minimum: 1, maximum: 6, default: 4 },
    },
  });
  ensureResponse("/api/search/answer", "post", 201, "Extractive answer with citations", docObj);

  // =================================================================
  // Taxonomy endpoints — full CRUD + merge for all 3 entity types
  // =================================================================

  const tagPaths = taxonomyPaths("tags", "Tags");
  const corrPaths = taxonomyPaths("correspondents", "Correspondents");
  const dtPaths = taxonomyPaths("document-types", "DocumentTypes", {
    createExtra: {
      description: { type: "string", nullable: true },
    },
  });

  for (const paths of [tagPaths, corrPaths, dtPaths]) {
    for (const [pathKey, methods] of Object.entries(paths)) {
      document.paths[pathKey] = methods;
    }
  }

  // =================================================================
  // Archive endpoints
  // =================================================================

  // GET /api/archive/export
  document.paths["/api/archive/export"] = {
    get: {
      operationId: "ArchiveController_exportArchive",
      summary: "Export full archive snapshot as JSON",
      tags: ["archive"],
      security: [{ bearer: [] }],
      parameters: [],
      responses: json200("Archive snapshot", docObj),
    },
  };

  // POST /api/archive/import
  document.paths["/api/archive/import"] = {
    post: {
      operationId: "ArchiveController_importArchive",
      summary: "Import archive snapshot (replace or merge)",
      tags: ["archive"],
      security: [{ bearer: [] }],
      parameters: [],
      requestBody: bodyJson({
        type: "object",
        required: ["snapshot"],
        properties: {
          mode: { type: "string", enum: ["replace", "merge"], default: "replace" },
          snapshot: { type: "object" },
        },
      }),
      responses: json201("Import result summary", docObj),
    },
  };

  // POST /api/archive/watch-folder/scan
  document.paths["/api/archive/watch-folder/scan"] = {
    post: {
      operationId: "ArchiveController_scanWatchFolder",
      summary: "Scan watch folder for new files and optionally import them",
      tags: ["archive"],
      security: [{ bearer: [] }],
      parameters: [],
      requestBody: bodyJson({
        type: "object",
        properties: {
          dryRun: { type: "boolean", default: false },
        },
      }),
      responses: json201("Watch folder scan result", docObj),
    },
  };

  // =================================================================
  // Health endpoints — overwrite to ensure response schemas
  // =================================================================

  document.paths["/api/health/providers"] = {
    get: {
      operationId: "HealthController_providers",
      summary: "List configured parse and embedding providers with availability",
      tags: ["health"],
      parameters: [],
      responses: json200("Provider availability response", docObj),
    },
  };

  document.paths["/api/health/ready"] = {
    get: {
      operationId: "HealthController_ready",
      summary: "Run readiness checks for database, object storage, and queue",
      tags: ["health"],
      parameters: [],
      responses: json200("Readiness status response", docObj),
    },
  };

  document.paths["/api/health/status"] = {
    get: {
      operationId: "HealthController_status_detail",
      summary: "Get queue depths, document counts, and recent processing jobs",
      tags: ["health"],
      parameters: [],
      responses: json200("Processing and queue activity response", docObj),
    },
  };

  // GET /api/health — main health endpoint
  ensureResponse("/api/health", "get", 200, "Health check with provider config", docObj);
  ensureResponse("/api/health/live", "get", 200, "Liveness probe");

  // GET /api/metrics — Prometheus, no JSON schema
  ensureResponse("/api/metrics", "get", 200, "Prometheus metrics (text/plain)");
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
