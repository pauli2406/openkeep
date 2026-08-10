import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const outDirectory = path.resolve(import.meta.dirname, "../out");
const packageDirectories = (await readdir(outDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("OpenKeep-"))
  .map((entry) => path.join(outDirectory, entry.name));

if (packageDirectories.length !== 1) {
  throw new Error(
    `Expected exactly one packaged OpenKeep runtime in ${outDirectory}; found ${packageDirectories.length}.`,
  );
}

const packageDirectory = packageDirectories[0];
const candidates =
  process.platform === "darwin"
    ? [path.join(packageDirectory, "OpenKeep.app", "Contents", "MacOS", "OpenKeep")]
    : process.platform === "win32"
      ? [path.join(packageDirectory, "OpenKeep.exe")]
      : [path.join(packageDirectory, "openkeep"), path.join(packageDirectory, "OpenKeep")];

let executable;
for (const candidate of candidates) {
  try {
    await access(candidate);
    executable = candidate;
    break;
  } catch {
    // Try the next platform-specific package name.
  }
}

if (!executable) {
  throw new Error(`Could not find the packaged OpenKeep executable in ${packageDirectory}.`);
}

const child = spawn(executable, ["--smoke-test"], {
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
  stdio: "inherit",
});

const timeout = setTimeout(() => {
  child.kill();
  console.error("Packaged OpenKeep smoke test exceeded 30 seconds.");
  process.exitCode = 1;
}, 30_000);

child.once("error", (error) => {
  clearTimeout(timeout);
  throw error;
});

child.once("exit", (code, signal) => {
  clearTimeout(timeout);
  if (code !== 0) {
    console.error(`Packaged OpenKeep exited with code ${code} and signal ${signal ?? "none"}.`);
    process.exitCode = code ?? 1;
  }
});
