# Mobile visual regression

Screenshots of the real app — real screens, real navigation, the real query layer,
the real tokens and faces — at 393×852, in both themes.

```bash
pnpm --filter @openkeep/mobile test:visual           # compare against the baselines
pnpm --filter @openkeep/mobile test:visual:update    # re-bless intended changes
pnpm --filter @openkeep/mobile test:visual:local     # skip the container (see below)
```

## How it works

`OPENKEEP_VISUAL=1 expo export --platform web` bundles the app for a browser.
`metro.config.js` swaps two modules for that build and nothing else:

- `src/auth` and `src/offline-archive` → `visual/stubs/`, so the archive is the
  fixture in `visual/fixtures.ts` reached through the same `authFetch` /
  `streamFetch` the app always uses. Every screen, hook and query above that line
  is the real one.
- the modules with no browser implementation → small stubs: the PDF view, the OS
  scanner, the file viewer, blob storage, SQLite, secure storage, `pdf-lib`.

Playwright then walks the app the way a person would — tapping tabs, rows, the
avatar, the scan button — and captures each screen.

## What a green run means

That the palette, the type scale, the spacing, the row heights, the states and
both themes are applied as the design says, and that the paths between screens
still work.

## What it does not mean

That the app looks right on a device. React Native for web maps flexbox and text
onto CSS with browser metrics; native text measurement, the native header, the
real PDF view and the OS scanner are all absent or approximated here. A simulator
pass is still the only thing that proves native fidelity.

## Rules the harness lives by

- **The container decides.** Text rasterisation depends on the font stack, so the
  baselines are only reproducible inside the pinned Playwright image. `test:visual`
  runs there; `test:visual:local` does not and will differ.
- **The bundle is always rebuilt.** A stale `visual/dist` would screenshot the
  previous commit and pass.
- **Everything that varies is pinned:** the clock through `page.clock`, the
  archive through fixtures, the viewport and the device scale through the config.
- Two things are deliberately *not* frozen: `requestAnimationFrame` and the
  `Date` global. Replacing either also breaks the timing inside Playwright's own
  injected helpers, and every click then waits forever for an element to become
  "stable". The pulsing dot on a processing row is seven pixels across and stays
  inside the 100-pixel diff budget.
- `?settled=1` drops the queued and failed documents from the fixture list. Their
  presence makes the list poll every four seconds, and a list that re-renders on a
  timer never settles enough for a synthesised long press.
