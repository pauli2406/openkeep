import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  createAtomicJsonFile,
  type AtomicJsonFileSystem,
} from "./storage/atomic-json-file";
import type {
  DesktopWatchFolderCounts,
  DesktopWatchFolderEvent,
  DesktopWatchFolderOutcome,
} from "../shared/desktop-api";

export type WatchFolderStateFileSystem = AtomicJsonFileSystem;

/** What a completed import knew about the file, so the same one is not sent twice. */
export type WatchFolderFingerprint = {
  size: number;
  mtimeMs: number;
  checksum: string;
};

export type StoredWatchFolder = {
  id: string;
  path: string;
  paused: boolean;
  counts: DesktopWatchFolderCounts;
  history: DesktopWatchFolderEvent[];
};

type StoredProfile = {
  folders: StoredWatchFolder[];
  /** Canonical file path → the fingerprint already imported from it. */
  fingerprints: Record<string, WatchFolderFingerprint & { at: number }>;
  /** Content checksum → when it was imported. Survives a rename or a move. */
  checksums: Record<string, number>;
};

const MAX_HISTORY_PER_FOLDER = 40;
const MAX_FINGERPRINTS_PER_PROFILE = 1_000;
const MAX_CHECKSUMS_PER_PROFILE = 1_000;

const COUNTED_OUTCOMES = {
  imported: "imported",
  duplicate: "duplicate",
  failed: "failed",
} as const satisfies Partial<
  Record<DesktopWatchFolderOutcome, keyof DesktopWatchFolderCounts>
>;

function emptyCounts(): DesktopWatchFolderCounts {
  return { imported: 0, duplicate: 0, failed: 0 };
}

function emptyProfile(): StoredProfile {
  return { folders: [], fingerprints: {}, checksums: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function parseCounts(value: unknown): DesktopWatchFolderCounts {
  if (!isRecord(value)) return emptyCounts();
  return {
    imported: positiveNumber(value.imported) ?? 0,
    duplicate: positiveNumber(value.duplicate) ?? 0,
    failed: positiveNumber(value.failed) ?? 0,
  };
}

function parseEvent(value: unknown): DesktopWatchFolderEvent | null {
  if (!isRecord(value)) return null;
  const at = positiveNumber(value.at);
  const outcome = value.outcome;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    at === null ||
    typeof outcome !== "string" ||
    !["imported", "duplicate", "retrying", "failed", "unsupported"].includes(outcome)
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    outcome: outcome as DesktopWatchFolderOutcome,
    at,
    ...(typeof value.message === "string" ? { message: value.message } : {}),
  };
}

function parseFolder(value: unknown): StoredWatchFolder | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.path !== "string" ||
    !path.isAbsolute(value.path)
  ) {
    return null;
  }
  return {
    id: value.id,
    path: value.path,
    paused: value.paused === true,
    counts: parseCounts(value.counts),
    history: Array.isArray(value.history)
      ? value.history
          .map(parseEvent)
          .filter((event): event is DesktopWatchFolderEvent => event !== null)
          .slice(0, MAX_HISTORY_PER_FOLDER)
      : [],
  };
}

function parseFingerprints(value: unknown) {
  const parsed: StoredProfile["fingerprints"] = {};
  if (!isRecord(value)) return parsed;
  for (const [filePath, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    const size = positiveNumber(entry.size);
    const mtimeMs = positiveNumber(entry.mtimeMs);
    const at = positiveNumber(entry.at);
    if (size === null || mtimeMs === null || at === null) continue;
    if (typeof entry.checksum !== "string" || entry.checksum.length === 0) continue;
    parsed[filePath] = { size, mtimeMs, checksum: entry.checksum, at };
  }
  return parsed;
}

function parseChecksums(value: unknown) {
  const parsed: Record<string, number> = {};
  if (!isRecord(value)) return parsed;
  for (const [checksum, at] of Object.entries(value)) {
    const parsedAt = positiveNumber(at);
    if (parsedAt !== null) parsed[checksum] = parsedAt;
  }
  return parsed;
}

function parseState(serialized: string): Record<string, StoredProfile> {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value) || value.version !== 1 || !isRecord(value.profiles)) {
      return {};
    }
    const profiles: Record<string, StoredProfile> = {};
    for (const [profileId, stored] of Object.entries(value.profiles)) {
      if (!isRecord(stored) || profileId.length === 0 || profileId.length > 128) {
        continue;
      }
      profiles[profileId] = {
        folders: Array.isArray(stored.folders)
          ? stored.folders
              .map(parseFolder)
              .filter((folder): folder is StoredWatchFolder => folder !== null)
          : [],
        fingerprints: parseFingerprints(stored.fingerprints),
        checksums: parseChecksums(stored.checksums),
      };
    }
    return profiles;
  } catch {
    return {};
  }
}

/** Keeps the newest `limit` entries of an at-stamped map. */
function trimByAge<Value extends number | { at: number }>(
  entries: Record<string, Value>,
  limit: number,
) {
  const keys = Object.keys(entries);
  if (keys.length <= limit) return entries;
  const ageOf = (key: string) => {
    const value = entries[key]!;
    return typeof value === "number" ? value : value.at;
  };
  const kept = keys.sort((left, right) => ageOf(right) - ageOf(left)).slice(0, limit);
  return Object.fromEntries(kept.map((key) => [key, entries[key]!])) as Record<
    string,
    Value
  >;
}

/**
 * Durable watch-folder configuration and import checkpoints, one record per
 * archive profile. Separate from encrypted credentials and from the global
 * lifecycle file: this is workstation-local bookkeeping about local paths that
 * is never sent to any archive.
 */
export function createDesktopWatchFolderStore({
  filePath,
  fileSystem,
  createId = randomUUID,
  createTemporaryId = randomUUID,
}: {
  filePath: string;
  fileSystem?: WatchFolderStateFileSystem;
  createId?: () => string;
  createTemporaryId?: () => string;
}) {
  const file = createAtomicJsonFile({ filePath, fileSystem, createTemporaryId });
  let profiles: Record<string, StoredProfile> = {};
  let loaded = false;
  let writes = Promise.resolve();

  function profileState(profileId: string): StoredProfile {
    return profiles[profileId] ?? emptyProfile();
  }

  function update(mutate: (profiles: Record<string, StoredProfile>) => void) {
    writes = writes.then(async () => {
      mutate(profiles);
      await file.write({ version: 1, profiles });
    });
    return writes;
  }

  return {
    async load() {
      if (loaded) return;
      try {
        const serialized = await file.read();
        if (serialized !== null) profiles = parseState(serialized);
      } catch {
        profiles = {};
      }
      loaded = true;
    },

    list(profileId: string | null): StoredWatchFolder[] {
      if (!profileId) return [];
      return profileState(profileId).folders.map((folder) => ({
        ...folder,
        counts: { ...folder.counts },
        history: folder.history.map((event) => ({ ...event })),
      }));
    },

    /** Adds a folder, or returns the existing record when it is already watched. */
    async add(profileId: string, folderPath: string) {
      const existing = profileState(profileId).folders.find(
        (folder) => folder.path === folderPath,
      );
      if (existing) return { folder: existing, added: false };
      const folder: StoredWatchFolder = {
        id: createId(),
        path: folderPath,
        paused: false,
        counts: emptyCounts(),
        history: [],
      };
      await update((next) => {
        const profile = next[profileId] ?? emptyProfile();
        profile.folders = [...profile.folders, folder];
        next[profileId] = profile;
      });
      return { folder, added: true };
    },

    setPaused(profileId: string, folderId: string, paused: boolean) {
      return update((next) => {
        const folder = next[profileId]?.folders.find(
          (candidate) => candidate.id === folderId,
        );
        if (folder) folder.paused = paused;
      });
    },

    remove(profileId: string, folderId: string) {
      return update((next) => {
        const profile = next[profileId];
        if (!profile) return;
        profile.folders = profile.folders.filter(
          (folder) => folder.id !== folderId,
        );
      });
    },

    /** Drops everything remembered about a profile that no longer exists. */
    forgetProfile(profileId: string) {
      return update((next) => {
        delete next[profileId];
      });
    },

    fingerprintFor(profileId: string, filePath: string) {
      return profileState(profileId).fingerprints[filePath];
    },

    knowsChecksum(profileId: string, checksum: string) {
      return checksum in profileState(profileId).checksums;
    },

    /**
     * Checkpoints a file whose content is now in the archive. Both indexes are
     * written: the path index keeps later polls from re-reading it at all, and
     * the checksum index recognizes the same bytes under a new name.
     */
    recordImported(
      profileId: string,
      filePath: string,
      fingerprint: WatchFolderFingerprint,
      at: number,
    ) {
      return update((next) => {
        const profile = next[profileId] ?? emptyProfile();
        profile.fingerprints = trimByAge(
          { ...profile.fingerprints, [filePath]: { ...fingerprint, at } },
          MAX_FINGERPRINTS_PER_PROFILE,
        );
        profile.checksums = trimByAge(
          { ...profile.checksums, [fingerprint.checksum]: at },
          MAX_CHECKSUMS_PER_PROFILE,
        );
        next[profileId] = profile;
      });
    },

    recordEvent(
      profileId: string,
      folderId: string,
      event: DesktopWatchFolderEvent,
    ) {
      return update((next) => {
        const folder = next[profileId]?.folders.find(
          (candidate) => candidate.id === folderId,
        );
        if (!folder) return;
        const counted = COUNTED_OUTCOMES[event.outcome as keyof typeof COUNTED_OUTCOMES];
        if (counted) folder.counts[counted] += 1;
        folder.history = [event, ...folder.history].slice(0, MAX_HISTORY_PER_FOLDER);
      });
    },

    async idle() {
      await writes;
    },
  };
}

export type DesktopWatchFolderStore = ReturnType<
  typeof createDesktopWatchFolderStore
>;
