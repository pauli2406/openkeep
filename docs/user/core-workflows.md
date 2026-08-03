---
title: Core Workflows
description: Learn the main archive tasks, from upload and browsing to reprocessing and download.
---

# Core Workflows

This guide covers the most common tasks in OpenKeep.

## Import Documents

Select `Import` in the top bar and either:

- drag files into the drop zone
- click the drop zone to choose files manually

For each queued file you can optionally set a title override before uploading.

After upload, OpenKeep shows whether each file:

- uploaded successfully
- failed with an error message

Use `View documents` when the upload is complete.

## Browse the Archive

Open `Documents` to browse your archive.

If you want semantic exploration, switch the `Documents` page to galaxy view.

### List View

Use list view when you want to:

- skim many documents quickly
- sort by date or title — select a column heading to sort, and again to
  reverse it. The sort is part of the address, so a sorted view can be shared
- inspect titles, badges, and extracted metadata
- select multiple documents for bulk actions

Select rows with the checkbox at the left of each row. Hold `Shift` while
selecting to take a whole range. A bar appears above the list showing how many
are selected, with the actions available for them:

- export the selected documents
- reprocess the selected documents
- delete the selected documents

`Tag` and `Set type` appear in that bar but are not available yet.

### Timeline View

Use timeline view when you want to browse by year and month.

This is useful for:

- tax seasons
- monthly billing cycles
- finding documents from a known period

### Galaxy View

Use galaxy view when you want to explore semantically related documents.

This helps surface clusters of similar content even if the filenames or metadata differ.

## Filter the Archive

The filter sidebar lets you narrow the current document set.

Current filters include:

- year
- status
- correspondent
- document type
- tags
- amount range

You can clear all active filters from the sidebar.

## Open a Document

From any list, search result, correspondent page, or exploration surface, open a document to view its detail page.

The document detail page includes:

- preview
- OCR text
- intelligence tab
- raw details
- audit history
- metadata editor
- actions such as reprocess and download
- AI summary and Q&A section

## Work Through Today

Today is the daily queue. Use it to:

- see everything with an open deadline, soonest first
- spot what is overdue
- preview a document and its extracted fields without leaving the queue
- confirm and file a task once it is handled
- narrow the queue to overdue items, this month, or invoices

## Open a Correspondent Dossier

Open the `Groups` view under Documents and select a correspondent, or select a
correspondent in the filter sidebar, to focus the archive on them.

This page shows:

- an AI-generated summary of the correspondent
- document count and total spend
- type breakdown
- monthly activity trend
- recent documents from that correspondent

Use `Open in explorer` if you want to keep working with that correspondent's documents using the full document browser.

## Download Documents

From the document detail page, you can download:

- the original file
- the searchable PDF, if one exists

Searchable PDF availability depends on the processing outcome and document type.

## Delete Documents

You can delete:

- a single document from its detail page
- multiple documents by selecting them in list view

Deletion is permanent and removes associated derived data as well.

## Reprocess Documents

Use reprocessing when:

- OCR or metadata extraction looks wrong
- you changed providers and want fresh output
- you want OpenKeep to re-run extraction after cleanup

You can reprocess:

- a single document from the detail page
- multiple selected documents from list view

Manual overrides remain locked during reprocessing unless you explicitly clear them first.

## Next Step

Continue with [Search and AI](./search-and-ai.md) for search, summaries, and AI-assisted answers.

You can also jump back to [Getting Started](./getting-started.md) if you want the broader product orientation.
