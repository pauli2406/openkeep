# Backend Notes

## Current Scope

- Single-user self-hosted backend.
- Auth supports owner login, refresh tokens, and long-lived API tokens.
- Documents support upload, deduplicated storage, OCR, metadata extraction, review flows, search, and download.
- Derived searchable PDFs are exposed separately from original file downloads.
- Documents persist provider metadata, chunks, embeddings state, review evidence, and intelligence metadata.
- The web app already exposes dashboard, explorer, search, review, document detail, and settings surfaces on top of the backend.

## Processing Model

1. Upload creates the document and queues processing.
2. Worker downloads the source file from object storage.
3. One parse provider is selected globally, with optional fallback on hard failure.
4. Metadata extraction runs through the hybrid entry point, using LangGraph-based agentic intelligence when LLM providers are configured and deterministic fallback otherwise.
5. Chunking runs over normalized parse output.
6. Search text, pages, blocks, chunks, tags, review metadata, intelligence metadata, and derived artifacts are persisted.

## Review Model

- Processing status: `pending`, `processing`, `ready`, `failed`
- Review status: `not_required`, `pending`, `resolved`
- Review reasons include low confidence, OCR failure, missing fields, ambiguous classification, unresolved correspondents, and related extraction issues.
- Review evidence lives in document metadata and is surfaced in the web UI.

## Current Intelligence Model

- `HybridMetadataExtractor` is the active extraction entry point.
- `AgenticDocumentIntelligenceService` orchestrates routing, title/summary, typed extraction, correspondent resolution, tagging, and validation.
- Supported LLM providers for agentic extraction are Mistral, Gemini, and OpenAI.
- Intelligence output is stored under `metadata.intelligence.*`.

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
