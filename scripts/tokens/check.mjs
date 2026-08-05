#!/usr/bin/env node
/**
 * Guards the shared palette (#124):
 *
 *  1. no colour literal in `apps/web/src` or `apps/mobile/src` — every colour
 *     must come from `@openkeep/tokens`;
 *  2. `apps/web/src/tokens.css` is in step with the package.
 *
 * The generated CSS and the tokens package itself are the only places a hex
 * value may appear.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const ROOTS = ["apps/web/src", "apps/mobile/src"];
const EXTENSIONS = [".ts", ".tsx", ".css", ".js", ".jsx"];
/** The generated file is the palette; `index.css` still aliases shadcn names. */
const ALLOWED = new Set(["apps/web/src/tokens.css"]);

const HEX = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
/** `#124` in a comment is an issue number, not a colour. */
const ISSUE_REF = /#\d{1,4}\b/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

const offences = [];
for (const dir of ROOTS) {
  for (const file of walk(resolve(root, dir))) {
    const rel = relative(root, file);
    if (ALLOWED.has(rel)) continue;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        const match = HEX.exec(line);
        if (!match) return;
        // `(#124)` and `see #40` are references, not colours.
        if (ISSUE_REF.test(match[0]) && match[0].length <= 5) return;
        offences.push(`${rel}:${index + 1}  ${line.trim()}`);
      });
  }
}

if (offences.length > 0) {
  console.error(
    `Colour literals must come from @openkeep/tokens. ${offences.length} found:\n` +
      offences.join("\n"),
  );
  process.exit(1);
}

execFileSync("node", [resolve(root, "scripts/tokens/generate.mjs"), "--check"], {
  stdio: "inherit",
});
console.log(`no colour literals in ${ROOTS.join(", ")}`);
