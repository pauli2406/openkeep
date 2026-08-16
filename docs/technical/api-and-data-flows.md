---
title: API and Data Flows
description: Backend surface area, major endpoints, and ingestion, search, and archive flows.
---

# API and Data Flows

This document summarizes the current backend surface and the most important runtime flows.

## Authentication Flow

Relevant endpoints:

- `POST /api/auth/setup`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/auth/me`
- `GET /api/auth/tokens`
- `POST /api/auth/tokens`
- `DELETE /api/auth/tokens/:id`

The web app stores access and refresh tokens client-side and refreshes access tokens automatically when needed.

## Document Ingestion Flow

Relevant endpoints:

- `POST /api/documents`
- `POST /api/documents/:id/reprocess`
- `POST /api/documents/reprocess/bulk`
- `POST /api/documents/:id/reembed`
- `POST /api/embeddings/reindex`

Flow:

1. client uploads file to `POST /api/documents`
2. API stores the binary and creates the document row
3. API inserts a `processing_jobs` row and enqueues a processing job
4. worker parses the document and extracts metadata
5. worker writes pages, OCR blocks, chunks, taxonomies, and metadata back to the database
6. worker queues embeddings when semantic indexing is configured
7. document becomes available for explorer, search, review, and detail views

Text block geometry:

- `document_text_blocks.bounding_box` is nullable; parse providers that return no line
  geometry (Mistral OCR returns markdown per page) store `null` instead of fabricated boxes
- migration `0014` nulled out all previously stored Mistral bounding boxes because they were
  fabricated by the old response mapper and never reflected real page geometry; real boxes
  return only when a document is reprocessed with a geometry-capable provider
- `documents.metadata.parse.providerMetadata` holds a bounded summary of the provider
  response (model, pages processed, document size), never the raw OCR payload
- markdown table rows stay in `pages[].lines` (only lines become `document_text_blocks`,
  which back `GET /api/documents/:id/text`, matching-line snippets and evidence
  localization); the chunker skips those rows on pages that also carry a normalized
  table, so a table is embedded once rather than twice

## Document Read and Update Surface

Relevant endpoints:

- `GET /api/documents`
- `GET /api/documents/facets`
- `GET /api/documents/review`
- `GET /api/documents/:id`
- `GET /api/documents/:id/text`
- `GET /api/documents/:id/history`
- `PATCH /api/documents/:id`
- `DELETE /api/documents/:id`
- `POST /api/documents/:id/review/resolve`
- `POST /api/documents/:id/review/requeue`
- `GET /api/documents/:id/download`
- `GET /api/documents/:id/download/searchable`
- `POST /api/documents/bulk/tags`
- `POST /api/documents/bulk/type`

Important behavior:

- user edits are persisted as manual overrides
- locked override fields survive reprocessing
- audit history is stored separately and exposed through the history endpoint
- the bulk endpoints add/remove one tag or set/clear the document type on up
  to 200 ids in one request, with partial-failure semantics: unknown ids are
  reported while the rest applies, and every touched document gets its own
  audit entry
- list, facets, and timeline accept `categoryIds` and an `uncategorized`
  flag; both resolve through the correspondent's category assignment

## Search Surface

Relevant endpoints:

- `GET /api/search/documents`
- `POST /api/search/semantic`
- `POST /api/search/answer`
- `POST /api/search/answer/stream`

Current model:

- semantic search returns document-centric results with matched chunks
- archive-wide answer endpoints first pass through a search orchestrator
- routed answers can be:
  - `semantic`: retrieval-backed answer with citations
  - `structured`: answer from normalized archive state such as due dates, review status, expiry dates, and task completion state
- current structured payload families are:
  - `deadline_items`
  - `pending_review_documents`
  - `expiring_contracts`
- response payloads now include:
  - `route`
  - `structuredData` when applicable
- streaming answers are delivered via server-sent events

Retrieval notes:

- the keyword arm filters AND ranks with the same language-aware regconfig
  (`german`/`english`/`simple` per document language) so stemmed queries match
  ("Rechnungen" finds "Rechnung"); its candidate cap covers the requested result
  window (`page * pageSize`, at least 50) so pagination stays reachable
- the vector arm ranks documents by their nearest chunk: a lateral probe computes the
  minimum cosine distance per filtered document over the composite primary key, so
  every eligible document is considered exactly once (perfect diversity — a
  multi-hundred-page file cannot crowd out other matches) and the result is exact.
  `total` is page-independent: the exact keyword count plus the vector candidates
  the keyword arm does not match, so the reported result count does not drift while
  paginating
- deliberately deferred until the archive approaches ~50k chunks: a global ANN
  pre-filter in front of the per-document lateral probe, per-provider partial HNSW
  indexes, a generated tsvector column with a language-aware GIN index, and
  rerankers — at that size revisit `semanticSearch` in
  `apps/api/src/documents/documents.service.ts`

Citations:

- the model cites inline by excerpt number ([1], [2][4]); each citation in the payload
  carries a matching `index`, so clients resolve markers to documents exactly — the
  previous fuzzy title matching could link the wrong document
- the legacy `[Document: "Title", Page: N]` format is still rendered for one release
  (exact/substring title matches only)
- web clients share one SSE line parser and the citation linkifier via `@openkeep/sdk`
  (`createSseParser`, `linkifyAnswerCitations`); the mobile app keeps local copies
  because it deliberately has no workspace package dependencies
- the omnibar renders document results from the answer stream's `search-results` event
  instead of issuing a second `POST /api/search/semantic` per question

Current search SSE event flow:

- `search-results`
- `answer-token`
- `done`
- `error`

For structured routes, the stream currently emits an empty `search-results` payload followed by an immediate `done` payload containing `route` and `structuredData`.

Routing guardrails:

- structured intents match anchored phrases only (for example `pending review`, not a bare
  `review`), and contract-expiry routing requires the expiry term near the contract term plus
  a listing/interrogative shape or a short query
- when a structured route returns zero items and the query carries substance beyond the
  trigger phrase, the orchestrator falls through to the semantic RAG path instead of
  answering "nothing found" from the wrong data; if semantic answering is unavailable the
  structured empty answer is kept

## Explorer Surface

Relevant endpoints:

- `GET /api/dashboard/insights`
- `GET /api/correspondents/:slug/insights`
- `GET /api/documents/timeline`

These power the higher-level archive browsing UI:

- dashboard widgets
- correspondent dossier
- timeline view
- groups view (correspondent blocks)

## Tax Year Surface

Relevant endpoints:

- `GET /api/taxes/:year`
- `GET /api/taxes/:year/export`

Membership lives server-side in one place: a document belongs to the year when
it carries the `tax` tag or a canonical tax document type, and each returned
document states why (`tag` | `type` | `both`). Year boundaries compare dates in
SQL against the coalesced issue date, sums run in integer cents per currency,
and documents without an amount are counted separately. The export streams a
ZIP (searchable PDF preferred, Windows-safe filenames, `index.csv` including
missing-file reporting) and writes audit events for the exported documents.

## Deadline Notifications Flow

Relevant endpoints:

- `GET /api/notifications` (`undeliveredFor=email|desktop` filters)
- `POST /api/notifications/:id/read`
- `POST /api/notifications/:id/delivered`

An hourly pg-boss job (`deadline.scan`) arms one record per document + window
(`upcoming`/`due`/`overdue`) + due date; the unique index makes reruns and
concurrent workers no-ops. Completing a task or moving the date invalidates
pending undelivered records; delivered records are history and stay. "Today"
is computed in `ARCHIVE_TIMEZONE`, never UTC midnight. Delivery is claim-once
per channel: `:id/delivered` returns `delivered: true` only for the call that
actually set the timestamp, which is what makes the desktop relay and the
daily email digest (`deadline.digest` job, opt-in per user) announce exactly
once.

## Email Ingestion Flow

Relevant endpoints:

- `GET /api/email-ingest/status`
- `POST /api/email-ingest/poll`

A scheduled pg-boss job (`email.ingest`) polls the IMAP mailbox and hands
supported attachments to the regular upload path (checksum dedup, review
routing, audit, `source: "email"`). Idempotency is a ledger: every message is
recorded once by RFC 5322 Message-ID with its outcome; `\Seen` flags are a
filter, not the truth. The guard enforces the sender allowlist and decides by
magic bytes, not the declared Content-Type — a renamed executable is rejected
with a reason in the capped rejection log. Imported documents carry
`metadata.email` provenance (sender, received date, subject).

## Categories Surface

Relevant endpoints:

- `GET|POST /api/taxonomies/categories`
- `PATCH|DELETE /api/taxonomies/categories/:id` (builtins refuse delete)
- `PATCH /api/taxonomies/correspondents/:id` accepts `categoryId` (stamps the
  manual source)

Categories are assigned per correspondent with strict source precedence
(`manual` > `llm` > `deterministic`); the intelligence prompt is constrained
to the current vocabulary and out-of-vocabulary suggestions are discarded.
Facets expose a categories dimension plus an `uncategorizedCount`, and the
chat tools accept category names in `search_documents`,
`aggregate_documents` (including `groupBy: category`), and `list_taxonomies`.

## Document AI Surface

Relevant document-level endpoints:

- `POST /api/documents/:id/summarize/stream`
- `POST /api/documents/:id/ask/stream`
- `GET /api/documents/:id/qa-history`
- `POST /api/documents/:id/qa-history`

This supports document-local AI workflows separate from archive-wide search answers.

Q&A history and multi-turn:

- `POST /api/documents/:id/ask/stream` persists the finished answer server-side; the
  `done` event carries `historyEntryId` (null when persistence failed). Clients fall
  back to the deprecated write only when that id is absent, so an older API or a
  failed server write does not lose the turn — the compatibility endpoint
  deduplicates identical recent turns, while server-side stream completions always
  create a turn (a deliberately repeated question stays in the conversation). Clients no longer write history themselves —
  `POST /api/documents/:id/qa-history` is deprecated (it accepted arbitrary answer text
  and lost entries when a tab closed mid-stream) and remains for one release.
- the last 4 Q&A pairs for the document are replayed as user/assistant turns in the
  prompt, so follow-up questions resolve against prior answers.

Per-document Q&A context selection:

- documents whose assembled context fits ~12k chars are answered in full-text mode
  (the budget counts chunk text, heading length, and per-chunk excerpt labels and
  separators, and caps the chunk count, so many short chunks cannot slip past it): ALL
  chunks with page labels go into the prompt and vector retrieval is skipped, so a
  retrieval miss cannot hide the answer in a short letter or invoice (the
  provider-agnostic equivalent of Mistral's Document QnA)
- larger documents use vector top-6 chunk retrieval; without usable embeddings they
  fall back to the first chunks by position (clearly labeled in the prompt)
- only vector-retrieved chunks surface as scored citations; full-text and positional
  answers cite pages inline instead

## Taxonomy Surface

Relevant endpoints:

- tags CRUD and merge under `/api/taxonomies/tags`
- correspondents CRUD and merge under `/api/taxonomies/correspondents`
- document types CRUD and merge under `/api/taxonomies/document-types`

These are used by both the backend processing pipeline and the settings UI.

## Archive Portability Surface

Relevant endpoints:

- `GET /api/archive/export`
- `POST /api/archive/import`
- `POST /api/archive/watch-folder/scan`

This is the current archive backup, restore, and external-ingestion control surface.

## Health and Observability Surface

Relevant endpoints:

- `GET /api/health`
- `GET /api/health/providers`
- `GET /api/health/live`
- `GET /api/health/ready`
- `GET /api/health/status`
- `GET /api/metrics`

These endpoints expose:

- active provider configuration
- readiness checks
- queue depth and recent processing jobs
- Prometheus-style metrics

## Important Persisted Data Shapes

At a conceptual level, the most important document-related persisted data includes:

- core document fields such as title, status, dates, amount, and taxonomy relations
- OCR text and page/block structures
- persisted chunks
- embeddings by chunk
- review status and review reasons
- processing job summaries
- audit events
- `metadata.parse`, `metadata.chunking`, `metadata.reviewEvidence`, and `metadata.manual`
- `metadata.intelligence.*` for the new agentic extraction output

## Related Documents

- [Architecture Overview](./architecture-overview.md)
- [Agentic Document Intelligence](./agentic-document-intelligence.md)
- [Backend Notes](../backend.md)

## Module Graph and Decorator Metadata

NestJS reads a constructor's dependencies from `design:paramtypes`. Any
transpiler that emits that metadata evaluates the referenced class when the
decorator runs, at module load — so a runtime import cycle between two
services makes the API fail to start with
`Cannot access 'X' before initialization`.

The API transpiles with esbuild (`tsx` in development, `tsup` in the build),
which does not emit that metadata. Two consequences:

- Providers are injected with an explicit `@Inject(Token)` rather than by
  constructor type, and request validation names its schema explicitly through
  `@ValidatedBody(Dto)` / `@ValidatedQuery(Dto)` — see
  `src/common/validated-params.ts`. The bare `@Body()` / `@Query()` forms rely
  on the missing metadata and silently validate nothing.
- Service-level import cycles were invisible, because nothing read the
  metadata that would have tripped over them.

Those cycles have been removed. Where a service would have to import
`DocumentsService` back and close a loop, it depends on the `DOCUMENTS_SERVICE`
token and annotates the type with `import type`, which the transpiler erases.
`documents.module.ts` aliases the token onto the real provider with
`useExisting`, so both resolve to the same instance.

`test/import-cycles.spec.ts` fails if a runtime cycle reappears outside
`*.module.ts`. Module files are exempt: a Nest module has no constructor to
emit metadata for, and `forwardRef(() => OtherModule)` defers the reference
past load, which is the framework's documented pattern.

Verified: with SWC configured to emit decorator metadata the API starts
cleanly and `design:paramtypes` resolves. Adopting such a transpiler is now a
choice rather than a blocked path; the explicit forms above stay correct
either way.
