/**
 * One process that serves the built app and the mock API on the same origin,
 * so the browser needs no proxy and no CORS.
 *
 * The app is served from `dist/`, i.e. the production bundle — the same thing
 * users get. Any request under `/api` is answered by the mock instead.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const DIST = resolve(import.meta.dirname, "../dist");
const PORT = Number(process.env.VISUAL_PORT ?? 4173);

if (!existsSync(join(DIST, "index.html"))) {
  console.error(`[visual] no build at ${DIST} — run \`pnpm --filter @openkeep/web build\` first`);
  process.exit(1);
}

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

const { startMockApi } = await import("./mock-api.mjs");

// The mock listens on its own port; this server proxies /api to it rather than
// duplicating the routing table.
const MOCK_PORT = Number(process.env.MOCK_API_PORT ?? 4174);
await startMockApi(MOCK_PORT);

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (url.pathname.startsWith("/api")) {
    const upstream = await fetch(`http://127.0.0.1:${MOCK_PORT}${url.pathname}${url.search}`, {
      method: request.method,
      headers: { "content-type": "application/json" },
    }).catch(() => null);

    if (!upstream) {
      response.statusCode = 502;
      response.end("{}");
      return;
    }
    response.statusCode = upstream.status;
    response.setHeader("Content-Type", "application/json");
    response.end(await upstream.text());
    return;
  }

  // Static file, else fall through to index.html for client-side routes.
  const requested = normalize(join(DIST, url.pathname));
  const file =
    requested.startsWith(DIST) && existsSync(requested) && statSync(requested).isFile()
      ? requested
      : join(DIST, "index.html");

  response.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
  createReadStream(file).pipe(response);
});

server.listen(PORT, () => {
  console.log(`[visual] app + mock api on http://localhost:${PORT}`);
});
