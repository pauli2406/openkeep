---
title: Configuration Reference
description: Key runtime configuration values, provider settings, and operational profiles.
---

# Configuration Reference

This document summarizes the most important runtime configuration knobs in OpenKeep.

The source of truth for config parsing is:

- `packages/config/src/index.ts`

The starter environment file is:

- `.env.example`

## Core App

- `NODE_ENV`: runtime mode
- `PORT`: API port
- `API_BASE_URL`: base URL used by web and client integrations
- `LOG_LEVEL`: application logger level

## Docs Site and Typesense DocSearch

- `DOCS_SITE_URL`: canonical docs URL used when building the Docusaurus site
- `TYPESENSE_COLLECTION_NAME`: collection alias used by the docs UI and scraper
- `TYPESENSE_ADMIN_API_KEY`: admin key used by the self-hosted Typesense node and scraper
- `TYPESENSE_PUBLIC_HOST`: browser-reachable Typesense hostname for the docs UI
- `TYPESENSE_PUBLIC_PORT`: browser-reachable Typesense port for the docs UI
- `TYPESENSE_PUBLIC_PROTOCOL`: browser-reachable Typesense protocol for the docs UI
- `DOCSEARCH_START_URL`: scraper start URL, defaults to the compose-hosted docs service
- `DOCSEARCH_SITEMAP_URL`: scraper sitemap URL, defaults to the compose-hosted docs sitemap
- `DOCSEARCH_STOP_URL`: optional URL pattern to exclude from scraping

Operational notes:

- the docs container uses a search-only key generated at runtime by `typesense-bootstrap`; that key is not stored in `.env`
- `TYPESENSE_PUBLIC_*` values must point to an address the browser can reach, not the internal Docker service name

## Database and Queue

- `DATABASE_URL`: PostgreSQL connection string
- `PG_BOSS_SCHEMA`: pg-boss schema name

Operational note:

- API, worker, and migrations all depend on a correct `DATABASE_URL`

## Object Storage

- `MINIO_ENDPOINT`
- `MINIO_PORT`
- `MINIO_USE_SSL`
- `MINIO_ACCESS_KEY`
- `MINIO_SECRET_KEY`
- `MINIO_BUCKET`

These settings control access to the S3-compatible object store used for binaries and derived artifacts.

## Authentication

- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `ACCESS_TOKEN_TTL`
- `REFRESH_TOKEN_TTL`
- `OWNER_EMAIL`
- `OWNER_PASSWORD`
- `OWNER_NAME`

Operational note:

- both JWT secrets must be long, unique, and environment-specific
- `OWNER_*` values matter most for initial bootstrap and seed behavior

## Bootstrap and External Init

- `SKIP_EXTERNAL_INIT`

When enabled, startup initialization that touches external systems is skipped. This is mainly useful for tests and special development scenarios, not for normal production operation.

## Processing Mode

- `PROVIDER_MODE`

Current value is still exposed in configuration and UI, but the more important practical control points today are parse-provider and embedding-provider selection.

## Parse Provider Selection

- `ACTIVE_PARSE_PROVIDER`
- `FALLBACK_PARSE_PROVIDER`

Supported parse provider ids:

- `local-ocr`
- `google-document-ai-enterprise-ocr`
- `google-document-ai-gemini-layout-parser`
- `amazon-textract`
- `azure-ai-document-intelligence`
- `mistral-ocr`

Fallback provider behavior:

- only used on hard parse failures
- not intended as dynamic quality arbitration between providers

## OCR and Parse Limits

- `OCR_LANGUAGES`
- `PARSE_PROVIDER_TIMEOUT_SECONDS`
- `PARSE_PROVIDER_MAX_PAGES`
- `PARSE_PROVIDER_MAX_BYTES`

These determine practical upper bounds and timeout behavior for document parsing.

## Review and Retry Thresholds

- `REVIEW_CONFIDENCE_THRESHOLD`
- `OCR_EMPTY_TEXT_THRESHOLD`
- `PROCESSING_RETRY_LIMIT`
- `PROCESSING_RETRY_DELAY_SECONDS`
- `PROCESSING_STALE_MINUTES` (default `30`)
- `ANSWER_MIN_CHUNK_SCORE` (default `0.4`)

These values affect:

- review routing sensitivity
- empty-text handling
- retry count for processing jobs
- retry backoff timing
- stale-processing recovery: documents stuck in `processing` longer than
  `PROCESSING_STALE_MINUTES` without an active queue job are marked `failed`
  (`lastProcessingError = "stale_processing_reaped"`) by a periodic worker reaper and can
  then be reprocessed
- RAG answer relevance: chunks below `ANSWER_MIN_CHUNK_SCORE` are not fed to the LLM;
  a near miss (within 0.1 below the threshold) answers low-confidence from the top 3
  chunks, anything worse returns an honest, localized "insufficient evidence" refusal.
  Cosine-score distributions differ per embedding provider, so tune this per provider.

## API Limits

- `MAX_UPLOAD_BYTES`
- `SEARCH_DEFAULT_PAGE_SIZE`
- `SEARCH_MAX_PAGE_SIZE`

These control upload size and search pagination limits.

## Embedding and LLM Providers

- `ACTIVE_CHAT_PROVIDER`
- `ACTIVE_EMBEDDING_PROVIDER`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_EMBEDDING_MODEL`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `GEMINI_EMBEDDING_MODEL`
- `VOYAGE_API_KEY`
- `VOYAGE_API_BASE_URL`
- `VOYAGE_EMBEDDING_MODEL`
- `MISTRAL_API_KEY`
- `MISTRAL_MODEL`
- `MISTRAL_EMBEDDING_MODEL`
- `MISTRAL_API_BASE_URL` (default `https://api.mistral.ai`): base URL for all Mistral
  surfaces — chat, embeddings, files, OCR
- `MISTRAL_OCR_BASE_URL` (deprecated): OCR-only override; falls back to
  `MISTRAL_API_BASE_URL` when unset. Chat and embeddings no longer read this variable.
- `MISTRAL_OCR_MODEL`
- `MISTRAL_OCR_INCLUDE_BLOCKS` (default `true`): paragraph blocks with real bounding boxes
- `MISTRAL_OCR_TABLE_FORMAT` (`markdown` | `none`, default `markdown`)
- `MISTRAL_OCR_CONFIDENCE_GRANULARITY` (`page` | `word` | `none`, default `page`); pages
  below the confidence threshold flag the document for review (`ocr_low_confidence`)
- `MISTRAL_OCR_EXTRACT_HEADER_FOOTER` (default `true`): headers/footers become blocks
  tagged `metadata.region` so boilerplate can be deprioritized
- `MISTRAL_OCR_UPLOAD_STRATEGY` (`auto` | `inline` | `files`, default `auto`): inline
  base64 below ~8MB, Files API (upload + signed URL, deleted in a finally) above —
  base64 inflates payloads ~33% and large inline bodies risk request-size rejections
- `MISTRAL_OCR_DOCUMENT_ANNOTATIONS` (default `false`): request a structured document
  annotation inside the OCR call and feed it to the extraction pipeline as a hint —
  skips the routing, title/summary, and (when complete) typed-extraction LLM calls.
  See [Agentic Document Intelligence](../technical/agentic-document-intelligence.md).

Timeouts and resilience:

- `LLM_TIMEOUT_SECONDS` (default `45`): hard timeout for non-streaming LLM completions;
  429/5xx responses are retried once before giving up
- `LLM_STREAM_TIMEOUT_SECONDS` (default `120`): hard timeout for streaming completions,
  applied once across the whole provider fallback chain (not per provider)
- streaming answers fail over to the next configured provider when a provider fails
  before its first token; after the first token the error is surfaced instead (no silent
  mid-answer restarts)
- closing the client (SSE disconnect) aborts the upstream LLM request; SSE responses
  send comment-frame heartbeats every 15s so idle proxies keep the connection open

Operational notes:

- chat uses the configured `ACTIVE_CHAT_PROVIDER` first when set; the remaining
  configured providers stay available as failover candidates (order:
  `openai` -> `gemini` -> `mistral`). The agentic extraction pipeline and
  correspondent resolution derive from the same order instead of hardcoding their own.
- semantic indexing is effectively off until `ACTIVE_EMBEDDING_PROVIDER` and the matching provider config are set
- agentic document intelligence becomes available when at least one supported LLM provider is configured

## Cloud Parse Providers

### Google Cloud Document AI

- `GOOGLE_CLOUD_PROJECT_ID`
- `GOOGLE_CLOUD_LOCATION`
- `GOOGLE_CLOUD_ACCESS_TOKEN`
- `GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON`
- `GOOGLE_DOCUMENT_AI_ENTERPRISE_PROCESSOR_ID`
- `GOOGLE_DOCUMENT_AI_GEMINI_PROCESSOR_ID`

### Amazon Textract

- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_SESSION_TOKEN`

### Azure AI Document Intelligence

- `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`
- `AZURE_DOCUMENT_INTELLIGENCE_API_KEY`

## Watch Folder

- `WATCH_FOLDER_PATH`

This must be configured for watch-folder scan operations to work.

If it is missing, `/api/archive/watch-folder/scan` will fail with a configuration error.

## Practical Configuration Profiles

### Minimal Local OCR Setup

Use:

- `ACTIVE_PARSE_PROVIDER=local-ocr`
- no embedding provider
- no cloud AI provider

This is the simplest archive mode.

### Search-Enabled Setup

Use:

- one parse provider
- one embedding provider

This enables semantic search and chunk embedding.

### Full Intelligence Setup

Use:

- one parse provider
- one embedding provider
- one or more LLM providers

This enables semantic search plus the full agentic extraction and AI assistance surface.

## Related Documents

- [Deployment Guide](./deployment-guide.md)
- [Runbooks](./runbooks.md)
- [Agentic Document Intelligence](../technical/agentic-document-intelligence.md)

## Deadlines and Email Digest

- `ARCHIVE_TIMEZONE`: IANA zone date-only deadlines are interpreted in; unset means the server's own zone
- `DEADLINE_UPCOMING_DAYS`: how many days ahead the "upcoming" window arms (default 7)
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM`: the email channel; without host and from-address the digest reports itself unconfigured instead of erroring
- `EMAIL_DIGEST_CRON`: daily digest schedule (default `0 7 * * *`), evaluated in `ARCHIVE_TIMEZONE`
- `PUBLIC_URL`: absolute web-app base URL used for links in outbound email

## Email Ingestion (IMAP)

- `IMAP_HOST` / `IMAP_PORT` / `IMAP_SECURE` / `IMAP_USER` / `IMAP_PASSWORD`: the archive mailbox; without host+user+password the channel is off
- `IMAP_FOLDER`: mailbox folder to poll (default `INBOX`)
- `EMAIL_INGEST_CRON`: poll schedule (default `*/5 * * * *`)
- `EMAIL_INGEST_ALLOWED_SENDERS`: comma-separated addresses or whole domains allowed to feed the archive; empty accepts everyone, reasonable only while the address is private
- `EMAIL_INGEST_LOG_LIMIT`: rejected/skipped ledger rows kept before pruning (default 500); imported rows are never pruned — they are the idempotency ledger

Operational notes:

- use a dedicated mailbox: the poller flags handled messages as read, so a
  human reading the same mailbox hides messages from it
- `MAX_UPLOAD_BYTES` bounds attachment size for email ingestion too
