import { defineConfig, devices } from "@playwright/test";

/**
 * Visual regression for the redesigned screens.
 *
 * Not part of `pnpm test`: it needs a browser binary, which CI has to install
 * deliberately. Run it with `pnpm --filter @openkeep/web test:visual`, and
 * re-bless intended changes with `--update-snapshots`.
 *
 * Everything the screenshots depend on is pinned — a fixed mock API, a frozen
 * clock, disabled animations, a fixed device scale — so a diff means the
 * rendering changed and nothing else.
 */
export default defineConfig({
  testDir: "./visual",
  testMatch: /.*\.visual\.ts/,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? "line" : "list",
  // Baselines are captured on Linux; a macOS run renders text differently and
  // would diff on every snapshot. Keep one platform's baselines in the repo.
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      // Measured: on a fixed Chromium build these screens render bit-identical
      // between runs, so a ratio-based tolerance (0.2% of 1280x900 is ~2300
      // pixels) was loose enough to miss a whole accent-colour change on most
      // screens. A small absolute budget absorbs a few anti-aliased glyph
      // pixels across machines without hiding a real change.
      maxDiffPixels: 100,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  use: {
    baseURL: process.env.VISUAL_BASE_URL ?? "http://localhost:4173",
    deviceScaleFactor: 1,
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "node visual/serve.mjs",
    url: process.env.VISUAL_BASE_URL ?? "http://localhost:4173",
    // Always start our own. Reusing whatever happens to hold the port has
    // already produced a run where a stale dev server proxied to the real
    // API and every screen rendered the login page instead.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
