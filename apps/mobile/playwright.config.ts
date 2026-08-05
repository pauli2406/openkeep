import { defineConfig, devices } from "@playwright/test";

/**
 * Visual regression for the mobile app (#150).
 *
 * The app is exported for web with `OPENKEEP_VISUAL=1` and rendered in Chromium
 * at 393×852 — the device size the redesign was specified for. What is under test
 * is the real app: real screens, real navigation, the real query layer, the real
 * tokens and faces. Only `src/auth` and `src/offline-archive` are swapped, for a
 * fixture archive, plus the handful of modules with no browser implementation.
 *
 * This is a proxy for a device, not a substitute. React Native for web maps
 * flexbox and text onto CSS, so a green run says the tokens, the type scale, the
 * spacing and both palettes are applied — it does not say the native screen is
 * pixel-correct. A simulator pass remains the only thing that proves that.
 *
 * Not part of `pnpm test`: it needs a browser binary and a bundle.
 * Run it with `pnpm --filter @openkeep/mobile test:visual`, and re-bless
 * intended changes with `--update-snapshots`.
 */
const PORT = Number(process.env.MOBILE_VISUAL_PORT ?? 5183);

export default defineConfig({
  testDir: "./visual",
  testMatch: /.*\.visual\.ts/,
  fullyParallel: true,
  // Each worker runs a Chromium with a 2.6 MB bundle; more than this and the
  // slower shots start timing out on a laptop rather than on anything real.
  workers: process.env.CI ? 4 : 4,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? "line" : "list",
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      // Same budget as the web suite: enough for a few anti-aliased glyph pixels
      // across machines, far too little to hide a colour or spacing change.
      maxDiffPixels: 100,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  use: {
    baseURL: process.env.MOBILE_VISUAL_BASE_URL ?? `http://localhost:${PORT}`,
    deviceScaleFactor: 1,
    ...devices["Desktop Chrome"],
    viewport: { width: 393, height: 852 },
  },
  webServer: {
    command: "node visual/serve.mjs",
    url: process.env.MOBILE_VISUAL_BASE_URL ?? `http://localhost:${PORT}`,
    // Never reuse: a stale bundle on the port would silently screenshot the
    // previous build.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
