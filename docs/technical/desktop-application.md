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

A per-profile offline cache stores what the user opens (see Offline Document
Cache), and an unreachable archive can be reopened as an explicit read-only
offline session served from it (see Offline Session). A live session never
silently swaps to cached data.

Desktop does not use the web login, refresh-token, or initial-owner setup routes.
After verification, `DesktopAuthProvider` presents the already authenticated owner
to the shared application. Account-security endpoints authorize the owner identity
behind either a JWT or an API token, so the desktop can administer language
preferences, TOTP, and remote API tokens without main exposing its connection
credential or minting a browser session. TOTP disable keeps its password plus
current-code proof. Non-owner principals receive a server `403`, whose message is
shown without request headers or credential values.

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
That automatically scopes conversations and recent searches without adding profile
IDs to the web client's storage keys. The authenticated shared app is also keyed by
profile UUID, so its in-memory state remounts immediately while main replaces the
`BrowserWindow`.
The remount creates a new TanStack Router and QueryClient as well as new route
components. Administration queries, mutation results, dialogs, pasted snapshots,
taxonomy selections, and authorization errors therefore share the same profile
isolation guarantee as document and search state. Main's active-profile signal
aborts an outgoing administration request before a late response can be applied.
Background imports, watch folders, and notification routing all carry the stable
profile UUID and be cancelled or routed by that identity rather than by label or
URL. App-level Electron runtime settings remain global where applicable; server-side
user settings remain data of the selected archive.

## Tray and Window Lifecycle

`createDesktopTrayLifecycle` is the deep module at the operating-system lifecycle
seam. Main injects the Electron tray adapter, profile operations, native import entry
point, persistent state adapter, and one cleanup operation. Callers use a small
interface to attach a replacement profile window, show or hide it, rebuild the menu,
capture bounds, or request quit. Tests cross that same interface with in-memory
adapters; Electron-specific `Tray`, `Menu`, `Dialog`, and application focus behavior
stay in `electron-tray-host.ts`.

Close-to-tray is the persisted default. The controller prevents the window close,
captures its bounds, and hides the same `BrowserWindow`, preserving its route and
profile-bound renderer state. The tray contains only application actions and profile
labels: show/hide, active archive, profile switching, native import, the close
preference, and explicit quit. It never receives credentials, server addresses,
document names, search text, or preview content. macOS uses an 18-pixel template
menu-bar image; Windows and Linux use appropriately sized monochrome notification-
area images. Windows and Linux also reveal the window on the conventional tray-icon
double-click.

Changing close behavior to `quit` crosses the same controller interface whether the
action begins in the tray or authenticated renderer. Main displays a native warning
before persistence because closing will stop imports and background work. The
renderer receives only the `tray`/`quit` value and tray availability through fixed
IPC channels. If tray creation fails—especially on a Linux desktop without a usable
status area—the effective behavior is quit even if the stored preference is `tray`;
this ensures the process cannot be left running without any visible recovery path.

Losing the last window is a separate case from closing it. Electron quits an
unsubscribed application once every window is gone, which would end a legitimate
tray session and could interrupt a profile switch while its replacement window is
still being built. Main therefore subscribes to `window-all-closed`, suppresses it
while a window creation is in flight, and otherwise hands the decision to the
controller: a live tray keeps the process running and refreshes its menu, and no
usable tray enters the quit path. Because a window can also be destroyed by a
renderer crash, showing from the tray rebuilds the window for the active profile
instead of acting on a destroyed handle, so the tray can never point at nothing.

Explicit quit and quit-on-close share one idempotent cleanup path. It marks the
controller as quitting so the next close is not hidden, aborts active archive fetches
and SSE streams, closes connections in every configured profile partition, flushes
global lifecycle state, destroys the tray, and only then calls Electron `app.quit()`.
Operating-system quit events are intercepted once and enter the same path.

Global state is stored atomically in `desktop-lifecycle.json`, separate from encrypted
profile credentials. It contains the close preference, last bounds, and allowlisted
per-profile OpenKeep routes. A remembered rectangle is restored exactly only when it
fits a current display work area; otherwise the last size is centered and constrained
to the primary work area. Routes pass the trusted-renderer allowlist both when they
are captured and restored. Removing a profile or changing its origin clears its
remembered route together with that partition. The existing profile repository still
owns the last active UUID.

The single-instance launch lifecycle continues to own cold arguments, macOS
`open-file`, and warm `second-instance` delivery. Its injected focus policy now calls
the tray controller, which restores minimized windows and shows and focuses hidden
windows before Open-with intake is delivered. Tray-native imports use the same native
picker and import service as the shared Import route, but assign the new batch
directly to the already active stable profile UUID.

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

Archive-wide answers, generated document summaries, and document-specific Q&A all
use this same path. The handler returns the upstream `Response` directly; it does
not read, clone, concatenate, or serialize the body. SSE chunks therefore reach the
shared renderer as soon as the archive emits them, including when an SSE field,
JSON value, or multi-byte UTF-8 character spans network chunks.

Each forwarded request combines the renderer request signal with the active profile
generation's signal. Closing the window aborts the renderer signal. Activating or
removing a profile aborts the profile signal before the old renderer is destroyed.
The shared stream consumers also assign a generation to each question, so starting
a replacement question or unmounting the route prevents queued chunks from an older
request changing the new view.

The shared JSON/SSE consumer treats `401`/`403`, gateway/provider unavailability,
server `error` events, malformed JSON events, a missing SSE body, and end-of-stream
without a terminal event as explicit error states. Those messages never include the
credential-bearing upstream request. Citation routes carry the canonical document
UUID and cited page into the normal document detail route; the profile partition
still determines which archive receives the document request.

## Native Save Capability

The shared web application has an optional host file-saver seam. A browser mount
does not provide an adapter and retains Blob plus download-link behavior. The
desktop mount supplies one adapter that accepts only three discriminated requests:
original document by UUID, searchable PDF by UUID, or archive export. The shared
routes receive only `saved`, `cancelled`, or a sanitized failure message.

Preload maps that seam to the fixed `desktop:save:request` channel. It exposes no
destination path, directory listing, arbitrary URL, write primitive, or generic IPC
invocation to the renderer. Main authorizes the sender as a registered top-level
OpenKeep frame and binds the request to the profile UUID assigned to that window.
The native-save module rejects malformed IDs, extra fields, shell windows, and a
profile that is no longer active before opening a dialog or making a request.

Main resolves one of the three fixed archive endpoints, attaches the active Bearer
and optional Cloudflare Access credentials, uses manual redirects, and combines the
operation with the active profile signal. For document responses it prefers the
UTF-8 `filename*` disposition parameter and falls back to `filename`. Suggestions
are normalized and stripped of traversal separators, control or platform-invalid
characters, trailing dots/spaces, dotfile ambiguity, and Windows reserved device
names. Searchable PDFs and JSON exports receive their required extension; original
documents keep a safe server extension or a MIME-derived fallback.

The operating-system dialog owns folder selection and overwrite confirmation. Once
approved, main reads the response body incrementally into a unique mode-`0600`
temporary file beside the destination, flushes and closes it, then renames it into
place. No binary body is serialized over IPC or buffered in renderer memory. Dialog
cancellation cancels the response and returns a normal no-op. Stream, network,
permission, dialog, and rename failures cancel or close the body, remove the partial
temporary file on a best-effort basis, and return a fixed user-safe error that does
not include credentials or local paths.

Native-save tests exercise the public save interface with byte-for-byte original,
searchable-PDF, and JSON output; UTF-8, traversal, invalid, and reserved filenames;
cancellation; confirmed overwrite; profile/request rejection; filesystem failure;
and mid-stream cleanup. Shared-route tests verify both the desktop adapter path and
the unchanged browser path.

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

## Native Import Seam

The shared upload route owns one observable queue for browser-selected, dropped,
native-picker, and Open-with files. Its existing upload and document-status requests
remain the only path into the archive, so native imports do not bypass API
authorization, duplicate detection, processing, or review behavior. An optional
`HostImportAdapter` supplies validated bytes to that route; the browser build uses
the normal file input and has no host adapter.

The desktop side separates the flow into deep modules:

- the launch lifecycle owns the single-instance lock, cold-start arguments,
  macOS `open-file`, warm `second-instance` delivery, ordered deferral until startup,
  and an injected focus policy that tray/background mode can replace later
- the import service canonicalizes each concrete path, opens it read-only, checks
  regular-file status, the 64-MiB ceiling, extension, and PDF/JPEG/PNG/TIFF/HEIC
  magic bytes, and deduplicates a path while it is pending
- the coordinator holds sanitized batch descriptors, auto-assigns the only saved
  profile, requires an explicit valid UUID with multiple profiles, and releases a
  batch only to a renderer already bound to that profile
- the renderer adapter converts delivered bytes to browser `File` objects and puts
  them into the shared queue without exposing the source path

The preload interface contains only `pick`, `pending`, `assign`, `consume`, and a
fixed change notification. It has no `readFile`, path argument, arbitrary IPC
channel, or directory capability. Main reopens and revalidates a pending source at
consumption time, then transfers immutable bytes. Consumption removes the in-memory
capability before asynchronous reading, so concurrent renderer calls cannot receive
the same batch twice. Failures become sanitized terminal queue entries, and source
files are never opened for writing.

Forge adds macOS document types to `Info.plist`. Packaged Windows starts register a
fixed per-user `OpenWithProgids` entry through `reg.exe` arguments without a command
shell; packaged Linux starts write OpenKeep's fixed desktop entry under the user's
applications directory. Neither path makes OpenKeep the default application. The
operating system forwards one or more selected paths to the single running process,
which focuses or restores its existing window and runs the same validation pipeline.

The same rule applies to administration. `/profile`, `/settings`,
`/settings/taxonomy`, and `/settings/providers` are shared web routes rather than
Electron copies. The shared host file-saver seam sends archive export to native save;
snapshot import remains the existing validated server mutation. The General route
polls server watch-folder status, processing status, health, and readiness. The
watch-folder data names the server's configured ingestion directory and is not the
future desktop-local watch-folder capability. Provider selection stays read-only in
the client because active providers come only from server environment configuration.

Desktop parity tests mount those shared routes with main-owned authentication and
the same fixture semantics as the browser smoke tests. They cover the core browse
surfaces, keyboard navigation, empty/loading/failure states, and remounting the App
across profile changes. Administration coverage exercises profile/TOTP/token
surfaces, native export and import, server watch-folder and health state, provider
visibility, taxonomy mutations, sanitized authorization failures, and clean admin
state after a profile remount. The web smoke suite remains the canonical behavior test;
the desktop suite proves that Electron's bootstrap, protocol, and profile seams do
not alter it.

Review and document management remain shared route modules as well. Their mutations
use one archive-state invalidation seam rather than maintaining desktop-specific
caches. A successful correction, resolve, requeue, reprocess, taxonomy change, or
delete refreshes the affected detail, history, explorer, review, dashboard, and
taxonomy queries. Deletion additionally evicts the removed document's text and
preview data immediately.

Route-owned request scopes cancel in-flight review, detail, preview, and mutation
requests on unmount. The main-process proxy combines those renderer signals with the
active profile generation signal, so a profile switch aborts a request even when it
is already being forwarded upstream. Preview blobs use explicit object-URL leases:
replacement and unmount revoke the old URL, while a completion that arrives after
cancellation is discarded before it can update React state.

The desktop parity suite exercises the end-to-end review-to-correction-to-resolve and
requeue flows, batch eligibility and failure feedback, the full document evidence and
metadata surface, inline taxonomy creation, override removal, confirmed maintenance
actions, missing/failed evidence, preview cleanup, and profile-scoped proxy aborts.
These tests intentionally import the shared routes; adding a parallel Electron-only
review UI would bypass the parity guard.

Import-specific tests exercise signature and size validation with real temporary
files, cold and warm launch ordering, exactly-once consumption, one- and multi-profile
routing, native picker delivery, drag/drop rejection, association metadata, shared
queue progress, duplicate handling, retryable failures, and terminal failures.

Notification tests cover the document-state classification, announce-once across
polling and restart, resuming a document that was still processing at shutdown,
per-outcome batching, profile scoping, deleted and never-settling documents, an
unreachable archive, repeated reports, each preference independently, an unsupported
system, the absence of sensitive content, and warm, cold, cross-profile, and untrusted
clicks.

Watch-folder tests cover the settle period against a growing copy and a clock-skewed
share, temporary/hidden/unsupported/directory entries, import-once and its survival
across a restart, renames and genuine changes, transient retry versus permanent
abandonment, missing folders and revoked permissions and their recovery, disconnect and
reconnect, pause and resume, burst coalescing, bounded retention, and the uploader's
request shape, duplicate answers, and status classification.

## Workstation Watch Folders

Desktop watch folders are workstation-local and must not be confused with the
archive's server-side watch folder (`GET/POST /archive/watch-folder`), which the
server scans independently of any client. The desktop feature is three modules with
one seam each:

- `watch-folder-rules.ts` decides whether a directory entry is a finished document.
  It is pure, so eligibility and the quiet-period rule are testable without a
  filesystem, and it reads the accepted-format table from `@openkeep/types` — the same
  table the web drop zone and the interactive desktop import use.
- `watch-folder-state.ts` owns durable per-profile configuration and import
  checkpoints in `desktop-watch-folders.json`, written atomically through the shared
  helper the lifecycle state file uses. It is deliberately separate from encrypted
  credentials and from global lifecycle state: it records local paths, which never
  reach an archive.
- `watch-folder-service.ts` is the controller. Filesystem access, the clock, the
  timer, and the uploader are injected, so every recovery path below is covered by
  in-memory tests.

The service polls rather than subscribing to native filesystem events. A poll
survives sleep and resume, a removable volume returning, an unreliable network share,
and a bulk-copy burst — cases where a native watcher goes silent or floods. Each cycle
re-reads its own durable checkpoints, so an interruption mid-copy costs one extra
poll, never a duplicate document. Scans coalesce: a request arriving during a pass
schedules exactly one more pass rather than queuing per event. A pass notifies
listeners only when it changed something, so an idle folder does not make the renderer
refetch and the tray menu rebuild every few seconds.

A file is uploaded only after its size and modification time are unchanged for the
settle period, which is measured from this machine's first sighting rather than from
the file's timestamp, so a clock-skewed network share still settles. Eligible files go
through `import-service`'s existing validation — extension, magic-byte signature, and
the 64 MiB limit — and are then posted to `POST /api/documents` with the active
profile's credentials, the same endpoint the web import uses. The upload carries the
active session's abort signal, so a profile switch cancels it.

Duplicate suppression uses two indexes per profile. The path index skips a file whose
size and modification time already produced an import, without reading it. The
checksum index recognizes the same bytes under a different name, which is what makes a
rename or a copy cheap instead of a second document; the uploader hashes before it
sends, so a recognized rename never reaches the network. A changed size or
modification time reopens the file, and a changed checksum is a genuine new import.
Both indexes and per-folder history are bounded.

Failure handling distinguishes permanent from transient. A wrong format, an oversized
file, or a 4xx other than 408/429 is recorded as failed and not retried until that
file's size or modification time changes. An unreachable archive, a 5xx, a throttle,
or a still-locked file is retried on later cycles up to a bounded attempt count, and
only the first attempt is written to history so a long outage cannot flood it. A
missing or unreadable folder becomes that folder's reported state while the other
folders keep working, and it recovers on its own when the folder returns.

Watching is profile-aware and connection-aware. Only the connected archive's folders
are scanned; a disconnect leaves them listed as `waiting` rather than making them
disappear, and reconnection resumes them. Removing a profile, or repointing it at
another server, forgets its folders and checkpoints. Signing out does not, because
those folders are waiting for the next sign-in. Explicit quit stops the timer and
flushes pending checkpoint writes as part of the tray lifecycle's single cleanup path.

The IPC surface is `list`, `add`, `set-paused`, `remove`, and a `changed`
notification. A renderer cannot name a folder: `add` opens the operating-system
directory picker in main, so the only paths that enter are ones the user chose there.
Every mutation additionally requires that the calling window's profile is the
connected archive. The tray shows watch state as counts only, never a path.

## Offline Document Cache

Desktop keeps a read-only offline copy of documents the user has opened, as the
storage layer of the offline archive (#172). This section records which mobile
cache semantics it reuses and where it deliberately departs; the offline session
that reads from it is described in the next section.

**Reused mobile semantics.** The cache is populated lazily and only ever by reading:
opening a document online stores its metadata, its preview or searchable file, its
OCR text, and its history. There is no prefetch, no background mirror, and no
mutation queue — the cache is last-opened state, refreshed whole (last-open-wins) on
the next online open. A searchable PDF is preferred over the original and an
original never replaces a cached searchable copy. Files are written to a temporary
name and renamed, and concurrent writes for one document collapse into the first.
A caching failure never breaks online viewing.

**The trigger is the protocol proxy, not the renderer.** Mobile calls its cache from
the document screen; desktop already routes every renderer API request through the
main-process proxy, so a new `observeApiResponse` seam on the protocol handler tees
each successful `GET /api/documents/:id`, `/text`, `/history`, and
`/download[/searchable]` response into the cache as it streams to the renderer. The
renderer needs no knowledge of the cache, the observed bytes are exactly what the
user read, and nothing is fetched twice. List, search, facet, and mutation traffic
is never cached. Until a profile's cache has opened — or when it stays disabled —
the observer passes responses through untouched.

**Deliberate departures from the mobile model**, each answering a documented flaw:

- *Scoped per archive profile.* Mobile keeps one unscoped cache database for
  whichever server and account are connected. The desktop cache lives under
  `offline-cache/<profile UUID>/` in `userData`, so two profiles — even for the same
  server — can never see each other's records.
- *Encrypted at rest.* Mobile stores cached documents in plaintext. Desktop seals
  records, file bytes, and the index with AES-256-GCM under a random per-profile
  data key; only that key, wrapped by Electron `safeStorage`, touches the
  operating-system store. On a machine with only an insecure keyring the cache
  stays disabled — the same refuse-don't-degrade rule credential storage follows.
  Directories are 0700 and files 0600.
- *Versioned from the first release.* Records and the index carry
  `OFFLINE_CACHE_VERSION`; mobile's `CREATE TABLE IF NOT EXISTS`-only store has no
  migration path, which is exactly what blocks its own issue/due-date retrofit
  (#152).
- *Dates are queryable columns, parsed as local dates.* `issue_date` and `due_date`
  live in the column index, and date-only strings go through
  `parseDateOnlyLocal` (shared from `@openkeep/types`) so offline due/overdue and
  year math can never inherit the UTC-midnight shift (#151). Mobile stores dates
  only inside opaque JSON and had to remove its due and year filters offline.
- *True freshness.* Every row records `cached_at`, and the summary exposes
  `MAX(cached_at)` — when content actually entered the cache — separate from any UI
  refresh counter, which mobile conflates (#153).
- *Streamed writes.* File bytes are encrypted chunk by chunk on their way to disk;
  mobile buffers whole documents through base64 in JS memory.
- *Damage is contained.* An unreadable index is rebuilt from the records; an
  unreadable record is skipped. One bad row cannot poison every offline read, which
  is the failure mode of mobile's shared `rows.map(JSON.parse)` path.

The store exposes `summary()` (document count, file bytes,
`lastCachedAt`) and a column listing for the coming offline surfaces; the sealed
records hold everything else. Store, cipher, and read-through are covered by tests
including cross-profile isolation, restart recovery, damaged-index rebuild,
damaged-record skip, plaintext-leak checks, and the disabled-without-keyring path.

## Offline Session

An offline session opens one profile's cached copy read-only. Entry is explicit
and has two doors, both offered only when the copy is usable — cached documents
plus a cached identity: the archive chooser's `Open offline copy`, and the same
offer beside `Retry` when a connected archive becomes unreachable. A 401 never
leads offline; rejected credentials keep removing the profile exactly as before.
Entering suspends any live session without touching stored credentials — it is
not a sign-out.

Serving happens at the protocol proxy, mirroring how the cache is populated.
While a profile is offline, its partition's `/api` traffic routes to an offline
API handler that answers the read endpoints in the archive's own response
shapes: the cached user for `/api/auth/me`; the documents list with query,
correspondent, type, tag, status, review, year, and date-range filters plus
date sorting; the review queue as pending cached documents; facets, the
timeline, Today's dashboard, and correspondent dossiers derived from the
column index; keyword search over cached titles, taxonomy names, and OCR text
(the one read-only POST, with matching blocks quoted and every result openable
offline by construction); document detail, OCR text, history, and decrypted
file bytes. A cached document therefore renders identically offline and
online, and the shared web application needs no cached-read forks. All date
arithmetic uses local dates, which is what lets the due and year filters work
offline — the filters mobile had to remove (#152) — without the UTC-midnight
shift (#151). Correspondent AI summaries report `unavailable` rather than
faking an empty result. Everything else — every mutation and AI request —
receives a read-only refusal at the transport, carrying its own header rather
than `archive-unavailable` so the renderer's failure handler is not sent
re-verifying on every request. Read-only is enforced in main; the renderer's
gating is presentation.

The renderer receives the mode as `sessionMode` on the shared `App` and exposes
it through the host shell as `useOfflineReadOnly()` — the one shared predicate
(mobile copy-pastes its equivalent across nine screens). It drives a persistent
read-only banner and disables the mutating surfaces: the import drop zone is
replaced by an explanation, ask composers are off, and the document rail's
editing, reprocess, and delete controls sit inside one disabled fieldset.
Inspection and clearing complete the copy's lifecycle. The availability query
reports counts, size on disk, and the true last-written time (`MAX(cached_at)`)
per profile — never a path or title — and drives both the chooser's offer and
the desktop-behavior panel's offline-copy block, whose delete action clears one
archive's records, files, index, identity, and wrapped key after an inline
confirmation. Clearing under an open offline session ends the session. The
cache's lifetime is bound to its profile: removal, a repoint to a different
server, and archive-rejected credentials all delete the whole per-profile cache
directory (including via the reconnect loop's rejection path), while sign-out
keeps it — the profile still exists and its copy waits for the next sign-in.
Every deletion is local by construction; nothing in the cache layer can reach
an archive.

Reconnection is a main-process loop, not a user chore. While a profile is
offline it is re-verified every thirty seconds through the ordinary activation,
so outcomes keep their meanings: the first success ends the offline session and
reopens the profile live — there are no offline mutations to replay — a
rejected credential removes the profile and the session with it, and transient
failures stay offline quietly. A verification that finishes after the session
already ended is discarded. Mobile has no working equivalent; its offline mode
persists until relaunch.

Offline-session tests cover the offline API's shapes, filters, paging,
not-cached answers, and read-only refusals; the derived dashboard, facets,
timeline, dossier, and text-search surfaces including local-date due/overdue
and year math and the empty cache; the reconnect outcomes including the
stale-verification guard; and, at parity level, the banner, the disabled
import and ask surfaces, the failure-handler guarantee, and a derivation↔UI
contract that routes msw through the real offline handler so the shared Today
and explorer render what an offline session actually serves.

## Import Outcome Notifications## Import Outcome Notifications

Notifications are driven by an outcome tracker in main rather than by the upload
route. A document keeps processing after its upload returns, and the window can be
hidden, pointed at another archive, or gone entirely by the time the archive settles
it — each of which would drop a renderer-owned poll. Four modules:

- `import-outcomes.ts` — the durable tracker. Both the pending set and the set of
  already-announced document IDs are persisted in `desktop-import-outcomes.json`, and
  the write happens before the announcement, so a crash between the two cannot produce
  a duplicate. Poll passes are serialized with at most one queued behind the running
  one, so a slow archive cannot build a backlog of timer ticks. A document that never
  settles is dropped after 24 hours instead of being polled forever.
- `document-status.ts` — classifies one `GET /api/documents/:id` answer using the
  archive's own vocabulary: `status` for pending/processing/ready/failed,
  `embeddingStatus` because a document can be ready while its embedding is still
  queued or indexing, and `reviewStatus` to decide whether a ready document needs the
  user. A 404 or 410 means the document was deleted and is forgotten without an
  announcement; any other failure leaves it pending, so an unreachable archive costs
  nothing.
- `import-notifications.ts` — builds at most one notification per batch per outcome. A
  notification carries a file name and a count only: never OCR or document text, an
  archive address, a bearer token, or a Cloudflare secret. One document deep-links to
  that document; a batch opens the review queue or the document list, because
  deep-linking one arbitrary member of a batch is a guess.
- `notification-routing.ts` — applies a click. The target archive already active means
  reveal and navigate. No archive active yet — a cold-start click, or the chooser
  being open — remembers the intent, because navigating an unauthenticated shell would
  land on the connection screen. Another archive active asks first: switching destroys
  the current window along with anything unfinished in it, so it must never happen
  silently. A remembered intent is consumed by the window being created for that
  profile, so the notification's route is that window's first URL rather than a second
  navigation. Every target is re-checked against the trusted-route allowlist before it
  is used.

All three import sources feed the same tracker. Watch-folder uploads happen in main,
so the uploader returns the created document's ID. Picker and Open-with uploads happen
in the renderer, so `HostImportAdapter` gained an optional `reportCreated`, which the
shared upload route calls after each successful create; a browser without a host is
unaffected. Reporting the same document twice is harmless — already-pending and
already-announced IDs are both ignored — which is what makes a retrying renderer safe.

Preferences for the three kinds live beside the close behavior in the global lifecycle
state file, and an unreadable or unknown value falls back to enabled, because silence
is the surprising outcome. There is no permission prompt to drive: the operating system
decides whether a notification appears, and focus, quiet hours, and do-not-disturb are
its business. A Linux desktop without a notification service reports
`Notification.isSupported()` false, and the presenter skips rather than retrying or
prompting. Removing a profile or repointing it at another server drops its pending
outcomes with the rest of its state.

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
archives. The offline copy holds only opened documents. Disk limits, eviction, and
deeper corruption recovery arrive with the last #172 story. There is no launch-at-login setting, signing, or release automation. Notifications report jobs this installation started;
they are not a general subscription to server events. Watch folders run only while the
desktop process runs, and they never move or rewrite a source file, so any
processed-folder workflow remains a separate feature.

## Related Documents

- [Desktop App](../user/desktop-app.md) for the user connection flow
- [Web Application](./web-application.md) for the shared renderer
- [API and Data Flows](./api-and-data-flows.md) for server-side request handling
