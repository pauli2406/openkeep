import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const envPath = resolve(repoRoot, ".env");
const provider = process.argv[2];

if (!provider) {
  console.error("Missing provider id");
  process.exit(1);
}

if (existsSync(envPath)) {
  const source = readFileSync(envPath, "utf8");
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

process.env.RUN_CLOUD_PARSE_E2E = "1";
process.env.E2E_PARSE_PROVIDER = provider;

const result = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", "test/cloud-parse.acceptance.spec.ts"],
  {
    cwd: resolve(repoRoot, "apps/api"),
    stdio: "inherit",
    env: process.env,
  },
);

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
