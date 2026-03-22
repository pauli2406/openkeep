import { execFile as cpExecFile } from "child_process";

/**
 * Minimal async wrapper around child_process.execFile.
 * Replaces the `execa` dependency which breaks on Node >= 25
 * due to `unicorn-magic` missing a proper exports entry.
 */
export function exec(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    cpExecFile(
      command,
      args,
      { maxBuffer: 50 * 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve({ stdout: stdout as string, stderr: stderr as string });
        }
      },
    );
  });
}
