---
title: FAQ
description: Quick answers to common OpenKeep user questions and edge cases.
---

# FAQ

## Why is my document still processing?

Possible reasons:

- the processing queue is busy
- OCR is taking longer on a large or poor-quality file
- an external provider is slow

Check `Settings` -> `Processing Activity`.

## Why did a document enter the review queue?

Usually because OpenKeep was unsure about important metadata or validation found issues.

Open `Review` and inspect the reason badges, then open the document detail page for more context.

## What is the difference between processing status and review status?

- processing status tells you whether the document has been parsed successfully
- review status tells you whether a human still needs to inspect it

## Why is the AI answer missing or refusing to answer?

Common reasons:

- there is not enough evidence in the archive
- no AI chat provider is configured
- OCR quality is weak
- the question is too broad

Try a narrower question, inspect citations when they are present, or open the linked structured items when the answer is based on archive state.

## Why is the searchable PDF missing?

Not every document produces a searchable PDF artifact. Availability depends on the source file and processing outcome.

If it is missing, you can still download the original file.

## Will reprocessing overwrite my manual corrections?

Not if the fields are saved as manual overrides.

Locked fields remain sticky across reprocessing until you unlock them.

## When should I use reprocess instead of resolve?

Use `Resolve` when the current result is acceptable.

Use `Reprocess` when OCR or metadata extraction itself needs another pass.

## Can I clean up duplicate tags, correspondents, or document types?

Yes. Use `Settings` -> `Taxonomy Management` to edit, merge, or delete taxonomy entries.

## Can I ask questions about just one document?

Yes. Open the document detail page and use the Q&A section near the bottom.

## Can I browse the archive visually instead of only as a list?

Yes. The Documents area supports:

- list view
- timeline view
- galaxy view

## What is the intelligence tab for?

It explains how OpenKeep interpreted the document, including extracted fields, confidence, provenance, warnings, and pipeline information.

Use it when something looks wrong or when you want to understand why a review flag was raised.

## How do I prepare for backup or migration work?

Use `Settings` -> `Archive Portability` and export a snapshot before major changes.

## Where will technical and operational documentation live?

They now live under:

- `docs/technical/`
- `docs/operations/`

Use [the documentation hub](../README.md) as the central index.
