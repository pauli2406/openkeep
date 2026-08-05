---
title: Review and Corrections
description: Resolve review items, apply manual overrides, and safely correct extracted metadata.
---

# Review and Corrections

OpenKeep tries to extract metadata automatically, but some documents still need manual review.

This guide explains how to work with those cases.

For search and AI behavior before a document reaches review, see [Search and AI](./search-and-ai.md).

## Why Documents Enter Review

Documents are added to the Review queue when OpenKeep is not confident enough about important information.

Typical reasons include:

- low extraction confidence
- ambiguous classification
- unresolved correspondent
- missing expected fields
- validation warnings

## Open the Review Queue

Go to `Review`. The screen shows one document at a time: the queue on the
left, the fields to confirm in the middle, and a preview on the right.

The queue lists every document waiting for attention, with its confidence and
review reasons. Chips at the top of the screen filter it by reason.

## Confirm One Document

The middle column lists the fields that matter, with the uncertain ones
highlighted in amber and annotated with why they need a look — `not found`,
`low confidence`, or `confident`.

Correct anything that is wrong, then choose:

- `Confirm and file` — saves your corrections, resolves the review, and moves
  to the next document
- `Reprocess` — sends the document back through processing, for when
  extraction looks wrong or you changed the provider
- `Skip` — moves on without deciding

## On Mobile

The phone app presents the same queue one document at a time: the page above,
only the fields that need confirming below it, and `Confirm` and `Skip` pinned
at the bottom. Swiping the card away also skips.

Either action can be taken back from the `Back` bar that appears for a few
seconds afterwards. A confirmation is not sent until that window closes, so
undoing it changes nothing on the server and starts no reprocessing.

`Show in document` opens the page at the line a value was read from. Editing
values rather than confirming them happens on the document page under
`Details`. See [Mobile App](./mobile-app.md).

## Keyboard

The queue is built to be worked through without the mouse:

| Key | Action |
| --- | --- |
| `Enter` | confirm and file |
| `j` / `k` | next / previous document |
| `e` | jump to the first field needing attention |
| `s` | skip |

`Enter` only confirms when no button or menu has focus, so activating a
control never files a document by accident.

## Confirm a Batch

When several documents are above a confidence threshold, a
`Confirm N above X%` button appears. Choose the threshold next to it.

Batch confirmation only ever includes documents whose review reasons are
about confidence — low confidence, ambiguous classification, or an unresolved
correspondent. A document flagged for a concrete defect, such as missing
fields, an unsupported format, or a processing or validation failure, is
never confirmed in bulk, however high its score.

## Correct Metadata on the Document Page

Open a document and use the fields rail on the right-hand side.

There is no separate edit mode. Click a value to edit it in place, and press
`Enter` to commit. Changed fields turn amber, and a save bar appears at the
bottom of the rail with `Save` and `Discard`.

Editable fields include key archive metadata such as:

- title
- correspondent
- document type
- issue date
- due date
- amount and currency
- reference number
- tags

Expiry date, holder name and issuing authority sit behind `More fields`.

If the correspondent you need does not exist yet, type its name in the
correspondent field and pick the dashed `+ <name>` entry to create it without
leaving the document. Tags work the same way.

## Manual Overrides

When you change a field and save it, OpenKeep treats that change as a manual override.

This means:

- your correction is preserved
- reprocessing does not overwrite the locked field automatically

Before you save, the save bar tells you which fields the save will lock.

The rail shows how many fields are currently locked, and every locked field
carries its own `Unlock` button. Unlocking a field lets the next reprocess
overwrite it again.

## When to Use Manual Overrides

Use manual overrides for fields that must stay stable, such as:

- due dates
- amounts
- correspondents
- document type
- reference numbers

## Intelligence Tab for Troubleshooting

If you are unsure why OpenKeep made a decision, check the `Intelligence` tab.

Look at:

- routing confidence
- extracted fields
- provenance snippets
- validation warnings
- duplicate signals

This helps explain where the information came from and where it may have gone wrong.

## Document History

Use the `History` tab to see the audit trail for a document.

This is useful when you want to understand:

- when a document was uploaded
- when it was reprocessed
- who made changes
- what payload changed during a key event

## Reprocessing With a Specific OCR Provider

From the document detail page, `Reprocess Document` may let you choose a provider when multiple parse providers are available.

Use this carefully if you are comparing OCR quality across providers.

## Practical Review Routine

A good review routine is:

1. open the queue
2. inspect the badges and summary
3. open the document detail page
4. verify preview, OCR text, and intelligence output
5. fix critical fields
6. resolve the review item, or requeue if the extraction must be rerun

## Next Step

Continue with [Settings and Admin](./settings-and-admin.md) for system administration features and archive maintenance tools.

For quick answers to common edge cases, see [FAQ](./faq.md).
