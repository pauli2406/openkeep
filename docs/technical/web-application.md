# Web Application

This document describes the current structure of the web client.

## Stack

The web app uses:

- React
- TanStack Router
- TanStack Query
- a generated API client from `packages/sdk`

The app entry is `apps/web/src/app.tsx`.

In production-style deployments, the built web app is served by the API process from the compiled `apps/web/dist` output.

## App Shell

The root route in `apps/web/src/routes/__root.tsx` provides:

- authenticated shell layout
- sidebar navigation
- mobile drawer navigation
- redirect behavior for unauthenticated users

Primary navigation surfaces:

- dashboard
- documents
- explore
- review
- search
- upload
- settings

## Auth Model

`AuthProvider` in `apps/web/src/hooks/use-auth.tsx` manages:

- current user
- login
- setup
- logout
- initial token sync from storage
- auth failure callback integration with the API client

On startup, the app:

1. syncs tokens from storage
2. checks health
3. fetches `/api/auth/me` when tokens exist
4. updates authenticated state

## API Usage Model

The web app uses two related access paths:

- generated `api.*` methods for standard request/response endpoints
- `authFetch(...)` for direct fetch flows, especially streaming endpoints

`authFetch(...)` is the main path for:

- SSE summary streams
- SSE answer streams
- direct authenticated fetches where the generated client is not ideal

## Main Routes

### `/'`

Dashboard view powered by `GET /api/dashboard/insights`.

### `/documents`

Explorer surface with three views:

- list
- timeline
- galaxy

This route is backed by shared explorer components and filter state.

### `/explore`

Standalone semantic galaxy route using the same explorer surface in forced galaxy mode.

### `/correspondents/$slug`

Correspondent dossier view powered by correspondent insights plus filtered document listing.

### `/search`

Hybrid search interface with:

- semantic result list
- expandable AI Answer panel
- SSE answer streaming

### `/review`

Review queue interface with resolve and requeue actions.

### `/upload`

Manual ingestion UI with drag-and-drop and file queue handling.

### `/documents/$documentId`

Document detail page with the richest single-document surface in the app.

Current detail tabs and sections include:

- preview
- OCR text
- intelligence
- raw details
- history
- editable metadata panel
- review actions
- reprocess and delete actions
- document summary and Q&A area

### `/settings`

Administrative UI for:

- API tokens
- taxonomy management
- archive portability
- processing activity
- provider visibility
- system health

## Explorer Component Model

The explorer experience is centered around `ExplorerSurface`.

It is responsible for:

- shared filter state
- view switching
- search query input
- selection mode for list view
- bulk delete and bulk reprocess flows
- switching between list, timeline, and galaxy rendering

Supporting components include:

- `filter-sidebar.tsx`
- `timeline-view.tsx`
- `galaxy-canvas.tsx`
- shared explorer display primitives in `shared.tsx`

## Document Detail Interaction Model

The document detail page is a hybrid of CRUD, diagnostics, and AI tooling.

Important patterns:

- edits create sticky manual overrides
- override locks can be cleared per field
- document history is treated as an audit surface, not just UI state
- AI summary and Q&A use SSE streams and separate state machines
- intelligence output is exposed as a first-class diagnostic surface

## Testing Strategy in the Web App

The web app uses Vitest plus Testing Library.

The current smoke tests validate the main user journeys:

- auth
- dashboard
- search
- upload
- explorer
- review/settings
- document detail

MSW is used for most HTTP mocking, with targeted `globalThis.fetch` mocking for streaming edge cases such as SSE-based search answer tests.

## Related Documents

- `docs/technical/testing-and-validation.md`
- `docs/technical/api-and-data-flows.md`
- `docs/operations/deployment-guide.md`
