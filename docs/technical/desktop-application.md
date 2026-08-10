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
`openkeep://app/api/` enter the main-process protocol handler. The handler forwards
all `/api` traffic to the active archive and attaches credentials in main, so the
renderer sees ordinary same-origin API responses and streams without seeing the
secrets.

## Connection and Session Lifecycle

The desktop app supports one active archive profile. On a new connection, main:

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

At startup, main decrypts and verifies the last active profile before mounting the
shared authenticated app. A successful check restores it automatically. A transport
failure retains the encrypted credentials and returns an unavailable state with
retry and edit actions. Once a reachable archive rejects the credentials with
`401` or `403`, main deletes the profile and returns to the connection flow. Sign-out
also deletes the stored profile before clearing the in-memory session and renderer
authentication state.

The session is intentionally online-only. Desktop has no local document archive or
offline fallback.

## Credential Persistence

`ProfileStorage` keeps a versioned `desktop-state.json` under Electron's per-user
application-data directory. Profile metadata and the encrypted credential blob are
separate fields. The JSON contains only the operating-system-encrypted, base64-encoded
blob; API tokens and Cloudflare secrets are never written as plaintext.

Encryption and decryption use Electron `safeStorage` in main. Credential values are
not returned by the preload bridge, logged, added to crash details or telemetry, or
included in session-state objects sent to the renderer. The bridge exposes only
narrow connection, retry, restore, sign-out, and runtime-information operations.

On Linux, secure storage must use Secret Service/libsecret or KWallet. The
`basic_text` backend and unknown backends are rejected, as is an unavailable or
locked credential facility. The connection screen reports the keyring requirement
instead of falling back to plaintext persistence.

## Authenticated API Proxy

For an active session, the custom-protocol handler maps every renderer request below
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
- IPC calls must originate from the main frame of a registered application window at
  an allowlisted `openkeep://app` route. Both preload and main validate the contract.
- Permission requests are denied by default. No remote page becomes executable UI.

## Shared Web Application

`@openkeep/web/app` is a narrow source export for the shared React application, while
`@openkeep/web/styles.css` supplies the existing design system. The browser keeps its
own `main.tsx` mount; Electron has a separate bootstrap that shows the connection
surface and then mounts the same `App`. Desktop Vite and TypeScript resolve the web
app's `@/` alias identically, and desktop builds are the guard against alias drift.

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

Desktop currently supports one saved archive profile and requires a live server for
all archive content. It has no offline document cache, native integration, signing,
or release automation.

## Related Documents

- [Desktop App](../user/desktop-app.md) for the user connection flow
- [Web Application](./web-application.md) for the shared renderer
- [API and Data Flows](./api-and-data-flows.md) for server-side request handling
