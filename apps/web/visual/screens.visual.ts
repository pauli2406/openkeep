import { expect, test, type Page } from "@playwright/test";

/**
 * One screenshot per screen, per theme, per width.
 *
 * The redesign (#40–#60) was verified by hand against `design/screens/*.png`,
 * in both themes at 1280 and 1024. Nothing repeated that check, so drift back
 * from the design would have gone unnoticed. These are the baselines for it.
 *
 * A failure means the rendering moved. That is not automatically wrong — if
 * the change was intended, re-bless with `--update-snapshots` and the diff
 * shows up in review, which is the point.
 */

const FROZEN_NOW = new Date("2026-03-20T09:00:00.000Z").getTime();

const VIEWPORTS = [
  { name: "1280", width: 1280, height: 900 },
  { name: "1024", width: 1024, height: 820 },
] as const;

const THEMES = ["light", "dark"] as const;

const SCREENS = [
  { name: "today", path: "/", ready: "main" },
  { name: "documents-list", path: "/documents", ready: "main" },
  { name: "documents-groups", path: "/documents?view=groups", ready: "main" },
  { name: "documents-timeline", path: "/documents?view=timeline", ready: "main" },
  { name: "review", path: "/review", ready: "main" },
  { name: "chat", path: "/search", ready: "main" },
  { name: "import", path: "/upload", ready: "main" },
  { name: "settings-general", path: "/settings", ready: "main" },
  { name: "settings-taxonomy", path: "/settings/taxonomy", ready: "main" },
  { name: "settings-providers", path: "/settings/providers", ready: "main" },
  { name: "profile", path: "/profile", ready: "main" },
] as const;

/**
 * Pin everything that would otherwise vary between runs: the clock (relative
 * dates like "3 days overdue"), the stored theme, and the auth tokens the app
 * reads on boot. Runs before any page script.
 */
async function pinEnvironment(page: Page, theme: (typeof THEMES)[number]) {
  await page.addInitScript(
    ({ now, storedTheme }) => {
      const RealDate = Date;
      class FrozenDate extends RealDate {
        constructor(...args: unknown[]) {
          // @ts-expect-error - forwarding the real constructor's overloads
          super(...(args.length ? args : [now]));
        }
        static now() {
          return now;
        }
      }
      // @ts-expect-error - deliberately replacing the global
      globalThis.Date = FrozenDate;

      window.localStorage.setItem("openkeep.access-token", "visual-access-token");
      window.localStorage.setItem("openkeep.refresh-token", "visual-refresh-token");
      window.localStorage.setItem("openkeep.theme", storedTheme);
      // Conversations are browser-local; an empty list keeps chat deterministic.
      window.localStorage.setItem("openkeep.chat-conversations", "[]");
      document.documentElement.setAttribute("data-theme", storedTheme);
    },
    { now: FROZEN_NOW, storedTheme: theme },
  );

  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
      /* The spinner would otherwise freeze at an arbitrary angle. */
      .animate-spin { visibility: hidden !important; }
    `,
  });
}

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test.describe(`${theme} @ ${viewport.name}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      for (const screen of SCREENS) {
        test(screen.name, async ({ page }) => {
          await pinEnvironment(page, theme);
          await page.goto(screen.path);

          // The shell is up and the route has painted.
          await page.locator(screen.ready).first().waitFor({ state: "visible" });

          // Web fonts change text metrics, so every box on the page depends on
          // them. `index.css` pulls Public Sans and IBM Plex Mono from Google
          // Fonts, which means these baselines need network access — without
          // it the browser falls back and every screenshot differs. Fail with
          // that sentence rather than thousands of unexplained pixel diffs.
          // `.then(() => true)` because the FontFaceSet itself is not
          // serializable across the CDP boundary.
          await page.evaluate(() => document.fonts.ready.then(() => true));
          const fontLoaded = await page.evaluate(() =>
            document.fonts.check('600 16px "Public Sans"'),
          );
          expect(
            fontLoaded,
            "Public Sans did not load — visual baselines require network access to Google Fonts",
          ).toBe(true);

          await expect(page.locator("[data-pending], .animate-spin")).toHaveCount(0, {
            timeout: 15_000,
          });

          await expect(page).toHaveScreenshot(
            `${screen.name}-${theme}-${viewport.name}.png`,
            { fullPage: false },
          );
        });
      }
    });
  }
}
