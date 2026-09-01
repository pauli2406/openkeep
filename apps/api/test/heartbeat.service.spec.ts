import type { AppConfig } from "@openkeep/config";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppConfigService } from "../src/common/config/app-config.service";
import { HeartbeatService, type HeartbeatTransport } from "../src/health/heartbeat.service";
import type { ReadinessReport, ReadinessService } from "../src/health/readiness.service";

const PING_URL = "https://hc-ping.com/11111111-2222-3333-4444-555555555555";

const okReport: ReadinessReport = {
  status: "ok",
  checks: { database: true, objectStorage: true, queue: true },
  failures: {},
};

const degradedReport: ReadinessReport = {
  status: "degraded",
  checks: { database: true, objectStorage: false, queue: false },
  failures: {
    objectStorage: "NoSuchBucket",
    queue: "pg-boss schema pgboss is not ready",
  },
};

function configWith(overrides: Partial<AppConfig>): AppConfigService {
  return new AppConfigService({
    HEARTBEAT_INTERVAL_SECONDS: 60,
    SKIP_EXTERNAL_INIT: false,
    ...overrides,
  } as AppConfig);
}

function build(options: {
  process?: "api" | "worker";
  config?: Partial<AppConfig>;
  readiness?: () => Promise<ReadinessReport>;
  transport?: HeartbeatTransport;
}) {
  const transport = vi.fn<HeartbeatTransport>(
    options.transport ?? (async () => new Response(null, { status: 200 })),
  );
  const check = vi.fn(options.readiness ?? (async () => okReport));
  const readiness = { check } as unknown as ReadinessService;
  const service = new HeartbeatService(
    options.process ?? "api",
    configWith(options.config ?? {}),
    readiness,
    transport,
  );
  return { service, transport, check };
}

describe("HeartbeatService", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("pings the URL with GET when every readiness check passes", async () => {
    const { service, transport } = build({ config: { HEARTBEAT_URL_API: PING_URL } });

    await service.tick();

    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe(PING_URL);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("reports to /fail with the failed checks when readiness is degraded", async () => {
    const { service, transport } = build({
      process: "worker",
      config: { HEARTBEAT_URL_WORKER: PING_URL },
      readiness: async () => degradedReport,
    });

    await service.tick();

    const [url, init] = transport.mock.calls[0];
    expect(url).toBe(`${PING_URL}/fail`);
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("worker readiness degraded");
    expect(String(init.body)).toContain("objectStorage: NoSuchBucket");
    expect(String(init.body)).toContain("queue: pg-boss schema pgboss is not ready");
    expect(String(init.body)).not.toContain("database");
  });

  it("reports to /fail when the probe itself throws", async () => {
    const { service, transport } = build({
      config: { HEARTBEAT_URL_API: PING_URL },
      readiness: async () => {
        throw new Error("pool is closed");
      },
    });

    await service.tick();

    const [url, init] = transport.mock.calls[0];
    expect(url).toBe(`${PING_URL}/fail`);
    expect(String(init.body)).toContain("pool is closed");
  });

  it("swallows transport failures and non-2xx responses", async () => {
    const failing = build({
      config: { HEARTBEAT_URL_API: PING_URL },
      transport: async () => {
        throw new Error("ECONNRESET");
      },
    });
    await expect(failing.service.tick()).resolves.toBeUndefined();

    const rejected = build({
      config: { HEARTBEAT_URL_API: PING_URL },
      transport: async () => new Response(null, { status: 503 }),
    });
    await expect(rejected.service.tick()).resolves.toBeUndefined();
  });

  it("does nothing when the URL for its process is unset", async () => {
    // The API URL is set, but this is the worker: it must not borrow it.
    const { service, transport, check } = build({
      process: "worker",
      config: { HEARTBEAT_URL_API: PING_URL },
    });

    service.onModuleInit();
    await service.tick();

    expect(check).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("stays quiet under SKIP_EXTERNAL_INIT", () => {
    vi.useFakeTimers();
    const { service, transport } = build({
      config: { HEARTBEAT_URL_API: PING_URL, SKIP_EXTERNAL_INIT: true },
    });

    service.onModuleInit();
    vi.advanceTimersByTime(120_000);

    expect(transport).not.toHaveBeenCalled();
  });

  it("pings immediately on init, then on every interval, and stops on destroy", async () => {
    vi.useFakeTimers();
    const { service, transport } = build({
      config: { HEARTBEAT_URL_API: PING_URL, HEARTBEAT_INTERVAL_SECONDS: 30 },
    });

    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport).toHaveBeenCalledTimes(2);

    service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("collapses overlapping ticks into the one in flight", async () => {
    let release: () => void = () => undefined;
    const { service, check } = build({
      config: { HEARTBEAT_URL_API: PING_URL },
      readiness: () =>
        new Promise<ReadinessReport>((resolve) => {
          release = () => resolve(okReport);
        }),
    });

    const first = service.tick();
    const second = service.tick();
    expect(second).toBe(first);
    expect(check).toHaveBeenCalledTimes(1);

    release();
    await first;
  });
});
