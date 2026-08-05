# OpenKeep mobile — design reference

This folder is the visual source of truth for the **Mobile redesign 2026** epic.

The palette, type scale and shell are the same as the web redesign — see
`apps/web/src/index.css` for the shipped token values. The two clients must not drift.

## Screens

All frames are 402 × 874pt (iPhone Pro), exported at 804 × 1748 (2×).
**Every screenshot is the dark theme** — it is the prototype's default, because that is
how the app is mostly used. Open the prototype and set its `theme` prop to `light`
to see the same screens light.

| File | Screen |
|---|---|
| `screens/01-today.png` | Today — replaces the Dashboard |
| `screens/02-documents-list.png` | Documents |
| Review queue | *no screenshot — see the prototype* |
| `screens/06-chat.png` | Chat — replaces Search |
| `screens/05-scan.png` | Scan — the draft the OS scanner returns to |
| Document detail | *no screenshot — see the prototype* |
| `screens/07-settings-general.png` | Settings |
| `screens/08-offline-archive.png` | Offline archive |
| `screens/09-correspondents.png` | Correspondents |
| `screens/10-dossier.png` | Correspondent dossier |
| `screens/11-connect.png` | Connect — first run |

The app bar and tab bar appear in every frame; those belong to the shell ticket.

## Prototype

`prototype/openkeep-mobile.dc.html` — open it in a browser. One phone, **clickable**:
tabs, filters, the review queue, the chat, the document detail tabs and the full-page
reader all work. Read its HTML source for exact colours, sizes, row heights and spacing.
It needs `prototype/support.js` and `prototype/ios-frame.jsx` beside it.

**For the Review queue and the Document detail screen the prototype is the only
reference** — both were restructured after the screenshots were taken, so no
screenshot exists for them. Click through those two rather than reading a still.

It is a **web artifact**, not React Native. Do not port its markup — take values,
layout and information order from it only.

## Three constraints the design respects

These are the things that are easy to get wrong in this codebase:

1. **Capture is the OS scanner.** `ScanScreen` calls the `DocumentScanner` TurboModule
   with `responseType: "imageFilePath"`. The app never draws a viewfinder or shutter.
   Frame 05 is the draft screen the system sheet returns to.
2. **Offline caching is lazy read-through, not sync.** `cacheOpenedDocument` /
   `ensureCachedFile` persist a document when it is opened, and
   `shouldUseCache = !isConnected` switches over automatically. There is no opt-in
   toggle, no Wi-Fi auto-download and no retention setting — `offline-archive.tsx`
   deletes those legacy keys on boot. `CacheSummary` exposes only `documentCount`,
   `fileStorageBytes` and `updatedAt`, so no free-space figure exists.
3. **Correspondent rows carry no dates or sums.** The facets/taxonomy call yields
   `id`, `name`, `slug`, `count` — nothing else.

Frames 05, 08 and 09 exist in their current form because of these. If a ticket seems to
ask for more, the constraint wins.
