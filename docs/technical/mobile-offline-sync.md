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

## Encryption at Rest

The copy is encrypted. `op-sqlite` is built with SQLCipher (the `op-sqlite` block
in `apps/mobile/package.json`), so the whole database file is ciphertext:
metadata, recognised text, and the `search_text` column offline search runs `LIKE`
against. The cipher sits under the database rather than over the values for that
reason — field-level encryption would have cost the searchable column, making
every offline search decrypt every row.

The key is 256 random bits per scope, held in `expo-secure-store` — the keystore
the app already used for tokens. Without a keystore there is no key, and without
a key there is no cache: reads answer empty and writes refuse for the session.
Falling back to plaintext would turn a missing keystore into a silent downgrade,
which is the one outcome this must not have. If a key existed and cannot be read
— a keystore reset, a backup restored onto another device — the database it sealed
is unrecoverable ciphertext, so it is deleted and the copy starts empty rather
than reopening a file that can never be read.

Document bytes live in the database as 512 KiB chunks rather than as files, so one
cipher and one key cover everything and nothing holds a whole PDF in memory.

**What is not protected:** the viewer takes a path, not a buffer, so opening a
document writes a decrypted copy to the cache directory for as long as it is open.
That copy is deleted when the screen closes, and swept at the next launch in case
a crash skipped that. So bytes do touch disk in the clear, briefly, while you are
reading — the archive of record stays encrypted, and this is stated rather than
implied.

The previous unencrypted databases, scoped and unscoped, are deleted on upgrade
along with the plaintext files directory. They are plaintext by definition;
documents re-cache as they are opened.

## Encrypted at Rest

The database is opened through `op-sqlite` built with SQLCipher, so the file
itself is ciphertext — metadata, recognised text, and the `search_text` column
offline search runs `LIKE` against. That is why the cipher sits under the
database rather than over the values: field-level encryption would have cost that
column, and every search would have had to decrypt every row. Document bytes live
in the same database in chunks, so there is one cipher and one key rather than
two, and nothing holds a whole PDF in memory.

The key is 256 random bits per scope, held in the device keystore. Without a
keystore there is no key and the copy stays disabled for the session: falling back
to plaintext would turn a missing keystore into a silent downgrade. A key that
existed but cannot be read — a keystore reset, a backup restored onto another
device — means its ciphertext is unrecoverable, so the copy is discarded and
rebuilt rather than reopened forever. SQLCipher being compiled in is a native
build flag, so the app checks `isSQLCipher()` before opening anything and refuses
to cache if it is false.

**Viewing a document decrypts it briefly.** `react-native-pdf` and the OS file
viewer take a path, not a buffer, so the bytes are written to the cache directory
while a document is open and deleted when it closes; a launch after a crash sweeps
whatever was left behind. That copy is plaintext for as long as the viewer is
open, which is stated here rather than implied away.

CI proves the at-rest property rather than assuming it: see `offline-encryption`
in [Testing and Validation](./testing-and-validation.md).

## Whose Copy It Is

The cache belongs to one archive and one account. Both the database name and the
files directory carry that scope — `openkeep-cache-<account>--<host>.db` and
`openkeep-cache/<account>--<host>/files` — so isolation does not depend on every
query remembering a `WHERE` clause. Before sign-in there is no scope and no
cache: reads answer empty and writes refuse, rather than falling back to a shared
copy, which is what previously let one account read another's documents after an
archive URL change or a sign-in as someone else. The scope also prefixes the
revision the cached queries are keyed by, so two copies holding the same counts
cannot serve each other's render.

The unscoped database this replaced is deleted once on upgrade. Its documents
cannot be attributed to an account, so they are removed rather than shown to
whoever signs in next; they re-cache as documents are opened.

## On-Device Storage

The cache uses SQLite for queryable document metadata and Expo's persistent document directory for files:

```text
openkeep-cache/
└── files/
    └── <document-id>.<ext>
```

The SQLite store keeps each cached record with `cachedAt`, `lastViewedAt`, searchable metadata, OCR text, history JSON, and file size, plus the issue, due and expiry dates as queryable columns — so the offline list filters by year and by date range, sorts by issue or due date, and pages in SQL rather than slicing the first page in JavaScript. A document with no due date sorts where the archive puts it, which takes an explicit `NULLS LAST`: SQLite orders nulls first ascending where Postgres orders them last. The date a document is filed under is its issue date, or the local day it was created where it has none, matching the year and month the derived surfaces report.

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

`CacheSummary` exposes `documentCount`, `fileStorageBytes`, `lastCachedAt` and `revision`, and the `Settings` -> `Offline` screen shows the first three. The last two are deliberately separate values: `lastCachedAt` is read from the rows (`MAX(cached_at)`) and is when a document was last written to the cache, so it survives a restart; `revision` is an opaque token the cached queries are keyed by, moved only when the cache really changed. Conflating them is what previously left the reported figure meaning "when the app last counted", resetting on every cold start — and left a document re-cached at an unchanged size invisible to every query reading the cache, since nothing in the comparison had moved.

## What Bounds the Copy

Each archive's copy has a byte budget, stored beside its rows so it is per scope
like everything else: 256 MiB by default — a phone is tighter than a laptop, so
this is not desktop's 1 GiB — with 64 MiB, 256 MiB and 1 GiB offered on the
`Settings` -> `Offline` screen. When a cached file pushes the copy past the
budget, documents are evicted least-recently-viewed first until it fits, rows and
files together, and lowering the limit evicts immediately rather than at the next
download. An unreadable stored limit falls back to the default, never to no
limit.

Only file bytes count against the budget. Row JSON is small, and evicting
metadata would cost the ability to list what the copy holds for no real saving.
`last_viewed_at` is refreshed when a document is opened offline as well as
online, so the copy someone reads every week without a connection is not the
first thing dropped.

## When the Copy Is Damaged

A row that cannot be decoded is dropped and the read carries on with the rest.
`JSON.parse` inside a `rows.map(...)` used to throw out of the whole read, so one
corrupt row took the list, the dashboard, the facets and search down together —
for a convenience copy, going dark is strictly worse than losing one document.
The decoded document is shape-checked as well as parsed, so a changed contract is
noticed rather than rendered as undefined; text and history are detail, and an
unreadable one is emptied rather than costing the document. Dropped rows are
counted and the `Settings` -> `Offline` screen says so, because an unexplained
gap in the copy is worse than an explained one.

A file that has gone missing under its row zeroes that row's byte count, so the
screen stops reporting storage that was already freed. The document itself
stays: its metadata and recognised text are still worth having.

A document the archive answers `404` or `410` for is removed from the copy along
with its file. Only those two: a `500` or a timeout means the archive could not
answer, and evicting on those would throw away a good copy exactly when it is
most needed.

## Returning to Live Data

An offline session used to be a dead end. `revalidateSession` was defined,
exported on the auth context, and called from nowhere — the only other reference
in the repo was a visual-test stub — so nothing ever cleared `sessionMode`, every
refetch interval was disabled while the cache was in use, and relaunching the app
was the only way back.

While an offline session is open the app now probes the archive every 30 seconds,
immediately when connectivity returns, and on demand from `Try to reconnect` on
the `Settings` -> `Offline` screen. The probe distinguishes the answers rather
than returning a bare boolean: reachable ends the offline session on live data,
`401` or `403` clears the session and hands over to the connect screen rather
than leaving one nobody can use, and anything else — including a `500`, a
timeout, or a thrown error — stays offline and tries again. Tearing down a usable
copy because the archive could not answer would be the wrong way round.

Two guards keep the loop honest: one check runs at a time, so a connectivity flip
during a slow probe cannot start a second, and a result that arrives after the
session has changed is discarded rather than applied to a session that has moved
on. The rules live in `offline-reconnect.ts`, apart from the provider, so they are
tested without React.

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
