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
- `apps/web`: browser UI for archive management, review, search, upload, and settings.
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

### Phase 2: Provider Platform and Chunking

Status: complete

- Add a normalized parsed-document model shared across parse providers.
- Add a provider registry with one globally active parse provider plus optional fallback provider.
- Implement parse adapters for local OCR, Google Cloud Document AI Enterprise OCR, Google Cloud Document AI Gemini layout parser, Amazon Textract, Azure AI Document Intelligence, and Mistral OCR.
- Keep one shared OpenKeep metadata extractor on top of normalized parse output.
- Persist document chunks as part of successful processing.
- Extend health, metrics, and audit data with provider-aware metadata.

### Phase 2.5: AI Search and Retrieval

Status: implemented for semantic retrieval, answer generation still pending

- Add pgvector-backed embeddings storage for chunk-level semantic document search.
- Add real embedding providers for OpenAI, Gemini, Voyage, and Mistral behind a registry.
- Support retrieval-first prompts such as “show all invoices from 2025” through hybrid search.
- Keep classic filters and exact search as a first-class path, not a fallback.
- Add manual re-embedding flows and stale-embedding detection tied to active provider/model configuration.

### Phase 3: Web App

Status: complete

- React 19 + Vite SPA with Tailwind CSS v4 and shadcn/ui components.
- TanStack Router for file-based routing with type-safe search params.
- TanStack Query for server state with automatic caching and refetching.
- openapi-fetch typed API client generated from the OpenAPI spec via @openkeep/sdk, including review, reprocess, and health/provider JSON endpoints.
- Login and initial owner setup flows with JWT access/refresh token management and auto-refresh middleware.
- Responsive app shell with collapsible sidebar navigation.
- Dashboard with stat cards, recent documents, and quick actions.
- Document list with facet-driven filters (year, correspondent, type, status, tags), keyword search, sort controls, and pagination.
- Document detail view with MIME-aware preview flows, OCR text viewer, metadata display, inline metadata editing, review actions, and raw details tab.
- Review queue with review reason badges, confidence scores, review evidence display, and resolve/requeue actions.
- Search page with keyword and semantic search modes, matched chunk previews, and relevance score breakdown.
- Upload page with drag-and-drop zone, multi-file queuing, per-file title override, and upload progress tracking.
- Settings page with user profile, API token management (create/revoke/copy), and richer system health/admin visibility.
- Provider-aware reprocessing with per-job OCR provider selection.
- Bundle splitting in the Vite build to reduce the initial payload.
- Vitest + Testing Library + MSW smoke coverage for auth recovery, dashboard, upload, document detail, review queue, and settings.
- Static file serving via @fastify/static from the API server in production (single container deployment).
- Dockerfile updated to build both web and API in a single image.

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
- Provider platform with a normalized parse model and a registry-based active/fallback parse selection flow.
- Cloud parse adapters for Google Cloud Document AI Enterprise OCR, Google Cloud Document AI Gemini layout parser, Amazon Textract, Azure AI Document Intelligence, and Mistral OCR.
- Explicit review state on documents plus resolve/requeue API endpoints.
- Structured review evidence in document metadata for missing required invoice fields and threshold context.
- Persisted document chunks and provider-aware parse metadata on processed documents.
- pgvector-backed chunk embedding storage and embedding summary fields on documents.
- Hybrid semantic search endpoint combining filters, keyword ranking, and vector similarity.
- Manual reindex endpoints for all or stale document embeddings.
- Live embedding E2E commands and templates for OpenAI, Gemini, Voyage, and Mistral.
- Searchable-PDF download endpoint separate from original-binary download.
- Readiness and metrics endpoints, including provider metadata, parse metrics, and pending-review gauges by reason.
- Provider-aware embedding metrics, semantic query metrics, and embedding queue depth.
- Migration-first Docker Compose startup path.
- OpenAPI generation output in `openapi.json`.
- SDK package with openapi-typescript generated types and openapi-fetch client factory.
- Web app: React 19 + Vite SPA with Tailwind CSS v4, shadcn/ui, TanStack Router, TanStack Query.
- Web app pages: login, setup, dashboard, document list with filters/facets, document detail with MIME-aware preview/OCR/editing, review queue, keyword and semantic search, drag-and-drop upload, settings with API tokens plus health/admin visibility.
- Provider-aware reprocessing UI in the web app.
- Web app smoke tests covering auth, dashboard, upload, document detail, review, and settings flows.
- Bundle-split web build.
- Static file serving from the API server via @fastify/static for single-container deployment.
- Dockerfile builds both web and API into a single image.
- Recent live-app stabilization fixes for settings readiness rendering, raw object rendering on dashboard/review screens, OCR provider override handling, review query parsing, and clearer upload/requeue/reprocess errors.
- OpenAPI parity for the remaining Phase 3 web-used JSON endpoints, with generated SDK output committed.
- Manual smoke checklist in `docs/phase-3-smoke.md`.
- Completed live Docker-stack smoke pass on 2026-03-22 covering login, health/admin endpoints, review data, upload, and provider-selected reprocess.

### Not implemented yet

- Answer generation.
- Azure live-provider validation is still pending because the root `.env` does not yet include Azure credentials.
- Mobile or desktop client code beyond placeholders.

## Next Steps

### Immediate next steps

1. Keep `apps/web` smoke tests and `docs/phase-3-smoke.md` as the required regression gate for Phase 3 surfaces.
2. Keep the Docker/OCR and provider E2E commands as part of the standard backend verification workflow.
3. Return to backend and retrieval work for:
   answer generation,
   richer non-invoice extraction,
   deeper operational dashboards,
   Azure provider validation.

### After web app stabilization

1. Add answer generation and retrieval UX on top of the existing semantic retrieval layer.
2. Build chat-style document Q&A in the web app.
3. Add operator dashboards with richer processing metrics.

### Mobile and desktop sequencing

- Start mobile once the upload API and auth flows are stable enough for a scan-first app.
- Start desktop after the web app if watch-folder import and bulk ingestion become important.

## Delivery Strategy

### Recommended implementation order from here

1. Answer generation and retrieval UX on top of the existing semantic retrieval layer.
2. Backend polish discovered by real web app usage and smoke runs.
3. Mobile capture app.
4. Desktop utility app.

### Why this order

- The web app now has automated smoke coverage, typed-client parity for the Phase 3 JSON flows, and a repeatable live smoke checklist, so the archive fundamentals are in place.
- Answer generation should build on that stable archive and usable client rather than compete with unfinished platform work.
- Mobile and desktop become easier once auth, uploads, and metadata correction are stable and validated through real web app use.

## Current Recommendation

Phase 3 is feature-complete, but it should not be considered done until web tests, OpenAPI parity, and repeatable smoke verification are in place. The next priority is finishing that stabilization work, then moving to answer generation.

What is already strong enough:

- document ingestion and asynchronous processing
- parse-provider platform with local and cloud adapters
- archive metadata and review workflow
- keyword and semantic search
- chunk persistence and embeddings
- operational health/metrics and reproducible backend verification
- complete browser UI covering login, archive browsing, review, search, upload, and settings
- provider-aware reprocessing and richer system health/admin visibility
- single-container production serving and bundle-split web delivery

What remains is real, but not blocking for day-to-day archive use:

- web app tests
- OpenAPI parity for the remaining review and health endpoints used by the web app
- repeatable Phase 3 smoke verification after frontend/backend changes
- answer generation
- broader extraction heuristics beyond invoice-heavy logic
- deeper operator dashboards
- Azure live-provider validation once credentials are added

So the next important step is closing the remaining Phase 3 stabilization gaps, then moving to answer generation and retrieval UX.

## Decisions Already Locked In

- Single-user household deployment first.
- REST plus OpenAPI first.
- PostgreSQL plus S3-compatible object storage.
- Docker Compose on one home server first.
- Virtual archive browsing instead of real nested folders.
- Local OCR first, then a provider platform with optional cloud parsing.
- Semantic search after archive stability, not part of the first archive milestone.
- One active embedding provider globally in v1, with chunk-level embeddings as the semantic index.
