# Commands

## Install

- `pnpm install`

## Local Backend

- `pnpm db:migrate`
- `docker compose up postgres minio`
- `docker compose up`
- `pnpm --filter @openkeep/api dev`
- `pnpm --filter @openkeep/worker dev`
- `pnpm --filter @openkeep/web dev`
- `pnpm docs:dev`

## Verification

- `pnpm typecheck`
- `pnpm build`
- `pnpm docs:build`
- `pnpm test:api:unit`
- `pnpm test:api:integration`
- `pnpm test:api:ocr`
- `pnpm --filter @openkeep/web typecheck`
- `pnpm --filter @openkeep/web test`

## Environment Requirements

- `test:api:integration` needs Docker.
- `test:api:ocr` needs `ocrmypdf`, `tesseract`, German and English Tesseract language data, Poppler, and ImageMagick.

## Documentation Check

When behavior changes, update the relevant docs before finishing:

- `docs/user/*`
- `docs/technical/*`
- `docs/operations/*`
- `docs/README.md`
- `README.md`
