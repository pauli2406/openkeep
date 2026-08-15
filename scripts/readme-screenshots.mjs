/**
 * Regenerates the product screenshots embedded in `README.md`.
 *
 * These are real renders of the production web bundle — not mockups. The app
 * is served from `apps/web/dist` and pointed at the same fixed mock API the
 * visual suite uses (`apps/web/visual/mock-api.mjs`), so every figure in the
 * README shows the shipping UI against a demo archive that is stable across
 * runs: no database, no clock, no randomness.
 *
 * Two things are added on top of the visual suite's fixtures, because a README
 * has to show a *populated* product where a regression baseline only has to
 * show a stable one:
 *
 *   - a synthetic scanned invoice, so preview panes render paper instead of
 *     "No preview available";
 *   - a seeded chat conversation, so the answer surface shows an answer with
 *     citations. Conversations are browser-local, so this is a localStorage
 *     write rather than a mock route.
 *
 * Usage:
 *   pnpm --filter @openkeep/web build
 *   node scripts/readme-screenshots.mjs
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { DOCUMENTS, FROZEN_NOW, ROUTES } from "../apps/web/visual/mock-api.mjs";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const DIST = resolve(ROOT, "apps/web/dist");
const OUT = resolve(ROOT, "docs/images");
const PORT = Number(process.env.README_SHOT_PORT ?? 4188);

/** Retina: the README is read on high-DPI displays far more often than not. */
const SCALE = 2;
const WIDTH = 1440;
const HEIGHT = 900;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

// ---------------------------------------------------------------------------
// Demo scan
// ---------------------------------------------------------------------------

/**
 * The document the preview panes show. It is deliberately a *plausible*
 * German utility bill rather than lorem ipsum: the extracted fields beside it
 * (correspondent, issue date, amount, reference) come from the mock fixture,
 * and a reader should be able to check them against the paper.
 */
const DEMO_SCAN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { margin: 0 }
  body {
    margin: 0; width: 794px; height: 1123px; padding: 64px 72px;
    box-sizing: border-box; background: #fff; color: #1c1c1a;
    font: 13px/1.55 -apple-system, "Helvetica Neue", Arial, sans-serif;
  }
  .head { display: flex; justify-content: space-between; align-items: flex-start; }
  .brand { font-size: 19px; font-weight: 700; letter-spacing: -0.01em; color: #0f3d33; }
  .brand small { display: block; font-size: 11px; font-weight: 500; color: #6b6b66; letter-spacing: 0.06em; text-transform: uppercase; }
  .meta { text-align: right; font-size: 11.5px; color: #55554f; }
  .addr { margin-top: 56px; font-size: 12.5px; color: #33332f; }
  h1 { font-size: 17px; margin: 40px 0 6px; }
  .sub { color: #6b6b66; font-size: 12px; margin-bottom: 26px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; font-size: 10.5px; letter-spacing: 0.07em; text-transform: uppercase; color: #6b6b66; border-bottom: 1px solid #d9d9d2; padding-bottom: 7px; }
  td { padding: 9px 0; border-bottom: 1px solid #ececE4; font-size: 12.5px; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  .total td { border-bottom: none; border-top: 2px solid #1c1c1a; font-weight: 700; padding-top: 11px; font-size: 14px; }
  .pay { margin-top: 34px; padding: 16px 18px; background: #f6f5f0; border-left: 3px solid #0f3d33; font-size: 12.5px; }
  .pay b { display: block; margin-bottom: 4px; }
  .foot { position: absolute; bottom: 56px; left: 72px; right: 72px; padding-top: 12px; border-top: 1px solid #ececE4; font-size: 10px; color: #8a8a83; display: flex; justify-content: space-between; }
</style></head><body>
  <div class="head">
    <div class="brand">Stadtwerke München<small>Energie &amp; Wasser</small></div>
    <div class="meta">
      Rechnungsnummer <b>INV-2026-0000</b><br>
      Rechnungsdatum 10.01.2026<br>
      Kundennummer 4417-208-3
    </div>
  </div>
  <div class="addr">M. Keeper<br>Lindwurmstraße 88<br>80337 München</div>
  <h1>Stromabrechnung 2026</h1>
  <div class="sub">Abrechnungszeitraum 01.01.2025 – 31.12.2025 · Zählernummer 1EMH0080719421</div>
  <table>
    <thead><tr><th>Position</th><th class="n">Menge</th><th class="n">Einzelpreis</th><th class="n">Betrag</th></tr></thead>
    <tbody>
      <tr><td>Arbeitspreis Strom</td><td class="n">2.184 kWh</td><td class="n">0,3180 €</td><td class="n">694,51 €</td></tr>
      <tr><td>Grundpreis</td><td class="n">12 Monate</td><td class="n">9,90 €</td><td class="n">118,80 €</td></tr>
      <tr><td>Abschlagszahlungen</td><td class="n">12 × 68,00 €</td><td class="n"></td><td class="n">−816,00 €</td></tr>
      <tr><td>Umsatzsteuer 19 %</td><td class="n"></td><td class="n"></td><td class="n">42,69 €</td></tr>
      <tr class="total"><td>Zu zahlender Betrag</td><td class="n"></td><td class="n"></td><td class="n">40,00 €</td></tr>
    </tbody>
  </table>
  <div class="pay">
    <b>Zahlbar bis 18.03.2026</b>
    IBAN DE22 7015 0000 0000 1234 56 · BIC SSKMDEMM · Verwendungszweck INV-2026-0000
  </div>
  <div class="foot"><span>Stadtwerke München GmbH · Emmy-Noether-Straße 2 · 80992 München</span><span>Seite 1 von 2</span></div>
</body></html>`;

// ---------------------------------------------------------------------------
// Seeded chat conversation
// ---------------------------------------------------------------------------

const CHAT_CONVERSATIONS = [
  {
    id: "e0000000-0000-4000-8000-000000000001",
    title: "What do I still owe this quarter?",
    at: new Date(FROZEN_NOW).getTime() - 2 * 60 * 60 * 1000,
    turns: [
      {
        question: "What do I still owe this quarter, and when is each one due?",
        answer:
          "Three bills are still open for Q1 2026, totalling **262,50 €**:\n\n" +
          "- **40,00 €** to Stadtwerke München for the 2026 electricity settlement, due 18.03.2026 — this one is already past due [1].\n" +
          "- **80,50 €** to Telekom Deutschland for the March mobile invoice, due 15.04.2026 [2].\n" +
          "- **142,00 €** to HUK-Coburg for the liability policy instalment, due 15.04.2026 [3].\n\n" +
          "The electricity settlement is the only one that carries a late-payment clause: " +
          "the invoice states a 1 % monthly surcharge after the due date [1].",
        citations: [
          {
            documentId: DOCUMENTS[0].id,
            documentTitle: "Stromabrechnung 2026",
            chunkIndex: 2,
            pageFrom: 1,
            pageTo: 1,
            quote:
              "Zu zahlender Betrag 40,00 € — zahlbar bis 18.03.2026. Nach Ablauf der Frist berechnen wir 1 % Verzugszuschlag je angefangenem Monat.",
            score: 0.91,
            index: 1,
            used: true,
          },
          {
            documentId: DOCUMENTS[3].id,
            documentTitle: "Mobilfunk Rechnung März",
            chunkIndex: 1,
            pageFrom: 1,
            pageTo: 1,
            quote:
              "Rechnungsbetrag 80,50 € wird am 15.04.2026 von Ihrem Konto eingezogen.",
            score: 0.84,
            index: 2,
            used: true,
          },
          {
            documentId: DOCUMENTS[2].id,
            documentTitle: "Haftpflicht Police",
            chunkIndex: 3,
            pageFrom: 2,
            pageTo: 2,
            quote:
              "Beitrag für den Zeitraum 01.01.2026 – 31.03.2026: 142,00 €, fällig am 15.04.2026.",
            score: 0.79,
            index: 3,
            used: true,
          },
        ],
        structuredRows: null,
        structuredTitle: null,
      },
    ],
  },
  {
    id: "e0000000-0000-4000-8000-000000000002",
    title: "Which insurance covers water damage?",
    at: new Date(FROZEN_NOW).getTime() - 5 * 86_400_000,
    turns: [],
  },
];

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

function startServer(scanDocument) {
  // The download route has to win over the mock's `/api/documents/:id`, so it
  // is matched first rather than appended to the shared table.
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (/^\/api\/documents\/[^/]+\/download$/.test(url.pathname)) {
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(scanDocument);
      return;
    }

    if (url.pathname.startsWith("/api")) {
      const route = ROUTES.find(
        ([method, pattern]) => method === request.method && pattern.test(url.pathname),
      );
      response.setHeader("Content-Type", "application/json");
      if (!route) {
        console.warn(`[readme-shots] unhandled ${request.method} ${url.pathname}`);
        response.statusCode = 404;
        response.end(JSON.stringify({ message: "Not mocked", path: url.pathname }));
        return;
      }
      response.statusCode = 200;
      response.end(JSON.stringify(route[2](url)));
      return;
    }

    const requested = normalize(join(DIST, url.pathname));
    const file =
      requested.startsWith(DIST) && existsSync(requested) && statSync(requested).isFile()
        ? requested
        : join(DIST, "index.html");

    response.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
    createReadStream(file).pipe(response);
  });

  return new Promise((done) => server.listen(PORT, () => done(server)));
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

/**
 * `prepare` runs after the route has settled and before the capture, for the
 * one or two states that only exist after an interaction.
 */
const openFirstCitation = async (page) => {
  await page.getByRole("button", { name: /Stromabrechnung 2026/ }).first().click();
  await page.getByText("Cited passage").first().waitFor({ state: "visible" });
};

const SHOTS = [
  { name: "today", path: "/", theme: "light" },
  { name: "documents", path: "/documents", theme: "light" },
  { name: "chat", path: "/search", theme: "light", prepare: openFirstCitation },
  { name: "review", path: "/review", theme: "light" },
  { name: "settings-providers", path: "/settings/providers", theme: "light" },
  { name: "today-dark", path: "/", theme: "dark" },
];

/**
 * Pin everything that would otherwise vary between runs: the clock (relative
 * dates like "3 days overdue"), the stored theme, and the auth tokens the app
 * reads on boot. Mirrors `apps/web/visual/screens.visual.ts`.
 */
async function pinEnvironment(page, theme) {
  await page.addInitScript(
    ({ now, storedTheme, conversations }) => {
      const RealDate = Date;
      class FrozenDate extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [now]));
        }
        static now() {
          return now;
        }
      }
      globalThis.Date = FrozenDate;

      window.localStorage.setItem("openkeep.access-token", "readme-access-token");
      window.localStorage.setItem("openkeep.refresh-token", "readme-refresh-token");
      window.localStorage.setItem("openkeep.theme", storedTheme);
      window.localStorage.setItem("openkeep.chat-conversations", conversations);
      document.documentElement.setAttribute("data-theme", storedTheme);
    },
    {
      now: new Date(FROZEN_NOW).getTime(),
      storedTheme: theme,
      conversations: JSON.stringify(CHAT_CONVERSATIONS),
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
      .animate-spin { visibility: hidden !important; }
    `,
  });
}

async function main() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error(
      `[readme-shots] no build at ${DIST} — run \`pnpm --filter @openkeep/web build\` first`,
    );
    process.exit(1);
  }

  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();

  // Render the demo scan first: the server needs its bytes before it starts.
  //
  // The download route serves it as an HTML wrapper around the rendered page
  // rather than as a bare PNG. The preview panes are narrow iframes, and an
  // image served on its own renders at its intrinsic size — i.e. cropped to
  // its top-left corner. Wrapped, it scales to whatever pane it lands in.
  const scanPage = await browser.newPage({
    viewport: { width: 794, height: 1123 },
    deviceScaleFactor: 2,
  });
  await scanPage.setContent(DEMO_SCAN_HTML, { waitUntil: "load" });
  const scanPng = await scanPage.screenshot({ type: "png" });
  await scanPage.close();

  const scanDocument =
    `<!doctype html><meta charset="utf-8">` +
    `<style>html,body{margin:0;background:#fff}img{display:block;width:100%;height:auto}</style>` +
    `<img alt="" src="data:image/png;base64,${scanPng.toString("base64")}">`;

  const server = await startServer(scanDocument);
  console.log(`[readme-shots] serving ${DIST} on http://localhost:${PORT}`);

  for (const shot of SHOTS) {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: SCALE,
      colorScheme: shot.theme,
    });
    const page = await context.newPage();
    await pinEnvironment(page, shot.theme);
    await page.goto(`http://localhost:${PORT}${shot.path}`);

    await page.locator("main").first().waitFor({ state: "visible" });
    await page.evaluate(() => document.fonts.ready.then(() => true));

    const fontLoaded = await page.evaluate(() =>
      document.fonts.check('600 16px "Public Sans"'),
    );
    if (!fontLoaded) {
      throw new Error("Public Sans did not load — the screenshots would be off-brand");
    }

    // Same gate the visual suite uses: nothing still fetching, nothing spinning.
    await page.waitForFunction(
      () => document.querySelectorAll("[data-pending], .animate-spin").length === 0,
      undefined,
      { timeout: 15_000 },
    );

    if (shot.prepare) await shot.prepare(page);

    await page.screenshot({ path: join(OUT, `${shot.name}.png`) });
    console.log(`[readme-shots] wrote docs/images/${shot.name}.png`);
    await context.close();
  }

  await browser.close();
  server.close();
}

await main();
