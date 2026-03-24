# Monitoring and Health

This document explains the current observability and health surface in OpenKeep.

## Health Endpoints

### `GET /api/health`

Use for:

- basic service status
- provider configuration visibility

This returns overall status plus provider configuration metadata.

### `GET /api/health/live`

Use for:

- liveness checks from orchestration platforms

### `GET /api/health/ready`

Use for:

- readiness checks before routing traffic
- troubleshooting dependency failures

Current readiness checks:

- database
- object storage
- queue

### `GET /api/health/status`

Use for:

- queue depth monitoring
- recent job inspection
- document state distribution
- pending review volume

This is currently one of the most useful operator endpoints.

### `GET /api/health/providers`

Use for:

- checking provider availability
- verifying which parse and embedding providers are active or configured

## Metrics Endpoint

### `GET /api/metrics`

This exposes Prometheus-style metrics.

It currently includes operationally important data such as:

- pending review counts
- pending review counts by reason
- stale embedding counts
- queue depths

## Structured Logging

The API bootstrap respects:

- `LOG_LEVEL`

The worker emits structured JSON log messages for important events, including:

- processing completion
- review-pending completion
- retry scheduling
- final failures
- embedding enqueue failures

Examples of important event names:

- `document.processing_completed`
- `document.processing_completed_review_pending`
- `document.processing_retry_scheduled`
- `document.processing_failed_final`
- `document.embedding_enqueue_failed`

## What to Monitor First

For a practical first monitoring pass, watch:

- readiness state
- processing queue depth
- embedding queue depth
- recent failed jobs
- pending review count
- stale embedding count

## Failure Signals Worth Alerting On

Useful alert candidates include:

- readiness degradation
- persistent queue growth
- repeated final processing failures
- repeated provider unavailability
- rising pending review counts after provider or parsing changes

## UI Surfaces for Operators

The Settings page currently mirrors several operational signals:

- provider availability
- system health
- queue depth and recent jobs
- watch-folder scan results

This is helpful for quick inspection, but API-level monitoring is still the better base for automation.

## Recommended Operator Routine

1. check readiness after deploys
2. confirm provider visibility after config changes
3. watch queue depth after bulk imports or reprocessing
4. inspect recent job failures when documents stop progressing
5. export a snapshot before major archive operations

## Related Documents

- `docs/operations/runbooks.md`
- `docs/operations/deployment-guide.md`
- `docs/user/settings-and-admin.md`
