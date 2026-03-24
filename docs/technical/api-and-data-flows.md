---
title: API and Data Flows
description: Backend surface area, major endpoints, and ingestion, search, and archive flows.
---

# API and Data Flows

This document summarizes the current backend surface and the most important runtime flows.

## Authentication Flow

Relevant endpoints:

- `POST /api/auth/setup`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/auth/me`
- `GET /api/auth/tokens`
- `POST /api/auth/tokens`
- `DELETE /api/auth/tokens/:id`

The web app stores access and refresh tokens client-side and refreshes access tokens automatically when needed.

## Document Ingestion Flow

Relevant endpoints:

- `POST /api/documents`
- `POST /api/documents/:id/reprocess`
- `POST /api/documents/reprocess/bulk`
- `POST /api/documents/:id/reembed`
- `POST /api/embeddings/reindex`

Flow:

1. client uploads file to `POST /api/documents`
2. API stores the binary and creates the document row
3. API inserts a `processing_jobs` row and enqueues a processing job
4. worker parses the document and extracts metadata
5. worker writes pages, OCR blocks, chunks, taxonomies, and metadata back to the database
6. worker queues embeddings when semantic indexing is configured
7. document becomes available for explorer, search, review, and detail views

## Document Read and Update Surface

Relevant endpoints:

- `GET /api/documents`
- `GET /api/documents/facets`
- `GET /api/documents/review`
- `GET /api/documents/:id`
- `GET /api/documents/:id/text`
- `GET /api/documents/:id/history`
- `PATCH /api/documents/:id`
- `DELETE /api/documents/:id`
- `POST /api/documents/:id/review/resolve`
- `POST /api/documents/:id/review/requeue`
- `GET /api/documents/:id/download`
- `GET /api/documents/:id/download/searchable`

Important behavior:

- user edits are persisted as manual overrides
- locked override fields survive reprocessing
- audit history is stored separately and exposed through the history endpoint

## Search Surface

Relevant endpoints:

- `GET /api/search/documents`
- `POST /api/search/semantic`
- `POST /api/search/answer`
- `POST /api/search/answer/stream`

Current model:

- semantic search returns document-centric results with matched chunks
- grounded answer endpoints build on retrieval results
- streaming answers are delivered via server-sent events

## Explorer Surface

Relevant endpoints:

- `GET /api/dashboard/insights`
- `GET /api/correspondents/:slug/insights`
- `GET /api/documents/projection`
- `GET /api/documents/timeline`

These power the higher-level archive browsing UI:

- dashboard widgets
- correspondent dossier
- timeline view
- semantic galaxy view

## Document AI Surface

Relevant document-level endpoints:

- `POST /api/documents/:id/summarize/stream`
- `POST /api/documents/:id/ask/stream`
- `GET /api/documents/:id/qa-history`
- `POST /api/documents/:id/qa-history`

This supports document-local AI workflows separate from archive-wide search answers.

## Taxonomy Surface

Relevant endpoints:

- tags CRUD and merge under `/api/taxonomies/tags`
- correspondents CRUD and merge under `/api/taxonomies/correspondents`
- document types CRUD and merge under `/api/taxonomies/document-types`

These are used by both the backend processing pipeline and the settings UI.

## Archive Portability Surface

Relevant endpoints:

- `GET /api/archive/export`
- `POST /api/archive/import`
- `POST /api/archive/watch-folder/scan`

This is the current archive backup, restore, and external-ingestion control surface.

## Health and Observability Surface

Relevant endpoints:

- `GET /api/health`
- `GET /api/health/providers`
- `GET /api/health/live`
- `GET /api/health/ready`
- `GET /api/health/status`
- `GET /api/metrics`

These endpoints expose:

- active provider configuration
- readiness checks
- queue depth and recent processing jobs
- Prometheus-style metrics

## Important Persisted Data Shapes

At a conceptual level, the most important document-related persisted data includes:

- core document fields such as title, status, dates, amount, and taxonomy relations
- OCR text and page/block structures
- persisted chunks
- embeddings by chunk
- review status and review reasons
- processing job summaries
- audit events
- `metadata.parse`, `metadata.chunking`, `metadata.reviewEvidence`, and `metadata.manual`
- `metadata.intelligence.*` for the new agentic extraction output

## Related Documents

- [Architecture Overview](./architecture-overview.md)
- [Agentic Document Intelligence](./agentic-document-intelligence.md)
- [Backend Notes](../backend.md)
