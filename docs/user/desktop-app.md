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
| OpenKeep and Cloudflare Access credentials | Desktop runtime settings that are not owned by an archive |
| Chromium local storage and network cache | App-wide runtime behavior, where the desktop app exposes such a setting |
| Query state, conversations, and recent searches | The installed desktop app and its version |
| In-progress upload state and active response streams |  |
| Temporary preview/object URLs |  |
| Future watch-folder, notification, and other background work |  |

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
connection for browsing, search, previews, uploads, downloads, and changes. If
you need read-only access to documents previously opened on a device, that is a
separate capability of the [mobile app](./mobile-app.md), not the desktop app.

## Related Documents

- [Getting Started](./getting-started.md) for the shared archive UI
- [Settings and Admin](./settings-and-admin.md) for creating and revoking API tokens
- [Desktop Application](../technical/desktop-application.md) for the security and network architecture
