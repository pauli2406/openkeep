# AGENTS.md

OpenKeep is a self-hosted, AI-assisted document archive: NestJS API, async processing worker, and web client over PostgreSQL + pgvector and MinIO, built as a TypeScript monorepo.

## Tooling

- `pnpm` (v10) with Node >= 22. Do not use npm or yarn.
- Tasks are orchestrated with `turbo`; workspaces live under `apps/*` and `packages/*`.
- Scope commands to one package with `pnpm --filter @openkeep/<name> <script>`.

## Workspace map

- `apps/api` — NestJS + Fastify REST API (auth, upload, search, review, taxonomy)
- `apps/worker` — background processing via `pg-boss` (OCR, extraction, embeddings)
- `apps/web` — TanStack Router web client
- `apps/docs` — Docusaurus renderer for the root `docs/` content
- `apps/mobile` — Expo/React Native client with offline archive support
- `apps/desktop` — placeholder, not an active development target
- `packages/config` — environment parsing and provider configuration
- `packages/db` — Drizzle schema and migrations
- `packages/types` — shared Zod schemas and public API types
- `packages/sdk` — generated API client consumed by the web app

## Develop

```sh
cp .env.example .env   # replace JWT secrets and owner password
pnpm install
docker compose up -d postgres minio
pnpm db:migrate
pnpm --filter @openkeep/api dev      # likewise: worker, web
```

Full containerized stack: `pnpm docker:up` (API on :3000, docs on :3001). The compose stack has no web service — run the web client separately with `pnpm --filter @openkeep/web dev`.

## Verify

Run before finishing any change:

- `pnpm typecheck`
- `pnpm build`
- `pnpm test:api:unit`
- `pnpm --filter @openkeep/web test` (for web changes)

Environment-dependent suites — run only when the environment supports them:

- `pnpm test:api:integration` — requires Docker (Testcontainers)
- `pnpm test:api:ocr` — requires `ocrmypdf`, `tesseract` (deu + eng data), Poppler, ImageMagick
- `pnpm test:e2e:*` — make live cloud provider calls and need real credentials in `.env`; never run unprompted

## How to work

Feature planning and story delivery follow a defined process — read `.agent/workflow.md` before splitting a feature into user stories or implementing one. Short version: stories become GitHub issues; implementation runs end-to-end on its own branch (small commits → PR → resolve automated review comments in a loop → hand off for manual review, never merge yourself).

## Working rules

- Docs are part of the product. If a change affects user behavior, architecture, operations, setup, or verification, update `docs/user/*`, `docs/technical/*`, or `docs/operations/*` in the same piece of work. Canonical markdown lives in the root `docs/` directory; `apps/docs` only renders it. Full trigger list: `.agent/docs.md`.
- After changing the API contract, regenerate the OpenAPI spec and SDK: `pnpm openapi:generate`, then `pnpm --filter @openkeep/sdk generate`.
- Parse, chat, and embedding providers are selected only through env config (`ACTIVE_PARSE_PROVIDER`, `ACTIVE_CHAT_PROVIDER`, `ACTIVE_EMBEDDING_PROVIDER`). The local default is `local-ocr`; never hardcode a provider.
- Keep real credentials only in untracked `.env` files. Run `pnpm secrets:scan` before publishing; allowlists live in `.gitleaks.toml`.

## Deeper context (read only what you need)

- `.agent/workflow.md` — feature planning and story implementation process
- `.agent/repo.md` — repo overview and working rules
- `.agent/backend.md` — processing pipeline, review model, provider IDs
- `.agent/commands.md` — full command and environment reference
- `.agent/docs.md` — documentation update triggers
- `.agent/roadmap.md` — current priorities
- `docs/technical/README.md` — contributor-facing architecture docs
