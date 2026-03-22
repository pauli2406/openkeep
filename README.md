# OpenKeep

OpenKeep is a self-hosted, AI-assisted document archive built as a TypeScript monorepo. The current implementation delivers the backend foundation first: a NestJS API, async processing worker, PostgreSQL plus pgvector, object storage integration, a provider-driven document parsing platform, deterministic archive extraction, chunk persistence, chunk-level embeddings, hybrid semantic search, and the monorepo layout for the future web, mobile, and desktop clients.

## Workspace Layout

- `apps/api`: NestJS REST API with auth, document upload, search, and archive metadata APIs.
- `apps/worker`: background processing worker for OCR and metadata extraction jobs.
- `apps/web`: reserved placeholder for the future web client.
- `apps/mobile`: reserved placeholder for the future React Native client.
- `apps/desktop`: reserved placeholder for the future Electron client.
- `packages/config`: shared environment parsing and provider configuration.
- `packages/db`: Drizzle schema and migrations.
- `packages/types`: shared Zod schemas and public API types.
- `packages/sdk`: future generated API client package.

## Backend Capabilities

- Single-user owner auth with JWT access/refresh tokens and long-lived API tokens.
- `POST /api/documents` multipart upload with content-hash deduplication for stored binaries.
- Async processing via `pg-boss`.
- Provider-driven parsing pipeline with one globally active parse provider and optional fallback provider.
- Local-first OCR pipeline with normalization for scanned PDFs, TIFF, HEIC/HEIF, and direct raster uploads.
- Cloud parse adapters for Google Cloud Document AI Enterprise OCR, Google Cloud Document AI Gemini layout parser, Amazon Textract, Azure AI Document Intelligence, and Mistral OCR.
- Deterministic metadata extraction with shared normalization for correspondents, invoice dates, due dates, amounts, currencies, reference numbers, document types, and tags.
- Persisted document chunks generated from normalized parse output.
- Embedding-provider registry with OpenAI, Gemini, Voyage, and Mistral adapters.
- Chunk-level embedding storage in PostgreSQL via pgvector-compatible `halfvec`.
- `POST /api/search/semantic` hybrid search combining structured filters, PostgreSQL full-text search, and vector similarity.
- Manual embedding reindex flows through `POST /api/embeddings/reindex` and `POST /api/documents/:id/reembed`.
- Explicit review workflow with `reviewStatus`, `reviewReasons`, structured review evidence, resolve/requeue endpoints, and latest processing-job summaries on documents.
- Retry-aware processing with bounded `pg-boss` backoff, structured JSON worker logs, and searchable-PDF artifact storage.
- PostgreSQL full-text search plus structured filters for year, dates, status, correspondent, document type, and tags.
- Virtual archive browsing via facet endpoints instead of a real nested folder tree.
- Ops endpoints for liveness, readiness, Prometheus-style metrics, and a dedicated searchable-PDF download route.

## Local Development

1. Copy `.env.example` to `.env` and replace the JWT secrets and owner password.
2. Install dependencies with `pnpm install`.
3. Apply database migrations with `pnpm db:migrate`.
4. Start infrastructure with `docker compose up postgres minio`.
5. Run the API with `pnpm --filter @openkeep/api dev`.
6. Run the worker with `pnpm --filter @openkeep/worker dev`.
7. Wait for `GET /api/health/ready` to report all checks green before using the stack.

For local-only parsing, keep `ACTIVE_PARSE_PROVIDER=local-ocr`. To switch to a cloud adapter, set `ACTIVE_PARSE_PROVIDER` to one of the supported provider ids and provide the matching credentials in `.env`. To enable semantic indexing, also set `ACTIVE_EMBEDDING_PROVIDER` and the matching embedding model/key values.

## Verification Commands

- `pnpm typecheck`
- `pnpm test:api:unit`
- `pnpm test:api:integration`
- `pnpm test:api:ocr`
- `pnpm test:e2e:google`
- `pnpm test:e2e:google:gemini`
- `pnpm test:e2e:aws`
- `pnpm test:e2e:azure`
- `pnpm test:e2e:mistral`
- `pnpm test:e2e:openai-embeddings`
- `pnpm test:e2e:gemini-embeddings`
- `pnpm test:e2e:voyage`
- `pnpm test:e2e:mistral-embeddings`
- `pnpm build`

`test:integration` requires a Docker-capable environment for Testcontainers. `test:ocr` requires a worker-capable environment with `ocrmypdf`, `tesseract`, German and English Tesseract language data, Poppler, and ImageMagick available, or an equivalent container image based on the worker runtime.
The provider-specific `test:e2e:*` commands perform live cloud parse or embedding calls and require matching credentials in `.env`. Start from `.env.google.example`, `.env.aws.example`, `.env.azure.example`, `.env.mistral.example`, `.env.openai.example`, or `.env.voyage.example` and copy the needed values into `.env`.

## Docker Compose

`docker-compose.yml` defines a single-host stack with:

- PostgreSQL
- pgvector extension enabled through migrations
- MinIO
- One-shot migration service
- OpenKeep API
- OpenKeep worker

The worker image includes OCR dependencies for `ocrmypdf`, `tesseract`, the required language data, Poppler, and ImageMagick so scanned PDFs and phone-native raster formats can be processed without extra host setup. The compose boot path is `postgres -> migrate -> api/worker`.

## Parse Provider IDs

- `local-ocr`
- `google-document-ai-enterprise-ocr`
- `google-document-ai-gemini-layout-parser`
- `amazon-textract`
- `azure-ai-document-intelligence`
- `mistral-ocr`

## Embedding Provider IDs

- `openai`
- `google-gemini`
- `voyage`
- `mistral`
