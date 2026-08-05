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

Open `Chat` and ask a question.

OpenKeep runs hybrid search, which combines:

- keyword matching
- semantic similarity

Search is answer-first. Instead of only showing a traditional result list, OpenKeep tries to return the most useful archive answer for the question you asked.

This helps with both exact terms and more natural-language questions.

For some questions, OpenKeep also uses structured archive state instead of relying only on free-text retrieval. This is especially important for operational questions about open work, review queues, and deadlines.

## How Search Results Appear

Depending on the question, search can return one of two main answer styles.

### Semantic Answers

For exploratory or knowledge-style questions, OpenKeep returns:

- a generated answer
- linked citations back to source documents
- supporting source cards

This path is best for questions like:

- What does the archive say about a particular supplier?
- Which document mentions a contract end date?
- What amount is mentioned in this letter?

### Structured Answers

For operational questions, OpenKeep may answer directly from structured archive fields such as due date, expiry date, review status, and task completion state.

These answers can show:

- a short summary
- linked item cards
- counts
- totals when applicable
- due dates, expiry dates, review reasons, or action labels

This path is best for questions like:

- Which invoices are still open this month?
- Which documents still need review?
- Which contracts expire soon?

## Ask Your Archive

`Chat` is a conversation, not a one-shot search box. Type a question in the
composer at the bottom and press `Enter`; `Shift+Enter` inserts a newline.

Examples:

- When is the invoice due?
- Which document mentions a contract end date?
- What does the archive say about a particular supplier?
- Which invoices are still open this month?
- Which documents still need review?
- Which contracts expire soon?

When successful, OpenKeep shows:

- a generated answer
- linked citations back to source documents for semantic answers
- structured item cards for operational answers

If the evidence is too weak, OpenKeep may refuse to answer confidently.

### Conversations

Every question you ask joins the conversation open in the left rail. Use
`New conversation` to start a fresh thread, and pick an earlier one from
`Recent` to reread it.

Conversations are stored in your browser, not on the server, so they stay on
the machine you asked them from and are not part of an archive export.

### Citations

Click a citation marker in an answer to open the quoted passage beside it.
From there you can copy the quote or jump straight to that place in the
source document.

Only extracted text is ever sent to the chat provider — never the original
file.

On mobile the same markers open the cited document at the cited page with the
quoted passage highlighted above it. Sources that are not in the device's
offline copy are marked as such while the archive is unreachable. See
[Mobile App](./mobile-app.md).

## How to Judge an AI Answer

Treat AI answers as a convenience layer over your documents, not as the final authority.

Always verify:

- the cited document
- the quoted excerpt
- important dates, amounts, and obligations

For structured answers, verification may mean opening the linked document card and checking the extracted fields that were used for the answer.

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
Each question is answered on its own — ask complete questions rather than referring back
to a previous answer.

### When source excerpts are shown

For long documents OpenKeep selects the passages most relevant to your question and
lists them as source cards you can open.

No source cards appear in two cases, which the answer text itself distinguishes:

- **Short documents** (most letters and invoices): the complete document text is sent to
  the model, so separate excerpts would just repeat it. The answer references pages
  inline, for example "on page 2".
- **Long documents without a usable search index**: only the beginning of the document is
  used. The answer says so explicitly. Treat such answers with care — a fact further back
  in the document may have been missed. Configuring an embedding provider and letting the
  document finish indexing restores full retrieval.

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
- ask operational questions explicitly when you care about current state, for example `still open`, `due this month`, `pending review`, or `expires soon`
- try a narrower query if you get too many results
- use document search and document-level Q&A together
- check citations before acting on an answer

## Next Step

Continue with [Review and Corrections](./review-and-corrections.md) to handle uncertain extraction results and fix metadata safely.

For admin and provider setup topics, continue with [Settings and Admin](./settings-and-admin.md) after that.
