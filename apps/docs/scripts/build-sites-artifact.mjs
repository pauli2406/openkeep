import { access, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildDirectory = resolve(root, "build");
const distDirectory = resolve(root, "dist");
const clientDirectory = resolve(distDirectory, "client");
const serverDirectory = resolve(distDirectory, "server");
const openAiDirectory = resolve(distDirectory, ".openai");
const hostingConfig = resolve(root, ".openai", "hosting.json");
const publicDirectory = resolve(root, "public");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function assertExists(path, label) {
  if (!(await exists(path))) {
    throw new Error(`${label} is missing at ${path}`);
  }
}

const worker = `const FILE_EXTENSION = /\\/[^/]+\\.[^/]+$/;

function makeAssetRequest(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, request);
}

async function fetchFirstExistingAsset(request, env, candidates) {
  for (const pathname of candidates) {
    const response = await env.ASSETS.fetch(makeAssetRequest(request, pathname));
    if (response.status !== 404) {
      return response;
    }
  }

  return null;
}

function candidatePaths(pathname) {
  if (pathname === "/") {
    return ["/index.html"];
  }

  const normalizedPathname =
    pathname.endsWith("/") && pathname.length > 1
      ? pathname.slice(0, -1)
      : pathname;

  if (FILE_EXTENSION.test(normalizedPathname)) {
    return [normalizedPathname];
  }

  return [\`\${normalizedPathname}.html\`, \`\${normalizedPathname}/index.html\`];
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }

    const { pathname } = new URL(request.url);
    const response = await fetchFirstExistingAsset(
      request,
      env,
      candidatePaths(pathname),
    );

    if (response) {
      return response;
    }

    const notFoundResponse = await env.ASSETS.fetch(
      makeAssetRequest(request, "/404.html"),
    );

    return new Response(notFoundResponse.body, {
      status: 404,
      headers: notFoundResponse.headers,
    });
  },
};
`;

await assertExists(buildDirectory, "Docusaurus build output");
await assertExists(hostingConfig, "Sites hosting metadata");

await rm(distDirectory, { recursive: true, force: true });
await mkdir(clientDirectory, { recursive: true });
await mkdir(serverDirectory, { recursive: true });
await mkdir(openAiDirectory, { recursive: true });

await cp(buildDirectory, clientDirectory, { recursive: true });

if (await exists(publicDirectory)) {
  await cp(publicDirectory, clientDirectory, { recursive: true });
}

await writeFile(resolve(serverDirectory, "index.js"), worker, "utf8");
await cp(hostingConfig, resolve(openAiDirectory, "hosting.json"));

await assertExists(resolve(clientDirectory, "index.html"), "Staged homepage");
await assertExists(resolve(clientDirectory, "docs.html"), "Staged docs index");
await assertExists(resolve(serverDirectory, "index.js"), "Staged Worker entry");
await assertExists(
  resolve(openAiDirectory, "hosting.json"),
  "Staged Sites metadata",
);

console.log(`Prepared Sites artifact in ${distDirectory}`);
