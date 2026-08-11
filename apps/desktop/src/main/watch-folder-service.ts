import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  classifyWatchFolderEntry,
  isWatchFolderEntrySettled,
  observeWatchFolderEntry,
  type WatchFolderObservation,
} from "./watch-folder-rules";
import type { DesktopWatchFolderStore } from "./watch-folder-state";
import type {
  WatchFolderUploadRequest,
  WatchFolderUploadResult,
} from "./watch-folder-uploader";
import type {
  DesktopWatchFolder,
  DesktopWatchFolderEvent,
  DesktopWatchFolderOutcome,
  DesktopWatchFolderState,
  DesktopWatchFoldersSnapshot,
} from "../shared/desktop-api";

export const WATCH_FOLDER_SCAN_INTERVAL_MS = 5_000;
export const WATCH_FOLDER_SETTLE_MS = 4_000;
const MAX_UPLOAD_ATTEMPTS = 4;

export type WatchFolderDirectoryEntry = {
  name: string;
  kind: "file" | "directory" | "other";
};

export type WatchFolderFileSystem = {
  readDirectory(directory: string): Promise<WatchFolderDirectoryEntry[]>;
  stat(filePath: string): Promise<{
    size: number;
    mtimeMs: number;
    kind: "file" | "directory" | "other";
  }>;
};

export type WatchFolderTimer = {
  start(run: () => void, intervalMs: number): void;
  stop(): void;
};

type UploaderPort = {
  upload(request: WatchFolderUploadRequest): Promise<WatchFolderUploadResult>;
};

type FolderCondition = {
  state: DesktopWatchFolderState;
  message?: string;
};

function directoryFailure(error: unknown): FolderCondition {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT" || code === "ENOTDIR") {
    return {
      state: "missing",
      message: "This folder no longer exists on this computer.",
    };
  }
  return {
    state: "unreadable",
    message:
      code === "EACCES" || code === "EPERM"
        ? "OpenKeep is not allowed to read this folder."
        : "This folder could not be read.",
  };
}

/**
 * Watches local folders for the connected archive and imports finished
 * documents from them.
 *
 * Polling rather than raw filesystem events is deliberate: a poll survives
 * sleep and resume, an unmounted drive coming back, an unreliable network
 * share, and an event burst during a bulk copy, all of which can leave a
 * native watcher silent or shouting. Each cycle re-reads its own durable
 * checkpoints, so a restart mid-copy costs one extra poll, never a duplicate.
 *
 * Nothing here writes to a watched folder. Source files are opened read-only,
 * and their paths never leave this machine.
 */
export function createDesktopWatchFolderService({
  store,
  fileSystem,
  uploader,
  timer,
  activeProfileId,
  now = () => Date.now(),
  createId = randomUUID,
  onChanged,
  reportError,
  settleMs = WATCH_FOLDER_SETTLE_MS,
  intervalMs = WATCH_FOLDER_SCAN_INTERVAL_MS,
}: {
  store: DesktopWatchFolderStore;
  fileSystem: WatchFolderFileSystem;
  uploader: UploaderPort;
  timer: WatchFolderTimer;
  activeProfileId: () => string | null;
  now?: () => number;
  createId?: () => string;
  onChanged: () => void;
  reportError?: (message: string, error: unknown) => void;
  settleMs?: number;
  intervalMs?: number;
}) {
  const observations = new Map<string, WatchFolderObservation>();
  const attempts = new Map<string, number>();
  /** Paths whose current size and modification time already failed for good. */
  const abandoned = new Map<string, { size: number; mtimeMs: number }>();
  const reported = new Set<string>();
  const conditions = new Map<string, FolderCondition>();
  let scanning = false;
  let rescan = false;
  let stopped = false;
  /**
   * The last archive that was connected. A disconnect must not make its watch
   * folders disappear from the UI — they are waiting, not gone.
   */
  let lastProfileId: string | null = null;

  function connectedProfileId() {
    const profileId = activeProfileId();
    if (profileId) lastProfileId = profileId;
    return profileId;
  }

  function record(
    profileId: string,
    folderId: string,
    name: string,
    outcome: DesktopWatchFolderOutcome,
    message?: string,
  ) {
    const event: DesktopWatchFolderEvent = {
      id: createId(),
      name,
      outcome,
      at: now(),
      ...(message ? { message } : {}),
    };
    return store.recordEvent(profileId, folderId, event);
  }

  async function considerEntry(
    profileId: string,
    folder: { id: string; path: string },
    entry: WatchFolderDirectoryEntry,
  ) {
    const verdict = classifyWatchFolderEntry(entry.name, entry.kind);
    if (verdict !== "eligible") {
      // Say something once about a file a user may have expected to import,
      // and stay silent about system, hidden, and in-progress entries.
      const key = `${folder.id}:${entry.name}`;
      if (verdict === "unsupported" && !reported.has(key)) {
        reported.add(key);
        await record(
          profileId,
          folder.id,
          entry.name,
          "unsupported",
          "OpenKeep imports PDF, JPEG, PNG, TIFF, and HEIC files.",
        );
      }
      return;
    }

    const filePath = path.join(folder.path, entry.name);
    let stats: Awaited<ReturnType<WatchFolderFileSystem["stat"]>>;
    try {
      stats = await fileSystem.stat(filePath);
    } catch {
      // Gone again between listing and stat: forget it and move on.
      observations.delete(filePath);
      return;
    }
    if (stats.kind !== "file") return;

    const checkpoint = store.fingerprintFor(profileId, filePath);
    if (
      checkpoint &&
      checkpoint.size === stats.size &&
      checkpoint.mtimeMs === stats.mtimeMs
    ) {
      return;
    }

    const observation = observeWatchFolderEntry(
      observations.get(filePath),
      stats,
      now(),
    );
    observations.set(filePath, observation);
    if (!isWatchFolderEntrySettled(observation, now(), settleMs)) return;

    const dead = abandoned.get(filePath);
    if (dead && dead.size === stats.size && dead.mtimeMs === stats.mtimeMs) return;

    const result = await uploader.upload({
      filePath,
      profileId,
      isKnownChecksum: (checksum) => store.knowsChecksum(profileId, checksum),
    });

    if (result.status === "imported" || result.status === "duplicate") {
      attempts.delete(filePath);
      abandoned.delete(filePath);
      await store.recordImported(
        profileId,
        filePath,
        { size: stats.size, mtimeMs: stats.mtimeMs, checksum: result.checksum },
        now(),
      );
      await record(
        profileId,
        folder.id,
        entry.name,
        result.status,
        result.status === "duplicate" ? result.message : undefined,
      );
      return;
    }

    if (result.status === "rejected") {
      attempts.delete(filePath);
      abandoned.set(filePath, { size: stats.size, mtimeMs: stats.mtimeMs });
      await record(profileId, folder.id, entry.name, "failed", result.message);
      return;
    }

    const attempt = (attempts.get(filePath) ?? 0) + 1;
    attempts.set(filePath, attempt);
    if (attempt >= MAX_UPLOAD_ATTEMPTS) {
      attempts.delete(filePath);
      abandoned.set(filePath, { size: stats.size, mtimeMs: stats.mtimeMs });
      await record(profileId, folder.id, entry.name, "failed", result.message);
      return;
    }
    if (attempt === 1) {
      await record(profileId, folder.id, entry.name, "retrying", result.message);
    }
  }

  async function runScan() {
    const profileId = connectedProfileId();
    if (!profileId) {
      // No connected archive: nothing is scanned, and nothing is lost. The
      // next cycle after reconnection picks the folders up again.
      conditions.clear();
      return;
    }

    for (const folder of store.list(profileId)) {
      if (stopped || activeProfileId() !== profileId) return;
      if (folder.paused) {
        conditions.set(folder.id, { state: "paused" });
        continue;
      }

      let entries: WatchFolderDirectoryEntry[];
      try {
        entries = await fileSystem.readDirectory(folder.path);
      } catch (error) {
        conditions.set(folder.id, directoryFailure(error));
        continue;
      }
      conditions.set(folder.id, { state: "watching" });

      for (const entry of entries) {
        if (stopped || activeProfileId() !== profileId) return;
        try {
          await considerEntry(profileId, folder, entry);
        } catch (error) {
          reportError?.("A watch folder entry could not be imported.", error);
        }
      }
    }
  }

  async function scan() {
    if (scanning) {
      rescan = true;
      return;
    }
    scanning = true;
    try {
      do {
        rescan = false;
        await runScan();
      } while (rescan && !stopped);
    } finally {
      scanning = false;
      onChanged();
    }
  }

  function conditionFor(folder: {
    id: string;
    paused: boolean;
  }): FolderCondition {
    if (folder.paused) return { state: "paused" };
    if (!activeProfileId()) return { state: "waiting" };
    return conditions.get(folder.id) ?? { state: "watching" };
  }

  function snapshot(): DesktopWatchFoldersSnapshot {
    const profileId = activeProfileId() ?? lastProfileId;
    const folders: DesktopWatchFolder[] = store.list(profileId).map((folder) => {
      const condition = conditionFor(folder);
      return {
        id: folder.id,
        path: folder.path,
        label: path.basename(folder.path) || folder.path,
        state: condition.state,
        ...(condition.message ? { message: condition.message } : {}),
        counts: folder.counts,
        history: folder.history,
      };
    });
    return { profileId, folders };
  }

  return {
    start() {
      stopped = false;
      timer.start(() => void scan(), intervalMs);
      void scan();
    },

    /** Runs one cycle now — after adding a folder, resuming, or reconnecting. */
    scan,

    snapshot,

    async add(folderPath: string) {
      const profileId = activeProfileId();
      if (!profileId) {
        throw new Error("Connect an archive before adding a watch folder.");
      }
      const added = await store.add(profileId, folderPath);
      conditions.delete(added.folder.id);
      await scan();
      return snapshot();
    },

    async setPaused(folderId: string, paused: boolean) {
      const profileId = activeProfileId();
      if (!profileId) return snapshot();
      await store.setPaused(profileId, folderId, paused);
      if (paused) {
        conditions.set(folderId, { state: "paused" });
        onChanged();
        return snapshot();
      }
      conditions.delete(folderId);
      await scan();
      return snapshot();
    },

    async remove(folderId: string) {
      const profileId = activeProfileId();
      if (!profileId) return snapshot();
      const folder = store.list(profileId).find(
        (candidate) => candidate.id === folderId,
      );
      await store.remove(profileId, folderId);
      conditions.delete(folderId);
      if (folder) {
        const prefix = `${folder.path}${path.sep}`;
        for (const key of [...observations.keys()]) {
          if (key.startsWith(prefix)) observations.delete(key);
        }
        for (const key of [...reported]) {
          if (key.startsWith(`${folderId}:`)) reported.delete(key);
        }
      }
      onChanged();
      return snapshot();
    },

    /** Counts for the tray, without exposing any local path. */
    summary() {
      const folders = snapshot().folders;
      const watching = folders.filter((folder) => folder.state === "watching").length;
      const attention = folders.filter((folder) =>
        folder.state === "missing" || folder.state === "unreadable",
      ).length;
      return { total: folders.length, watching, attention };
    },

    async stop() {
      stopped = true;
      timer.stop();
      await store.idle();
    },
  };
}

export type DesktopWatchFolderService = ReturnType<
  typeof createDesktopWatchFolderService
>;

export function createIntervalWatchFolderTimer(): WatchFolderTimer {
  let handle: ReturnType<typeof setInterval> | null = null;
  return {
    start(run, intervalMs) {
      if (handle) clearInterval(handle);
      handle = setInterval(run, intervalMs);
      handle.unref?.();
    },
    stop() {
      if (handle) clearInterval(handle);
      handle = null;
    },
  };
}
