import "reflect-metadata";

import { writeFile } from "fs/promises";
import { resolve } from "path";
import {
  AnswerQueryResponseSchema,
  ApiTokenSchema,
  ArchiveImportRequestSchema,
  ArchiveImportResultSchema,
  ArchiveSnapshotSchema,
  AuthTokensSchema,
  CorrespondentSchema,
  CreateApiTokenResponseSchema,
  CurrentUserSchema,
  DeleteTaxonomyResponseSchema,
  DocumentHistoryResponseSchema,
  DocumentSchema,
  DocumentTextResponseSchema,
  DocumentTypeSchema,
  HealthProvidersResponseSchema,
  HealthResponseSchema,
  ProcessingStatusResponseSchema,
  ReadinessResponseSchema,
  RequeueDocumentProcessingResponseSchema,
  SearchDocumentsResponseSchema,
  SemanticSearchResponseSchema,
  SuccessResponseSchema,
  TagSchema,
  WatchFolderScanRequestSchema,
  WatchFolderScanResponseSchema,
} from "@openkeep/types";
import { zodToOpenAPI } from "nestjs-zod";
import { z } from "zod";

import { createApp } from "./bootstrap";

function ensureOperation(
  document: Record<string, any>,
  path: string,
  method: string,
): Record<string, any> | null {
  return document.paths?.[path]?.[method] ?? null;
}

function patchMultipartUpload(document: Record<string, any>) {
  const operation = ensureOperation(document, "/api/documents", "post");
  if (!operation) {
    return;
  }

  operation.requestBody = {
    required: true,
    content: {
      "multipart/form-data": {
        schema: {
          type: "object",
          properties: {
            file: {
              type: "string",
              format: "binary",
            },
            title: {
              type: "string",
            },
            source: {
              type: "string",
              enum: ["upload", "watch-folder", "email", "api"],
            },
          },
          required: ["file"],
        },
      },
    },
  };
}

function patchJsonRequest(
  document: Record<string, any>,
  path: string,
  method: string,
  schemaName: string,
  schema: z.ZodTypeAny,
  required = true,
) {
  const operation = ensureOperation(document, path, method);
  if (!operation) {
    return;
  }

  ensureComponentSchema(document, schemaName, schema);
  operation.requestBody = {
    required,
    content: {
      "application/json": {
        schema: schemaRef(schemaName),
      },
    },
  };
}

function ensureComponentSchema(
  document: Record<string, any>,
  name: string,
  schema: z.ZodTypeAny,
) {
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas[name] = zodToOpenAPI(schema);
}

function schemaRef(name: string) {
  return {
    $ref: `#/components/schemas/${name}`,
  };
}

function patchJsonResponse(
  document: Record<string, any>,
  path: string,
  method: string,
  status: number,
  description: string,
  schemaName: string,
  schema: z.ZodTypeAny,
) {
  const operation = ensureOperation(document, path, method);
  if (!operation) {
    return;
  }

  ensureComponentSchema(document, schemaName, schema);
  operation.responses ??= {};
  operation.responses[String(status)] = {
    description,
    content: {
      "application/json": {
        schema: schemaRef(schemaName),
      },
    },
  };
}

function patchCsvTagsQuery(document: Record<string, any>, path: string) {
  const operation = ensureOperation(document, path, "get");
  if (!operation?.parameters) {
    return;
  }

  operation.parameters = operation.parameters.map((parameter: Record<string, any>) => {
    if (parameter.in === "query" && parameter.name === "tags") {
      return {
        ...parameter,
        schema: {
          type: "string",
          description: "Comma-separated UUIDs",
        },
      };
    }

    return parameter;
  });
}

function patchBinaryDownload(document: Record<string, any>, path: string, description: string) {
  const operation = ensureOperation(document, path, "get");
  if (!operation) {
    return;
  }

  operation.responses ??= {};
  operation.responses["200"] = {
    description,
    content: {
      "application/octet-stream": {
        schema: {
          type: "string",
          format: "binary",
        },
      },
    },
  };
}

function patchMetrics(document: Record<string, any>) {
  const operation = ensureOperation(document, "/api/metrics", "get");
  if (!operation) {
    return;
  }

  operation.responses ??= {};
  operation.responses["200"] = {
    description: "Prometheus metrics",
    content: {
      "text/plain": {
        schema: {
          type: "string",
        },
      },
    },
  };
}

function patchGeneratedDocument(document: Record<string, any>) {
  patchJsonResponse(
    document,
    "/api/health",
    "get",
    200,
    "Overall service health response",
    "HealthResponse",
    HealthResponseSchema,
  );
  patchJsonResponse(
    document,
    "/api/health/providers",
    "get",
    200,
    "Provider availability response",
    "HealthProvidersResponse",
    HealthProvidersResponseSchema,
  );
  patchJsonResponse(
    document,
    "/api/health/live",
    "get",
    200,
    "Live health response",
    "HealthLiveResponse",
    z.object({
      status: z.literal("ok"),
      timestamp: z.string(),
    }),
  );
  patchJsonResponse(
    document,
    "/api/health/ready",
    "get",
    200,
    "Readiness status response",
    "ReadinessResponse",
    ReadinessResponseSchema,
  );
  patchJsonResponse(
    document,
    "/api/health/status",
    "get",
    200,
    "Processing and queue activity response",
    "ProcessingStatusResponse",
    ProcessingStatusResponseSchema,
  );

  patchJsonResponse(
    document,
    "/api/auth/setup",
    "post",
    201,
    "Owner account created",
    "AuthTokens",
    AuthTokensSchema,
  );
  patchJsonResponse(
    document,
    "/api/auth/login",
    "post",
    201,
    "Login response with tokens",
    "AuthTokens",
    AuthTokensSchema,
  );
  patchJsonResponse(
    document,
    "/api/auth/refresh",
    "post",
    201,
    "Refreshed tokens",
    "AuthTokens",
    AuthTokensSchema,
  );
  patchJsonResponse(
    document,
    "/api/auth/me",
    "get",
    200,
    "Current authenticated principal",
    "CurrentUser",
    CurrentUserSchema,
  );
  patchJsonResponse(
    document,
    "/api/auth/tokens",
    "get",
    200,
    "List of API tokens",
    "ApiTokenList",
    z.array(ApiTokenSchema),
  );
  patchJsonResponse(
    document,
    "/api/auth/tokens",
    "post",
    201,
    "Newly created API token",
    "CreateApiTokenResponse",
    CreateApiTokenResponseSchema,
  );
  patchJsonResponse(
    document,
    "/api/auth/tokens/{id}",
    "delete",
    200,
    "Token deleted",
    "SuccessResponse",
    SuccessResponseSchema,
  );

  patchMultipartUpload(document);
  patchJsonResponse(
    document,
    "/api/documents",
    "get",
    200,
    "List documents with structured and full-text filters",
    "SearchDocumentsResponse",
    SearchDocumentsResponseSchema,
  );
  patchCsvTagsQuery(document, "/api/documents");
  patchJsonResponse(
    document,
    "/api/documents/{id}",
    "get",
    200,
    "Single document",
    "Document",
    DocumentSchema,
  );
  patchJsonResponse(
    document,
    "/api/documents/{id}",
    "patch",
    200,
    "Updated document",
    "Document",
    DocumentSchema,
  );
  patchJsonResponse(
    document,
    "/api/documents/{id}/history",
    "get",
    200,
    "Document audit history",
    "DocumentHistoryResponse",
    DocumentHistoryResponseSchema,
  );
  patchJsonResponse(
    document,
    "/api/documents/{id}/text",
    "get",
    200,
    "Extracted text blocks",
    "DocumentTextResponse",
    DocumentTextResponseSchema,
  );
  patchJsonResponse(
    document,
    "/api/documents/{id}/review/resolve",
    "post",
    201,
    "Updated document after review resolution",
    "Document",
    DocumentSchema,
  );
  patchJsonResponse(
    document,
    "/api/documents/{id}/review/requeue",
    "post",
    201,
    "Queued processing job metadata",
    "RequeueDocumentProcessingResponse",
    RequeueDocumentProcessingResponseSchema,
  );
  patchJsonResponse(
    document,
    "/api/documents/{id}/reprocess",
    "post",
    201,
    "Queued processing job metadata",
    "RequeueDocumentProcessingResponse",
    RequeueDocumentProcessingResponseSchema,
  );
  patchCsvTagsQuery(document, "/api/search/documents");
  patchJsonResponse(
    document,
    "/api/search/documents",
    "get",
    200,
    "Paginated search results",
    "SearchDocumentsResponse",
    SearchDocumentsResponseSchema,
  );
  patchJsonResponse(
    document,
    "/api/search/semantic",
    "post",
    201,
    "Semantic search results",
    "SemanticSearchResponse",
    SemanticSearchResponseSchema,
  );
  patchJsonResponse(
    document,
    "/api/search/answer",
    "post",
    201,
    "Extractive answer with citations",
    "AnswerQueryResponse",
    AnswerQueryResponseSchema,
  );

  patchJsonResponse(document, "/api/taxonomies/tags", "get", 200, "List of tags", "TagList", z.array(TagSchema));
  patchJsonResponse(document, "/api/taxonomies/tags", "post", 201, "Created tag", "Tag", TagSchema);
  patchJsonResponse(document, "/api/taxonomies/tags/{id}", "patch", 200, "Updated tag", "Tag", TagSchema);
  patchJsonResponse(
    document,
    "/api/taxonomies/tags/{id}",
    "delete",
    200,
    "Deleted tag",
    "DeleteTaxonomyResponse",
    DeleteTaxonomyResponseSchema,
  );
  patchJsonResponse(
    document,
    "/api/taxonomies/tags/{id}/merge",
    "post",
    201,
    "Merged tag",
    "Tag",
    TagSchema,
  );
  patchJsonResponse(
    document,
    "/api/taxonomies/correspondents",
    "get",
    200,
    "List of correspondents",
    "CorrespondentList",
    z.array(CorrespondentSchema),
  );
  patchJsonResponse(
    document,
    "/api/taxonomies/correspondents",
    "post",
    201,
    "Created correspondent",
    "Correspondent",
    CorrespondentSchema,
  );
  patchJsonResponse(
    document,
    "/api/taxonomies/correspondents/{id}",
    "patch",
    200,
    "Updated correspondent",
    "Correspondent",
    CorrespondentSchema,
  );
  patchJsonResponse(
    document,
    "/api/taxonomies/correspondents/{id}",
    "delete",
    200,
    "Deleted correspondent",
    "DeleteTaxonomyResponse",
    DeleteTaxonomyResponseSchema,
  );
  patchJsonResponse(
    document,
    "/api/taxonomies/correspondents/{id}/merge",
    "post",
    201,
    "Merged correspondent",
    "Correspondent",
    CorrespondentSchema,
  );
  patchJsonResponse(
    document,
    "/api/taxonomies/document-types",
    "get",
    200,
    "List of document types",
    "DocumentTypeList",
    z.array(DocumentTypeSchema),
  );
  patchJsonResponse(
    document,
    "/api/taxonomies/document-types",
    "post",
    201,
    "Created document type",
    "DocumentType",
    DocumentTypeSchema,
  );
  patchJsonResponse(
    document,
    "/api/taxonomies/document-types/{id}",
    "patch",
    200,
    "Updated document type",
    "DocumentType",
    DocumentTypeSchema,
  );
  patchJsonResponse(
    document,
    "/api/taxonomies/document-types/{id}",
    "delete",
    200,
    "Deleted document type",
    "DeleteTaxonomyResponse",
    DeleteTaxonomyResponseSchema,
  );
  patchJsonResponse(
    document,
    "/api/taxonomies/document-types/{id}/merge",
    "post",
    201,
    "Merged document type",
    "DocumentType",
    DocumentTypeSchema,
  );

  patchJsonResponse(
    document,
    "/api/archive/export",
    "get",
    200,
    "Archive snapshot",
    "ArchiveSnapshot",
    ArchiveSnapshotSchema,
  );
  patchJsonRequest(
    document,
    "/api/archive/import",
    "post",
    "ArchiveImportRequest",
    ArchiveImportRequestSchema,
  );
  patchJsonResponse(
    document,
    "/api/archive/import",
    "post",
    201,
    "Import result summary",
    "ArchiveImportResult",
    ArchiveImportResultSchema,
  );
  patchJsonRequest(
    document,
    "/api/archive/watch-folder/scan",
    "post",
    "WatchFolderScanRequest",
    WatchFolderScanRequestSchema,
  );
  patchJsonResponse(
    document,
    "/api/archive/watch-folder/scan",
    "post",
    201,
    "Watch folder scan result",
    "WatchFolderScanResponse",
    WatchFolderScanResponseSchema,
  );

  patchBinaryDownload(document, "/api/documents/{id}/download", "Original file download");
  patchBinaryDownload(
    document,
    "/api/documents/{id}/download/searchable",
    "Searchable PDF download",
  );
  patchMetrics(document);
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
