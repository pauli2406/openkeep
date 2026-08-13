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
    ? [
        path.join(packageDirectory, "OpenKeep.app", "Contents", "MacOS", "openkeep"),
        path.join(packageDirectory, "OpenKeep.app", "Contents", "MacOS", "OpenKeep"),
      ]
    : process.platform === "win32"
      ? [
          path.join(packageDirectory, "openkeep.exe"),
          path.join(packageDirectory, "OpenKeep.exe"),
        ]
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

const SUCCESS_MARKER = "OPENKEEP_DESKTOP_SMOKE_OK";

const child = spawn(executable, ["--smoke-test"], {
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
  // Piped rather than inherited so the success marker can be recognised here.
  // What this test asserts is that the packaged app boots and reports a correct
  // renderer; a platform that is slow to tear Chromium down should not turn a
  // healthy boot into a failure.
  stdio: ["ignore", "pipe", "inherit"],
});

let reportedSuccess = false;
let settled = false;
let output = "";

function finish(code, message) {
  if (settled) return;
  settled = true;
  clearTimeout(timeout);
  if (message) console.error(message);
  process.exitCode = code;
  if (child.exitCode === null && child.signalCode === null) child.kill();
}

const timeout = setTimeout(() => {
  finish(1, "Packaged OpenKeep smoke test exceeded 30 seconds.");
}, 30_000);

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  output += chunk;
  if (!reportedSuccess && output.includes(SUCCESS_MARKER)) {
    reportedSuccess = true;
    // Give the process a moment to exit on its own, then stop waiting for it.
    setTimeout(() => finish(0), 2_000).unref();
  }
});

child.once("error", (error) => {
  clearTimeout(timeout);
  throw error;
});

child.once("exit", (code, signal) => {
  if (reportedSuccess) {
    finish(0);
    return;
  }
  finish(
    code ?? 1,
    `Packaged OpenKeep exited with code ${code} and signal ${signal ?? "none"} before reporting success.`,
  );
});
