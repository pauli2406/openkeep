---
title: Testing and Validation
description: Current automated and manual verification strategy across API, web, and operations.
---

# Testing and Validation

This document summarizes the current verification strategy.

## Goals

The current test strategy tries to protect:

- backend extraction and normalization behavior
- provider integrations and fallback behavior
- semantic search behavior
- major web user journeys

## Backend Validation Layers

### Unit Tests

Primary command:

- `pnpm --filter @openkeep/api test:unit`

This currently covers areas such as:

- agentic document intelligence service
- correspondent resolution
- deterministic metadata extraction
- chunking
- embedding providers
- extractive answer provider
- LLM service
- OCR provider behavior
- parse providers
- semantic ranking utilities

### Type Checking

Primary command:

- `pnpm --filter @openkeep/api typecheck`

### Integration and Acceptance Layers

Additional commands exist for:

- container-backed integration tests
- OCR acceptance tests
- live provider-specific end-to-end tests for parse and embedding providers

These are documented in the root `README.md` and `docs/backend.md`.

## Web Validation Layers

### Type Checking

Primary command:

- `pnpm --filter @openkeep/web typecheck`

### Smoke Tests

Primary command:

- `pnpm --filter @openkeep/web test`

The current smoke suite covers:

- authentication
- dashboard rendering
- explorer flows
- search and AI answer UI
- upload flow
- review/settings flows
- document detail workflows

### Visual Regression

Primary command:

- `pnpm --filter @openkeep/web test:visual`
- `pnpm --filter @openkeep/web test:visual:update` to re-bless intended changes

Not part of `pnpm test`: it needs a Chromium binary, installed deliberately
with `pnpm --filter @openkeep/web exec playwright install chromium`.

It screenshots each redesigned screen in **both themes at 1280 and 1024** — the
same matrix the redesign was reviewed against by hand — and compares against
baselines in `apps/web/visual/__screenshots__`. 44 screenshots in total.

Everything the images depend on is pinned, so a diff means the rendering
changed and nothing else:

- a fixed mock API (`visual/mock-api.mjs`), no database and no seeded data
- a frozen clock, so relative labels like "3 days overdue" are stable
- animations and transitions disabled, spinners hidden
- a fixed device scale, and the production build rather than the dev server

The tolerance is a small absolute pixel budget rather than a ratio. On a fixed
Chromium build these screens render bit-identical between runs; a percentage
tolerance was loose enough that changing the entire accent colour still passed
on most screens.

**Requires network access.** `index.css` pulls Public Sans and IBM Plex Mono
from Google Fonts, and text metrics drive every box on the page. The suite
asserts the font actually loaded and fails with that explanation rather than
producing thousands of unexplained pixel diffs.

Baselines are captured on Linux. Another platform rasterises text differently
and will diff on every snapshot.

## Mocking Strategy

The web test stack currently uses:

- MSW for most HTTP route mocking
- explicit `globalThis.fetch` mocking when streaming behavior is easier to control directly

This is especially relevant for SSE-style answer streams, where deterministic stream control is useful in tests.

## What We Validate in Practice

The current test suite gives confidence in:

- upload-to-processing happy paths
- review and correction flows
- search result rendering
- AI answer UI behavior
- provider configuration visibility in settings
- document detail rendering including newer intelligence surfaces

## Manual Validation

There is also a manual smoke checklist in:

- `docs/phase-3-smoke.md`

That document is currently the main bridge between automated validation and operational verification.

## Current Gaps

The repo still has room to improve in areas such as:

- **no CI workflow runs lint, tests or the build.** `.github/workflows` covers
  image builds and docs search reindexing only, so every suite described here
  is run by hand
- broader end-to-end archive workflow automation
- retrieval quality benchmarking as a first-class operator workflow
- richer regression coverage for cross-provider behavior in production-like environments
- the visual suite covers screens at rest; interactive states (menus open,
  rows selected, validation errors) are not captured

## Recommended Contributor Workflow

For most product changes, the practical validation path is:

1. run relevant backend unit tests
2. run backend typecheck
3. run web typecheck
4. run web smoke tests
5. run the visual suite when the change touches styling, layout or tokens
6. use the manual smoke checklist when the change affects user-facing archive flows

## Related Documents

- [Repo README](../README.md)
- [Backend Notes](../backend.md)
- [Manual Smoke Checklist](../phase-3-smoke.md)
- [Runbooks](../operations/runbooks.md)
