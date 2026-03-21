# Backend Notes

## Runtime Components

- API: receives uploads, exposes auth/search/archive endpoints, and enqueues processing jobs.
- Worker: consumes `document.process` jobs from `pg-boss`, runs OCR, extracts metadata, and updates archive records.
- PostgreSQL: stores users, documents, OCR text blocks, processing jobs, tags, correspondents, document types, and audit events.
- MinIO: stores the original uploaded binary once per unique checksum plus derived searchable PDFs when OCR succeeds.

## Processing Flow

1. Upload a PDF or image to `POST /api/documents`.
2. The API stores the original binary in object storage and inserts a `documents` row.
3. A `processing_jobs` record is inserted and published to `pg-boss`.
4. The worker normalizes scanned PDFs, TIFF, HEIC/HEIF, and direct raster uploads into OCR-ready pages.
5. OCR runs with `ocrmypdf` first for PDFs and falls back to page rasterization plus `tesseract` when needed.
6. Metadata extraction applies shared normalization for dates, currencies, amounts, and confidence scoring.
7. The worker replaces prior OCR/page/tag records for idempotent reprocessing, stores a derived searchable PDF when available, and records review state separately from processing state.
8. The document becomes searchable through PostgreSQL full-text search and structured filters.

## Review and Operations

- Processing lifecycle status is limited to `pending`, `processing`, `ready`, and `failed`.
- Review state is persisted separately with `reviewStatus`, `reviewReasons`, `reviewedAt`, and `reviewNote`.
- Documents expose structured `metadata.reviewEvidence` so review callers can inspect missing invoice fields, OCR text length, thresholds, and active review reasons.
- `GET /api/documents/review` returns the review queue.
- `POST /api/documents/:id/review/resolve` marks manual review complete.
- `POST /api/documents/:id/review/requeue` clears review state and publishes a fresh processing job.
- `GET /api/documents/:id/download/searchable` returns the derived searchable PDF when one exists.
- `GET /api/health/live`, `GET /api/health/ready`, and `GET /api/metrics` expose process health and runtime metrics.
- Metrics include processing outcomes, retries, durations, queue depth, and pending-review gauges by reason.

## Verification Paths

- `pnpm --filter @openkeep/api test:unit` runs pure Node unit coverage.
- `pnpm --filter @openkeep/api test:integration` runs the Testcontainers-backed API suite against PostgreSQL and MinIO.
- `pnpm --filter @openkeep/api test:ocr` runs OCR acceptance coverage and should be executed in a worker-capable environment with the same OCR binaries and Tesseract language data as the production worker image.
- Expected operator bootstrap path:
  1. bring up infrastructure
  2. run migrations
  3. start API and worker
  4. wait for readiness to go green

## Phase 2 Hooks Already Present

- Provider interfaces for OCR, metadata extraction, embeddings, and answer generation.
- Queue payload shape that can carry future job metadata.
- Line-level OCR text storage for later chunking and semantic retrieval.
