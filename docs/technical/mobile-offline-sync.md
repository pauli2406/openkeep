---
title: Mobile Offline Mode and Local Sync
description: How the mobile app stores data locally, syncs with the server, and behaves when offline.
---

# Mobile Offline Mode and Local Sync

This document explains how the OpenKeep mobile app supports offline access and how it synchronises its local archive copy with the server.

## Overview

The mobile app can operate fully offline for read-only access. A local snapshot of the entire archive — document metadata, OCR text, audit history, and the actual files — is stored on the device. When connectivity is restored, the app incrementally reconciles the local snapshot with the server using an `updatedAt`-based change detection strategy.

All offline and sync logic lives in a single context provider:
`apps/mobile/src/offline-archive.tsx` — `OfflineArchiveProvider`

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Mobile Device                          │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              OfflineArchiveProvider                  │   │
│  │                                                     │   │
│  │  ┌──────────────┐    ┌────────────────────────────┐ │   │
│  │  │ Network      │    │       Sync Engine          │ │   │
│  │  │ Monitor      │───▶│  syncArchive()             │ │   │
│  │  │ (NetInfo)    │    │  - paginate all docs       │ │   │
│  │  └──────────────┘    │  - diff via updatedAt      │ │   │
│  │                      │  - download changed files  │ │   │
│  │  ┌──────────────┐    │  - tombstone deletions     │ │   │
│  │  │ AutoSync     │───▶│  - write index.json        │ │   │
│  │  │ Manager      │    └────────────────────────────┘ │   │
│  │  │ (reconnect)  │              │                     │   │
│  │  └──────────────┘              ▼                     │   │
│  │                      ┌────────────────────────────┐ │   │
│  │  ┌──────────────┐    │   Local Filesystem         │ │   │
│  │  │ Offline Mode │    │                            │ │   │
│  │  │ Toggle       │    │  openkeep-offline/         │ │   │
│  │  │ (AsyncStore) │    │  ├── index.json            │ │   │
│  │  └──────────────┘    │  ├── documents/<id>.json   │ │   │
│  │                      │  └── files/<id>.<ext>      │ │   │
│  └─────────────────────-└────────────────────────────┘─┘   │
│                                    ▲                        │
│    Screens read from               │ shouldUseOffline?      │
│    local store when offline        │                        │
│  ┌──────────────────────────────── │ ──────────────────┐   │
│  │  DashboardScreen  DocumentsScreen  DocumentDetail    │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                           │  (online only)
                           ▼
          ┌────────────────────────────────┐
          │     OpenKeep Server (API)      │
          │                               │
          │  GET /api/documents?page=N    │
          │  GET /api/documents/:id       │
          │  GET /api/documents/:id/text  │
          │  GET /api/documents/:id/history│
          │  GET /api/documents/:id/download│
          │  GET /api/dashboard/insights  │
          │  GET /api/documents/facets    │
          │  GET /api/health              │
          └────────────────────────────────┘
```

---

## On-Device Storage Layout

Files are written to the app's permanent `documentDirectory` via `expo-file-system`. This location is not evicted by the OS under storage pressure (unlike `cacheDirectory`).

```
<expo documentDirectory>/openkeep-offline/
├── index.json                    ← master manifest (OfflineArchiveIndex)
├── documents/
│   └── <document-id>.json        ← per-document record (OfflineDocumentRecord)
└── files/
    └── <document-id>.<ext>       ← binary file (PDF, image, or text)
```

### `index.json` — the manifest

```ts
type OfflineArchiveIndex = {
  version: 1;
  lastSyncedAt: string | null;   // ISO timestamp of last successful sync
  documentCount: number;
  storageBytes: number;          // total bytes consumed on device
  documents: ArchiveDocument[];  // full document list for in-memory filtering
  dashboard: DashboardInsights | null;
  facets: FacetsResponse | null;
};
```

### `documents/<id>.json` — per-document record

```ts
type OfflineDocumentRecord = {
  document: ArchiveDocument;              // full metadata
  text: DocumentTextResponse | null;      // OCR text blocks
  history: DocumentHistoryResponse | null;// audit events
  fileUri: string | null;                 // absolute path to binary file on device
  syncedAt: string;                       // ISO timestamp of this record's sync
};
```

---

## Offline Mode Toggle

The offline mode flag is stored in `AsyncStorage` under the key `openkeep.mobile.offline-archive-mode`.

The effective offline state is a composite of two signals:

```
shouldUseOffline = isOfflineModeEnabled OR !isConnected
```

| `isOfflineModeEnabled` | `isConnected` | `shouldUseOffline` |
|---|---|---|
| false | true | false — reads hit the live API |
| false | false | true — device has no network |
| true | true | true — user has explicitly forced offline |
| true | false | true — both conditions active |

---

## Sync Algorithm

The full sync is invoked by calling `syncArchive(authFetch)`. It runs as a single sequential pass:

```
┌─────────────────────────────────────────────────────┐
│                   syncArchive()                     │
│                                                     │
│  1. ensureOfflineDirs()                             │
│     Create directory tree if not present            │
│                          │                          │
│  2. Read existing index.json                        │
│     Get current document snapshot (or empty)        │
│                          │                          │
│  3. Paginate GET /api/documents                     │
│     Fetch all pages (pageSize=100) until exhausted  │
│                          │                          │
│  4. Parallel fetch                                  │
│     GET /api/dashboard/insights                     │
│     GET /api/documents/facets                       │
│                          │                          │
│  5. Diff: shouldRefreshDocument(existing, incoming) │
│     Compare updatedAt / status /                    │
│     searchablePdfAvailable / mimeType               │
│                          │                          │
│        ┌─────────────────┴──────────────────┐       │
│    CHANGED                             UNCHANGED     │
│        │                                    │        │
│  6a. For each changed doc (parallel):  6b. Reload    │
│      GET /api/documents/:id                from disk  │
│      GET /api/documents/:id/text                     │
│      GET /api/documents/:id/history                  │
│      GET /api/documents/:id/download                 │
│      Write <id>.json + <id>.<ext>                   │
│                          │                          │
│  7. Tombstone deleted documents                     │
│     Remove <id>.json and <id>.<ext>                 │
│     for docs in old index not in new server list    │
│                          │                          │
│  8. Write updated index.json                        │
│     (new document list, dashboard, facets,          │
│      storageBytes, lastSyncedAt)                    │
│                          │                          │
│  9. Emit SyncResult                                 │
│     { documentCount, synced, reused,                │
│       failed, removed }                             │
└─────────────────────────────────────────────────────┘
```

### Change detection

A document record is refreshed when any of the following server-side fields differ from the locally cached version:

- `updatedAt`
- `status`
- `searchablePdfAvailable`
- `mimeType`

Passing `forceFull: true` to `syncArchive` bypasses this check and re-downloads every document regardless.

### File download strategy

For PDF documents where `searchablePdfAvailable: true`, the searchable PDF variant is downloaded instead of the original. For all other types, the original file is downloaded. Files are fetched as `ArrayBuffer`, base64-encoded, and written to disk via `expo-file-system`.

If a file download fails but the document already has a locally cached file from a prior sync, that cached file is reused rather than discarding the record entirely.

---

## Auto-Sync on Reconnect

`AutoSyncManager` is a component mounted inside the authenticated navigator (`apps/mobile/App.tsx`). It watches the network state and fires an incremental sync automatically when connectivity is restored:

```
Network transition: disconnected → connected
        │
        ▼
Is user authenticated?       → No  → skip
Is archive ready?            → No  → skip
Is sync already in progress? → Yes → skip
Does a prior snapshot exist? → No  → skip (no lastSyncedAt)
        │
        ▼
checkArchiveReachability()
  → GET /api/health
        │
   reachable? → No  → skip
        │
        ▼
syncArchive(authFetch)   ← incremental diff sync
```

A guard on `lastSyncedAt` prevents repeated auto-syncs within the same reconnect event.

---

## Offline Read Paths per Screen

When `shouldUseOffline` is true, each screen substitutes local reads for live API calls:

| Screen | Live API | Offline path |
|---|---|---|
| `DashboardScreen` | `GET /api/dashboard/insights` | `offline.loadDashboard()` — reads `dashboard` from `index.json` |
| `DocumentsScreen` | `GET /api/documents?...` | `offline.loadDocuments(...)` — in-memory filter on `index.json`.`documents` |
| `DocumentDetailScreen` | `GET /api/documents/:id` + text + history | `offline.loadDocumentRecord(id)` — reads `documents/<id>.json` |
| `DocumentViewer` | Authenticated file download | Uses `fileUri` from `OfflineDocumentRecord` |
| AI features, Q&A, facets | Live API | Disabled — queries not enabled offline |

### Local document search and filtering

`loadDocuments` performs in-memory filtering over the cached document list from `index.json`. The text search searches a concatenated haystack per document covering:

- `title`
- `correspondent.name`
- `documentType.name`
- `referenceNumber`
- `holderName`
- `issuingAuthority`
- `tags[].name`

Results are sorted by `createdAt` descending and capped at 30 items.

---

## Write Restrictions Offline

The mobile app is read-only when offline. All mutation operations check `shouldUseOffline` and disable their actions accordingly:

| Operation | Offline behaviour |
|---|---|
| Edit document metadata | Disabled |
| Resolve / requeue review | Disabled |
| Mark task complete | Disabled |
| Reprocess document | Disabled |
| Delete document | Disabled |
| Generate AI summary | Disabled |
| Document Q&A | Disabled |
| Share file from Overview tab | Disabled (use Preview tab cached file instead) |

---

## Storage Accounting

Total on-device storage used by the offline archive is tracked in `index.json`.`storageBytes`. It is recalculated on every sync pass by summing the sizes of all files in the `files/` directory. This value is exposed in the Settings screen so the user can see how much space the offline archive is consuming.

---

## Related Documents

- [Architecture Overview](./architecture-overview.md)
- [API and Data Flows](./api-and-data-flows.md)
