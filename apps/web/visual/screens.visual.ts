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

/** One finished conversation, because the empty chat shows none of the thread. */
const CHAT_THREAD = JSON.stringify([
  {
    id: "visual-thread",
    title: "When does my electricity contract end?",
    at: FROZEN_NOW - 3_600_000,
    turns: [
      {
        question: "When does my electricity contract end, and what does it cost?",
        answer:
          "Your contract with **Stadtwerke München** runs until **31 December 2026** [1].\n\n- The monthly instalment is **€128.50** [2]\n- Notice period: three months before the end of the term [1]",
        citations: [
          {
            documentId: "d0000000-0000-4000-8000-000000000000",
            documentTitle: "Stromabrechnung 2026",
            chunkIndex: 0,
            pageFrom: 2,
            pageTo: 2,
            quote: "Der Vertrag endet am 31.12.2026. Kündigungsfrist drei Monate.",
            score: 0.82,
            index: 1,
            used: true,
          },
          {
            documentId: "d0000000-0000-4000-8000-000000000001",
            documentTitle: "Einkommensteuerbescheid 2025",
            chunkIndex: 1,
            pageFrom: 1,
            pageTo: 1,
            quote: "Monatlicher Abschlag 128,50 EUR",
            score: 0.7,
            index: 2,
            used: true,
          },
        ],
        structuredRows: null,
        structuredTitle: null,
      },
    ],
  },
]);

type Screen = {
  name: string;
  path: string;
  ready: string;
  /** The login page has to render signed out. */
  signedOut?: boolean;
  conversations?: string;
};

const SCREENS: readonly Screen[] = [
  { name: "today", path: "/", ready: "main" },
  { name: "documents-list", path: "/documents", ready: "main" },
  { name: "documents-groups", path: "/documents?view=groups", ready: "main" },
  { name: "documents-timeline", path: "/documents?view=timeline", ready: "main" },
  { name: "review", path: "/review", ready: "main" },
  { name: "taxes", path: "/taxes", ready: "main" },
  { name: "chat", path: "/search", ready: "main" },
  { name: "chat-thread", path: "/search", ready: "main", conversations: CHAT_THREAD },
  { name: "document-detail", path: "/documents/d0000000-0000-4000-8000-000000000000", ready: "main" },
  { name: "correspondent", path: "/correspondents/stadtwerke-muenchen", ready: "main" },
  { name: "import", path: "/upload", ready: "main" },
  { name: "settings-general", path: "/settings", ready: "main" },
  { name: "settings-taxonomy", path: "/settings/taxonomy", ready: "main" },
  { name: "settings-providers", path: "/settings/providers", ready: "main" },
  { name: "profile", path: "/profile", ready: "main" },
  { name: "login", path: "/login", ready: "form", signedOut: true },
];

/**
 * Pin everything that would otherwise vary between runs: the clock (relative
 * dates like "3 days overdue"), the stored theme, and the auth tokens the app
 * reads on boot. Runs before any page script.
 */
async function pinEnvironment(page: Page, theme: (typeof THEMES)[number], screen: Screen) {
  await page.addInitScript(
    ({ now, storedTheme, signedOut, conversations }) => {
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

      if (!signedOut) {
        window.localStorage.setItem("openkeep.access-token", "visual-access-token");
        window.localStorage.setItem("openkeep.refresh-token", "visual-refresh-token");
      }
      window.localStorage.setItem("openkeep.theme", storedTheme);
      // Conversations are browser-local, so the screen decides what exists.
      window.localStorage.setItem("openkeep.chat-conversations", conversations);
      document.documentElement?.setAttribute("data-theme", storedTheme);
    },
    {
      now: FROZEN_NOW,
      storedTheme: theme,
      signedOut: Boolean(screen.signedOut),
      conversations: screen.conversations ?? "[]",
    },
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
          await pinEnvironment(page, theme, screen);
          await page.goto(screen.path);

          // The shell is up and the route has painted.
          await page.locator(screen.ready).first().waitFor({ state: "visible" });

          // Web fonts change text metrics, so every box on the page depends on
          // them. `index.css` bundles Geist through @fontsource, so wait for font
          // decoding before capture.
          // `.then(() => true)` because the FontFaceSet itself is not
          // serializable across the CDP boundary.
          await page.evaluate(() => document.fonts.ready.then(() => true));
          const fontLoaded = await page.evaluate(() =>
            document.fonts.check('600 16px "Geist Variable"'),
          );
          expect(
            fontLoaded,
            "Geist did not load — visual baselines require the bundled font asset",
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
