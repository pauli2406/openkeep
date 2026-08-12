---
title: Web Application
description: Web client structure, route model, auth flow, and testing approach.
---

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
- a 48px top bar carrying primary navigation
- redirect behavior for unauthenticated users

The top bar replaced the former sidebar and mobile drawer. Left to right it
holds the logo mark, the primary tabs, a search field that opens the omnibar
(also reachable with Cmd/Ctrl+K), the Import action, the theme toggle, the
settings gear and the account menu. The tab row scrolls horizontally on narrow
viewports; the search field collapses to its icon below the `md` breakpoint.
Native hosts may provide their platform through the shared host-shell context, so
shortcut labels remain `Cmd` on macOS and `Ctrl` on Windows/Linux while the same
omnibar keyboard handler continues to accept either modifier.

Primary navigation surfaces:

- today
- documents
- review
- chat
- import
- settings
- account menu (opens the profile page)

Sign out moved off the account menu onto the profile page itself, next to the
identity header, so the destructive action sits with the account it affects
rather than one hover away from every screen.

`/profile` carries the identity header, four archive statistics, the archive
export, two-factor setup and API tokens. The statistics are derived from
`/api/dashboard/insights`: total documents, documents not awaiting review
(total minus pending — note this includes documents that never required
review, since the API exposes no resolved count), correspondents and document
types.

## Theming

Color lives entirely in `apps/web/src/index.css` as `--ok-*` custom properties:
`:root` carries the light values and `[data-theme="dark"]` overrides them. The
shadcn/Radix `--color-*` names are aliases onto those tokens, so components
never name a color directly.

`data-theme` is set on `<html>`. An inline script in `index.html` applies it
before first paint — reading `localStorage["openkeep.theme"]`, falling back to
`prefers-color-scheme` — so a dark user never sees a light flash. `useTheme`
(`src/hooks/use-theme.ts`) keeps React in sync, persists an explicit choice, and
follows the OS until one is made.

Public Sans and IBM Plex Mono are local, OFL-licensed assets shared from the mobile
workspace and bundled by Vite. The web UI therefore keeps identical text metrics
inside Electron's self-only CSP and in network-restricted web deployments.

Two things need care when adding UI:

- Canvas 2D cannot resolve `var()`. Anything painted through `fillStyle` or
  `strokeStyle` must go through `resolveColor()` from `src/lib/explorer.ts`, and
  its draw effect must depend on the current theme so it repaints on toggle.
- Document previews render on `--ok-paper`, which stays light in both themes.

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
- groups

This route is backed by shared explorer components and filter state.

### `/explore`

Standalone semantic groups route using the same explorer surface in forced groups mode.

### `/correspondents/$slug`

Correspondent dossier view powered by correspondent insights plus filtered document listing.

### `/search`

Answer-first archive search interface with:

- hybrid keyword + semantic retrieval for exploratory questions
- structured operational answers for open deadlines, pending review items, and expiring contracts
- linked citations for semantic answers
- linked item cards for structured answers
- SSE answer streaming shared with the mobile client

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
- switching between list, timeline, and groups rendering

Supporting components include:

- `filter-sidebar.tsx`
- `timeline-view.tsx`
- `groups-view.tsx`
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

- [Testing and Validation](./testing-and-validation.md)
- [API and Data Flows](./api-and-data-flows.md)
- [Deployment Guide](../operations/deployment-guide.md)
