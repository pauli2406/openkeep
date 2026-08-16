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

The desktop app uses a native picker for the second action and also accepts files
from the operating system's `Open with OpenKeep` command. See
[Desktop App](./desktop-app.md#import-documents) for supported types, profile
selection, and desktop validation rules.

Each file gets its own row in the queue below the drop zone, moving through
`Upload → OCR → Extract → Embed` independently — the active stage carries the
accent colour. `Retry` on a failed row reprocesses the document rather than
uploading the file again.

If the same content is already in the archive the row is marked amber and
links to the document that already holds it. OpenKeep still files the new
document — the same paperwork can legitimately arrive twice — it just tells
you rather than letting it look like a first import.

A finished file links straight to its document, or shows a `Review` badge when
the extraction needs confirming.

When a watch folder is configured, its path and last scan appear under the
drop zone.

For each queued file you can optionally set a title override before uploading.

After upload, OpenKeep shows whether each file:

- uploaded successfully
- failed with an error message

Use `View documents` when the upload is complete.

## Jump Anywhere with the Omnibar

Press `Cmd+K` (`Ctrl+K` on Windows and Linux) from any screen to open the
omnibar. Start typing and it offers, in order:

- asking your archive the question you typed
- correspondents, document types and tags matching it, which open the
  `Documents` page filtered to that entry
- the screens themselves

Use the arrow keys to move, `Enter` to go, and `Cmd+Enter` to open in a new
tab. `Esc` closes it.

Type `>` first to switch to command mode, which lists actions such as
importing a document or toggling the theme rather than archive content.

## Browse the Archive

Open `Documents` to browse your archive.

To see the archive by who sends it, switch the `Documents` page to `Groups`.

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

Use timeline view to see how much arrived when. It shows one row per month,
newest first, with a bar whose length is the number of documents in that month,
the count, and the kinds of document it contained. Months holding an unpaid
deadline carry an amber marker.

Select a month to expand it in place and list its documents; select a document
to open it.

This is useful for:

- tax seasons
- monthly billing cycles
- finding documents from a known period

### Groups View

Use groups view to see the archive by correspondent. Each block is one
correspondent, sized by how many documents they account for. Select a block to
open the list filtered to that correspondent.

Each block also names the document type that correspondent sends most often.

Block totals follow the filter sidebar: narrowing by year, type, tag or status
narrows the counts. Selecting correspondents is the one exception — every
correspondent stays visible so you can still pick another one.

## Filter the Archive

The filter sidebar lets you narrow the current document set.

Current filters include:

- status
- year
- document type
- correspondent
- tags
- date range
- amount range

Each section collapses, and any section with more than a handful of entries
gets its own filter box — type a few letters to find one tag among hundreds
instead of scrolling.

Active filters also appear as chips above the list. Select a chip to remove
that filter, or use `Clear all` (shown once more than one filter is set).
The sidebar's own `Clear` resets everything too.

## Open a Document

From any list, search result, correspondent page, or exploration surface, open a document to view its detail page.

The document detail page is two columns: the document itself on the left, its
metadata in a rail on the right.

The left column has tabs — preview (with zoom and page navigation), OCR text,
intelligence, Q&A, raw details, and audit history. The top bar carries the
download actions and, when the document needs review, a `Confirm` button.

The right rail shows the extracted fields as a list. Select any value to edit
it in place; changed values turn amber, and a single `Save` bar appears at the
bottom of the rail. Below the fields sit the reason a document needs review, a
collapsible processing summary (parse provider, embedding, confidence), and the
reprocess and delete actions.

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

## On Mobile

Selection works by long-pressing a row in `Documents`. The action bar that
appears offers `Add tag`, `Mark done` and `Delete` — reprocessing and downloads
stay on the document page. Selection applies to what you picked, even after you
change the search or filters, and is cleared when you leave the tab.

Capture uses the phone's own document scanner rather than an in-app camera. See
[Mobile App](./mobile-app.md).

## Next Step

Continue with [Search and AI](./search-and-ai.md) for search, summaries, and AI-assisted answers.

You can also jump back to [Getting Started](./getting-started.md) if you want the broader product orientation.

## The Tax Year

The `Taxes` tab assembles one calendar year the way an accountant thinks:
documents grouped by type, with per-group and overall sums per currency.
Documents without an amount are listed and counted separately, never silently
summed or dropped.

Membership is transparent: a document belongs to the year when it carries the
`tax` tag (applied automatically when the pipeline detects tax content, or by
you) **or** is filed under a tax document type (`Tax Document`, `Tax
Statement`). Each row shows a chip explaining which rule included it — remove
the tag on the document to take it out of the year; the view updates
immediately.

`Export year` downloads the whole year as a ZIP a tax advisor can use without
OpenKeep: one folder per document type, the searchable PDF where one exists
(original bytes otherwise), predictable Windows-safe filenames, and an
`index.csv` listing every member with date, correspondent, type, title,
amount, currency, and status. A document whose file is missing from storage is
reported in the CSV instead of being silently omitted. Exports appear in each
document's audit history.

## Browse by Category

Categories are life domains — Housing, Insurance, Finance, Health, Taxes &
Authorities, Work, and so on — assigned per correspondent, so every document
from a sender inherits its domain. Twelve builtin categories ship with the
archive; you can add your own under `Settings → Tags & taxonomy → Categories`.

A category has one of three sources, with strict precedence:

1. **manual** — you picked it (in the correspondent dossier or taxonomy page).
   Nothing automatic ever overwrites a manual choice.
2. **llm** — the correspondent intelligence suggested it. Suggestions are
   constrained to your current vocabulary; anything outside it is discarded.
3. **deterministic** — derived from the correspondent's dominant document type
   (Utility Bill → Housing, Payslip → Work, Tax Document → Taxes &
   Authorities…). This runs without any AI provider configured, so every
   archive categorizes itself.

In the explorer's Groups view, switch `Grouped by` to `Categories` to see the
archive as life domains, sized by document count with the top correspondents
named inside each block. Correspondents without a category appear in an
honest `Uncategorized` block rather than disappearing. The filter sidebar has
a matching Categories section, and category filters combine with every other
filter and survive in the URL.
