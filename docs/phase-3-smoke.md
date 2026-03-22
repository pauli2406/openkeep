# Phase 3 Smoke Checklist

Use this checklist after backend or frontend changes that could affect the web app or its supporting API flows.

## Manual smoke steps

1. Open the deployed app and confirm the login page loads.
2. Sign in with the owner account and confirm the dashboard renders without raw object output.
3. Refresh the page and confirm the authenticated session persists.
4. Open the review queue and confirm pending review items load.
5. Open the upload page, upload a supported PDF or image, and confirm the new document reaches `ready` or an expected review state.
6. Open the uploaded document detail page and confirm metadata, OCR text, and preview/fallback rendering load.
7. Trigger reprocess from document detail with an explicitly selected OCR provider and confirm the document updates with the selected provider after processing completes.
8. Open settings and confirm processing activity, provider availability, readiness checks, and system health all load.

## Latest completed live pass

- Date: 2026-03-22
- Environment: local Docker Compose stack on `http://localhost:3000`
- Verified:
  - owner login worked
  - `/api/health`, `/api/health/ready`, `/api/health/status`, and `/api/health/providers` returned healthy data
  - review queue data loaded
  - a live JPEG upload completed processing
  - a live provider-selected reprocess completed and switched the document `parseProvider` to `local-ocr`
