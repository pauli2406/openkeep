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

Go to `Review` to see documents waiting for attention.

For each document, you may see:

- review reason badges
- confidence percentage
- routing or intelligence badges
- a short summary of what OpenKeep inferred

You can also filter the queue by review reason.

## Resolve vs Requeue

Each review item offers two main actions.

### Resolve

Use `Resolve` when the document is acceptable as it is, or after you have checked and corrected it.

### Requeue

Use `Requeue` when you want OpenKeep to process the document again.

This is useful when:

- extraction looks wrong
- the provider choice should change
- the document was updated externally
- you want a fresh processing attempt after a failure

## Correct Metadata on the Document Page

Open a document and use the metadata editor on the right-hand side.

Editable fields include key archive metadata such as:

- title
- correspondent
- document type
- issue date
- due date
- expiry date
- amount and currency
- reference number
- tags

## Manual Overrides

When you change a field and save it, OpenKeep treats that change as a manual override.

This means:

- your correction is preserved
- reprocessing does not overwrite the locked field automatically

You can unlock an overridden field later from the same metadata panel.

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
