# Settings and Admin

The `Settings` page is the administrative control area for OpenKeep.

It is where you manage access, taxonomy curation, archive portability, provider visibility, and system health.

For operator-focused guidance outside the UI, see `docs/operations/README.md`.

## User Profile

The User Profile section shows the current account information, including:

- display name
- email address
- role

## API Tokens

Use API tokens when you need programmatic access to OpenKeep.

You can:

- create tokens
- set an optional expiry date
- copy the token at creation time
- revoke tokens later

Important:

- a newly created token is only shown once
- store it securely when it is generated

## Taxonomy Management

OpenKeep lets you curate the labels used across the archive.

Current taxonomy sections:

- Tags
- Correspondents
- Document Types

For each taxonomy, you can:

- create entries
- rename entries
- merge duplicate entries
- delete entries

Use this to keep the archive consistent when AI-generated labels drift or duplicate.

## Archive Portability

The archive portability section supports export, import, and watch-folder scans.

### Export Snapshot

Use `Export Snapshot` to create a JSON snapshot of the archive state.

### Import Snapshot

You can paste snapshot JSON back into the app and import it in one of two modes:

- `Replace`
- `Merge`

Use replace only when you fully understand the consequences for the current archive state.

### Scan Watch Folder

Use `Scan Watch Folder` to trigger ingestion from the configured watch folder.

The page can show:

- imported items
- duplicates
- unsupported files
- failures
- planned items in dry-run mode
- recent scan history

Dry-run mode is useful when you want to inspect what would happen without importing anything yet.

## Processing Activity

The processing activity section gives you a live view of the system.

It includes:

- OCR queue depth
- embedding queue depth
- total document count
- pending review count
- document status breakdown
- recent processing jobs

Use this page when uploads appear delayed or when you want to confirm that a reprocess or embed job has been queued.

## AI and Providers

The AI and Providers section shows which providers are configured and available.

This includes:

- chat providers
- embedding providers
- parse providers
- active provider markers
- fallback provider markers where applicable

Use this page to confirm whether a missing AI feature is caused by configuration rather than by a document problem.

## System Health

The system health section shows:

- overall server status
- readiness checks for key dependencies

Current readiness checks include:

- database
- object storage
- queue

If the system is unhealthy or degraded, this is one of the first places to inspect.

## When to Use Settings Most Often

Common admin scenarios include:

- checking whether providers are configured correctly
- cleaning up tags or correspondents
- exporting the archive before a migration or maintenance task
- checking why processing seems slow
- triggering a watch-folder scan
- creating a token for scripts or integrations

## Final User Guide Step

Continue with `docs/user/faq.md` for quick answers to common questions and edge cases.

If you are administering a real deployment, continue into `docs/operations/deployment-guide.md` and `docs/operations/runbooks.md`.
