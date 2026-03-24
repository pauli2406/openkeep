# Repo Overview

- Monorepo managed with `pnpm` and `turbo`.
- Full-stack project: API, worker, and web app are implemented; mobile and desktop remain placeholders.
- Main apps:
  - `apps/api`: NestJS + Fastify API
  - `apps/worker`: background processing runtime
  - `apps/web`: TanStack Router web client
  - `apps/mobile`: future React Native client
  - `apps/desktop`: future Electron client
- Shared packages:
  - `packages/config`: environment parsing
  - `packages/db`: Drizzle schema and migrations
  - `packages/types`: shared Zod schemas and public types
  - `packages/sdk`: generated client package used by the web app
- Infra:
  - PostgreSQL for metadata
  - MinIO for binary storage
  - `pg-boss` for async jobs
  - provider-driven parsing with local and cloud adapters

# Working Rules

- Prefer backend-safe changes unless the task clearly targets a client app.
- Keep docs aligned when behavior or verification paths change.
- For any substantial product or architecture change, update the relevant files under `docs/user`, `docs/technical`, or `docs/operations`.
- Use the explicit test entrypoints instead of ad hoc commands when possible.
- Default local parse provider is `local-ocr`; cloud providers are selected only through config.
