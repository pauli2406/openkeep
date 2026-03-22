# Commands

## Install

- `pnpm install`

## Local Backend

- `pnpm db:migrate`
- `docker compose up postgres minio`
- `pnpm --filter @openkeep/api dev`
- `pnpm --filter @openkeep/worker dev`

## Verification

- `pnpm typecheck`
- `pnpm build`
- `pnpm test:api:unit`
- `pnpm test:api:integration`
- `pnpm test:api:ocr`

## Environment Requirements

- `test:api:integration` needs Docker.
- `test:api:ocr` needs `ocrmypdf`, `tesseract`, German and English Tesseract language data, Poppler, and ImageMagick.
