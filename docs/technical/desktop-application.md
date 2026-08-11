---
title: Desktop Application
description: Electron runtime boundaries, security policy, and contributor workflow.
---

# Desktop Application

The desktop client is an Electron Forge application in `apps/desktop`. It reuses the
web application's exported `App`, generated route tree, components, and stylesheet.
Desktop-only code is limited to the runtime bootstrap and capabilities that require
an operating-system boundary.

## Runtime Boundary

The application has three trust zones:

1. The **renderer** runs bundled OpenKeep React code at `openkeep://app/`. It has no
   Node.js integration and cannot import Electron APIs.
2. The **preload** exposes `window.openkeepDesktop`, a frozen bridge containing named,
   typed operations. It does not expose `ipcRenderer`, generic invocation, request
   headers, credentials, or filesystem paths.
3. The **main process** owns Electron, network access to archives, protocol routing,
   window lifecycle, navigation policy, and IPC authorization.

The renderer never loads JavaScript or HTML from an archive server. Requests under
`openkeep://app/api/` enter the protocol handler for the active Electron session.
The handler forwards all `/api` traffic to that session's selected archive and
attaches credentials in main, so the renderer sees ordinary same-origin API
responses and streams without seeing the secrets.

## Archive Profiles

The desktop app stores multiple archive profiles but activates only one at a time.
Every profile receives a stable UUID when it is created. The UUID—not the editable
label or normalized server URL—is its identity, so duplicate labels and duplicate
server URLs are allowed without profiles colliding.

Each profile contains its label, server URL, HTTP confirmation choice, and a
separate encrypted credential record. The last active UUID is app-level registry
state. At startup, main applies these selection rules:

1. With no profiles, open the connection shell.
2. With one profile, verify and activate it automatically.
3. With multiple profiles, verify and activate the last active profile when it is
   still present and valid.
4. If no candidate can be restored, open the chooser without discarding other
   profiles.

The active profile remains visible in the authenticated web shell through the
desktop archive switcher. It provides add, activate, edit, rename, reconnect, and
confirmed removal operations without broadening the web application's Electron
capabilities.

## Connection and Verification Lifecycle

On a new or edited connection, main:

1. normalizes and validates the HTTP or HTTPS server URL
2. requires explicit confirmation for plaintext HTTP except on loopback hosts
3. checks secure credential storage availability
4. requests `/api/health` with a bounded timeout and manual redirect handling
5. requests `/api/auth/me` with the Bearer token and optional Cloudflare Access
   service-token headers
6. persists and activates the profile only after both responses validate

Cloudflare Access credentials are optional but atomic: the client ID and client
secret must either both be present or both be absent. Health receives the
Cloudflare pair when configured but not the OpenKeep Bearer token. The current-user
request receives both.

At startup and reconnect, main decrypts and verifies only the selected profile
before mounting the shared authenticated app. A transport failure retains that
profile and its encrypted credentials and exposes retry, edit, and profile-selection
actions. Once a reachable archive rejects credentials with `401` or `403`, main
deletes only the failing profile's credentials and profile record. The chooser and
all other profiles remain usable.

The session is intentionally online-only. Desktop has no local document archive or
offline fallback.

## Profile Session Isolation

The unconnected connection shell and archive chooser use the dedicated ephemeral
`openkeep-shell` Electron partition. An authenticated profile uses its own persistent
partition named `persist:openkeep-profile-UUID`. The stable UUID makes the partition
independent of editable labels and URLs.

Each profile partition receives its own custom-protocol registration and the same
navigation, permission, CSP, and request-header security policy. A profile switch
does not navigate the existing window in place. Main increments the active-session
generation, aborts the outgoing generation's requests and streams, destroys its
`BrowserWindow`, and creates a new window in the destination profile's partition.
Callbacks and responses capture their generation and are ignored if a newer
activation has begun. This prevents a late response or authorization failure from
one archive from mutating the next archive's session.

Destroying and recreating the renderer drops in-memory query caches, conversations,
recent-search state, upload state, active streams, and temporary object URLs.
Chromium local storage and network cache stay inside the profile-specific partition.
Temporary preview URLs additionally use component-owned leases, so replacement,
unmount, route changes, and late download completions revoke or refuse the old URL.
Destroying a profile renderer releases any remaining Chromium-owned blob resources.
Future background imports, watch folders, and notifications must carry the stable
profile UUID and be cancelled or routed by that identity rather than by label or
URL. App-level Electron runtime settings remain global where applicable; server-side
user settings remain data of the selected archive.

Removing a profile clears its partition storage and cache, closes its network
connections, and deletes its encrypted credential record after user confirmation.
Editing a profile's server URL performs the same partition cleanup before that
stable UUID can address a different origin. Renaming a profile does not clear its
partition. These operations never change or delete data in the remote archive and
never clear another profile's partition.

## Credential Persistence

`ProfileStorage` keeps a versioned `desktop-state.json` under Electron's per-user
application-data directory. The registry maps stable profile UUIDs to metadata and
separate encrypted credential blobs and records the last active UUID. The JSON
contains only operating-system-encrypted, base64-encoded blobs; API tokens and
Cloudflare secrets are never written as plaintext.

Encryption and decryption use Electron `safeStorage` in main. Credential values are
not returned by the preload bridge, logged, added to crash details or telemetry, or
included in session-state objects sent to the renderer. The bridge exposes only
narrow list, add, activate, edit, rename, reconnect, remove, restore, and
runtime-information operations.

On Linux, secure storage must use Secret Service/libsecret or KWallet. The
`basic_text` backend and unknown backends are rejected, as is an unavailable or
locked credential facility. The connection screen reports the keyring requirement
instead of falling back to plaintext persistence.

## Authenticated API Proxy

For an active profile session, the custom-protocol handler maps every renderer request below
`openkeep://app/api` to the corresponding path and query on the configured archive.
Before forwarding, it removes renderer-supplied `Authorization`, Cloudflare Access,
cookie, origin, referer, host, and content-length headers. Main then adds the active
profile's Bearer token and, when configured, the Cloudflare Access client ID and
secret.

Request methods, bodies, response bodies, status codes, and response headers remain
streaming Fetch values. This preserves large uploads, downloads, and SSE answer
streams without buffering them through IPC. Redirects use `manual` mode so neither
verification nor proxied requests can silently follow to another origin with
credentials attached.

Fetch failures generated by the desktop proxy carry a private transport marker;
ordinary `502` responses returned by an archive do not. The shared API seam reports
that marker and `401` responses to the desktop host. Desktop then re-verifies the
active profile in main and leaves the authenticated renderer for the unavailable or
invalid-credential state. This makes an outage or expired token replace, rather than
sit behind, cached archive content.

## Security Invariants

- `openkeep` is registered as a standard, secure, Fetch-capable scheme before Electron
  becomes ready. Application assets are resolved beneath the packaged renderer root;
  traversal, encoded separators, unknown hosts, methods, missing assets, and arbitrary
  SPA fallbacks are rejected.
- Browser windows use `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`, `webSecurity: true`, and no webviews.
- The production Content Security Policy permits only bundled code and the minimum
  blob/data sources required by the existing preview UI. Archive connections remain
  same-origin from the renderer's perspective and are performed by main.
- Navigation and window-open requests use explicit application-route and external
  `https:`/`mailto:` allowlists. Electron never creates a default child window.
- Internal deep routes, query strings, and fragments stay in the hardened window.
  Main remembers the last trusted route by stable profile UUID for same-process
  profile switching; it never restores one profile's route into another partition.
- IPC calls must originate from the main frame of a registered application window at
  an allowlisted `openkeep://app` route. Both preload and main validate the contract.
- Permission requests are denied by default. No remote page becomes executable UI.

## Shared Web Application

`@openkeep/web/app` is a narrow source export for the shared React application, while
`@openkeep/web/styles.css` supplies the existing design system. The browser keeps its
own `main.tsx` mount; Electron has a separate bootstrap that shows the connection
surface and then mounts the same `App`. Desktop Vite and TypeScript resolve the web
app's `@/` alias identically, and desktop builds are the guard against alias drift.
The host also supplies its runtime platform so shared omnibar labels render `Cmd` on
macOS and `Ctrl` on Windows/Linux without branching the component tree.

Public Sans and IBM Plex Mono are compiled from the OFL-licensed font files already
owned by the mobile workspace. Both Vite builds fingerprint and bundle those files;
desktop does not weaken its CSP or rely on Google Fonts for visual parity.

The optional host-shell accessory seam adds only the archive-profile control to the
authenticated top bar. Today, the document explorer and its list/timeline/group
views, the omnibar, and correspondent dossiers remain the exact web route modules.
Browser history and deep links continue through TanStack Router at the trusted
`openkeep://app` origin; the custom protocol returns the application entry point only
for allowlisted client routes.

Desktop parity tests mount those shared routes with main-owned authentication and
the same fixture semantics as the browser smoke tests. They cover the core browse
surfaces, keyboard navigation, empty/loading/failure states, and remounting the App
across profile changes. The web smoke suite remains the canonical behavior test;
the desktop suite proves that Electron's bootstrap, protocol, and profile seams do
not alter it.

## Contributor Commands

From the repository root:

```sh
pnpm install
pnpm --filter @openkeep/desktop dev
pnpm --filter @openkeep/desktop typecheck
pnpm --filter @openkeep/desktop test
pnpm --filter @openkeep/desktop build
pnpm --filter @openkeep/desktop test:smoke
```

`build` creates an unpacked, fused application under `apps/desktop/out`. Run the smoke
test after that build; it launches the packaged executable headlessly and verifies the
trusted origin, preload surface, connection screen, CSP, and absence of Node globals.
CI performs this package/start sequence natively on macOS, Windows, and Linux (with
Xvfb on Linux).

Electron Forge's pnpm packaging support requires the repository's hoisted linker, so
the root `.npmrc` is part of the desktop toolchain. Forge and its experimental Vite
plugin are pinned to one version to avoid incompatible minor updates.

## Current Limitations

Desktop connects to one active profile at a time and requires a live server for all
archive content. Persistent Chromium partitions isolate profiles but are not offline
archives. Desktop has no offline document cache, native integration, signing, or
release automation.

## Related Documents

- [Desktop App](../user/desktop-app.md) for the user connection flow
- [Web Application](./web-application.md) for the shared renderer
- [API and Data Flows](./api-and-data-flows.md) for server-side request handling
