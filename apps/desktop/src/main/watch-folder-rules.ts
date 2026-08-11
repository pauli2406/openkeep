import path from "node:path";
import { importMimeTypeForExtension } from "@openkeep/types";

/**
 * Why a directory entry is not going to be imported. Only `eligible` entries
 * reach the stability gate; every other verdict is reported once and then
 * stays quiet, so a folder full of system files cannot fill the history.
 */
export type WatchFolderVerdict =
  | "eligible"
  | "directory"
  | "hidden"
  | "temporary"
  | "unsupported";

/**
 * Extensions and prefixes writers use for files they are still producing.
 * Importing one of these means importing a truncated document, and the final
 * rename is what makes it eligible.
 */
const TEMPORARY_EXTENSIONS = new Set([
  ".crdownload",
  ".download",
  ".part",
  ".partial",
  ".tmp",
  ".temp",
  ".opdownload",
  ".filepart",
]);

const TEMPORARY_PREFIXES = ["~$", ".~lock.", "~"];

export function classifyWatchFolderEntry(
  name: string,
  kind: "file" | "directory" | "other",
): WatchFolderVerdict {
  if (kind !== "file") return "directory";
  if (name.startsWith(".")) return "hidden";
  if (TEMPORARY_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return "temporary";
  }
  const extension = path.extname(name).toLowerCase();
  if (TEMPORARY_EXTENSIONS.has(extension)) return "temporary";
  // A doubled extension such as `scan.pdf.part` is caught above; a bare
  // `scan.pdf~` is an editor backup rather than the document itself.
  if (name.endsWith("~")) return "temporary";
  return importMimeTypeForExtension(extension) ? "eligible" : "unsupported";
}

export type WatchFolderProbe = {
  size: number;
  mtimeMs: number;
};

/**
 * What the previous poll observed for a path, and when that observation first
 * held. A file is only quiet once the same size and modification time survive
 * `settleMs`, which is what separates a finished copy from one in progress.
 */
export type WatchFolderObservation = WatchFolderProbe & {
  firstSeenAt: number;
};

export function observeWatchFolderEntry(
  previous: WatchFolderObservation | undefined,
  probe: WatchFolderProbe,
  now: number,
): WatchFolderObservation {
  if (
    previous &&
    previous.size === probe.size &&
    previous.mtimeMs === probe.mtimeMs
  ) {
    return previous;
  }
  return { ...probe, firstSeenAt: now };
}

export function isWatchFolderEntrySettled(
  observation: WatchFolderObservation,
  now: number,
  settleMs: number,
): boolean {
  // A file whose modification time is in the future — a clock skew across a
  // network share — would otherwise never settle. Age it from our own first
  // sighting instead of trusting the stamp.
  return now - observation.firstSeenAt >= settleMs;
}
