import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const protocol = process.env.TYPESENSE_PROTOCOL || "http";
const host = process.env.TYPESENSE_HOST || "127.0.0.1";
const port = process.env.TYPESENSE_PORT || "8108";
const adminApiKey = process.env.TYPESENSE_ADMIN_API_KEY;
const collectionName =
  process.env.TYPESENSE_COLLECTION_NAME || "openkeep-docs";
const outputPath =
  process.env.TYPESENSE_SEARCH_API_KEY_FILE ||
  "/run/typesense/docs-search-api-key";
const description =
  process.env.TYPESENSE_SEARCH_KEY_DESCRIPTION ||
  `${collectionName}-search-only`;

if (!adminApiKey) {
  throw new Error("TYPESENSE_ADMIN_API_KEY is required");
}

const baseUrl = `${protocol}://${host}:${port}`;

const request = async (pathname, init = {}) => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-TYPESENSE-API-KEY": adminApiKey,
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(
      `Typesense request failed (${response.status} ${response.statusText})`,
    );
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
};

const waitForTypesense = async () => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);

      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until Typesense is reachable.
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error("Timed out waiting for Typesense to become healthy");
};

const ensureFreshSearchKey = async () => {
  const existingKeys = await request("/keys");

  for (const key of existingKeys.keys || []) {
    if (key.description === description) {
      await request(`/keys/${key.id}`, { method: "DELETE" });
    }
  }

  const createdKey = await request("/keys", {
    method: "POST",
    body: JSON.stringify({
      description,
      actions: ["documents:search"],
      collections: [collectionName],
    }),
  });

  if (!createdKey.value) {
    throw new Error("Typesense did not return a search-only key value");
  }

  return createdKey.value;
};

await waitForTypesense();

const searchApiKey = await ensureFreshSearchKey();
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${searchApiKey}\n`, "utf8");

console.log(`Wrote Typesense search-only key to ${outputPath}`);
