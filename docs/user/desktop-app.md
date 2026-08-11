---
title: Desktop App
description: Connect the OpenKeep desktop app securely to an existing archive.
---

# Desktop App

The desktop app uses the same archives and features as the web app. It can save
multiple named connections to existing OpenKeep servers and opens one archive
at a time. It does not create or set up a new archive.

## Before You Connect

Sign in to the web app, open `Profile` from the avatar menu, and find
`API tokens`. Create a token, optionally set an expiry date, and copy it when
it appears. OpenKeep shows a new token only once.

If Cloudflare Access protects the archive, you also need a Cloudflare Access
service token from the person who operates it. A service token has two values:
a client ID and a client secret. The desktop app requires both values and sends
them with archive requests; browser-based Cloudflare login is not used for this
connection.

## Add an Archive

On the connection screen:

1. Give the connection a name that will identify it in the desktop app.
2. Enter the archive address, such as `https://archive.example.com`.
3. Paste the OpenKeep API token.
4. If required, expand `Cloudflare Access` and enter both service-token values.
5. Select `Connect archive`.

The app normalizes the address, checks `/api/health`, and then uses
`/api/auth/me` to verify the token. It saves the profile only after both checks
succeed.

Use HTTPS for an archive reached over a network. Plain HTTP is allowed without
an extra prompt for loopback development addresses such as `localhost` and
`127.0.0.1`. For any other HTTP address, the app explains that the token could
be read in transit and requires a second, explicit confirmation before it
connects.

After the first connection, use the active archive control in the authenticated
shell and select `Add another archive` to save another profile. Profile names
and server addresses do not have to be unique. The app keeps each connection
separate with an internal ID, so two profiles called `Home` or two profiles for
the same server remain independent saved connections.

## Open and Switch Archives

The active archive control is always available while the shared archive UI is
open. It shows the current profile name. Open it and select another profile to
switch archives without signing out or restarting the app.

Switching replaces the authenticated archive window and cancels work that still
belongs to the previous profile. The destination archive opens with its own
browser state rather than inheriting searches, conversations, uploads, previews,
or cached responses from the archive you left.

The authenticated desktop window is the same archive experience as the web app:
Today, Documents (list, timeline, and groups), correspondent dossiers, filters,
selection and bulk actions, and the omnibar all use the shared implementation.
Press `Cmd+K` on macOS or `Ctrl+K` on Windows and Linux to open the omnibar.
The shortcut shown in the app follows the current operating system.

Normal internal links, Back, Forward, reload, and document deep links stay in the
hardened OpenKeep window. When you return to a profile during the same desktop
session, the app restores that profile's last safe OpenKeep route, including its
filters, without applying the route to another profile. HTTPS and email links open
in the operating system's default app. Other external URL schemes are refused.

At startup:

- if exactly one profile is saved, the app reconnects it automatically
- if several profiles are saved, the app restores the last active profile when
  it is still valid
- if no valid profile can be restored, the app opens the archive chooser so you
  can select, reconnect, edit, or add a profile

## Browse the Archive

Once connected, desktop uses the same authenticated archive interface as the web
app rather than a separate desktop copy:

- **Today** shows live archive statistics, work needing attention, previews, and
  recently added documents.
- **Documents** keeps the list, timeline, and grouped views together with the
  existing facets, filters, selection, and bulk actions.
- **Correspondent dossiers** show the correspondent's insights, document timeline,
  and linked records.
- The **omnibar** opens from the search control or with `Command+K` on macOS and
  `Ctrl+K` on Windows and Linux, then navigates to the same archive results as web.

Back and forward navigation, deep document and correspondent links, theme, and the
English/German interface behave the same way in both clients. Loading, empty,
processing, unauthorized, and temporarily unavailable states still depend on the
active server. Desktop does not substitute stale content from another profile or
an offline cache when a request fails.

Switching profiles creates a fresh shared-app instance in that profile's isolated
window. Rows, filters, previews, selections, and query results from the previous
archive therefore cannot remain visible in the destination archive.

## Close, Reopen, and Quit

OpenKeep keeps running in the system tray by default. Closing the main window hides
it; it does not stop the desktop process. Use the tray menu to show or hide the
window, see and switch the active archive, start a native file import, or choose
`Quit OpenKeep`. Files, credentials, server addresses, and document details are not
shown in the tray menu.

The small desktop-behavior control beside the active archive control changes what
happens when the window closes:

- **Keep OpenKeep running** hides the window and lets imports and future background
  work continue.
- **Quit OpenKeep** stops imports and background work, closes active archive
  connections, and exits the process whenever the window is closed. OpenKeep shows
  this consequence for confirmation before saving the change.

The preference is global rather than tied to one archive. Explicit `Quit OpenKeep`
always exits, regardless of the preference. OpenKeep remembers the last valid window
size and position, active archive, and that archive's safe route. If a monitor has
been disconnected or its usable area changed, the next window is centered on the
current primary display instead of being restored off-screen.

On macOS the tray icon lives in the menu bar. On Windows it lives in the notification
area; double-clicking its icon reveals a hidden window. Supported Linux desktops use
their system tray. If Linux cannot provide a usable tray, close-to-tray is disabled
and closing the window quits, so OpenKeep cannot become an invisible stranded
process. Starting OpenKeep again, opening a supported file with OpenKeep, or a second
launch always reveals and focuses the existing hidden window. If the window itself
ever disappears while OpenKeep keeps running, `Show OpenKeep` opens a new one for the
active archive rather than doing nothing. Launch at login is not configured by this
preference.

## Import Documents

Desktop accepts PDF, JPEG (`.jpg` and `.jpeg`), PNG, TIFF (`.tif` and `.tiff`),
and HEIC documents through three entry points:

1. Open `Import` and drag one or more files onto the drop zone.
2. Select the drop zone to open the operating system's native file picker.
3. In Finder, File Explorer, or a Linux file manager, choose `Open with` and
   select OpenKeep. This also starts OpenKeep when it is closed.

All three routes feed the same visible queue. Every file progresses through
`Upload`, `OCR`, `Extract`, and `Embed`; completed duplicates are identified,
temporary failures can be retried, and terminal failures stay visible with their
message. OpenKeep reads source files but never rewrites, moves, or deletes them.

When exactly one valid archive profile exists, files opened with OpenKeep go to
that archive automatically. With several profiles, OpenKeep asks which archive
should receive the incoming batch before it reads the complete files or starts an
upload. Selecting another profile switches into that profile's isolated window and
then opens its Import queue.

Desktop rejects missing, inaccessible, disguised, unsupported, and larger-than-
64-MiB files before upload. A server can set a lower `MAX_UPLOAD_BYTES`, in which
case its limit appears as an ordinary per-file upload failure. The desktop safety
limit does not grant the shared web interface access to file paths or arbitrary
files.

## Review and Manage Documents

Desktop uses the complete web review queue and document page. In `Review`, you can
filter by review reason, inspect the source preview, correct extracted fields, resolve
one item, requeue it, or confirm an eligible confidence-only batch. Resolving an item
moves the queue to the next document; an unsuccessful save or review action remains
visible as an error and does not silently advance the queue.

The document page exposes the same preview, OCR text, generated intelligence, audit
history, archive metadata, taxonomy values, and manual overrides as web. You can
create a missing correspondent or tag while editing, save corrections, unlock an
override, resolve or requeue review, and reprocess the document. Reprocessing and
deleting require confirmation. Cancelling a delete leaves the remote document
untouched.

Successful changes refresh the queue, document lists, dashboard counts, detail data,
history, and affected taxonomy displays. Switching profiles or closing the window
cancels requests from the old archive and discards temporary previews, so a late
response cannot appear in the next archive. For the complete correction workflow,
see [Review and Corrections](./review-and-corrections.md).

## Search and AI

Desktop uses the same `Chat`, hybrid search, structured operational answers,
citations, generated document summaries, and document Q&A as the web app. Answers
and summaries appear while they are being generated; the app does not wait for the
complete response before showing text.

Starting a replacement question cancels the previous request. Closing the window or
switching profiles also stops any active answer, summary, or document-Q&A stream from
the archive you left. A late chunk cannot be added to the destination profile.

Citation markers and source cards keep the source document ID and cited page. Opening
one uses the active profile's connection and takes the document preview to that page.
If credentials expire, the server or provider is unavailable, or a stream ends in an
invalid state, desktop shows an error rather than saving a partial response as a
completed answer.

Conversations and recent searches live in the active profile's isolated desktop
browser storage. They return when you reopen that profile, never appear in another
profile, and are deleted with the local profile state when you remove it. Server-side
document Q&A history remains data of the remote archive.

## Administer the Active Archive

Desktop opens the same `Profile` and `Settings` routes as the web app. From the
active archive you can:

- view the owner identity and archive statistics, change UI and AI language
  preferences, enroll or disable two-factor authentication, and create or revoke
  API tokens
- create, rename, merge, and delete tags, correspondents, and document types
- inspect the server-selected parse, embedding, and chat providers, queue activity,
  recent processing jobs, readiness, and system health
- inspect the archive server's watch-folder configuration, trigger dry-run or live
  scans, export a snapshot through the operating-system save dialog, and paste a
  snapshot for merge or replacement import

The desktop connection profile and the API tokens listed inside `Profile` are
different things. The connection profile is local metadata plus one encrypted
Bearer token used by the desktop runtime. The token list is remote archive data.
Revoking a different token does not alter the saved desktop profile. Revoking the
token currently used by that profile succeeds on the server, then disconnects that
profile when its next request is rejected; reconnect it with a replacement token.

Desktop never exposes the connection token to these shared pages and never opens the
web login or first-owner setup flow. Account-security operations are authorized by
the connected owner's API token. Disabling two-factor authentication still requires
the owner's password and a current authenticator or recovery code.

All settings forms, queries, pending mutations, and error messages are discarded on
a profile switch. Server-side changes already accepted by the archive remain there,
but an unfinished form or late response from the archive you left cannot appear in
the destination profile.

The watch folder shown in General settings belongs to the remote archive server. It
is not a folder on the desktop computer, and it is separate from the desktop watch
folders described above.

## Notifications

OpenKeep can tell you when background work finishes, so you do not have to keep the
window open and watch it. There are three kinds, and each can be turned on or off
separately in the desktop-behavior panel beside the archive switcher:

- **Finished imports** — a document has been processed and filed.
- **Documents needing review** — a document was filed but wants your confirmation.
- **Failed imports** — a document could not be processed.

All three are on by default and cover every import route equally: drag and drop, the
file picker, `Open with OpenKeep`, and watch folders.

Clicking a notification brings OpenKeep forward and opens the document it is about. A
notification for several documents at once opens the review queue or the document
list, since there is no single document to open. If the notification belongs to an
archive you are not currently in, OpenKeep asks before switching, because switching
archives closes the current archive window along with anything unfinished in it. If
you click a notification while OpenKeep is still starting, it waits until that archive
has connected and then opens the document.

Each result is announced once. Closing the window, switching archives, quitting, or
restarting mid-processing does not produce a repeat announcement, and a document that
was still processing when you quit is picked up again the next time that archive is
connected. A document deleted before it finished is never announced.

Notifications contain a file name and a count. They never contain document text, an
archive address, or any credential.

Your operating system decides whether a notification is actually shown. OpenKeep does
not ask for permission repeatedly and has no separate do-not-disturb setting:

- **macOS** — allow or silence OpenKeep under `System Settings → Notifications`. Focus
  modes and do-not-disturb apply as usual.
- **Windows** — `Settings → System → Notifications`, then find OpenKeep in the list.
  Focus assist applies as usual.
- **Linux** — notifications need a notification service from your desktop
  environment. Where none is available, the panel says so and import results stay
  visible in the app instead.

## Watch Folders on This Computer

A watch folder is a folder on your own computer that OpenKeep imports new documents
from while it is running. Open the folder control beside the archive switcher to add,
pause, resume, inspect, or stop watching one. Each archive profile has its own
folders, and adding one always goes through the operating system's folder picker.

New PDF, JPEG, PNG, TIFF, and HEIC files are imported into the active archive through
the same upload path as a manual import. OpenKeep never deletes, moves, renames, or
edits anything in a watched folder — importing only reads the file.

A file is imported once it has finished being written: OpenKeep waits until its size
and modification time stop changing, so a large scan still being copied or downloaded
is not imported half-finished. Partial-download files (`.part`, `.crdownload`,
`.tmp`), editor backups, hidden files, subfolders, and unsupported file types are
skipped. An unsupported file is reported once in the folder's history so you can see
why it stayed behind.

Each folder shows how many files were imported, how many were already filed, and how
many failed, plus a recent per-file history you can open. `Already filed` means the
archive already holds those exact contents — renaming or copying a document you
already imported does not create a second one. A file that genuinely changed is
imported again as a new version of your record.

Watch folders keep running while the main window is hidden in the tray. They stop
when OpenKeep quits, because they are part of the desktop app rather than the server.
They also pause whenever their archive is not connected, and continue after you
reconnect or restart — nothing is imported twice as a result. Import checkpoints are
stored on this computer, so a restart in the middle of a copy costs at most one extra
check.

If a folder is deleted, renamed, on a removable drive that was ejected, or no longer
readable, that folder is marked in the panel and the others keep working. It resumes
by itself when the folder is available again. A file the archive rejects for good —
the wrong format, or larger than 64 MiB — is reported as failed and not retried until
its contents change; a temporary problem such as an unreachable server is retried
automatically.

The folder paths you choose stay on this computer. They are used only to read the
files you selected and are never sent to the archive.

The watch folder in the archive's own `Settings` is a different feature: it is a
folder on the server, configured by the archive, and it works whether or not the
desktop app is running. Desktop watch folders belong to this workstation.

## Save Documents and Archive Exports

Desktop uses the operating system's save dialog instead of the browser download
shelf for files that should remain on your computer:

- `Download original` saves the exact uploaded document.
- `Download searchable PDF` saves the derived PDF when the archive provides one.
- `Export archive` in Profile and `Export snapshot` in Settings save the current
  archive JSON snapshot.

The dialog starts with a filename suggested by the archive and the matching file
extension. OpenKeep removes path separators, invalid characters, and reserved
Windows device names before showing that suggestion. You can still choose another
name and folder. If the destination already exists, the operating system asks
whether to replace it.

Selecting `Cancel` makes no file and is not treated as an error. If the archive,
destination, or permissions fail, the page reports that the file was not saved.
OpenKeep writes to a temporary file in the selected folder and publishes it only
after the complete response has been written, so an interrupted download is not
presented as a finished file.

Credentials and file bytes stay out of the web renderer during a desktop save. The
trusted desktop process downloads the response and streams it directly to disk.
The web app keeps its existing browser-native download behavior; in Settings, web
also continues to place an exported snapshot in the JSON editor for manual copying
or import.

## Manage a Saved Profile

Open the active archive control to manage profiles:

- **Rename:** select `Edit`, change the profile name, and save. Renaming keeps
  that profile's credentials and local state.
- **Edit the connection:** select `Edit` to change the server address, API token,
  or Cloudflare Access values. Changing the server address clears that profile's
  old local browser state before the new address is used.
- **Reconnect:** select the unavailable profile and use `Retry connection`. The
  app keeps its encrypted credentials after a temporary network or server error,
  so they do not need to be pasted again.
- **Remove:** select `Remove`, review the named profile and address, then confirm
  `Remove saved archive`. This deletes only the saved credentials and local
  profile state. The remote OpenKeep server, its account, and every document in
  the remote archive remain untouched.

If an archive is reachable but rejects its saved OpenKeep or Cloudflare Access
credentials, the app deletes only that failing profile's saved credentials and
returns to the chooser. Other profiles and their credentials remain available.
Create a replacement API token in the affected archive's web app, then add or
edit that profile.

## What Is Separate for Each Archive

Each saved profile has a stable internal ID. OpenKeep uses it as the isolation
boundary even when two profiles have the same name or server address.

| Profile-specific | Global |
| --- | --- |
| OpenKeep and Cloudflare Access credentials | Close behavior and last valid window bounds |
| Chromium local storage and network cache | App-wide runtime behavior, where the desktop app exposes such a setting |
| Query state, conversations, and recent searches | The installed desktop app and its version |
| In-progress upload state, assigned Open-with batches, and active response streams |  |
| Temporary preview/object URLs |  |
| Watch folders and their import checkpoints |  |
| Pending imports still waiting for their outcome | Notification preferences |

Server-side account preferences naturally belong to the server and user behind
the active profile. App-level runtime preferences remain global where applicable.
Removing one profile never clears another profile's local state.

## Connection Problems

If the server is temporarily unreachable, choose `Retry connection` or
`Edit connection`. Retry keeps the stored credentials encrypted; you do not
have to paste them again. With multiple profiles, you can also return to the
chooser and open another archive while the unavailable one remains saved.

If the server becomes unreachable or rejects the token while the shared archive
UI is already open, the desktop transport returns to this reconnect/chooser state
instead of leaving stale rows or previews on screen. A retry verifies the saved
profile again before the archive UI is remounted.

## Credential Security

The app encrypts every profile's API token and optional Cloudflare secret with
the operating system's credential facility. Raw credentials stay in the trusted
desktop process and are not exposed to the shared web interface. Each encrypted
record is associated with the profile's stable internal ID.

On Linux, an unlocked Secret Service/libsecret or KWallet keyring must be
available. OpenKeep refuses to save credentials when Electron can provide only
its insecure `basic_text` fallback. Install or unlock a supported keyring, then
restart the app and connect again.

## No Offline Archive

The desktop app has no offline archive or document cache. Its profile-specific
Chromium cache is an isolation mechanism, not an offline copy. The app needs a live
connection for browsing, search, previews, imports, downloads, and changes. If
you need read-only access to documents previously opened on a device, that is a
separate capability of the [mobile app](./mobile-app.md), not the desktop app.

## Related Documents

- [Getting Started](./getting-started.md) for the shared archive UI
- [Search and AI](./search-and-ai.md) for search, summaries, Q&A, and citations
- [Settings and Admin](./settings-and-admin.md) for creating and revoking API tokens
- [Desktop Application](../technical/desktop-application.md) for the security and network architecture
