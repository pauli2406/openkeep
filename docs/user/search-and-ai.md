---
title: Search and AI
description: Use hybrid search, archive-wide AI answers, and document-level summaries and Q&A.
---

# Search and AI

OpenKeep includes two related capabilities:

- archive search
- AI-assisted summaries and answers

They work together, but they are not the same thing.

For the broader archive workflow, see [Core Workflows](./core-workflows.md).

## Search Basics

Open the `Search` page and enter a query.

OpenKeep runs hybrid search, which combines:

- keyword matching
- semantic similarity

This helps with both exact terms and more natural-language questions.

## Reading Search Results

Each search result may show:

- title
- correspondent
- date
- document type
- ranking score
- matched excerpts

Open matched excerpts to see the chunks that contributed to the result.

## AI Answer for Archive-Wide Questions

On the Search page, expand `AI Answer` to ask your archive a question.

Examples:

- When is the invoice due?
- Which document mentions a contract end date?
- What does the archive say about a particular supplier?

When successful, OpenKeep shows:

- a generated answer
- linked citations back to source documents
- supporting source cards

If the evidence is too weak, OpenKeep may refuse to answer confidently.

## How to Judge an AI Answer

Treat AI answers as a convenience layer over your documents, not as the final authority.

Always verify:

- the cited document
- the quoted excerpt
- important dates, amounts, and obligations

This is especially important for invoices, contracts, tax documents, and legal records.

## Document Summary

Each document detail page includes an AI summary section.

OpenKeep tries to generate a concise explanation of what the document is about.

You can:

- let it generate automatically
- regenerate it manually
- see provider and model information when available

## Ask Questions About a Single Document

Each document detail page also includes a Q&A section.

Use it to ask focused questions about one document, for example:

- What is the due date?
- What amount is listed?
- Who is the issuer?
- What obligations are described in this contract?

OpenKeep streams the answer and stores a persisted Q&A history for that document.

## Clearing Q&A History

The Q&A section includes `Clear history`.

Use this when you want to remove earlier question-and-answer entries for that document.

## Intelligence Tab on a Document

The `Intelligence` tab shows how OpenKeep interpreted the document.

Depending on the document, it may include:

- routing result and confidence
- generated summary
- extracted type-specific fields
- field confidence
- provenance snippets
- tagging and correspondent resolution
- validation warnings or errors
- pipeline metadata

This is most useful when you want to understand why a document was classified or flagged a certain way.

## When AI Features May Be Limited

AI-generated summaries and answers depend on configured providers and on document quality.

You may see limited or missing AI output when:

- no chat provider is configured
- OCR quality is poor
- the document has very little usable text
- the archive does not contain enough evidence for the question

## Good Search Habits

- start with plain-language questions
- try a narrower query if you get too many results
- use document search and document-level Q&A together
- check citations before acting on an answer

## Next Step

Continue with [Review and Corrections](./review-and-corrections.md) to handle uncertain extraction results and fix metadata safely.

For admin and provider setup topics, continue with [Settings and Admin](./settings-and-admin.md) after that.
