import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import { AppConfigService } from "../common/config/app-config.service";
import { fetchWithTimeout } from "../processing/http.util";
import { ReadinessService } from "./readiness.service";

export type HeartbeatProcess = "api" | "worker";

export const HEARTBEAT_PROCESS = Symbol("HEARTBEAT_PROCESS");
export const HEARTBEAT_TRANSPORT = Symbol("HEARTBEAT_TRANSPORT");

export type HeartbeatTransport = (url: string, init: RequestInit) => Promise<Response>;

const PING_TIMEOUT_MS = 10_000;

export const defaultHeartbeatTransport: HeartbeatTransport = (url, init) =>
  fetchWithTimeout(url, init, PING_TIMEOUT_MS);

/**
 * Dead-man's-switch heartbeat for one process.
 *
 * An HTTP uptime monitor can only see the API, and only through Cloudflare
 * Access. This inverts the direction: the process itself proves it is alive by
 * pinging a monitor URL (healthchecks.io style) on a fixed interval, after
 * probing the dependencies it needs. If the process dies, the pings stop and
 * the monitor alerts once its grace period runs out. If a dependency is gone,
 * the process says so right away through the monitor's `/fail` endpoint.
 *
 * The API and the worker are separate containers with separate URLs, so each
 * crash is attributed to the right one.
 */
@Injectable()
export class HeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HeartbeatService.name);
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(
    @Inject(HEARTBEAT_PROCESS) private readonly process: HeartbeatProcess,
    @Inject(AppConfigService) private readonly configService: AppConfigService,
    @Inject(ReadinessService) private readonly readiness: ReadinessService,
    @Inject(HEARTBEAT_TRANSPORT) private readonly transport: HeartbeatTransport,
  ) {}

  /** The ping URL for this process, or undefined when heartbeats are off. */
  get url(): string | undefined {
    return this.process === "api"
      ? this.configService.get("HEARTBEAT_URL_API")
      : this.configService.get("HEARTBEAT_URL_WORKER");
  }

  onModuleInit(): void {
    const url = this.url;
    if (!url || this.configService.get("SKIP_EXTERNAL_INIT")) {
      return;
    }

    const intervalSeconds = this.configService.get("HEARTBEAT_INTERVAL_SECONDS");
    this.logger.log(`Heartbeat for ${this.process} every ${intervalSeconds}s`);

    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalSeconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * One heartbeat: probe, then report. Never throws — a monitoring hiccup must
   * not become an application error. Overlapping ticks (a probe slower than
   * the interval) collapse into the one already running.
   */
  tick(): Promise<void> {
    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async run(): Promise<void> {
    const url = this.url;
    if (!url) {
      return;
    }

    let target = url;
    let body: string | undefined;

    try {
      const report = await this.readiness.check();
      if (report.status !== "ok") {
        const failed = Object.entries(report.failures)
          .map(([check, message]) => `${check}: ${message}`)
          .join("\n");
        target = `${url}/fail`;
        body = `${this.process} readiness degraded\n${failed}`;
        this.logger.warn(`Heartbeat reporting failure: ${failed.replace(/\n/g, "; ")}`);
      }
    } catch (error) {
      target = `${url}/fail`;
      body = `${this.process} readiness probe threw: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }

    try {
      const response = await this.transport(target, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { "Content-Type": "text/plain" },
        body,
      });
      if (!response.ok) {
        this.logger.warn(`Heartbeat ping to ${target} returned HTTP ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(
        `Heartbeat ping to ${target} failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
