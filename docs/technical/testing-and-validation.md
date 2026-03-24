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

- broader end-to-end archive workflow automation
- retrieval quality benchmarking as a first-class operator workflow
- richer regression coverage for cross-provider behavior in production-like environments

## Recommended Contributor Workflow

For most product changes, the practical validation path is:

1. run relevant backend unit tests
2. run backend typecheck
3. run web typecheck
4. run web smoke tests
5. use the manual smoke checklist when the change affects user-facing archive flows

## Related Documents

- `README.md`
- `docs/backend.md`
- `docs/phase-3-smoke.md`
- `docs/operations/runbooks.md`
