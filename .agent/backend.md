# Backend Notes

## Current Scope

- Single-user self-hosted backend.
- Auth supports owner login, refresh tokens, and long-lived API tokens.
- Documents support upload, deduplicated storage, OCR, metadata extraction, review flows, search, and download.
- Derived searchable PDFs are exposed separately from original file downloads.
- Documents also persist provider metadata and deterministic chunks for later semantic work.

## Processing Model

1. Upload creates the document and queues processing.
2. Worker downloads the source file from object storage.
3. One parse provider is selected globally, with optional fallback on hard failure.
4. Metadata extraction normalizes dates, currencies, amounts, archive fields, and review evidence.
5. Deterministic chunking runs over normalized parse output.
6. Search text, pages, blocks, chunks, tags, and derived artifacts are persisted.

## Review Model

- Processing status: `pending`, `processing`, `ready`, `failed`
- Review status: `not_required`, `pending`, `resolved`
- Review reasons include low confidence, OCR failure, missing fields, and unsupported formats.
- Review evidence lives in document metadata.

## Parse Providers

- `local-ocr`
- `google-document-ai-enterprise-ocr`
- `google-document-ai-gemini-layout-parser`
- `amazon-textract`
- `azure-ai-document-intelligence`
- `mistral-ocr`

## Supported Local OCR Inputs

- Text files
- PDFs
- JPEG, PNG, WebP
- TIFF
- HEIC/HEIF

PDF flow prefers `ocrmypdf` and falls back to page rasterization plus `tesseract`.
