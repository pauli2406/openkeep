---
title: Mobile App
description: How the OpenKeep mobile app is organised, what it adds to the web app, and what still works without a connection.
---

# Mobile App

The mobile app looks and works like the web app at phone width: the same screens,
the same features and the same blue-and-white design. On top of that it adds what only
a phone can do: the document scanner, swipe gestures and an encrypted offline copy.

Where this page does not describe a screen in detail, the
[Core Workflows](./core-workflows.md) and [Settings and Admin](./settings-and-admin.md)
guides for the web app apply.

## Connecting

On first run the app asks for your archive URL, then your email and password. If two-factor
authentication is on, it asks for the code next, and a recovery code works there too.

You can sign in with an API token instead. Create one under `Profile` -> `API tokens`. If
your archive sits behind Cloudflare Access, the connect screen also takes its service token.

A new archive has no owner yet. Choose `Need to set up?` to create the owner and walk through
the same setup as on the web.

If the archive cannot be reached and you have opened documents on this device
before, the connect screen also offers `Open the offline copy`. That row only
appears when there is a signed-in session to restore; after a sign-out or an
expired token you have to connect again, even if cached documents are still on
the device.

## Getting Around

The button at the top left opens the menu, with the same destinations as the web app's
sidebar:

| Where | What it is for |
|---|---|
| Today | The queue of open deadlines, filtered by the tiles above it |
| Documents | The archive as a list, timeline or groups, with filters and bulk actions |
| Review | One uncertain document at a time |
| Taxes | One calendar year, assembled the way an accountant thinks |
| Chat | Questions about the whole archive, with citations |
| Settings | Language, appearance, taxonomy, AI providers, system health, archive |
| Profile | Your name at the bottom of the menu: two-factor, API tokens, export, sign out |

The header stays on every one of them. Its search field opens the omnibar, which works as on
the web. The sun or moon switches the theme, and the blue button opens import.

Swipe a task on `Today` to the left to complete it. Completing a task also resolves its review.

## Capture a Document

The import screen offers `Scan` and `Choose files`. `Scan` opens the operating system's own
document scanner, so edge detection, perspective correction and multi-page capture behave the
way you already expect.

Scanned pages become one PDF. Below them sits an optional title; everything else is read off
the document. One chosen file waits on this draft as well, while several files upload straight
away.

Each upload gets its own row showing how far it has come: upload, OCR, extraction, embedding.
A failed row can be retried. A file already in the archive is flagged as a duplicate, with
`Open original` next to it.

## Work Through Review

Review shows one document at a time rather than a list.

1. The strip at the top shows your place in the queue. Its chips narrow the queue to one
   reason, and `Queue` lists everything waiting.
2. The page itself comes next; tapping it opens the reader full screen.
3. Below it are the fields, each with the confidence the pipeline recorded. Correct a value
   right there.
4. `Show in document` jumps the reader to the line the value was read from.
5. `Confirm and file` saves your corrections and accepts the document. `Skip` moves on without
   changing anything, and swiping the card to the left also skips. `Reprocess` runs the document
   through the pipeline again.

After either action a `Back` bar appears for a few seconds. Confirming is not
sent to the server until that window closes, so taking it back is instant and
leaves no trace — no reprocessing is triggered. If the app is closed inside that
window, the confirm is sent the next time you open Review with a connection: what
you saw accepted stays accepted.

When a document is in review for a reason that carries no field evidence — a
failed conversion, empty OCR, an unsupported format — the field list says
`no field evidence` rather than `all clear`, because there is nothing there to
confirm.

The queue also offers bulk confirm for documents held back only by low confidence, as on the
web.

## Browse and Act in Bulk

`Documents` switches between `List`, `Timeline` and `Groups`. The filter button opens a sheet
with status, year, type, correspondent, category, tag, date range and amount range, each with its
count; active filters appear as chips you can remove. The sort button orders by title, issue date,
date added or due date.

Long-press any row to enter selection mode. `Select all` takes the whole list, and the bar
at the bottom then offers:

- `Tag` — add or remove one tag on everything selected
- `Type` — set one document type
- `Export` — share the files
- `Reprocess` — run them through the pipeline again
- `Mark done` — complete the task on each selected document
- `Delete` — with a confirmation step

Selection survives scrolling, searching and filtering: acting applies to what
you picked, not to what the list happens to show. If part of a bulk action
fails, the successful part is applied and the failures stay selected so a retry
touches only those. Selection is cleared when you leave the tab.

`Timeline`, `Groups` and the category filter are online-only: the offline copy stores documents,
not sender categories.

## Read a Document

The page sits at the top with page and zoom controls, and below it are the same tabs as on the web:

| Tab | Contents |
|---|---|
| Fields | Every field, editable in place, with confidence and locks; tags, the review reason, processing facts, raw metadata and email provenance |
| Intelligence | The AI summary and everything the pipeline extracted |
| Q&A | Ask about this document alone; a citation jumps to its page |
| OCR Text | The recognised text |
| History | The audit trail |

Fields you change turn amber, and `Save` appears at the bottom. Saving locks those fields against
reprocessing, and the lock next to a field releases it again. The header holds the document's main
action, and its `⋯` menu holds both downloads, requeue, reprocess and delete.

## Ask the Archive

`Chat` looks like the web's. Each answer carries numbered sources; tapping one shows the quoted
passage, and `Find in document` opens the page with that passage highlighted. Answers based on weak
evidence say so.

Conversations are saved on the device, up to twenty per account, and the history button reopens them.
They are stored unencrypted, unlike the offline copy.

A new question is refused while the previous answer is still streaming, so no
question is left without an answer.

## Offline

The mobile app does not mirror the archive. It keeps a copy of each document you
open while connected, and falls back to those copies when the archive cannot be
reached. There is nothing to switch on, no download-over-Wi-Fi setting and no
retention setting.

The copy is encrypted on the device with a key held in the system keychain, so
what is stored — titles, amounts, recognised text and the files themselves — is
not readable from a backup or by another app. While you have a document open, a
readable copy of that one file exists in temporary storage so the viewer can show
it; it is removed when you close the document. If the device has no working
keychain, the app keeps no offline copy at all rather than storing one in the
clear.

The copy belongs to the account and the archive it came from. Signing in as
someone else, or pointing the app at another archive, never shows you the
previous copy.

`Settings` -> `Available offline` shows what is stored:

- how many documents are cached and how much file storage they use
- when a document was last written to the copy — a time today, a date before that
- what is kept per document: metadata, the original file, recognised text, history
- a storage limit for the copy, and what it is using of it
- `Delete the offline copy`, which removes the local copy and never touches the
  server

When the copy passes its limit, the documents you opened longest ago are removed
first — opening one again offline counts as opening it, so what you actually read
stays. Removed documents come back the next time you open them with a
connection.

If a stored document ever turns out to be unreadable, the app removes it from the
copy and says so on that screen rather than failing to open the list; it comes
back the next time you open the document online. A document deleted from the
archive leaves the copy the next time you open it.

What works from the local copy: browsing, the filters except category, sorting, searching titles,
senders and recognised text, opening a document with its page and text, the correspondent
list, and seeing which documents were pending review. AI answers, uploads, edits,
review actions, reprocessing, deleting, taxes and everything under `Settings` that reads the server
need the archive.

When you opened the local copy from the connect screen, the app keeps checking
whether the archive is back — every half minute, and straight away when the
device regains a connection — and switches to live data by itself. `Try to
reconnect` on that screen asks immediately. You no longer have to restart the app
to get back online.

Offline sessions are read-only throughout. A screen that has mutating actions
shows an `Offline — read-only` strip and disables them, including the overflow
actions on a document.

## Appearance

`Settings` -> `Appearance` offers light, dark and system. The choice is applied
immediately and remembered. Density adjusts row heights for smaller screens.

## Related Documents

- [Getting Started](./getting-started.md) for an orientation that applies here too
- [Review and Corrections](./review-and-corrections.md) for the full review model
- [Search and AI](./search-and-ai.md) for how to judge an answer
- [Mobile Document Cache](../technical/mobile-offline-sync.md) for what the cache stores
