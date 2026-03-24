# Backup, Restore, and Portability

This document describes the current archive portability model.

## Current Portability Mechanisms

OpenKeep currently provides portability through:

- archive snapshot export
- archive snapshot import
- object storage persistence for source files and derived artifacts
- PostgreSQL persistence for metadata and processing state

The user-facing control surface is in Settings under `Archive Portability`.

## Exporting a Snapshot

Use:

- `GET /api/archive/export`

The settings UI exposes this as `Export Snapshot`.

Use exports before:

- risky maintenance work
- migrations between environments
- bulk taxonomy cleanup
- major provider changes you may want to roll back from

## Importing a Snapshot

Use:

- `POST /api/archive/import`

The current import modes are:

- `replace`
- `merge`

Operational guidance:

- prefer `merge` when validating portability on a non-empty system
- use `replace` only with clear change control and backup confidence

## What a Snapshot Is Not

A snapshot is not automatically a complete infrastructure backup strategy.

You should also account for:

- PostgreSQL data durability
- MinIO object durability
- environment configuration backup
- external provider credential recovery

## Recommended Backup Strategy

For serious environments, treat backup as a layered process:

1. export an archive snapshot
2. back up PostgreSQL data
3. back up MinIO data
4. back up deployment configuration and secrets through your secure secret-management process

## Restore Guidance

At a minimum, a restore-capable operational posture should preserve:

- database state
- object storage contents
- relevant environment configuration

If one of these is missing, the restored system may boot but behave as incomplete or inconsistent.

## Watch Folder as an Ingestion Channel

The watch folder is not a backup mechanism. It is an ingestion convenience.

It is best used for:

- controlled imports from external scanners or folders
- staged inbound file processing
- dry-run validation of a new ingestion source

## Migration Checklist

Before moving an environment:

1. export an archive snapshot
2. preserve PostgreSQL data
3. preserve MinIO objects
4. record active provider settings and secrets
5. verify readiness on the target environment
6. test document downloads, search, review, and upload after migration

## Related Documents

- `docs/operations/deployment-guide.md`
- `docs/operations/runbooks.md`
- `docs/user/settings-and-admin.md`
