---
title: Desktop App
description: Connect the OpenKeep desktop app securely to an existing archive.
---

# Desktop App

The desktop app uses the same archive and features as the web app. It connects
to one existing OpenKeep server with an API token; it does not create or set up
a new archive.

## Before You Connect

Sign in to the web app, open `Profile` from the avatar menu, and find
`API tokens`. Create a token, optionally set an expiry date, and copy it when
it appears. OpenKeep shows a new token only once.

If Cloudflare Access protects the archive, you also need a Cloudflare Access
service token from the person who operates it. A service token has two values:
a client ID and a client secret. The desktop app requires both values and sends
them with archive requests; browser-based Cloudflare login is not used for this
connection.

## Connect an Archive

On the connection screen:

1. Enter the archive address, such as `https://archive.example.com`.
2. Paste the OpenKeep API token.
3. If required, expand `Cloudflare Access` and enter both service-token values.
4. Select `Connect archive`.

The app normalizes the address, checks `/api/health`, and then uses
`/api/auth/me` to verify the token. It saves the profile only after both checks
succeed.

Use HTTPS for an archive reached over a network. Plain HTTP is allowed without
an extra prompt for loopback development addresses such as `localhost` and
`127.0.0.1`. For any other HTTP address, the app explains that the token could
be read in transit and requires a second, explicit confirmation before it
connects.

## Stored Connection

The desktop app restores its single saved archive automatically when it starts.
It verifies the server and token again before opening the shared archive UI.

If the server is temporarily unreachable, choose `Retry connection` or
`Edit connection`. Retry keeps the stored credentials encrypted; you do not
have to paste them again. If the server responds and rejects the saved token or
Cloudflare credentials, the app removes them and returns to the connection
screen. Create a replacement API token in the web app if necessary.

Selecting `Sign out` removes the saved profile and credentials and clears the
authenticated desktop UI.

## Credential Security

The app encrypts the API token and optional Cloudflare secret with the operating
system's credential facility. Raw credentials stay in the trusted desktop
process and are not exposed to the shared web interface.

On Linux, an unlocked Secret Service/libsecret or KWallet keyring must be
available. OpenKeep refuses to save credentials when Electron can provide only
its insecure `basic_text` fallback. Install or unlock a supported keyring, then
restart the app and connect again.

## No Offline Archive

The desktop app has no offline archive or document cache. It needs a live
connection for browsing, search, previews, uploads, downloads, and changes. If
you need read-only access to documents previously opened on a device, that is a
separate capability of the [mobile app](./mobile-app.md), not the desktop app.

## Related Documents

- [Getting Started](./getting-started.md) for the shared archive UI
- [Settings and Admin](./settings-and-admin.md) for creating and revoking API tokens
- [Desktop Application](../technical/desktop-application.md) for the security and network architecture
