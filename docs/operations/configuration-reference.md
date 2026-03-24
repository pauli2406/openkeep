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

These values affect:

- review routing sensitivity
- empty-text handling
- retry count for processing jobs
- retry backoff timing

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
- `MISTRAL_OCR_BASE_URL`
- `MISTRAL_OCR_MODEL`

Operational notes:

- chat uses the configured `ACTIVE_CHAT_PROVIDER` when set; otherwise it falls back in this order: `openai` -> `gemini` -> `mistral`
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
