---
title: Settings and Admin
description: Manage tokens, taxonomies, portability, provider visibility, and system health.
---

# Settings and Admin

The `Settings` page is the administrative control area for OpenKeep. It has
three sections in its left navigation: `General` (language preferences, watch
folder, archive import/export, system health), `Tags & taxonomy`, and
`AI providers`.

Account management — your profile, two-factor authentication and API tokens —
moved to the `Profile` page, opened from the avatar menu in the top bar.

For operator-focused guidance outside the UI, see [Operations Overview](../operations/README.md).

## User Profile

The User Profile section shows the current account information, including:

- display name
- email address
- role

## API Tokens

Use API tokens when you need programmatic access to OpenKeep.

You can:

- create tokens
- set an optional expiry date
- copy the token at creation time
- revoke tokens later

Important:

- a newly created token is only shown once
- store it securely when it is generated

The [Desktop App](./desktop-app.md) uses one of these tokens to connect to an
existing archive. Revoking that token causes the desktop app to remove its
stored connection the next time the server verifies it.

## Tags and Taxonomy

`Settings -> Tags & taxonomy` curates the labels used across the archive.
One list serves all three kinds — switch between `Tags`, `Correspondents` and
`Types` at the top.

The list is built for large archives: it filters as you type, virtualises the
rows, and shows how many documents use each entry. Sort by name or by
document count.

### Quick Filters

- `All` — everything
- `Unused` — entries no document uses. Only available once document counts
  have loaded; if the count request fails, the filter is disabled and the
  counts show as `—` rather than pretending every entry is unused.
- `Duplicates` — entries OpenKeep believes are the same thing, such as a
  case-only difference, a singular and its plural, or a name that is a prefix
  of another. Each carries a one-click `merge into <name>` suggestion.

### Acting on Entries

Type a name and press `Add` to create an entry.

Tick one or more rows to open the action bar, which offers:

- merge the selection into another entry — the target picker filters as you
  type, so it reaches every entry, not only the first page
- rename, when exactly one row is selected
- delete the selection

Deleting an entry removes the label, not the documents.

If an action fails, the reason is shown above the list.

Use this to keep the archive consistent when AI-generated labels drift or duplicate.

## Mobile Offline Copy

On the phone app, `Settings` -> `Offline` shows how many documents are cached,
how much file storage they use, what is kept per document, and a
`Delete the offline copy` action. Cache clearing lives there rather than in the
main settings list. Deleting the local copy never changes the server archive.

There is nothing to enable: the app caches each document you open while
connected and reads from those copies when the archive is unreachable. See
[Mobile App](./mobile-app.md).

## Archive Portability

The archive portability section supports export, import, and watch-folder scans.

### Export Snapshot

Use `Export Snapshot` to create a JSON snapshot of the archive state.

### Import Snapshot

You can paste snapshot JSON back into the app and import it in one of two modes:

- `Replace`
- `Merge`

Use replace only when you fully understand the consequences for the current archive state.

### Scan Watch Folder

Use `Scan Watch Folder` to trigger ingestion from the configured watch folder.

The page can show:

- imported items
- duplicates
- unsupported files
- failures
- planned items in dry-run mode
- recent scan history

Dry-run mode is useful when you want to inspect what would happen without importing anything yet.

## AI Providers

`Settings -> AI providers` is the single place to see both what is configured
and what the pipeline is doing. Processing activity used to be a separate
section; it now lives here.

### At a Glance

Four numbers across the top:

- processing queue depth
- embedding queue depth
- failures among the recent jobs
- average time per document

Note that the failure count and the average cover the recent-jobs window the
server returns, not the whole archive.

### The Three Stages

One row each for `Parsing`, `Embeddings` and `Chat`, listing every provider
OpenKeep knows about and marking:

- `Active` — the one in use
- `Fallback` — used when the active one cannot handle a document
- `Available` — configured and ready, but not selected
- `No model set` — credentials present, but no model configured
- `Not configured` — no credentials

Each row also says whether the provider runs on this machine or is a cloud
service that documents leave the machine for.

These states describe your **configuration**, not a live connection test.
OpenKeep does not currently probe providers, so a provider whose credentials
are valid but whose service is down still shows as available.

### Recent Jobs

The list below shows the newest jobs across both queues with their status —
queued, running, done or failed — and how long each took.

Use this page when uploads appear delayed, when you want to confirm a
reprocess or embed job was queued, or to check whether a missing AI feature
is a configuration problem rather than a document problem.

## System Health

The system health section shows:

- overall server status
- readiness checks for key dependencies

Current readiness checks include:

- database
- object storage
- queue

If the system is unhealthy or degraded, this is one of the first places to inspect.

## When to Use Settings Most Often

Common admin scenarios include:

- checking whether providers are configured correctly
- cleaning up tags or correspondents
- exporting the archive before a migration or maintenance task
- checking why processing seems slow
- triggering a watch-folder scan
- creating a token for scripts or integrations

## Final User Guide Step

Continue with [FAQ](./faq.md) for quick answers to common questions and edge cases.

If you are administering a real deployment, continue into [Deployment Guide](../operations/deployment-guide.md) and [Runbooks](../operations/runbooks.md).
