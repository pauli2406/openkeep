import { expect, test, type Page } from "@playwright/test";

/**
 * One screenshot per screen, per theme.
 *
 * Every screen is reached the way a person reaches it — tapping a tab, a row, the
 * avatar, the scan button — so the shots cover navigation as well as rendering.
 * A failure means something moved. That is not automatically wrong: if the change
 * was intended, re-bless with `--update-snapshots` and the new image lands in the
 * diff, which is the point.
 */

/** The fixture archive is dated around this. Keep it in step with `fixtures.ts`. */
const FROZEN_NOW = new Date("2026-03-20T09:00:00.000Z").getTime();

const THEMES = ["light", "dark"] as const;

type Reach = (page: Page) => Promise<void>;

type Screen = {
  name: string;
  /** Query string, for the states that are not reachable by tapping. */
  search?: string;
  /** Text that is only on this screen once it has settled. */
  ready: string;
  reach?: Reach;
};

/**
 * The navigator keeps the screens you came from mounted and hidden, and the same
 * document title appears on Today and in the list. Every lookup therefore has to
 * be restricted to what is actually on screen, or it resolves to a hidden copy
 * and waits forever for that to become visible.
 */
const onScreen = (page: Page, text: string, exact = false) =>
  page.getByText(text, { exact }).filter({ visible: true }).first();

const tab = (label: string): Reach => async (page) => {
  await page.getByText(label, { exact: true }).filter({ visible: true }).last().click();
};

const SCREENS: Screen[] = [
  { name: "today", ready: "Recently added" },
  { name: "documents", ready: "documents", reach: tab("Documents") },
  {
    name: "documents-selection",
    // Without the queued and failed rows the list stops polling, which is what
    // makes a synthesised long press reliable.
    search: "?settled=1",
    ready: "Add tag",
    reach: async (page) => {
      await tab("Documents")(page);
      // `.last()`, not `.first()`: the navigator leaves the Today copy of this row
      // mounted, and Playwright still counts it as visible. The list screen is the
      // one that mounted last.
      const row = page.getByText("Stromabrechnung 2026").filter({ visible: true }).last();
      await row.waitFor();
      // Long press is the only way into selection mode, and a synthesised one
      // occasionally lands while the list is mid-refetch — so it gets retried
      // rather than being allowed to fail the screenshot.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await row.hover();
        await page.mouse.down();
        await page.waitForTimeout(700);
        await page.mouse.up();
        if (await onScreen(page, "Add tag").isVisible().catch(() => false)) {
          // Off the row again: a hovered row draws its pressed tint, which no
          // phone ever shows.
          await page.mouse.move(0, 0);
          return;
        }
        await page.waitForTimeout(300);
      }
    },
  },
  { name: "review", ready: "Confirm", reach: tab("Review") },
  { name: "chat", ready: "Ask your archive", reach: tab("Chat") },
  {
    name: "chat-answer",
    ready: "Sources",
    reach: async (page) => {
      await tab("Chat")(page);
      await page.getByPlaceholder(/Ask/i).fill("How much does the premium go up?");
      await page.getByRole("button", { name: "Send", exact: true }).click();
    },
  },
  {
    name: "document-detail",
    ready: "Issued",
    // Opened from Today's recent list rather than from Documents: that list polls
    // while a document is processing, and a list that re-renders every two
    // seconds never satisfies Playwright's "stable" check for a click.
    reach: async (page) => {
      await onScreen(page, "Beitragsanpassung Hausrat").click();
    },
  },
  {
    name: "document-details-tab",
    ready: "File",
    reach: async (page) => {
      await onScreen(page, "Beitragsanpassung Hausrat").click();
      await onScreen(page, "Details", true).click();
    },
  },
  {
    name: "document-history-tab",
    ready: "Changes",
    reach: async (page) => {
      await onScreen(page, "Beitragsanpassung Hausrat").click();
      await onScreen(page, "History", true).click();
    },
  },
  {
    name: "correspondents",
    ready: "documents",
    reach: async (page) => {
      await tab("Documents")(page);
      await page.getByRole("button", { name: "Correspondents", exact: true }).click();
    },
  },
  {
    name: "correspondent-dossier",
    ready: "Key changes",
    reach: async (page) => {
      await tab("Documents")(page);
      await page.getByRole("button", { name: "Correspondents", exact: true }).click();
      await onScreen(page, "Allianz Versicherung").click();
    },
  },
  {
    name: "settings",
    ready: "Appearance",
    reach: async (page) => {
      // The avatar is labelled with the signed-in name, which is how a
      // screen reader announces it.
      await page.getByRole("button", { name: "You", exact: true }).click();
    },
  },
  {
    name: "offline-archive",
    ready: "Delete the copy",
    reach: async (page) => {
      // The avatar is labelled with the signed-in name, which is how a
      // screen reader announces it.
      await page.getByRole("button", { name: "You", exact: true }).click();
      await onScreen(page, "Available offline", true).click();
    },
  },
  {
    name: "scan-draft",
    ready: "Images from files",
    reach: async (page) => {
      await page.getByRole("button", { name: "Scan & upload", exact: true }).click();
    },
  },
  { name: "connect", search: "?signedOut=1", ready: "Server URL" },
  { name: "today-offline", search: "?offline=1", ready: "Offline" },
  {
    name: "documents-offline",
    search: "?offline=1",
    ready: "documents",
    reach: tab("Documents"),
  },
];

/**
 * The clock, pinned through Playwright's own clock rather than by replacing the
 * `Date` global. Today's arrival labels and every overdue comparison read it, so
 * it has to be fixed — but a hand-rolled `FrozenDate` also freezes the timing
 * inside Playwright's injected helpers, and every click then waits forever for
 * an element to become "stable". `setFixedTime` fixes what the page reads and
 * leaves timers, and the helpers, alone.
 *
 * The pulsing dot on a processing row is deliberately not frozen for the same
 * reason: stopping `requestAnimationFrame` stops the stability check too. The dot
 * is seven pixels across, well inside the diff budget.
 */
async function pinEnvironment(page: Page) {
  await page.clock.setFixedTime(FROZEN_NOW);
}

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    for (const screen of SCREENS) {
      test(screen.name, async ({ page }) => {
        await pinEnvironment(page);
        await page.goto(`/${screen.search ?? ""}`);

        // The shell mounts before the fonts resolve, and the first shot would
        // otherwise differ from every later one. Wait for any content, then for
        // the faces — no locator, because a text marker that appears on some
        // screens and not others makes this ambiguous.
        await page.waitForFunction(() => document.body.innerText.trim().length > 0);
        await page.evaluate(() => document.fonts.ready);

        if (screen.reach) {
          await screen.reach(page);
        }

        await onScreen(page, screen.ready).waitFor();
        await page.waitForTimeout(250);

        await expect(page).toHaveScreenshot(`${screen.name}-${theme}.png`, { fullPage: false });
      });
    }
  });
}
