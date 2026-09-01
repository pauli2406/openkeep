---
title: Monitoring and Health
description: Health endpoints, metrics, structured logging, and practical monitoring priorities.
---

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

## External Heartbeat Monitoring

Everything above is pull-based: something has to call the endpoints. In a typical
self-hosted setup nothing does, and an HTTP uptime monitor pointed at `/api/health`
has two blind spots: it sits behind whatever access layer protects the domain
(Cloudflare Access, a VPN), and it can only ever see the API container. A worker
that crash-loops leaves the API green.

The heartbeat inverts the direction. Each process proves it is alive by pinging a
dead-man's-switch monitor on a fixed interval, after probing the dependencies it
needs. If the pings stop, the monitor alerts. It is designed for
[healthchecks.io](https://healthchecks.io), whose free plan is enough for this,
but any service that accepts a plain GET as "I am alive" works.

### What each check covers

| Env var                | Process pinging | Alerts when                                                                                  |
| ---------------------- | --------------- | -------------------------------------------------------------------------------------------- |
| `HEARTBEAT_URL_API`    | `api`           | the API container is down, or it cannot reach Postgres, the MinIO bucket, or the pg-boss schema |
| `HEARTBEAT_URL_WORKER` | `worker`        | the worker container is down (crash loop, OOM, failed boot), or it cannot reach the same three |

Two checks therefore cover all four containers of the production stack: `api` and
`worker` directly, `postgres` and `minio` through the readiness probe that both
processes run before every ping. The readiness probe is the same code that serves
`GET /api/health/ready`, so the monitor never disagrees with the endpoint.

### Behaviour

- Every `HEARTBEAT_INTERVAL_SECONDS` (default 60) the process runs the readiness
  probe. On success it sends `GET <url>`.
- On a failed probe it sends `POST <url>/fail` with the failed checks and their
  error messages as the body. healthchecks.io treats `/fail` as an immediate
  failure, so a dependency outage alerts right away instead of after the grace
  period, and the body shows up in the check's log.
- A ping that times out or returns a non-2xx status is logged at `warn` level and
  otherwise ignored. Monitoring never affects the process it monitors.
- A graceful shutdown sends nothing. Deploy restarts are absorbed by the grace
  period.
- Unset URL means off for that process. `SKIP_EXTERNAL_INIT` also disables it.

### Setup with healthchecks.io

1. Create two checks, for example `openkeep api` and `openkeep worker`. Set
   **Period** to 1 minute and **Grace** to 5 minutes. With the default interval this
   alerts about six minutes after a process stops, while surviving a normal deploy
   restart.
2. Attach the notification channels you want (email is enabled by default).
3. Copy each check's ping URL into `HEARTBEAT_URL_API` and `HEARTBEAT_URL_WORKER`
   in the deployment's environment (the Dokploy Environment tab for the reference
   setup; `docker-compose.prod.yml` passes them through).
4. Redeploy. Both checks turn green within a minute. Verify the alarm once by
   stopping the worker container and waiting for the notification.

If you already use healthchecks.io for the backup job described in the hosting
guide, these are simply two more checks in the same project.

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
- a missing heartbeat (API or worker process stopped)
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

- [Runbooks](./runbooks.md)
- [Deployment Guide](./deployment-guide.md)
- [Settings and Admin](../user/settings-and-admin.md)
