import { spawnSync } from "node:child_process";

const protocol = process.env.TYPESENSE_PUBLIC_PROTOCOL || "http";
const host = process.env.TYPESENSE_PUBLIC_HOST || "127.0.0.1";
const port = process.env.TYPESENSE_PUBLIC_PORT || "8108";
const adminApiKey =
  process.env.TYPESENSE_ADMIN_API_KEY || "change-me-typesense-admin-key";
const collectionAlias = process.env.TYPESENSE_COLLECTION_NAME || "openkeep-docs";
const baseUrl = `${protocol}://${host}:${port}`;

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

const result = spawnSync(
  "docker",
  ["compose", "run", "--rm", "docs-search-indexer"],
  {
    stdio: "inherit",
  },
);

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
