import { beforeEach, describe, expect, it, vi } from "vitest";

import { BossService } from "../src/processing/boss.service";

const workMock = vi.fn();
const sendMock = vi.fn();
const startMock = vi.fn();

vi.mock("pg-boss", () => {
  return {
    default: class PgBossMock {
      work = workMock;
      send = sendMock;
      start = startMock;
      createQueue = vi.fn();
      stop = vi.fn();
    },
  };
});

const createConfigService = (overrides: Record<string, unknown> = {}) => ({
  get: (key: string) => {
    const values: Record<string, unknown> = {
      SKIP_EXTERNAL_INIT: true,
      PG_BOSS_SCHEMA: "pgboss",
      PROCESSING_RETRY_LIMIT: 2,
      PROCESSING_RETRY_DELAY_SECONDS: 30,
      DATABASE_URL: "postgres://localhost/test",
      ...overrides,
    };
    return values[key];
  },
});

const createDatabaseService = (queryResult: { rowCount: number | null } = { rowCount: 0 }) => ({
  pool: {
    query: vi.fn().mockResolvedValue(queryResult),
  },
});

describe("BossService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("subscribes with includeMetadata so pg-boss exposes the real retryCount", async () => {
    const service = new BossService(
      createConfigService() as never,
      createDatabaseService() as never,
    );

    const handler = vi.fn();
    await service.work("document-processing", handler);

    expect(workMock).toHaveBeenCalledWith(
      "document-processing",
      expect.objectContaining({ includeMetadata: true }),
      expect.any(Function),
    );
  });

  it("passes the pg-boss retryCount (camelCase) through to the handler", async () => {
    const service = new BossService(
      createConfigService() as never,
      createDatabaseService() as never,
    );

    const handler = vi.fn().mockResolvedValue(undefined);
    await service.work("document-processing", handler);

    const bossHandler = workMock.mock.calls[0][2];
    await bossHandler([
      {
        id: "job-1",
        data: { documentId: "doc-1" },
        retryCount: 2,
        // legacy lowercase field must NOT be what we read
        retrycount: 0,
      },
    ]);

    expect(handler).toHaveBeenCalledWith({ documentId: "doc-1" }, "job-1", 2);
  });

  it("ignores empty job batches", async () => {
    const service = new BossService(
      createConfigService() as never,
      createDatabaseService() as never,
    );

    const handler = vi.fn();
    await service.work("document-processing", handler);

    const bossHandler = workMock.mock.calls[0][2];
    await bossHandler([]);

    expect(handler).not.toHaveBeenCalled();
  });

  it("reports no active job when external init is skipped", async () => {
    const databaseService = createDatabaseService({ rowCount: 1 });
    const service = new BossService(createConfigService() as never, databaseService as never);

    await expect(service.hasActiveJobForDocument("document-processing", "doc-1")).resolves.toBe(
      false,
    );
    expect(databaseService.pool.query).not.toHaveBeenCalled();
  });

  it("checks the pg-boss job table for active jobs of a document", async () => {
    const databaseService = createDatabaseService({ rowCount: 1 });
    const service = new BossService(
      createConfigService({ SKIP_EXTERNAL_INIT: false }) as never,
      databaseService as never,
    );

    await expect(service.hasActiveJobForDocument("document-processing", "doc-1")).resolves.toBe(
      true,
    );

    const [query, params] = databaseService.pool.query.mock.calls[0];
    expect(query).toContain(`FROM "pgboss".job`);
    expect(query).toContain("state IN ('created', 'retry', 'active')");
    expect(params).toEqual(["document-processing", "doc-1"]);
  });
});
