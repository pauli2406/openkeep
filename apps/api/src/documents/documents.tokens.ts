/**
 * Injection token for `DocumentsService`.
 *
 * `DocumentsService` sits at the centre of the module graph, so services it
 * depends on cannot import it back by class without creating a runtime import
 * cycle. Depending on this token instead lets the consumer use
 * `import type { DocumentsService }`, which the transpiler erases — no runtime
 * edge, no cycle, and no `forwardRef` needed on that edge.
 *
 * This matters beyond tidiness: a runtime cycle is what makes the API
 * unbuildable with any transpiler that emits `design:paramtypes`. Under those,
 * NestJS resolves the graph eagerly and the cycle throws
 * `Cannot access 'X' before initialization` at module load.
 *
 * `documents.module.ts` aliases the token onto the real provider with
 * `useExisting`, so both resolve to the same instance.
 */
export const DOCUMENTS_SERVICE = Symbol("DOCUMENTS_SERVICE");
