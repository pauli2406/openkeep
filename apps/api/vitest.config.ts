import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.spec.ts"],
    // Everything under test/ runs by default. The heavyweight suites gate
    // themselves on an env flag and skip otherwise:
    //   api.integration          RUN_TESTCONTAINERS=1  (Postgres + MinIO)
    //   *.acceptance             RUN_OCR_ACCEPTANCE / RUN_CLOUD_*_E2E
    // `test:unit` used to name every spec explicitly, which meant a new spec
    // silently never ran until someone remembered to add it.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
});
