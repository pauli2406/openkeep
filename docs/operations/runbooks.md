---
title: Runbooks
description: Common operational procedures for readiness, stuck jobs, watch-folder scans, and provider issues.
---

# Runbooks

This document collects common operational procedures.

## Check Service Readiness

Use when:

- the stack was just deployed
- users report the app is unavailable
- you changed infrastructure dependencies

Steps:

1. check `GET /api/health`
2. check `GET /api/health/ready`
3. inspect `GET /api/health/status`
4. verify PostgreSQL, MinIO, API, and worker processes are running

Healthy baseline:

- health reports `ok`
- readiness checks for database, object storage, and queue all pass

## Investigate Stuck Document Processing

Use when:

- documents remain in `pending` or `processing`
- review volume is not moving
- embeddings never appear

Check:

1. `GET /api/health/status`
2. queue depths
3. recent processing jobs
4. worker logs
5. document `lastProcessingError` in the UI or API

Likely causes:

- worker not running
- queue schema not ready
- object storage unavailable
- provider timeout or credential failure
- OCR dependency problems in non-container environments

## Reprocess a Single Document

Use when:

- OCR output is wrong
- metadata extraction is poor
- provider configuration changed

Procedure:

1. open the document in the UI and use `Reprocess Document`
2. or call `POST /api/documents/:id/reprocess`
3. monitor queue and recent jobs through `GET /api/health/status`

Operational note:

- manual overrides remain locked unless cleared deliberately

## Reprocess Many Documents

Use when:

- you changed parse provider behavior
- you want to refresh a segment of the archive

Procedure:

1. select documents in explorer list view and use `Reprocess selected`
2. or use `POST /api/documents/reprocess/bulk`
3. monitor queue depth and recent jobs

## Rebuild Embeddings

Use when:

- embedding provider settings changed
- semantic search quality is inconsistent after a configuration change

Procedure:

1. confirm embedding provider configuration is valid
2. trigger `POST /api/embeddings/reindex` for the desired scope
3. monitor queue depth and recent embedding jobs

## Run a Watch-Folder Scan

Use when:

- external files were deposited into the watch folder
- you want to test the watch-folder path with a dry run

Procedure:

1. confirm `WATCH_FOLDER_PATH` is configured
2. trigger `POST /api/archive/watch-folder/scan`
3. start with `dryRun: true` when validating a new setup
4. inspect imported, duplicate, unsupported, and failed counts in the response or settings UI

## Investigate Watch-Folder Failures

Common causes:

- `WATCH_FOLDER_PATH` not configured
- unsupported MIME type
- duplicate checksum
- upload failure while importing the file

Look for:

- item-level reasons in the watch-folder scan result
- audit event `archive.watch_folder_scanned`

## Investigate Search Problems

Use when:

- semantic search returns weak or empty results
- archive-wide AI answers are poor or unavailable

Check:

1. embedding provider configuration
2. document chunk counts
3. embedding status on recently ingested documents
4. LLM provider configuration for answer generation
5. whether the archive actually contains enough evidence

## Investigate Provider Misconfiguration

Use when:

- settings page shows providers as unavailable
- cloud parse requests fail immediately
- AI answers or summaries disappear

Procedure:

1. verify environment variables for the provider
2. check `GET /api/health/providers`
3. confirm the active provider id matches the configured credentials
4. review API and worker logs for auth or timeout failures

## Respond to Final Processing Failures

The worker emits structured log events such as:

- `document.processing_retry_scheduled`
- `document.processing_failed_final`
- `document.embedding_enqueue_failed`

When a final failure occurs:

1. inspect the document record and latest job error
2. identify whether the problem is file-specific, provider-specific, or infrastructure-specific
3. fix the root cause
4. reprocess the document if appropriate

## Related Documents

- [Monitoring and Health](./monitoring-and-health.md)
- [Backup, Restore, and Portability](./backup-restore-and-portability.md)
- [Manual Smoke Checklist](../phase-3-smoke.md)
