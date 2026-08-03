import { Body, Param, Query } from "@nestjs/common";
import { type ZodDto, ZodValidationPipe } from "nestjs-zod";
import { z } from "zod";

/**
 * Request validation, wired explicitly.
 *
 * The global `ZodValidationPipe` finds a route's schema through the parameter's
 * emitted `design:paramtypes` metadata. This API is transpiled by esbuild — via
 * `tsx` in development and `tsup` in the build — and esbuild does not implement
 * `emitDecoratorMetadata`, regardless of what tsconfig asks for. The metadata is
 * therefore absent at runtime, the global pipe finds no schema, and it passes
 * the raw request through untouched: no coercion, no defaults, no rejection.
 *
 * That failure is silent, which is what makes it dangerous. It is the same
 * reason every provider in this codebase is injected with an explicit
 * `@Inject(Token)` rather than by constructor type.
 *
 * Naming the DTO here removes the dependency on metadata entirely, so these
 * behave identically under esbuild, SWC or tsc.
 *
 * Switching the API to a transpiler that emits decorator metadata would let the
 * bare `@Body()` / `@Query()` forms work again, but it also makes NestJS resolve
 * the module graph eagerly, which surfaces circular imports (documents ↔
 * processing) that currently only survive because the metadata is missing. That
 * is a separate piece of work; see the note in docs/technical/api-and-data-flows.md.
 */

/** `@ValidatedBody(CreateTagDto) body: CreateTagDto` */
export const ValidatedBody = (dto: ZodDto) => Body(new ZodValidationPipe(dto));

/** `@ValidatedQuery(SearchDocumentsQueryDto) query: SearchDocumentsQueryDto` */
export const ValidatedQuery = (dto: ZodDto) => Query(new ZodValidationPipe(dto));

/**
 * A `?flag=true|1` style query parameter, coerced rather than rejected so an
 * unexpected value reads as "off" instead of failing the request.
 */
const BooleanFlagSchema = z.preprocess(
  (value) => value === "true" || value === "1" || value === true,
  z.boolean(),
);

/** `@BooleanFlagQuery("force") force: boolean` */
export const BooleanFlagQuery = (property: string) =>
  Query(property, new ZodValidationPipe(BooleanFlagSchema));

/** `@ValidatedParam("id", IdParamDto) id: string` */
export const ValidatedParam = (property: string, dto: ZodDto) =>
  Param(property, new ZodValidationPipe(dto));
