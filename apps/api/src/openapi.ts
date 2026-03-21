import "reflect-metadata";

import { writeFile } from "fs/promises";
import { resolve } from "path";

import { createApp } from "./bootstrap";

async function generateOpenApi() {
  process.env.SKIP_EXTERNAL_INIT = "true";
  process.env.JWT_ACCESS_SECRET ??= "openkeep-docs-access-secret-123456789";
  process.env.JWT_REFRESH_SECRET ??= "openkeep-docs-refresh-secret-123456789";
  const { app, document } = await createApp();
  await writeFile(resolve(process.cwd(), "openapi.json"), JSON.stringify(document, null, 2));
  await app.close();
}

generateOpenApi();
