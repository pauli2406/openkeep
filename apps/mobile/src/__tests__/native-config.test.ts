/**
 * The build flags the offline copy's encryption depends on.
 *
 * `op-sqlite` compiles with SQLCipher only when its config says so, and its
 * podspec finds that config by walking **up** from
 * `node_modules/@op-engineering/op-sqlite` and taking the first `package.json`
 * it meets. With pnpm's hoisted linker the package sits at the workspace root,
 * so the file it reads is the root one — not `apps/mobile/package.json`, where
 * the flag looks like it belongs.
 *
 * That mistake shipped: 0.3.0 and 0.3.1 built without SQLCipher, the app
 * correctly refused to cache anything, and the only clue was a line on the
 * Offline screen. This test is the guard, because nothing else fails when the
 * flag is in the wrong file — the JavaScript is identical either way.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

function packageJson(path: string) {
  return JSON.parse(readFileSync(join(__dirname, path), "utf8")) as {
    "op-sqlite"?: { sqlcipher?: boolean };
  };
}

describe("op-sqlite's SQLCipher flag", () => {
  it("is in the workspace root package.json, which is the one the podspec reads", () => {
    expect(packageJson("../../../../package.json")["op-sqlite"]?.sqlcipher).toBe(true);
  });

  it("is in the mobile package.json too, in case the tree is ever not hoisted", () => {
    // Cheap insurance: with an isolated node_modules the upward walk would find
    // this file instead.
    expect(packageJson("../../package.json")["op-sqlite"]?.sqlcipher).toBe(true);
  });
});
