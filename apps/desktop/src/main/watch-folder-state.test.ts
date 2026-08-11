import { describe, expect, it } from "vitest";
import {
  classifyWatchFolderEntry,
  isWatchFolderEntrySettled,
  observeWatchFolderEntry,
} from "./watch-folder-rules";
import {
  createDesktopWatchFolderStore,
  type WatchFolderStateFileSystem,
} from "./watch-folder-state";

function memoryFileSystem() {
  const files = new Map<string, string>();
  const fileSystem: WatchFolderStateFileSystem = {
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
  return { files, fileSystem };
}

function createStore(fileSystem: WatchFolderStateFileSystem) {
  let sequence = 0;
  return createDesktopWatchFolderStore({
    filePath: "/state/desktop-watch-folders.json",
    fileSystem,
    createId: () => `id-${++sequence}`,
    createTemporaryId: () => `tmp-${++sequence}`,
  });
}

describe("watch folder rules", () => {
  it("imports only supported finished documents", () => {
    expect(classifyWatchFolderEntry("Invoice.PDF", "file")).toBe("eligible");
    expect(classifyWatchFolderEntry("scan.tiff", "file")).toBe("eligible");
    expect(classifyWatchFolderEntry("notes.txt", "file")).toBe("unsupported");
    expect(classifyWatchFolderEntry(".DS_Store", "file")).toBe("hidden");
    expect(classifyWatchFolderEntry("Inbox", "directory")).toBe("directory");
    expect(classifyWatchFolderEntry("scan.pdf.part", "file")).toBe("temporary");
    expect(classifyWatchFolderEntry("scan.pdf.crdownload", "file")).toBe("temporary");
    expect(classifyWatchFolderEntry("~$report.pdf", "file")).toBe("temporary");
    expect(classifyWatchFolderEntry("report.pdf~", "file")).toBe("temporary");
  });

  it("waits for size and modification time to stop changing", () => {
    const growing = observeWatchFolderEntry(undefined, { size: 10, mtimeMs: 5 }, 1_000);
    expect(isWatchFolderEntrySettled(growing, 3_000, 4_000)).toBe(false);

    const stillGrowing = observeWatchFolderEntry(
      growing,
      { size: 20, mtimeMs: 9 },
      6_000,
    );
    expect(stillGrowing.firstSeenAt).toBe(6_000);
    expect(isWatchFolderEntrySettled(stillGrowing, 9_000, 4_000)).toBe(false);

    const quiet = observeWatchFolderEntry(stillGrowing, { size: 20, mtimeMs: 9 }, 9_000);
    expect(quiet.firstSeenAt).toBe(6_000);
    expect(isWatchFolderEntrySettled(quiet, 10_001, 4_000)).toBe(true);
  });

  it("settles a file whose modification time is ahead of this clock", () => {
    const skewed = observeWatchFolderEntry(
      undefined,
      { size: 4, mtimeMs: 9_999_999 },
      1_000,
    );
    expect(isWatchFolderEntrySettled(skewed, 5_100, 4_000)).toBe(true);
  });
});

describe("desktop watch folder state", () => {
  it("keeps folders, checkpoints, and history per archive profile", async () => {
    const { fileSystem } = memoryFileSystem();
    const store = createStore(fileSystem);
    await store.load();

    const home = await store.add("home", "/Users/keeper/Scans");
    const work = await store.add("work", "/Users/keeper/Scans");
    expect(home.added).toBe(true);
    expect(work.added).toBe(true);
    expect((await store.add("home", "/Users/keeper/Scans")).added).toBe(false);

    await store.recordImported(
      "home",
      "/Users/keeper/Scans/invoice.pdf",
      { size: 12, mtimeMs: 34, checksum: "sha-1" },
      1_000,
    );
    await store.recordEvent("home", home.folder.id, {
      id: "event-1",
      name: "invoice.pdf",
      outcome: "imported",
      at: 1_000,
    });
    await store.idle();

    expect(store.knowsChecksum("home", "sha-1")).toBe(true);
    expect(store.knowsChecksum("work", "sha-1")).toBe(false);
    expect(store.fingerprintFor("home", "/Users/keeper/Scans/invoice.pdf")).toMatchObject(
      { size: 12, mtimeMs: 34, checksum: "sha-1" },
    );
    expect(store.list("home")[0]).toMatchObject({
      counts: { imported: 1, duplicate: 0, failed: 0 },
    });
    expect(store.list("work")[0]!.counts.imported).toBe(0);
  });

  it("restores checkpoints after a restart so nothing is imported twice", async () => {
    const { fileSystem } = memoryFileSystem();
    const store = createStore(fileSystem);
    await store.load();
    const added = await store.add("home", "/Users/keeper/Scans");
    await store.setPaused("home", added.folder.id, true);
    await store.recordImported(
      "home",
      "/Users/keeper/Scans/invoice.pdf",
      { size: 12, mtimeMs: 34, checksum: "sha-1" },
      1_000,
    );
    await store.idle();

    const restored = createStore(fileSystem);
    await restored.load();
    expect(restored.list("home")).toMatchObject([
      { path: "/Users/keeper/Scans", paused: true },
    ]);
    expect(restored.knowsChecksum("home", "sha-1")).toBe(true);
  });

  it("bounds history per folder and drops the oldest checkpoints", async () => {
    const { fileSystem } = memoryFileSystem();
    const store = createStore(fileSystem);
    await store.load();
    const added = await store.add("home", "/Users/keeper/Scans");

    for (let index = 0; index < 60; index += 1) {
      await store.recordEvent("home", added.folder.id, {
        id: `event-${index}`,
        name: `scan-${index}.pdf`,
        outcome: "imported",
        at: index,
      });
    }
    await store.idle();

    const folder = store.list("home")[0]!;
    expect(folder.counts.imported).toBe(60);
    expect(folder.history).toHaveLength(40);
    expect(folder.history[0]!.name).toBe("scan-59.pdf");
  });

  it("forgets everything about a removed profile", async () => {
    const { fileSystem } = memoryFileSystem();
    const store = createStore(fileSystem);
    await store.load();
    await store.add("home", "/Users/keeper/Scans");
    await store.recordImported(
      "home",
      "/Users/keeper/Scans/invoice.pdf",
      { size: 1, mtimeMs: 2, checksum: "sha-1" },
      10,
    );
    await store.forgetProfile("home");
    await store.idle();

    expect(store.list("home")).toEqual([]);
    expect(store.knowsChecksum("home", "sha-1")).toBe(false);
  });

  it("falls back to no watch folders when the state file is unusable", async () => {
    const { files, fileSystem } = memoryFileSystem();
    files.set("/state/desktop-watch-folders.json", "{ not json");
    const store = createStore(fileSystem);
    await store.load();
    expect(store.list("home")).toEqual([]);
  });
});
