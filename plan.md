# OpenKeep Plan

## Vision

OpenKeep is a self-hosted, AI-driven document archive for a household or home office. The product should make paper mail behave like searchable digital knowledge:

- Scan letters and invoices with a phone.
- Upload them to a home server through a stable API.
- Run OCR and metadata extraction automatically.
- Classify documents by correspondent, document type, year, and tags.
- Extract structured fields such as invoice amounts, due dates, and reference numbers.
- Offer classic archive browsing and later semantic search plus LLM-assisted retrieval.

The long-term product should feel like a modern, privacy-aware, API-first version of Paperless with better AI workflows, cleaner clients, and a stronger platform foundation.

## Product Goals

### Primary goals

- Make document ingestion frictionless.
- Keep the archive logically organized without manual filing.
- Make every document easy to find through filters, keywords, and later AI search.
- Expose the system through a clean backend API so multiple clients can share the same core.
- Stay self-hostable on a single home server.

### Success criteria

- A user can upload a scanned PDF or image and receive a processed archive record automatically.
- OCR text is searchable and line-addressable.
- Metadata is useful enough that most invoices and common letters need little or no manual cleanup.
- The backend remains the system of record, with web/mobile/desktop as clients on top.

## Monorepo Picture

### Applications

- `apps/api`: REST API, auth, document endpoints, search, archive facets.
- `apps/worker`: OCR and extraction worker consuming async jobs.
- `apps/web`: future browser UI for archive management and search.
- `apps/mobile`: future React Native app for scan/upload and archive access.
- `apps/desktop`: future Electron app for power-user workflows and local batch import.

### Shared packages

- `packages/config`: env parsing and runtime settings.
- `packages/db`: Drizzle schema and migrations.
- `packages/types`: shared Zod schemas and API types.
- `packages/sdk`: generated or hand-authored API client layer for future apps.

## System Architecture

### Core stack

- TypeScript monorepo with `pnpm` and `turbo`.
- NestJS on Fastify for the API.
- PostgreSQL for metadata, search filters, OCR text, and jobs metadata.
- MinIO or another S3-compatible store for document binaries.
- `pg-boss` for background processing without Redis.
- Local OCR by default with hooks for optional cloud-assisted enrichment.

### Processing model

1. A client uploads a PDF or image.
2. The API stores the binary once by checksum and creates a document record.
3. The API queues a processing job.
4. The worker downloads the file, runs OCR, extracts text and metadata, and updates the archive record.
5. Search and browse APIs expose the processed document.

### Archive model

- Keep storage virtual, not filesystem-driven.
- Documents are grouped by metadata views such as year, correspondent, document type, and tags.
- Each document stores both full text and line-level OCR blocks.
- Reprocessing must be idempotent so the same document can be re-run safely.

## Roadmap

### Phase 0: Foundation

Status: done

- Monorepo structure for backend, web, mobile, and desktop.
- Shared config, types, DB schema, and SDK package.
- Docker Compose baseline for API, worker, PostgreSQL, and MinIO.
- Initial OpenAPI generation flow.

### Phase 1: Backend Archive Core

Status: implemented foundation, needs hardening

- Owner auth with JWT access/refresh tokens and long-lived API tokens.
- Upload API with binary deduplication by checksum.
- Core document schema, correspondents, document types, tags, OCR blocks, jobs, and audit events.
- Background processing worker.
- Local OCR provider abstraction.
- Deterministic metadata extraction for invoices and generic letters.
- PostgreSQL full-text search and structured filter API.
- Archive facets for browse-style navigation.

### Phase 1.5: Backend Hardening

Status: complete

- Add real database-backed integration tests with PostgreSQL and MinIO.
- Improve OCR coverage for scanned PDFs and multipage rasterized files.
- Add better normalization and validation around dates, currencies, and confidence scoring.
- Implement document review flows for low-confidence extraction and failed jobs.
- Add reprocessing policies, job retries, and operational metrics/logging.
- Add migration/app startup commands for smoother first-time deployment.
- Add dedicated searchable-PDF download support and structured review evidence on documents.
- Add explicit unit, integration, and OCR acceptance test entrypoints.
- Validate the backend in a real Docker/OCR-capable environment.

### Phase 2: AI Search and Retrieval

Status: planned

- Add chunk generation on top of line-level OCR text.
- Introduce embeddings storage and retrieval for semantic document search.
- Add provider adapters for OpenAI and Gemini and Anthropic and Mistral behind existing interfaces.
- Support prompts such as “show all invoices from 2025” with retrieval-first behavior.
- Keep classic filters and exact search as a first-class path, not a fallback.

### Phase 3: Web App

Status: planned

- Build a browser UI on top of the API.
- Include login, document list, detail view, OCR text view, search, filters, facets, and manual metadata correction.
- Add “needs review” screens for extraction failures or low-confidence results.
- Add document preview and download flows.

### Phase 4: Mobile App

Status: planned

- Build a React Native app focused on capture and upload.
- Add camera capture, crop/cleanup, multi-page scan, and upload queue.
- Support processing status feedback after upload.
- Add lightweight search and document detail access for quick lookup on the phone.

### Phase 5: Desktop App

Status: planned

- Build an Electron app for power workflows.
- Add watch-folder import, drag-and-drop batch upload, and richer review tools.
- Reuse the same API and shared SDK as the web and mobile apps.

## Current Repo Status

### Implemented now

- Backend monorepo scaffold.
- API and worker runtime structure.
- Shared schema/types/config packages.
- Initial DB migration.
- Docker deployment baseline.
- Unit tests around OCR text fallback, deterministic metadata extraction, and normalization utilities.
- Dedicated API test scripts for unit, integration, and OCR acceptance execution.
- Testcontainers integration coverage for auth, upload, deduplication, search, review workflows, metrics, and searchable-PDF download.
- OCR acceptance tests for scanned PDFs, TIFF, and HEIC/HEIF normalization.
- Successful local execution of the Docker-backed integration suite and OCR acceptance suite.
- Explicit review state on documents plus resolve/requeue API endpoints.
- Structured review evidence in document metadata for missing required invoice fields and threshold context.
- Searchable-PDF download endpoint separate from original-binary download.
- Readiness and metrics endpoints, including pending-review gauges by reason.
- Migration-first Docker Compose startup path.
- OpenAPI generation output in `openapi.json`.

### Not implemented yet

- Real OpenAI or Gemini integration.
- Embeddings and semantic retrieval.
- Web, mobile, or desktop client code beyond placeholders.
- UI flows for review, corrections, and end-user archive management.

## Next Steps

### Immediate next steps

1. Start the Phase 3 web client on top of the hardened review and search APIs.
2. Add richer review evidence and missing-field detection for more document classes beyond invoice-like mail.
3. Add deeper operational metrics and queue dashboards once real deployment telemetry is available.
4. Add client-facing derived-file metadata only if the web app needs more than `searchablePdfAvailable`.
5. Keep the Docker/OCR test commands as part of the standard backend verification workflow.

### After backend hardening

1. Build the web app first.
2. Use the API and shared types to implement login, document list, detail pages, search, and review flows.
3. Only then add semantic retrieval and LLM query UX so the UI has a strong non-AI baseline.

### Mobile and desktop sequencing

- Start mobile once the upload API and auth flows are stable enough for a scan-first app.
- Start desktop after the web app if watch-folder import and bulk ingestion become important.

## Delivery Strategy

### Recommended implementation order from here

1. Web archive UI.
2. Semantic retrieval and provider integrations.
3. Mobile capture app.
4. Desktop utility app.

### Why this order

- The backend is already the critical path and shared dependency for every client.
- The web app will expose missing backend needs faster than a mobile-first build.
- Semantic search should land on a reliable archive, not replace missing archive fundamentals.
- Mobile and desktop become easier once auth, uploads, and metadata correction are stable.

## Decisions Already Locked In

- Single-user household deployment first.
- REST plus OpenAPI first.
- PostgreSQL plus S3-compatible object storage.
- Docker Compose on one home server first.
- Virtual archive browsing instead of real nested folders.
- Local OCR first with provider abstraction for later hybrid AI.
- Semantic search as a second major phase, not part of the first archive milestone.
