---
title: Architecture Overview
description: High-level system architecture, runtime components, and processing model.
---

# Architecture Overview

This document explains the current high-level architecture of OpenKeep.

## Purpose

OpenKeep is a self-hosted document archive that combines:

- file ingestion
- OCR and document parsing
- metadata extraction
- semantic indexing
- archive browsing and review workflows
- AI-assisted summaries and grounded answers

## Monorepo Layout

- `apps/api`: NestJS API and most backend orchestration
- `apps/worker`: background worker runtime for queued processing
- `apps/web`: TanStack Router web application
- `packages/config`: shared config parsing and provider configuration
- `packages/db`: schema, migrations, and database package
- `packages/types`: shared public types and schemas
- `packages/sdk`: generated API client used by the web app

## Runtime Components

### API

The API handles:

- authentication
- document upload and metadata CRUD
- review queue and document history
- semantic search and answer endpoints
- dashboard and explorer endpoints
- taxonomy management
- archive export/import and watch-folder scan triggers
- health and metrics endpoints

In production-style builds, the API also serves the built web SPA assets.

### Worker

The worker consumes queued jobs from `pg-boss` and performs:

- OCR or cloud parsing
- metadata extraction
- chunk generation
- embedding generation
- searchable PDF generation when supported

### PostgreSQL

PostgreSQL stores:

- users and auth-related state
- documents and metadata
- text blocks and pages
- chunks and chunk embeddings
- taxonomies
- audit events
- processing jobs

### Object Storage

MinIO or another S3-compatible backend stores:

- original uploaded files
- derived searchable PDFs

## Main Processing Shape

At a high level, the archive flow is:

1. upload document
2. store file and create document record
3. enqueue processing job
4. parse or OCR the document
5. extract metadata
6. persist text blocks and chunks
7. enqueue embeddings when configured
8. make the document searchable and reviewable

## Current Intelligence Model

Metadata extraction now has two modes:

- deterministic fallback mode
- agentic mode using LangGraph when an LLM provider is configured

The active entry point is `HybridMetadataExtractor`, which routes to the agentic pipeline when at least one supported LLM provider is configured.

## Supported Provider Categories

### Parse Providers

- `local-ocr`
- `google-document-ai-enterprise-ocr`
- `google-document-ai-gemini-layout-parser`
- `amazon-textract`
- `azure-ai-document-intelligence`
- `mistral-ocr`

### Embedding Providers

- `openai`
- `google-gemini`
- `voyage`
- `mistral`

### Chat / LLM Providers

- `openai`
- `gemini`
- `mistral`

## Review Model

OpenKeep separates processing from review.

- processing status tracks pipeline execution
- review status tracks whether a human should inspect the result

This allows a document to be technically ready while still being flagged for manual validation.

## Web Application Model

The web app is built around a small set of user surfaces:

- dashboard
- archive explorer
- correspondent dossier
- search with AI answers
- review queue
- upload page
- document detail page
- settings and system administration

## Related Documents

- [API and Data Flows](./api-and-data-flows.md)
- [Agentic Document Intelligence](./agentic-document-intelligence.md)
- [Web Application](./web-application.md)
- [Deployment Guide](../operations/deployment-guide.md)
- [Backend Notes](../backend.md)
