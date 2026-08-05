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
- hybrid and structured archive search
- AI-assisted answers and summaries
- review and correction workflows

## First-Time Setup

If the archive has not been initialized yet, open the app and complete the
setup wizard. It has three steps.

### Step 1 — Owner Account

You will be asked for:

- display name
- email address
- password

Current password requirement:

- at least 12 characters

There is exactly one owner account. Creating it signs you in.

### Step 2 — Document Language

Choose the language OCR and extraction should read your documents in. This
sets your AI processing and chat language; you can change it later under
`Settings -> General`.

You can skip this step and keep the default.

### Step 3 — Watch Folder

An optional folder OpenKeep imports from automatically. It is configured on
the server through the `WATCH_FOLDER_PATH` environment variable rather than
in the app, so this step only tells you where it will appear — on the Import
page — once that variable is set.

Choosing `Done` finishes setup and lands you on Today.

## Signing In

Use the login page with the email and password you created during setup.

After signing in, you land on Today.

## Main Areas of the App

### Today

Today answers "what do I have to do", as a working queue rather than an
overview. It lists everything with an open deadline, soonest first: how many
days until it is due (overdue shown in red), the document, the task, and the
amount.

Selecting a row previews that document beside the list with its extracted
fields, so you can check it without leaving the queue. `Confirm and file`
marks the task done and removes it from the queue.

Filter the queue with the chips above it: `Open tasks`, `Overdue`,
`This month` or `Invoices`.

Keyboard: `↑`/`↓` move through the queue, `Enter` opens the selected
document.

### Documents

The Documents area is the main archive browser. It supports three views:

- list view for dense scanning and bulk actions
- timeline view for chronological browsing
- groups view for browsing by correspondent

### Search

On mobile this tab is called `Chat`; see [Mobile App](./mobile-app.md).

Search combines keyword matching, semantic search, and structured archive answers. Use it for both exploratory questions and operational questions like open invoices, pending review items, or expiring contracts.

### Review

The Review queue shows documents that need manual attention.

### Import

The Import page lets you add files directly to the archive. It is the `Import`
button on the right of the top bar.

### Settings

Settings is split into three sections, reached from its left navigation:
`General` (language, watch folder, archive import/export, system health),
`Tags & taxonomy`, and `AI providers`. Your account — profile, two-factor
authentication and API tokens — lives on the `Profile` page, opened from the
avatar menu in the top bar.

## Light and Dark Appearance

OpenKeep follows your operating system's light or dark setting by default.

To override it, select the sun or moon icon on the right of the top bar. Your
choice is remembered in that browser and applies the next time you open
OpenKeep; until you make a choice, the app keeps following the system setting.

Document previews stay on a light page in both appearances, so a scan always
looks like the scan.

## Guide Map

- Learn the day-to-day archive tasks in [Core Workflows](./core-workflows.md)
- Learn search, summaries, and Q&A in [Search and AI](./search-and-ai.md)
- Learn review and manual correction workflows in [Review and Corrections](./review-and-corrections.md)
- Learn admin tools in [Settings and Admin](./settings-and-admin.md)
- Learn the phone app in [Mobile App](./mobile-app.md)

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
