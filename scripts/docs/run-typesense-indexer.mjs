import { spawnSync } from "node:child_process";

const scraperRunner = process.env.TYPESENSE_DOCSEARCH_RUNNER || "compose";
const scraperImage =
  process.env.TYPESENSE_DOCSEARCH_IMAGE || "typesense/docsearch-scraper:0.11.0";
const protocol = process.env.TYPESENSE_PUBLIC_PROTOCOL || "http";
const host = process.env.TYPESENSE_PUBLIC_HOST || "127.0.0.1";
const port = process.env.TYPESENSE_PUBLIC_PORT || "8108";
const adminApiKey =
  process.env.TYPESENSE_ADMIN_API_KEY || "change-me-typesense-admin-key";
const collectionAlias = process.env.TYPESENSE_COLLECTION_NAME || "openkeep-docs";
const baseUrl = `${protocol}://${host}:${port}`;

const runScraper = () => {
  if (scraperRunner === "compose") {
    return spawnSync("docker", ["compose", "run", "--rm", "docs-search-indexer"], {
      stdio: "inherit",
    });
  }

  if (scraperRunner !== "docker") {
    throw new Error(
      `Unsupported TYPESENSE_DOCSEARCH_RUNNER value: ${scraperRunner}`,
    );
  }

  if (!process.env.DOCSEARCH_START_URL) {
    throw new Error("DOCSEARCH_START_URL is required when using docker mode");
  }

  const startUrl = new URL(process.env.DOCSEARCH_START_URL);
  const sitemapUrl =
    process.env.DOCSEARCH_SITEMAP_URL || new URL("/sitemap.xml", startUrl).toString();
  const stopUrl =
    process.env.DOCSEARCH_STOP_URL || new URL("/search", startUrl).toString();
  const config = JSON.stringify({
    index_name: collectionAlias,
    start_urls: [{ url: startUrl.toString() }],
    allowed_domains: [startUrl.hostname],
    sitemap_urls: [sitemapUrl],
    stop_urls: [stopUrl],
    selectors: {
      default: {
        lvl0: "header h1",
        lvl1: "article h1, header h1",
        lvl2: "article h2",
        lvl3: "article h3",
        lvl4: "article h4",
        lvl5: "article h5",
        lvl6: "article h6",
        text: "article p, article li, article td, article th, article code",
      },
    },
    strip_chars: " .,;:#",
    scrape_start_urls: false,
  });

  return spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-e",
      `TYPESENSE_API_KEY=${adminApiKey}`,
      "-e",
      `TYPESENSE_HOST=${host}`,
      "-e",
      `TYPESENSE_PORT=${port}`,
      "-e",
      `TYPESENSE_PROTOCOL=${protocol}`,
      "-e",
      `CONFIG=${config}`,
      scraperImage,
    ],
    {
      stdio: "inherit",
    },
  );
};

const request = async (pathname, init = {}) => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      "X-TYPESENSE-API-KEY": adminApiKey,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });

  if (response.status === 404) {
    return { status: 404, body: null };
  }

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(
      `Typesense request failed (${response.status} ${response.statusText})`,
    );
  }

  return { status: response.status, body };
};

const existingAlias = await request(`/aliases/${collectionAlias}`);
const previousCollectionName = existingAlias.body?.collection_name;

if (previousCollectionName) {
  console.log(
    `Removing alias ${collectionAlias} before reindexing to avoid synonym-transfer failures`,
  );
  await request(`/aliases/${collectionAlias}`, { method: "DELETE" });
}

const result = runScraper();

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (previousCollectionName) {
  const currentAlias = await request(`/aliases/${collectionAlias}`);
  const currentCollectionName = currentAlias.body?.collection_name;

  if (
    currentCollectionName &&
    currentCollectionName !== previousCollectionName
  ) {
    console.log(`Deleting stale Typesense collection ${previousCollectionName}`);
    await request(`/collections/${previousCollectionName}`, { method: "DELETE" });
  }
}

const collections = await request("/collections");
const currentAlias = await request(`/aliases/${collectionAlias}`);
const activeCollectionName = currentAlias.body?.collection_name;

for (const collection of collections.body || []) {
  if (
    collection.name.startsWith(`${collectionAlias}_`) &&
    collection.name !== activeCollectionName
  ) {
    console.log(`Deleting stale Typesense collection ${collection.name}`);
    await request(`/collections/${collection.name}`, { method: "DELETE" });
  }
}
