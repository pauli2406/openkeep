---
title: Mobile App
description: How the redesigned OpenKeep mobile app is organised, what each tab does, and what still works without a connection.
---

# Mobile App

The mobile app is a companion to the web app, not a copy of it. It is built for
the three things you do away from a desk: capture a document, clear the review
queue, and look something up.

The screens described here match the redesigned app. Where a name differs from
the web app it is called out.

## Connecting

On first run the app asks for your archive URL and an API token. Create the
token in the web app under `Settings` -> `API tokens`.

If the archive cannot be reached and you have opened documents on this device
before, the connect screen also offers `Open the offline copy`. That row only
appears when there is a signed-in session to restore; after a sign-out or an
expired token you have to connect again, even if cached documents are still on
the device.

## The Five Places

| Where | What it is for |
|---|---|
| Today | What needs attention: due tasks, review count, what arrived |
| Documents | The archive as a dense list with filter chips and search |
| Review | One uncertain document at a time, confirm or skip |
| Chat | Questions about the whole archive, with citations |
| Scan button | Capture or import a new document |

`Chat` is the mobile name for what the web app calls `Search`. It is the same
hybrid and structured search, presented as a conversation.

Settings sits behind the avatar in the `Today` bar rather than in the tab bar.

The scan button floats above the tab bar on `Today` and `Documents`. It is
hidden on `Review`, where confirm and skip are the primary actions, and on
`Chat`, where the message composer occupies that corner.

## Capture a Document

The scan button opens the operating system's own document scanner — the same one
your camera app uses — so edge detection, perspective correction and multi-page
capture behave the way you already expect. The app never shows its own
viewfinder.

After scanning you land on the import draft:

- captured pages as a list, with a thumbnail and size for each
- an optional title; everything else is read off the document
- `Images from files` and `Choose a PDF` for importing instead of scanning
- one primary `Upload` action, pinned to the bottom

Multiple captured pages are combined into a single PDF before upload.

## Work Through Review

Review shows one document at a time rather than a list.

1. The page itself sits at the top; tapping it opens the reader full screen.
2. Below it are only the fields that need confirming, each with the confidence
   the pipeline recorded.
3. `Show in document` jumps the reader to the line the value was read from.
4. `Confirm` accepts the document, `Skip` moves on without changing anything.
   Swiping the card to the left also skips.

After either action a `Back` bar appears for a few seconds. Confirming is not
sent to the server until that window closes, so taking it back is instant and
leaves no trace — no reprocessing is triggered. If the app is closed inside that
window, the confirm is sent the next time you open Review with a connection: what
you saw accepted stays accepted.

When a document is in review for a reason that carries no field evidence — a
failed conversion, empty OCR, an unsupported format — the field list says
`no field evidence` rather than `all clear`, because there is nothing there to
confirm.

Editing values rather than just confirming them happens on the document page,
under `Details`.

## Browse and Act in Bulk

`Documents` is a dense list. The chips above it filter to review, due, this year
and unfiled; the search field searches titles, senders and types.

Long-press any row to enter selection mode. The bar at the bottom then offers:

- `Add tag` — pick one tag to add to everything selected
- `Mark done` — complete the task on each selected document
- `Delete` — with a confirmation step

Selection survives scrolling, searching and filtering: acting applies to what
you picked, not to what the list happens to show. If part of a bulk action
fails, the successful part is applied and the failures stay selected so a retry
touches only those. Selection is cleared when you leave the tab.

### Filter by Category

The chip row ends with a `Category` chip. Tapping it opens a sheet with the
archive's life-domain categories; picking one narrows the list to documents
whose sender belongs to that domain, and the count strip names the active
category. Tap the active chip to clear it.

The chip is online-only: the offline mirror stores documents, not sender
categories, so offline the chip disables and an active category filter is
dropped rather than silently misapplied.


## Read a Document

A document opens on four tabs:

| Tab | Contents |
|---|---|
| Document | Amount, due and issue date, then the page at readable size |
| Details | Every field as a row, with a confidence badge where the value is uncertain, plus tags and file facts |
| Questions | Ask about this document alone |
| History | The recognised text and the audit trail |

Tapping any field row on `Details` opens the edit sheet. Cancelling it discards
the changes. The overflow menu in the bar holds `Reprocess document` — with a
parser choice when more than one is configured — and `Delete document`.

## Ask the Archive

`Chat` keeps the thread of questions and answers. Each answer carries numbered
sources; tapping one opens the cited document at the cited page with the quoted
passage highlighted. Answers based on weak evidence say so.

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

`Settings` -> `Offline` shows what is stored:

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

What works from the local copy: browsing, every filter chip including due and
the current year, sorting by newest or oldest, searching titles, senders
and recognised text, opening a document with its page and text, the correspondent
list, and seeing which documents were pending review. AI answers, uploads, edits,
review actions, reprocessing and deleting all need the archive.

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

- [Getting Started](./getting-started.md) for the web app orientation
- [Review and Corrections](./review-and-corrections.md) for the full review model
- [Search and AI](./search-and-ai.md) for how to judge an answer
- [Mobile Document Cache](../technical/mobile-offline-sync.md) for what the cache stores
