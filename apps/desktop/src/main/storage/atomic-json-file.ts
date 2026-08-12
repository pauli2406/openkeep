import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * The filesystem surface an atomic JSON file needs. Injecting it keeps the
 * stores above this module testable without touching a real disk.
 */
export type AtomicJsonFileSystem = {
  mkdir(directory: string): Promise<unknown>;
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, contents: string): Promise<unknown>;
  rename(from: string, to: string): Promise<unknown>;
};

export function nodeAtomicJsonFileSystem(): AtomicJsonFileSystem {
  return {
    mkdir: (directory) => fs.mkdir(directory, { recursive: true, mode: 0o700 }),
    readFile: (filePath) => fs.readFile(filePath, "utf8"),
    writeFile: (filePath, contents) =>
      fs.writeFile(filePath, contents, { encoding: "utf8", mode: 0o600 }),
    rename: (from, to) => fs.rename(from, to),
  };
}

/**
 * A single owner-readable JSON file that is replaced through a temporary file
 * and one rename, so an interrupted write can never leave desktop state
 * half-parsed. Reads report a missing file as `null` rather than throwing,
 * because "not configured yet" is the normal first-run state.
 */
export function createAtomicJsonFile({
  filePath,
  fileSystem = nodeAtomicJsonFileSystem(),
  createTemporaryId = randomUUID,
}: {
  filePath: string;
  fileSystem?: AtomicJsonFileSystem;
  createTemporaryId?: () => string;
}) {
  return {
    async read(): Promise<string | null> {
      try {
        return await fileSystem.readFile(filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },

    async write(value: unknown): Promise<void> {
      const temporaryPath = `${filePath}.${createTemporaryId()}.tmp`;
      await fileSystem.mkdir(path.dirname(filePath));
      await fileSystem.writeFile(temporaryPath, JSON.stringify(value, null, 2));
      await fileSystem.rename(temporaryPath, filePath);
    },
  };
}

export type AtomicJsonFile = ReturnType<typeof createAtomicJsonFile>;
