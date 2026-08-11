import { randomUUID } from "node:crypto";
import {
  createAtomicJsonFile,
  type AtomicJsonFileSystem,
} from "./storage/atomic-json-file";
import type {
  DesktopImportSource,
  DesktopNotificationKind,
} from "../shared/desktop-api";

export type ImportOutcomeFileSystem = AtomicJsonFileSystem;

export type TrackedImport = {
  documentId: string;
  profileId: string;
  name: string;
  source: DesktopImportSource;
  at: number;
};

/**
 * What the archive says about a document this installation imported. Only the
 * settled states are notifiable; `unavailable` keeps the document pending so a
 * temporarily unreachable archive costs nothing.
 */
export type ImportDocumentState =
  | { state: "processing" }
  | { state: "settled"; kind: DesktopNotificationKind }
  | { state: "missing" }
  | { state: "unavailable" };

export type ImportOutcomeBatch = {
  kind: DesktopNotificationKind;
  profileId: string;
  documents: Array<{ documentId: string; name: string }>;
};

type DocumentStatusPort = {
  inspect(profileId: string, documentId: string): Promise<ImportDocumentState>;
};

export type ImportOutcomeTimer = {
  start(run: () => void, intervalMs: number): void;
  stop(): void;
};

export const IMPORT_OUTCOME_POLL_INTERVAL_MS = 4_000;
/** A document still unsettled after this long is forgotten rather than polled forever. */
export const IMPORT_OUTCOME_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_NOTIFIED_IDS = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseTracked(value: unknown): TrackedImport | null {
  if (!isRecord(value)) return null;
  const at = typeof value.at === "number" && Number.isFinite(value.at) ? value.at : null;
  if (
    typeof value.documentId !== "string" ||
    value.documentId.length === 0 ||
    value.documentId.length > 128 ||
    typeof value.profileId !== "string" ||
    value.profileId.length === 0 ||
    typeof value.name !== "string" ||
    at === null
  ) {
    return null;
  }
  const source = ["picker", "open-with", "watch-folder"].includes(
    value.source as string,
  )
    ? (value.source as DesktopImportSource)
    : "picker";
  return {
    documentId: value.documentId,
    profileId: value.profileId,
    name: value.name.slice(0, 256),
    source,
    at,
  };
}

function parseState(serialized: string) {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value) || value.version !== 1) return { pending: [], notified: {} };
    const pending = Array.isArray(value.pending)
      ? value.pending
          .map(parseTracked)
          .filter((entry): entry is TrackedImport => entry !== null)
      : [];
    const notified: Record<string, number> = {};
    if (isRecord(value.notified)) {
      for (const [documentId, at] of Object.entries(value.notified)) {
        if (typeof at === "number" && Number.isFinite(at)) notified[documentId] = at;
      }
    }
    return { pending, notified };
  } catch {
    return { pending: [] as TrackedImport[], notified: {} as Record<string, number> };
  }
}

function newestFirst(entries: Record<string, number>, limit: number) {
  const keys = Object.keys(entries);
  if (keys.length <= limit) return entries;
  const kept = keys
    .sort((left, right) => entries[right]! - entries[left]!)
    .slice(0, limit);
  return Object.fromEntries(kept.map((key) => [key, entries[key]!]));
}

/**
 * Follows documents this desktop installation imported until the archive settles
 * them, then reports each settled document exactly once.
 *
 * Ownership sits in main rather than in the upload route on purpose: a document
 * can still be processing when the window is hidden, when the user switches
 * archives, or when the app restarts, and every one of those would drop a
 * renderer-owned poll. The pending set and the notified set are both persisted,
 * so a restart resumes instead of re-announcing.
 */
export function createDesktopImportOutcomeTracker({
  filePath,
  fileSystem,
  statuses,
  activeProfileId,
  notify,
  timer,
  now = () => Date.now(),
  createTemporaryId = randomUUID,
  intervalMs = IMPORT_OUTCOME_POLL_INTERVAL_MS,
  maxAgeMs = IMPORT_OUTCOME_MAX_AGE_MS,
  reportError,
}: {
  filePath: string;
  fileSystem?: ImportOutcomeFileSystem;
  statuses: DocumentStatusPort;
  activeProfileId: () => string | null;
  notify: (batch: ImportOutcomeBatch) => void;
  timer: ImportOutcomeTimer;
  now?: () => number;
  createTemporaryId?: () => string;
  intervalMs?: number;
  maxAgeMs?: number;
  reportError?: (message: string, error: unknown) => void;
}) {
  const file = createAtomicJsonFile({ filePath, fileSystem, createTemporaryId });
  let pending: TrackedImport[] = [];
  let notified: Record<string, number> = {};
  let loaded = false;
  let writes = Promise.resolve();
  let passes = Promise.resolve();
  let queuedPasses = 0;
  let stopped = false;

  function persist() {
    const run = writes.then(() => file.write({ version: 1, pending, notified }));
    // The stored chain must always settle: one transient write failure must
    // not disable outcome checkpointing until restart. The caller still sees
    // its own failure via `run`.
    writes = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function markNotified(entries: TrackedImport[]) {
    const at = now();
    for (const entry of entries) notified[entry.documentId] = at;
    notified = newestFirst(notified, MAX_NOTIFIED_IDS);
  }

  async function runPoll() {
    const profileId = activeProfileId();
    if (!profileId) return;
    const mine = pending.filter((entry) => entry.profileId === profileId);
    if (mine.length === 0) return;

    const settledByKind = new Map<DesktopNotificationKind, TrackedImport[]>();
    const forget: TrackedImport[] = [];

    for (const entry of mine) {
      if (stopped || activeProfileId() !== profileId) break;
      if (now() - entry.at > maxAgeMs) {
        forget.push(entry);
        continue;
      }
      let result: ImportDocumentState;
      try {
        result = await statuses.inspect(profileId, entry.documentId);
      } catch (error) {
        reportError?.("An imported document's status could not be read.", error);
        continue;
      }
      if (result.state === "missing") {
        // Deleted before it settled: nothing worth announcing.
        forget.push(entry);
        continue;
      }
      if (result.state !== "settled") continue;
      const group = settledByKind.get(result.kind) ?? [];
      group.push(entry);
      settledByKind.set(result.kind, group);
    }

    const resolved = [...settledByKind.values()].flat();
    if (resolved.length === 0 && forget.length === 0) return;

    const removed = new Set([...resolved, ...forget].map((entry) => entry.documentId));
    pending = pending.filter((entry) => !removed.has(entry.documentId));
    markNotified(resolved);
    // Persist before announcing: a crash between the two must not re-announce.
    await persist();

    for (const [kind, entries] of settledByKind) {
      notify({
        kind,
        profileId,
        documents: entries.map((entry) => ({
          documentId: entry.documentId,
          name: entry.name,
        })),
      });
    }
  }

  /**
   * Runs one pass, serialized behind any pass already in flight, and resolves
   * only when this caller's pass is done. One running plus one queued pass is
   * enough: a further request would poll the same documents again, so a slow
   * archive cannot build a backlog of timer ticks.
   */
  function poll(): Promise<void> {
    if (queuedPasses >= 2) return passes;
    queuedPasses += 1;
    passes = passes
      .then(() => (stopped ? undefined : runPoll()))
      .catch((error: unknown) => {
        reportError?.("Imported documents could not be checked.", error);
      })
      .finally(() => {
        queuedPasses -= 1;
      });
    return passes;
  }

  return {
    async load() {
      if (loaded) return;
      try {
        const serialized = await file.read();
        if (serialized !== null) {
          const parsed = parseState(serialized);
          pending = parsed.pending;
          notified = parsed.notified;
        }
      } catch {
        pending = [];
        notified = {};
      }
      loaded = true;
    },

    /**
     * Registers documents an import just created. Re-registering a document that
     * is already pending or already announced is ignored, which is what makes a
     * repeated report from a retrying renderer harmless.
     */
    async track(
      profileId: string,
      source: DesktopImportSource,
      documents: Array<{ documentId: string; name: string }>,
    ) {
      const known = new Set(pending.map((entry) => entry.documentId));
      const additions = documents
        .filter(
          (document) =>
            typeof document?.documentId === "string" &&
            document.documentId.length > 0 &&
            document.documentId.length <= 128 &&
            !known.has(document.documentId) &&
            !(document.documentId in notified),
        )
        .map((document) => ({
          documentId: document.documentId,
          profileId,
          name: String(document.name ?? "").slice(0, 256),
          source,
          at: now(),
        }));
      if (additions.length === 0) return;
      pending = [...pending, ...additions];
      await persist();
    },

    poll,

    pendingCount() {
      return pending.length;
    },

    start() {
      stopped = false;
      timer.start(() => void poll(), intervalMs);
      void poll();
    },

    async stop() {
      stopped = true;
      timer.stop();
      await passes;
      await writes;
    },

    /** Drops everything remembered about a profile that no longer exists. */
    async forgetProfile(profileId: string) {
      const remaining = pending.filter((entry) => entry.profileId !== profileId);
      if (remaining.length === pending.length) return;
      pending = remaining;
      await persist();
    },
  };
}

export type DesktopImportOutcomeTracker = ReturnType<
  typeof createDesktopImportOutcomeTracker
>;

export function createIntervalImportOutcomeTimer(): ImportOutcomeTimer {
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
