import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const SRC = join(__dirname, "..");
const I18N = join(SRC, "i18n.tsx");

/**
 * Read from the source rather than the module, deliberately: a duplicated key in
 * an object literal is silently dropped, so the parsed value can never show it.
 * Both duplicate keys that slipped through during the redesign were caught by
 * the compiler only because the table is `as const`; this catches them in a
 * table that is not.
 */
function localeBlocks() {
  const source = readFileSync(I18N, "utf8");
  const blocks: Record<string, string[]> = {};
  for (const locale of ["en", "de"] as const) {
    const start = source.indexOf(`  ${locale}: {`);
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf("\n  },", start);
    const body = source.slice(start, end);
    blocks[locale] = Array.from(body.matchAll(/^\s{4}"([^"]+)":/gm)).map((match) => match[1]);
  }
  return blocks as { en: string[]; de: string[] };
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === "__tests__" ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

describe("the string table", () => {
  const { en, de } = localeBlocks();

  it("has the same keys in both locales", () => {
    const missingInGerman = en.filter((key) => !de.includes(key));
    const missingInEnglish = de.filter((key) => !en.includes(key));
    expect({ missingInGerman, missingInEnglish }).toEqual({
      missingInGerman: [],
      missingInEnglish: [],
    });
  });

  it("declares every key once per locale", () => {
    for (const [locale, keys] of Object.entries({ en, de })) {
      const seen = new Set<string>();
      const duplicates = keys.filter((key) => (seen.has(key) ? true : (seen.add(key), false)));
      expect({ locale, duplicates }).toEqual({ locale, duplicates: [] });
    }
  });

  it("has no empty translation", () => {
    const source = readFileSync(I18N, "utf8");
    expect(Array.from(source.matchAll(/^\s{4}"([^"]+)":\s*"",?$/gm)).map((m) => m[1])).toEqual([]);
  });

  /**
   * `t()` is typed against the English keys, so a missing one is a compile
   * error — except where a screen widens it, which several do for dynamic keys
   * (`t(key as never)`). Those are exactly the ones a compiler cannot check.
   */
  it("resolves every literal key used in the app", () => {
    const used = new Set<string>();
    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\bt\(\s*"([a-z][A-Za-z0-9.]*)"/g)) {
        used.add(match[1]);
      }
    }
    expect(Array.from(used).filter((key) => !en.includes(key)).sort()).toEqual([]);
  });
});
