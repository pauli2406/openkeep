import { describe, expect, it } from "vitest";

import type { DatabaseService } from "../src/common/db/database.service";
import type { ObjectStorageService } from "../src/common/storage/storage.service";
import { ReadinessService } from "../src/health/readiness.service";
import type { BossService } from "../src/processing/boss.service";

function build(options: {
  database?: () => Promise<unknown>;
  storage?: () => Promise<void>;
  queue?: () => Promise<void>;
}) {
  const database = {
    pool: { query: options.database ?? (async () => ({ rows: [] })) },
  } as unknown as DatabaseService;
  const storage = {
    ensureReady: options.storage ?? (async () => undefined),
  } as unknown as ObjectStorageService;
  const boss = {
    ensureReady: options.queue ?? (async () => undefined),
  } as unknown as BossService;
  return new ReadinessService(database, storage, boss);
}

describe("ReadinessService", () => {
  it("is ok when every dependency answers", async () => {
    const report = await build({}).check();

    expect(report).toEqual({
      status: "ok",
      checks: { database: true, objectStorage: true, queue: true },
      failures: {},
    });
  });

  it("names each failed dependency with its error, and still runs the others", async () => {
    const report = await build({
      storage: async () => {
        throw new Error("NoSuchBucket");
      },
      queue: async () => {
        throw "schema missing";
      },
    }).check();

    expect(report.status).toBe("degraded");
    expect(report.checks).toEqual({ database: true, objectStorage: false, queue: false });
    expect(report.failures).toEqual({
      objectStorage: "NoSuchBucket",
      queue: "schema missing",
    });
  });
});
