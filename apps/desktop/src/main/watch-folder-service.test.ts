import { describe, expect, it, vi } from "vitest";
import {
  createDesktopWatchFolderService,
  type WatchFolderDirectoryEntry,
  type WatchFolderFileSystem,
} from "./watch-folder-service";
import {
  createDesktopWatchFolderStore,
  type WatchFolderStateFileSystem,
} from "./watch-folder-state";
import type { WatchFolderUploadResult } from "./watch-folder-uploader";

type FakeEntry = {
  size: number;
  mtimeMs: number;
  kind?: "file" | "directory" | "other";
};

function memoryStateFileSystem(): WatchFolderStateFileSystem {
  const files = new Map<string, string>();
  return {
    mkdir: async () => undefined,
    readFile: async (filePath) => {
      const contents = files.get(filePath);
      if (contents === undefined) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return contents;
    },
    writeFile: async (filePath, contents) => {
      files.set(filePath, contents);
    },
    rename: async (from, to) => {
      files.set(to, files.get(from)!);
      files.delete(from);
    },
  };
}

async function createHarness(
  options: {
    entries?: Record<string, FakeEntry>;
    directoryError?: NodeJS.ErrnoException;
    profileId?: string | null;
  } = {},
) {
  const entries = new Map(Object.entries(options.entries ?? {}));
  let directoryError = options.directoryError;
  let profileId: string | null =
    options.profileId === undefined ? "home" : options.profileId;
  let clock = 100_000;

  const fileSystem: WatchFolderFileSystem = {
    readDirectory: vi.fn(async (): Promise<WatchFolderDirectoryEntry[]> => {
      if (directoryError) throw directoryError;
      return [...entries.keys()].map((name) => ({
        name,
        kind: entries.get(name)!.kind ?? "file",
      }));
    }),
    stat: vi.fn(async (filePath: string) => {
      const name = filePath.split("/").at(-1)!;
      const entry = entries.get(name);
      if (!entry) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return {
        size: entry.size,
        mtimeMs: entry.mtimeMs,
        kind: entry.kind ?? ("file" as const),
      };
    }),
  };

  const results: WatchFolderUploadResult[] = [];
  const upload = vi.fn(
    async ({
      isKnownChecksum,
    }: {
      filePath: string;
      profileId: string;
      isKnownChecksum: (checksum: string) => boolean;
    }): Promise<WatchFolderUploadResult> => {
      const next = results.shift() ?? { status: "imported", checksum: "sha-default" };
      if (
        (next.status === "imported" || next.status === "duplicate") &&
        isKnownChecksum(next.checksum)
      ) {
        return { status: "duplicate", checksum: next.checksum, message: "known" };
      }
      return next;
    },
  );

  const timer = { start: vi.fn(), stop: vi.fn() };
  const onChanged = vi.fn();
  const store = createDesktopWatchFolderStore({
    filePath: "/state/watch.json",
    fileSystem: memoryStateFileSystem(),
    createId: (() => {
      let sequence = 0;
      return () => `folder-${++sequence}`;
    })(),
  });
  await store.load();

  let eventSequence = 0;
  const service = createDesktopWatchFolderService({
    store,
    fileSystem,
    uploader: { upload },
    timer,
    activeProfileId: () => profileId,
    now: () => clock,
    createId: () => `event-${++eventSequence}`,
    onChanged,
    settleMs: 4_000,
  });

  return {
    service,
    store,
    fileSystem,
    upload,
    timer,
    onChanged,
    entries,
    queueResults(...next: WatchFolderUploadResult[]) {
      results.push(...next);
    },
    advance(ms: number) {
      clock += ms;
    },
    disconnect() {
      profileId = null;
    },
    reconnect(next = "home") {
      profileId = next;
    },
    failDirectory(error: NodeJS.ErrnoException | undefined) {
      directoryError = error;
    },
    /** Two cycles: the first observes, the second finds the file unchanged. */
    async settleAndScan() {
      await service.scan();
      clock += 5_000;
      await service.scan();
    },
  };
}

describe("desktop watch folder service", () => {
  it("imports a settled document once and never again", async () => {
    const harness = await createHarness({
      entries: { "invoice.pdf": { size: 120, mtimeMs: 10 } },
    });
    harness.queueResults({ status: "imported", checksum: "sha-invoice" });
    await harness.service.add("/Users/keeper/Scans");

    // The first cycle only observes: a file seen once is not known to be quiet.
    expect(harness.upload).not.toHaveBeenCalled();

    await harness.settleAndScan();
    expect(harness.upload).toHaveBeenCalledTimes(1);

    await harness.settleAndScan();
    expect(harness.upload).toHaveBeenCalledTimes(1);

    const folder = harness.service.snapshot().folders[0]!;
    expect(folder.state).toBe("watching");
    expect(folder.counts).toEqual({ imported: 1, duplicate: 0, failed: 0 });
    expect(folder.history[0]).toMatchObject({
      name: "invoice.pdf",
      outcome: "imported",
    });
  });

  it("waits while a copy is still growing", async () => {
    const harness = await createHarness({
      entries: { "scan.pdf": { size: 100, mtimeMs: 10 } },
    });
    await harness.service.add("/Users/keeper/Scans");

    harness.advance(5_000);
    harness.entries.set("scan.pdf", { size: 400, mtimeMs: 5_100 });
    await harness.service.scan();
    expect(harness.upload).not.toHaveBeenCalled();

    harness.advance(5_000);
    await harness.service.scan();
    expect(harness.upload).toHaveBeenCalledTimes(1);
  });

  it("ignores temporary, hidden, unsupported, and directory entries", async () => {
    const harness = await createHarness({
      entries: {
        "scan.pdf.part": { size: 10, mtimeMs: 1 },
        ".DS_Store": { size: 10, mtimeMs: 1 },
        "notes.txt": { size: 10, mtimeMs: 1 },
        Archive: { size: 0, mtimeMs: 1, kind: "directory" },
      },
    });
    await harness.service.add("/Users/keeper/Scans");
    await harness.settleAndScan();

    expect(harness.upload).not.toHaveBeenCalled();
    const folder = harness.service.snapshot().folders[0]!;
    expect(folder.history.filter((event) => event.outcome === "unsupported")).toEqual([
      expect.objectContaining({ name: "notes.txt" }),
    ]);
  });

  it("recognizes a renamed file the archive already holds", async () => {
    const harness = await createHarness({
      entries: { "invoice.pdf": { size: 120, mtimeMs: 10 } },
    });
    harness.queueResults({ status: "imported", checksum: "sha-same" });
    await harness.service.add("/Users/keeper/Scans");
    await harness.settleAndScan();

    harness.entries.delete("invoice.pdf");
    harness.entries.set("invoice-final.pdf", { size: 120, mtimeMs: 10 });
    harness.queueResults({ status: "imported", checksum: "sha-same" });
    await harness.settleAndScan();

    const folder = harness.service.snapshot().folders[0]!;
    expect(folder.counts).toEqual({ imported: 1, duplicate: 1, failed: 0 });
  });

  it("reconsiders a file that genuinely changed", async () => {
    const harness = await createHarness({
      entries: { "invoice.pdf": { size: 120, mtimeMs: 10 } },
    });
    harness.queueResults({ status: "imported", checksum: "sha-first" });
    await harness.service.add("/Users/keeper/Scans");
    await harness.settleAndScan();

    harness.entries.set("invoice.pdf", { size: 400, mtimeMs: 20_000 });
    harness.queueResults({ status: "imported", checksum: "sha-second" });
    await harness.settleAndScan();

    expect(harness.upload).toHaveBeenCalledTimes(2);
    expect(harness.service.snapshot().folders[0]!.counts.imported).toBe(2);
  });

  it("retries a transient failure and gives up on a permanent one", async () => {
    const harness = await createHarness({
      entries: { "invoice.pdf": { size: 120, mtimeMs: 10 } },
    });
    harness.queueResults(
      { status: "retry", message: "The archive could not be reached." },
      { status: "retry", message: "The archive could not be reached." },
      { status: "imported", checksum: "sha-late" },
    );
    await harness.service.add("/Users/keeper/Scans");
    await harness.settleAndScan();
    await harness.settleAndScan();

    const retrying = harness.service.snapshot().folders[0]!;
    expect(retrying.history.filter((event) => event.outcome === "retrying")).toHaveLength(1);

    await harness.settleAndScan();
    expect(harness.service.snapshot().folders[0]!.counts.imported).toBe(1);
  });

  it("stops retrying an oversized file until its contents change", async () => {
    const harness = await createHarness({
      entries: { "huge.pdf": { size: 999, mtimeMs: 10 } },
    });
    harness.queueResults({
      status: "rejected",
      message: "The file exceeds the desktop import limit of 64 MiB.",
    });
    await harness.service.add("/Users/keeper/Scans");
    await harness.settleAndScan();
    await harness.settleAndScan();

    expect(harness.upload).toHaveBeenCalledTimes(1);
    const folder = harness.service.snapshot().folders[0]!;
    expect(folder.counts.failed).toBe(1);
    expect(folder.history[0]).toMatchObject({ outcome: "failed" });
  });

  it("reports a missing folder and revoked permissions without importing", async () => {
    const harness = await createHarness({
      entries: { "invoice.pdf": { size: 120, mtimeMs: 10 } },
    });
    await harness.service.add("/Volumes/Stick/Scans");

    harness.failDirectory(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }) as NodeJS.ErrnoException,
    );
    await harness.service.scan();
    expect(harness.service.snapshot().folders[0]).toMatchObject({
      state: "missing",
    });

    harness.failDirectory(
      Object.assign(new Error("EACCES"), { code: "EACCES" }) as NodeJS.ErrnoException,
    );
    await harness.service.scan();
    expect(harness.service.snapshot().folders[0]).toMatchObject({
      state: "unreadable",
    });

    // The drive comes back and the pending document is imported.
    harness.failDirectory(undefined);
    await harness.settleAndScan();
    expect(harness.upload).toHaveBeenCalledTimes(1);
    expect(harness.service.snapshot().folders[0]!.state).toBe("watching");
  });

  it("pauses on disconnect and resumes after reconnection", async () => {
    const harness = await createHarness({
      entries: { "invoice.pdf": { size: 120, mtimeMs: 10 } },
    });
    await harness.service.add("/Users/keeper/Scans");

    harness.disconnect();
    await harness.settleAndScan();
    expect(harness.upload).not.toHaveBeenCalled();
    expect(harness.service.snapshot()).toMatchObject({
      profileId: "home",
      folders: [{ state: "waiting" }],
    });

    harness.reconnect();
    await harness.settleAndScan();
    expect(harness.upload).toHaveBeenCalledTimes(1);
  });

  it("scans nothing while a folder is paused and catches up on resume", async () => {
    const harness = await createHarness({
      entries: { "invoice.pdf": { size: 120, mtimeMs: 10 } },
    });
    const snapshot = await harness.service.add("/Users/keeper/Scans");
    const folderId = snapshot.folders[0]!.id;

    await harness.service.setPaused(folderId, true);
    await harness.settleAndScan();
    expect(harness.upload).not.toHaveBeenCalled();
    expect(harness.service.snapshot().folders[0]!.state).toBe("paused");

    harness.advance(5_000);
    await harness.service.setPaused(folderId, false);
    await harness.settleAndScan();
    expect(harness.upload).toHaveBeenCalledTimes(1);
  });

  it("coalesces a burst of scan requests into one pass", async () => {
    const harness = await createHarness({
      entries: { "invoice.pdf": { size: 120, mtimeMs: 10 } },
    });
    await harness.service.add("/Users/keeper/Scans");
    harness.advance(5_000);

    await Promise.all([
      harness.service.scan(),
      harness.service.scan(),
      harness.service.scan(),
    ]);

    expect(harness.upload).toHaveBeenCalledTimes(1);
  });

  it("notifies only when a poll actually changed something", async () => {
    const harness = await createHarness({
      entries: { "invoice.pdf": { size: 120, mtimeMs: 10 } },
    });
    await harness.service.add("/Users/keeper/Scans");
    await harness.settleAndScan();
    const afterImport = harness.onChanged.mock.calls.length;
    expect(afterImport).toBeGreaterThan(0);

    // Nothing new in the folder: further polls must stay silent so the renderer
    // and the tray are not rebuilt every few seconds.
    await harness.settleAndScan();
    await harness.settleAndScan();
    expect(harness.onChanged).toHaveBeenCalledTimes(afterImport);
  });

  it("forgets a removed folder and summarizes state without paths", async () => {
    const harness = await createHarness({
      entries: { "invoice.pdf": { size: 120, mtimeMs: 10 } },
    });
    const snapshot = await harness.service.add("/Users/keeper/Scans");
    expect(harness.service.summary()).toEqual({
      total: 1,
      watching: 1,
      attention: 0,
    });

    await harness.service.remove(snapshot.folders[0]!.id);
    expect(harness.service.snapshot().folders).toEqual([]);
    expect(harness.service.summary()).toEqual({
      total: 0,
      watching: 0,
      attention: 0,
    });
  });
});
