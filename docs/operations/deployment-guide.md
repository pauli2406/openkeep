---
title: Deployment Guide
description: Current single-host deployment model, service layout, and startup expectations.
---

# Deployment Guide

This guide describes the current practical deployment model for OpenKeep.

## Current Deployment Shape

The repo currently provides a single-host Docker Compose deployment model built around:

- PostgreSQL with pgvector support
- MinIO for S3-compatible object storage
- self-hosted Typesense for documentation search
- one-shot migration job
- API service
- worker service
- docs site
- Typesense search-key bootstrap job

The current deployment does not use a separate web container. The API image builds the web app and serves the static SPA bundle.

The compose file is:

- `docker-compose.yml`

## Services in the Default Stack

### `postgres`

Responsibilities:

- primary relational database
- document metadata store
- pg-boss job metadata store
- chunk and embedding persistence

### `minio`

Responsibilities:

- object storage for original files
- object storage for generated searchable PDFs

### `migrate`

Responsibilities:

- run database migrations before application startup

### `typesense`

Responsibilities:

- store the documentation search index
- serve the search API consumed by the docs site

### `typesense-bootstrap`

Responsibilities:

- wait for the Typesense node to become reachable
- create a fresh search-only API key scoped to the docs collection
- write that key to a shared runtime volume for the docs container

### `api`

Responsibilities:

- serve the REST API under `/api`
- expose health and metrics endpoints
- serve application backend logic

### `worker`

Responsibilities:

- consume queue jobs
- run OCR and parsing
- run extraction and chunking
- run embedding jobs

### `docs`

Responsibilities:

- build the Docusaurus site with the current runtime search configuration
- serve the docs site on port `3001`

### `docs-search-indexer`

Responsibilities:

- scrape the rendered docs site with the Typesense DocSearch scraper
- upload the resulting records into the configured Typesense collection
- run on demand with `pnpm docs:search:index`
- clear the existing alias before each run so repeated reindex jobs do not fail on Typesense synonym transfer

## Startup Order

Current intended boot path:

1. `postgres`
2. `migrate`
3. `typesense`
4. `typesense-bootstrap`
5. `api`
6. `worker`
7. `docs`

`minio` must also be healthy before the API and worker start successfully in the compose stack.

## Host Requirements

Minimum practical host capabilities:

- Docker and Docker Compose
- enough CPU and RAM for OCR and document parsing workloads
- persistent storage for PostgreSQL and MinIO volumes

For local non-container development, the worker also needs OCR tools installed on the host.

## Recommended Deployment Procedure

1. copy `.env.example` to `.env`
2. replace default auth secrets and passwords
3. configure the provider settings you actually plan to use
4. start the stack with `docker compose up --build`
5. wait until readiness checks pass
6. open the web app and complete owner setup if this is a fresh system
7. run `pnpm docs:search:index` after the docs service is healthy to populate or refresh the docs index

## Ports in the Default Compose Stack

- `3000`: API and web-facing backend base URL
- `3001`: docs site
- `5432`: PostgreSQL
- `8108`: Typesense API
- `9000`: MinIO S3 endpoint
- `9001`: MinIO console

## Docker Images in the Repo

Current images are defined by:

- `apps/api/Dockerfile`
- `apps/docs/Dockerfile`
- `apps/worker/Dockerfile`

Notable details:

- the API image builds shared packages and the API bundle
- the worker image includes OCR dependencies such as `ocrmypdf`, `tesseract`, `poppler-utils`, `imagemagick`, and language data for German and English

## Readiness Expectations

The system should not be considered ready for user traffic until `GET /api/health/ready` reports healthy checks for:

- database
- object storage
- queue

## Production Cautions

Before using the default stack beyond throwaway local environments, change at least:

- PostgreSQL password
- MinIO access and secret keys
- JWT access secret
- JWT refresh secret
- owner password defaults

Also review:

- backup strategy
- Typesense persistence and API-key rotation strategy
- provider credentials management
- reverse proxy and TLS setup outside the scope of the current repo docs

## Related Documents

- [Configuration Reference](./configuration-reference.md)
- [Monitoring and Health](./monitoring-and-health.md)
- [Backup, Restore, and Portability](./backup-restore-and-portability.md)
- [Web Application](../technical/web-application.md)
