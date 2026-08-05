/**
 * Serves the exported web bundle. No mock API here — unlike the web app, the
 * mobile app reaches a server only through `authFetch`/`streamFetch`, and those
 * are the two things the visual build replaces with fixtures. So this is a plain
 * static file server with an index fallback.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const DIST = resolve(import.meta.dirname, "dist");
const PORT = Number(process.env.MOBILE_VISUAL_PORT ?? 5183);

if (!existsSync(join(DIST, "index.html"))) {
  console.error(`[visual] no bundle at ${DIST} — run \`pnpm --filter @openkeep/mobile visual:build\``);
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const requested = normalize(join(DIST, decodeURIComponent(url.pathname)));

  const file =
    requested.startsWith(DIST) && existsSync(requested) && statSync(requested).isFile()
      ? requested
      : join(DIST, "index.html");

  response.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
  // The screenshots must not race a stale cache between runs.
  response.setHeader("Cache-Control", "no-store");
  createReadStream(file).pipe(response);
});

server.listen(PORT, () => {
  console.log(`[visual] serving ${DIST} on http://localhost:${PORT}`);
});
