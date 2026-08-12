---
title: Mobile Document Cache
description: How the mobile app caches opened documents for read-only offline access.
---

# Mobile Document Cache

The mobile app does not mirror the whole archive locally. Instead, it keeps a persistent cache of documents that were opened while the app had a live archive connection.

Cached mode is read-only. When the device cannot use the live archive, the app shows cached documents only.

## What Gets Cached

Opening a document detail page online stores one local cache record:

- document metadata from `GET /api/documents/:id`
- OCR text from `GET /api/documents/:id/text`
- audit history from `GET /api/documents/:id/history`
- the preview file from `GET /api/documents/:id/download`
- for PDFs, the searchable PDF from `GET /api/documents/:id/download/searchable` when available

The cache is last-opened state. It is refreshed the next time the same document is opened online.

## On-Device Storage

The cache uses SQLite for queryable document metadata and Expo's persistent document directory for files:

```text
openkeep-cache/
└── files/
    └── <document-id>.<ext>
```

The SQLite store keeps each cached record with `cachedAt`, `lastViewedAt`, searchable metadata, OCR text, history JSON, and file size.

Date-only values (`YYYY-MM-DD`) are days, not instants, and the offline
derivations read them as local days through `parseArchiveDate` — the helper the
display layer already used. Read as instants they would sit at UTC midnight,
which is the previous day for every user west of Greenwich: January documents
filed in the year before, and documents due today reported overdue. Day counts
for due and overdue are differences between local day starts rather than
divided milliseconds, so neither the time of day nor a daylight-saving change
can move them.

The database records its schema version in `PRAGMA user_version`, and the store
brings it forward on open through an ordered chain of migrations — each step
upgrading one version, able to add columns and backfill them from
`document_json`, which holds the whole document. This is not optional
bookkeeping: `CREATE TABLE IF NOT EXISTS` is a no-op on a database that already
has the table, so without the chain a new column would never appear on an
upgraded install and the offline filters would quietly read missing data. A
database written before versioning existed carries `0` and is adopted as the
oldest known shape, keeping what it cached. A database from a newer build, or
from a version too old to migrate, is discarded and re-caches as documents are
opened — the cache is a convenience copy, so that is both safe and safer than
reading a shape the app no longer describes.

Neither half of the cache reaches the device directly. `offline-metadata-store.ts` takes the SQLite handle it queries through, and `offline-file-cache.ts` takes a small filesystem interface — so the store's real SQL runs against Node's own SQLite in tests, and the download flow runs against an in-memory filesystem, with no simulator and no Expo runtime. Production wires the same code to `expo-sqlite` and `expo-file-system` in one place per module.

`CacheSummary` exposes exactly three values — `documentCount`, `fileStorageBytes` and `updatedAt` — and the `Settings` -> `Offline` screen shows those three and nothing else. `updatedAt` is the revision the cached queries are keyed by, moved only when the counts change, so it is presented as when the cache was last checked rather than when a document was last written.

## Offline Read Paths

When the app is offline or running from an offline-restored session:

| Screen | Cached behavior |
|---|---|
| Dashboard | Derived from cached documents only |
| Documents | Lists and filters cached documents only |
| Search | Runs local metadata/OCR search over cached documents; AI answers are unavailable |
| Review | Shows cached documents with pending review only |
| Correspondents | Builds facets from cached documents |
| Document detail | Loads cached metadata, preview file, OCR text, and history |

Archive-wide AI search, document Q&A, uploads, edits, review mutations, reprocessing, and delete actions require a live archive connection.

## Cache Management

Users can clear cached documents from `Settings` -> `Offline`. There is no opt-in toggle, no auto-download and no retention setting; the provider deletes the AsyncStorage keys of those removed features on boot. Logging out also clears the cache on the device for privacy. Clearing the mobile cache does not modify the server archive.

During startup, the mobile app removes legacy full-snapshot files under `openkeep-offline/`, the old `openkeep-offline.db` SQLite database, and old AsyncStorage settings for the previous offline archive mode.

## Related Documents

- [Architecture Overview](./architecture-overview.md)
- [API and Data Flows](./api-and-data-flows.md)
- [Mobile App](../user/mobile-app.md)
