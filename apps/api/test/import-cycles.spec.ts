import { readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../src");

/**
 * A runtime import cycle between services is not a style problem here.
 *
 * NestJS reads a constructor's dependency types from `design:paramtypes`. Any
 * transpiler that emits that metadata — SWC, tsc, the Nest CLI — evaluates the
 * class reference when the decorator runs, at module load. If two service
 * modules import each other, one of them is still initialising at that point
 * and the read throws `Cannot access 'X' before initialization`, so the API
 * does not start at all.
 *
 * The API currently transpiles with esbuild, which emits no such metadata, so
 * the cycles were invisible — and they were the reason the metadata could not
 * be turned on. Depend on an injection token with `import type` for the type
 * annotation instead (see `documents.tokens.ts`); a type-only import is erased
 * and leaves no runtime edge.
 *
 * `*.module.ts` files are exempt: a Nest module has no constructor to emit
 * metadata for, and `forwardRef(() => OtherModule)` defers the class reference
 * past load. That is the framework's documented pattern for module graphs.
 */
async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) return listTypeScriptFiles(full);
      return entry.isFile() && full.endsWith(".ts") ? [full] : [];
    }),
  );
  return files.flat();
}

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = normalize(join(dirname(fromFile), specifier));
  for (const candidate of [`${base}.ts`, join(base, "index.ts")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not this one
    }
  }
  return null;
}

/** Runtime edges only: `import type` is erased and cannot cause a cycle. */
const IMPORT = /^\s*import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gm;

function buildGraph(files: string[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const edges: string[] = [];
    for (const match of source.matchAll(IMPORT)) {
      if (match[1]) continue;
      const target = resolveSpecifier(file, match[2]);
      if (target) edges.push(target);
    }
    graph.set(file, edges);
  }
  return graph;
}

function findCycles(graph: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const seenCycle = new Set<string>();

  const walk = (node: string, stack: string[], visited: Set<string>) => {
    const at = stack.indexOf(node);
    if (at !== -1) {
      const cycle = [...stack.slice(at), node];
      const key = [...cycle].sort().join("|");
      if (!seenCycle.has(key)) {
        seenCycle.add(key);
        cycles.push(cycle);
      }
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    for (const next of graph.get(node) ?? []) walk(next, [...stack, node], visited);
  };

  for (const file of [...graph.keys()].sort()) walk(file, [], new Set());
  return cycles;
}

describe("module graph", () => {
  it("has no runtime import cycles outside Nest module files", async () => {
    const files = await listTypeScriptFiles(SRC);
    const graph = buildGraph(files);
    const offending = findCycles(graph).filter((cycle) =>
      cycle.some((file) => !file.endsWith(".module.ts")),
    );

    expect(
      offending.map((cycle) => cycle.map((file) => relative(SRC, file)).join(" -> ")),
    ).toEqual([]);
  });
});
