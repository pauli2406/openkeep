import "reflect-metadata";

import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { WorkerModule } from "../src/worker.module";

/**
 * The worker has its own module graph. A provider that resolves fine inside
 * AppModule can still be missing from WorkerModule, and the only place that
 * surfaces is the worker container's boot: Nest throws
 * UnknownDependenciesException, the process exits, and Docker restarts it in
 * a loop while the API stays green.
 *
 * `compile()` builds the whole injector graph and instantiates every provider
 * but never calls `onModuleInit`, so pg-boss, Postgres and MinIO are never
 * contacted; the config package defaults everything except the JWT secrets,
 * and SKIP_EXTERNAL_INIT guards the few constructors that would otherwise
 * reach out. That makes this a pure wiring check that runs in the unit suite.
 */
describe("WorkerModule", () => {
  it("resolves every worker's dependencies", async () => {
    process.env.SKIP_EXTERNAL_INIT = "1";
    process.env.JWT_ACCESS_SECRET ??= "test-access-secret-test-access-secret";
    process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-test-refresh-secret";

    const moduleRef = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();

    try {
      expect(moduleRef).toBeDefined();
    } finally {
      await moduleRef.close();
    }
  });
});
