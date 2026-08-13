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
- browser and desktop-host import delivery into the shared upload queue

The desktop package adds focused Vitest suites for secure path validation, native
picker/Open-with batch delivery, single-instance launch ordering, explicit archive
selection, fixed platform association metadata, and exactly-once consumption. Its
full verification commands are documented in
[Desktop Application](./desktop-application.md#contributor-commands).

### Visual Regression

Primary command:

- `pnpm --filter @openkeep/web test:visual`
- `pnpm --filter @openkeep/web test:visual:update` to re-bless intended changes

Both run **inside the pinned Playwright container**, which is what CI uses.
Text rasterisation depends on the font stack and freetype build: ten of the
forty-four baselines differed between a developer machine and that container.
Whichever machine generates the baselines decides where the suite passes, so
the container decides — always. Docker is therefore required, and
`test:visual:update` must never be run outside it.

`test:visual:local` runs directly against a locally installed browser. It is
faster for iterating on a screen, but its results do not correspond to the
committed baselines and it must not be used to update them.

Not part of `pnpm test`: it needs Docker, and a browser image to pull.

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

- broader end-to-end archive workflow automation
- retrieval quality benchmarking as a first-class operator workflow
- richer regression coverage for cross-provider behavior in production-like environments
- the visual suite covers screens at rest; interactive states (menus open,
  rows selected, validation errors) are not captured

## Continuous Integration

`.github/workflows/ci.yml` runs on every pull request and every push to `main`.
Six jobs, in parallel:

| job | what it runs | notes |
| --- | --- | --- |
| Typecheck | `pnpm lint` | `tsc --noEmit` across every package |
| Unit and smoke tests | `pnpm test` | api + web |
| Build | `pnpm build` | every package |
| API integration | `pnpm test:api:integration` | Testcontainers starts Postgres and MinIO |
| Visual regression | `pnpm --filter @openkeep/web test:visual` | runs in the pinned Playwright image |
| Secret scan | gitleaks | working tree on PRs, full history on `main` |

Typecheck, tests and build are separate jobs rather than one chain, so a type
error and a failing test surface in the same run instead of one masking the
other. They share a Turbo cache, so the overlap costs little.

A final `CI` job depends on all six and fails if any did not succeed. Protect
`main` with that single check; adding a job later then needs no change to
branch protection.

### Notes

- The secret scan splits by event. Pull requests scan the working tree (~30s);
  pushes to `main` scan the full history (~3m30s), which is the backstop for a
  secret that reached a branch and was removed again. Running history on every
  PR would spend six times the minutes re-scanning what `main` already cleared.
- On a failed visual job the expected/actual/diff images are uploaded as a
  `visual-diffs` artifact — reviewing a visual regression from a log line alone
  is not practical.
- Node is pinned to a single major and pnpm comes from `packageManager`, so
  neither can change CI's behaviour without a commit that says so.

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

## Mobile Unit and Component Tests

`apps/mobile` runs Jest through `jest-expo`, in the repo's `pnpm test` pipeline:

```bash
pnpm --filter @openkeep/mobile test          # once
pnpm --filter @openkeep/mobile test:watch    # while working
```

These are not screenshots. They cover the layer where the mobile redesign kept
going wrong:

| Suite | What it holds in place |
|---|---|
| `dates` | date-only values parse as local calendar dates; the suite runs in `America/Los_Angeles` so a UTC-midnight regression fails |
| `document-state` | an active processing job outranks a stale `failed` status |
| `passage` | prefix matching stays opt-in for chat quotes; review evidence needs the full value; the cited page is searched first |
| `i18n` | both locales carry the same keys, once each, and every literal `t()` key resolves |
| `style-invariants` | no colour literals, no `fontWeight`, only bundled font faces, radii on the scale |
| `primitives` | `Row`, `Button`, `Screen`, `Notice`, `Pill` resolve to palette tokens in **both** themes; no tap target under 44pt at any density |
| `review-outbox` | a confirm held for the undo window survives a kill: written down before the window opens, replayed once on the next launch, kept when the send fails, refused for another account, and dropped once too old to be meaningful |
| `review-undo` | confirming a review is held for the undo window and sent once; taking it back sends nothing at all |
| `offline-store` | the offline mirror's real SQL: what a cached document reads back as, the status/review/correspondent filters, the search-text match, cache accounting, and the derived dashboard and facets |
| `offline-file-cache` | which endpoint a document's bytes come from, the write-to-temporary-then-move flow, byte accounting, and two viewers collapsing into one download |
| `offline-cache-migration` | the cache schema version: adopting a pre-versioning database, running each step once in version order, and discarding a shape this build cannot read |
| `offline-encryption` | that the copy is **ciphertext at rest**: the same store code driven through a real SQLCipher driver, then the raw file read back for the title, the recognised text and the document bytes — in UTF-8 and UTF-16 — plus the journal, the file header, and that neither a wrong key nor no key can read it |
| `offline-surfaces` | dates in the offline derivations: due today is not overdue at any hour, day counts survive a daylight-saving change, a document keeps its own local year and month, and the latest document is compared as a date |

Native modules with no JavaScript fallback are mocked in `jest.setup.js` — SQLite,
the OS document scanner, the PDF view, the file viewer, secure storage. Screens
mock `../auth` and `../offline-archive` at the module boundary; the screen's own
logic is never mocked.

One suite goes further than the rest. `offline-encryption` runs the store against
`better-sqlite3-multiple-ciphers`, a SQLCipher-capable SQLite for Node, so CI can
assert what actually lands on disk rather than take a device's word for it.
Turning the cipher off in that harness fails five of its six tests, which is how
we know it is testing the property and not the wiring.

That driver builds natively, so it is **not** a workspace dependency — a Windows
install would try to compile it and fail for no reason. The `Encryption at rest
(mobile)` job installs it on Linux and sets `OPENKEEP_CIPHER_TEST=1`, which is
what un-skips the suite; the job is required, so the property cannot regress
unnoticed. To run it locally: `npm install --no-save
better-sqlite3-multiple-ciphers`, then
`OPENKEEP_CIPHER_TEST=1 pnpm --filter @openkeep/mobile test -- --testPathPattern offline-encryption`.

What no Node driver can cover is whether the shipped app's `op-sqlite` was *built*
with SQLCipher — that is a native flag, so the app asserts `isSQLCipher()` before
it opens the copy and refuses to cache when it is false.

The two offline suites are the exception to that mock, and deliberately so: the
offline store and file cache take their database handle and filesystem as
arguments, so those tests run the real query and download code. The database is
Node's own SQLite (`node:sqlite`, which needs `--experimental-sqlite` on Node 22
— hence the flag in the `test` script), so a wrong filter or ordering fails here
exactly as it would on a device. The filesystem has no Node equivalent and is
stood in for; what those tests prove is the cache's flow, not the platform's file
API.

Two constraints worth knowing before adding a suite:

- A `QueryClient` created per test needs `gcTime: 0` and a `clear()` afterwards,
  or its garbage-collection timer keeps the Jest worker alive.
- Rendering a screen under fake timers fights the queue's `refetchInterval`.
  Where a timed window has to be closed, unmount instead — leaving the screen
  closes it too.

What the unit suite does **not** cover is how a screen is laid out. That is the
visual suite below — and neither one proves how the app looks on a device.

## Mobile Visual Regression

Thirty-four screenshots — seventeen screens in both themes — of the real app at
393×852:

```bash
pnpm --filter @openkeep/mobile test:visual           # compare
pnpm --filter @openkeep/mobile test:visual:update    # re-bless
```

Baselines are re-rendered by the `Bless Mobile Baselines` workflow
(`workflow_dispatch`, optionally filtered with `grep`), which runs the container
and pushes a branch with whatever changed, for one `gh pr create` to turn into a
pull request. It stops short of opening the pull request itself because this
repository does not permit Actions to create them. That exists because the baselines
are only reproducible against one font stack: a contributor whose container is
broken cannot bless an intended change, and taking `-actual.png` out of a failed
run's artifact only works when the run fails. A version bump can slip under the
diff budget — green suite, stale baseline — and that drift silently spends the
budget a real regression needs. Reviewing the result is deliberate: a baseline change is
a claim about how the app should look, and deserves the same review as the change
that caused it.

`OPENKEEP_VISUAL=1 expo export --platform web` renders the app in a browser.
`metro.config.js` swaps `src/auth` and `src/offline-archive` for fixture-backed
stubs, plus the modules with no browser implementation (the PDF view, the OS
scanner, the file viewer, blob storage, SQLite, secure storage, `pdf-lib`).
Everything above that line — screens, navigation, queries, tokens, faces — is the
real thing. Playwright then reaches each screen the way a person does, by tapping
tabs and rows.

Like the web suite, it runs inside the pinned Playwright image, because text
rasterisation depends on the font stack and the baselines are only reproducible
against one. Diffs are uploaded as CI artifacts on failure.

A green run means the palette, type scale, spacing, row heights, states and both
themes are applied, and that the paths between screens still work. It does not
mean the native screen is correct: react-native-web is a proxy for a device, and
native text measurement, the native header and the real document viewer are
absent or approximated. A simulator pass remains the only thing that proves
native fidelity — see `apps/mobile/visual/README.md` for the harness rules,
including which globals must not be frozen and why.
