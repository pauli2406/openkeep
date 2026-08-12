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
`openkeep://app/api/` enter the main-process protocol handler, which is the seam used
by later authenticated desktop work. In the foundation slice, only `/api/health` is
forwarded and the selected archive is held in memory.

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

This slice intentionally has no persistent archive profile, API-token authentication,
offline document cache, native integration, signing, or release automation. The health
check proves the trust boundary and shared renderer; the subsequent desktop stories
add those capabilities through the same narrow main/preload seams.
