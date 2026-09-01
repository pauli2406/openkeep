import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../common/db/database.service";
import { ObjectStorageService } from "../common/storage/storage.service";
import { BossService } from "../processing/boss.service";

export type ReadinessCheck = "database" | "objectStorage" | "queue";

export interface ReadinessReport {
  status: "ok" | "degraded";
  checks: Record<ReadinessCheck, boolean>;
  /** Error message per failed check; empty when everything passed. */
  failures: Partial<Record<ReadinessCheck, string>>;
}

/**
 * The one place that knows what "this process can do its job" means: the
 * database answers, the bucket exists, the pg-boss schema is migrated. The
 * readiness endpoint and the heartbeat both consume it, so the external
 * monitor never disagrees with what `/api/health/ready` would have said.
 */
@Injectable()
export class ReadinessService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(ObjectStorageService) private readonly storageService: ObjectStorageService,
    @Inject(BossService) private readonly bossService: BossService,
  ) {}

  async check(): Promise<ReadinessReport> {
    const probes: Record<ReadinessCheck, () => Promise<unknown>> = {
      database: () => this.databaseService.pool.query("SELECT 1"),
      objectStorage: () => this.storageService.ensureReady(),
      queue: () => this.bossService.ensureReady(),
    };

    const names = Object.keys(probes) as ReadinessCheck[];
    const settled = await Promise.allSettled(names.map((name) => probes[name]()));

    const checks = { database: false, objectStorage: false, queue: false };
    const failures: Partial<Record<ReadinessCheck, string>> = {};
    names.forEach((name, index) => {
      const outcome = settled[index];
      if (outcome.status === "fulfilled") {
        checks[name] = true;
      } else {
        failures[name] =
          outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      }
    });

    return {
      status: Object.values(checks).every(Boolean) ? "ok" : "degraded",
      checks,
      failures,
    };
  }
}
