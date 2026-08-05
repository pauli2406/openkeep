import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { palettes, radii } from "@openkeep/tokens";
import { fonts } from "../typography";

const SRC = join(__dirname, "..");

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === "__tests__" ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

function violations(pattern: RegExp, allow: (line: string) => boolean = () => false) {
  const found: string[] = [];
  for (const file of sourceFiles()) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (pattern.test(line) && !allow(line)) {
          found.push(`${relative(SRC, file)}:${index + 1} ${line.trim()}`);
        }
      });
  }
  return found;
}

/**
 * The rules the redesign set for itself, as tests rather than as a convention
 * nobody re-checks. Each one is here because it was broken at least once: a
 * colour written as a literal survived a whole audit, a `fontWeight` silently
 * overrode a named face, and three radii outlived the scale in a shared
 * component no screen ticket owned.
 */
describe("colour", () => {
  it("is never a literal", () => {
    // `scripts/tokens/check.mjs` enforces this repo-wide; this keeps the mobile
    // half failing fast in the app's own suite.
    expect(violations(/#[0-9a-fA-F]{3,8}\b/, (line) => line.trimStart().startsWith("*"))).toEqual(
      [],
    );
    expect(violations(/\b(?:rgba?|hsla?)\s*\(/, (line) => /gradient|shadow|stopColor/i.test(line))).toEqual(
      [],
    );
  });

  it("comes from a palette that covers both themes", () => {
    expect(Object.keys(palettes.light).sort()).toEqual(Object.keys(palettes.dark).sort());
  });
});

describe("type", () => {
  it("is selected by face, never by weight", () => {
    // Static faces: React Native picks a family, and a `fontWeight` alongside it
    // either does nothing or synthesises a different face than the one intended.
    expect(violations(/^\s*fontWeight:/)).toEqual([]);
  });

  it("names only faces that are bundled", () => {
    const bundled = new Set<string>([
      ...Object.values(fonts.sans),
      ...Object.values(fonts.mono),
    ]);
    const named = new Set<string>();
    for (const file of sourceFiles()) {
      for (const match of readFileSync(file, "utf8").matchAll(/fontFamily:\s*"([^"]+)"/g)) {
        named.add(match[1]);
      }
    }
    expect(Array.from(named).filter((family) => !bundled.has(family))).toEqual([]);
  });
});

describe("radii", () => {
  it("are on the scale", () => {
    // The epic's rule: nothing above 10 in `apps/mobile/src`. Anything larger is
    // the web app's card language, which this design does not use.
    expect(
      violations(/borderRadius:\s*(1[1-9]|[2-9][0-9])\b/, (line) => /radii\./.test(line)),
    ).toEqual([]);
  });

  it("stay within the scale in the token package too", () => {
    for (const [name, value] of Object.entries(radii)) {
      if (name === "pill") {
        continue;
      }
      expect(value).toBeLessThanOrEqual(10);
    }
  });
});
