---
title: Getting Started
description: Set up OpenKeep, sign in, and understand the main areas of the app.
---

# Getting Started

This guide helps you start using OpenKeep as a document archive for personal or small-team use.

## What OpenKeep Does

OpenKeep stores your documents, extracts text and metadata from them, and helps you work with them through:

- document upload
- OCR and metadata extraction
- archive browsing with filters and visual views
- semantic search
- AI-assisted answers and summaries
- review and correction workflows

## First-Time Setup

If the archive has not been initialized yet, open the app and complete the setup screen.

You will be asked for:

- display name
- email address
- password

Current password requirement:

- at least 12 characters

After setup, OpenKeep creates the initial owner account and signs you in.

## Signing In

Use the login page with the email and password you created during setup.

After signing in, you land on the dashboard.

## Main Areas of the App

### Dashboard

The dashboard gives you a quick overview of the archive:

- total documents
- pending review count
- top correspondents
- upcoming deadlines and overdue items
- recent documents
- monthly intake trend

### Documents

The Documents area is the main archive browser. It supports three views:

- list view for dense scanning and bulk actions
- timeline view for chronological browsing
- galaxy view for semantic exploration

### Search

Search combines keyword matching and semantic search. You can also expand the AI Answer panel to ask archive-wide questions.

### Review

The Review queue shows documents that need manual attention.

### Upload

The Upload page lets you add files directly to the archive.

### Settings

Settings covers administrative functions such as API tokens, taxonomies, archive import/export, provider availability, and system health.

## Guide Map

- Learn the day-to-day archive tasks in [Core Workflows](./core-workflows.md)
- Learn search, summaries, and Q&A in [Search and AI](./search-and-ai.md)
- Learn review and manual correction workflows in [Review and Corrections](./review-and-corrections.md)
- Learn admin tools in [Settings and Admin](./settings-and-admin.md)

## Supported Upload Types

The current upload UI accepts:

- PDF
- JPEG
- PNG
- TIFF
- HEIC

## What Happens After Upload

After you upload a document, OpenKeep usually:

1. stores the original file
2. runs OCR or parsing
3. extracts metadata such as type, dates, amount, and correspondent
4. creates searchable text and chunks
5. optionally creates embeddings for semantic search
6. marks the document as ready or sends it to review if confidence is low

## Document Statuses You May See

- `pending`: accepted and waiting to be processed
- `processing`: currently being parsed or enriched
- `ready`: available for use
- `failed`: processing did not complete successfully

Review is tracked separately, so a document can be `ready` and still require review.

## When to Use Review

Use the Review queue when OpenKeep is uncertain about important fields, for example:

- document classification is ambiguous
- a correspondent could not be resolved
- expected fields are missing
- confidence is too low

## Best Practices

- upload clear scans when possible
- review important financial or legal documents after processing
- use manual corrections when a key field is wrong
- use tags and taxonomies to keep the archive tidy
- regenerate summaries or reprocess documents only when needed

## Next Step

Continue with [Core Workflows](./core-workflows.md) for the day-to-day tasks most users perform.
