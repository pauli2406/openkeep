import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { RouteParamtypes } from "@nestjs/common/enums/route-paramtypes.enum";
import { ZodValidationPipe } from "nestjs-zod";
import { describe, expect, it } from "vitest";

import { ArchiveController } from "../src/archive/archive.controller";
import { AuthController } from "../src/auth/auth.controller";
import { DocumentsController } from "../src/documents/documents.controller";
import { EmbeddingsController } from "../src/documents/embeddings.controller";
import { ExplorerController } from "../src/explorer/explorer.controller";
import { HealthController } from "../src/health/health.controller";
import { SearchController } from "../src/search/search.controller";
import { TaxonomiesController } from "../src/taxonomies/taxonomies.controller";

const CONTROLLERS = [
  ArchiveController,
  AuthController,
  DocumentsController,
  EmbeddingsController,
  ExplorerController,
  HealthController,
  SearchController,
  TaxonomiesController,
];

/**
 * Every `@Body()` and `@Query()` parameter must carry its own validating pipe.
 *
 * The global `ZodValidationPipe` cannot do this on its own here: it resolves a
 * route's schema from `design:paramtypes`, and esbuild — which transpiles this
 * API through `tsx` in development and `tsup` in the build — does not implement
 * `emitDecoratorMetadata`. With the metadata absent the global pipe finds no
 * schema and silently forwards the raw request: no coercion, no defaults, no
 * rejection. That is how `?statuses=ready` reached Postgres as a bare string
 * and produced a 500 (#76), and how every other endpoint accepted anything at
 * all.
 *
 * `@ValidatedBody(Dto)` / `@ValidatedQuery(Dto)` name the schema explicitly, so
 * the behaviour does not depend on the transpiler. This test fails if a new
 * endpoint reverts to the bare decorators.
 */
describe("request validation is wired on every body and query parameter", () => {
  const VALIDATED = new Set([RouteParamtypes.BODY, RouteParamtypes.QUERY]);

  for (const controller of CONTROLLERS) {
    const methods = Object.getOwnPropertyNames(controller.prototype).filter(
      (name) => name !== "constructor",
    );

    for (const method of methods) {
      const args =
        (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) as
          | Record<string, { index: number; pipes?: unknown[] }>
          | undefined) ?? {};

      for (const [key, meta] of Object.entries(args)) {
        const paramtype = Number(key.split(":")[0]);
        if (!VALIDATED.has(paramtype)) continue;

        const label = `${controller.name}.${method} param ${meta.index} (${
          paramtype === RouteParamtypes.BODY ? "@Body" : "@Query"
        })`;

        it(`${label} validates its input`, () => {
          const pipes = meta.pipes ?? [];
          const hasValidator = pipes.some((pipe) => pipe instanceof ZodValidationPipe);
          expect(
            hasValidator,
            `${label} has no ZodValidationPipe. Use @ValidatedBody(Dto) / ` +
              `@ValidatedQuery(Dto) — the bare decorators do not validate, ` +
              `because esbuild emits no decorator metadata for the global pipe ` +
              `to read.`,
          ).toBe(true);
        });
      }
    }
  }

  it("covers at least the endpoints that existed when this was written", () => {
    const counted = CONTROLLERS.flatMap((controller) =>
      Object.getOwnPropertyNames(controller.prototype)
        .filter((name) => name !== "constructor")
        .flatMap((method) => {
          const args =
            (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) as
              | Record<string, unknown>
              | undefined) ?? {};
          return Object.keys(args).filter((key) => VALIDATED.has(Number(key.split(":")[0])));
        }),
    );
    // Guards against the loop above silently finding nothing — an empty
    // metadata read would otherwise make this whole suite vacuously pass.
    expect(counted.length).toBeGreaterThanOrEqual(36);
  });
});
