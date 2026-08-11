import { describe, expect, it, vi } from "vitest";
import {
  createDesktopImportOutcomeTracker,
  type ImportDocumentState,
  type ImportOutcomeBatch,
  type ImportOutcomeFileSystem,
} from "./import-outcomes";
import { classifyDocumentState } from "./document-status";

function memoryFileSystem() {
  const files = new Map<string, string>();
  const fileSystem: ImportOutcomeFileSystem = {
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

function createHarness(
  options: {
    fileSystem?: ImportOutcomeFileSystem;
    states?: Record<string, ImportDocumentState>;
    profileId?: string | null;
  } = {},
) {
  const fileSystem = options.fileSystem ?? memoryFileSystem().fileSystem;
  const states = new Map(Object.entries(options.states ?? {}));
  let profileId: string | null =
    options.profileId === undefined ? "home" : options.profileId;
  let clock = 1_000;
  const batches: ImportOutcomeBatch[] = [];
  const inspect = vi.fn(
    async (_profileId: string, documentId: string): Promise<ImportDocumentState> =>
      states.get(documentId) ?? { state: "processing" },
  );
  let sequence = 0;

  const tracker = createDesktopImportOutcomeTracker({
    filePath: "/state/outcomes.json",
    fileSystem,
    statuses: { inspect },
    activeProfileId: () => profileId,
    notify: (batch) => batches.push(batch),
    timer: { start: vi.fn(), stop: vi.fn() },
    now: () => clock,
    createTemporaryId: () => `tmp-${++sequence}`,
  });

  return {
    tracker,
    batches,
    inspect,
    fileSystem,
    settle(documentId: string, state: ImportDocumentState) {
      states.set(documentId, state);
    },
    advance(ms: number) {
      clock += ms;
    },
    switchProfile(next: string | null) {
      profileId = next;
    },
  };
}

describe("document state classification", () => {
  it("treats only a settled archive answer as notifiable", () => {
    expect(classifyDocumentState({ status: "pending" })).toEqual({ state: "processing" });
    expect(classifyDocumentState({ status: "processing" })).toEqual({
      state: "processing",
    });
    expect(
      classifyDocumentState({ status: "ready", embeddingStatus: "indexing" }),
    ).toEqual({ state: "processing" });
    expect(
      classifyDocumentState({
        status: "ready",
        embeddingStatus: "ready",
        reviewStatus: "not_required",
      }),
    ).toEqual({ state: "settled", kind: "completed" });
    expect(
      classifyDocumentState({
        status: "ready",
        embeddingStatus: "ready",
        reviewStatus: "pending",
      }),
    ).toEqual({ state: "settled", kind: "review" });
    expect(classifyDocumentState({ status: "failed" })).toEqual({
      state: "settled",
      kind: "failed",
    });
    expect(
      classifyDocumentState({ status: "ready", embeddingStatus: "failed" }),
    ).toEqual({ state: "settled", kind: "failed" });
  });
});

describe("desktop import outcome tracker", () => {
  it("announces a settled document once, whatever the import source", async () => {
    const harness = createHarness();
    await harness.tracker.load();
    await harness.tracker.track("home", "watch-folder", [
      { documentId: "doc-1", name: "invoice.pdf" },
    ]);
    await harness.tracker.track("home", "picker", [
      { documentId: "doc-2", name: "receipt.pdf" },
    ]);

    await harness.tracker.poll();
    expect(harness.batches).toEqual([]);

    harness.settle("doc-1", { state: "settled", kind: "completed" });
    await harness.tracker.poll();
    expect(harness.batches).toEqual([
      {
        kind: "completed",
        profileId: "home",
        documents: [{ documentId: "doc-1", name: "invoice.pdf" }],
      },
    ]);

    await harness.tracker.poll();
    await harness.tracker.poll();
    expect(harness.batches).toHaveLength(1);
    expect(harness.tracker.pendingCount()).toBe(1);
  });

  it("groups one batch per outcome instead of one notification per file", async () => {
    const harness = createHarness();
    await harness.tracker.load();
    await harness.tracker.track("home", "picker", [
      { documentId: "doc-1", name: "a.pdf" },
      { documentId: "doc-2", name: "b.pdf" },
      { documentId: "doc-3", name: "c.pdf" },
    ]);
    harness.settle("doc-1", { state: "settled", kind: "completed" });
    harness.settle("doc-2", { state: "settled", kind: "completed" });
    harness.settle("doc-3", { state: "settled", kind: "failed" });

    await harness.tracker.poll();

    expect(harness.batches).toHaveLength(2);
    expect(harness.batches[0]!.documents).toHaveLength(2);
    expect(harness.batches[1]).toMatchObject({ kind: "failed" });
  });

  it("does not announce the same document again after a restart", async () => {
    const shared = memoryFileSystem();
    const first = createHarness({ fileSystem: shared.fileSystem });
    await first.tracker.load();
    await first.tracker.track("home", "picker", [
      { documentId: "doc-1", name: "invoice.pdf" },
    ]);
    first.settle("doc-1", { state: "settled", kind: "completed" });
    await first.tracker.poll();
    await first.tracker.stop();
    expect(first.batches).toHaveLength(1);

    const restarted = createHarness({
      fileSystem: shared.fileSystem,
      states: { "doc-1": { state: "settled", kind: "completed" } },
    });
    await restarted.tracker.load();
    await restarted.tracker.track("home", "picker", [
      { documentId: "doc-1", name: "invoice.pdf" },
    ]);
    await restarted.tracker.poll();

    expect(restarted.batches).toEqual([]);
    expect(restarted.tracker.pendingCount()).toBe(0);
  });

  it("resumes a document that was still processing when the app restarted", async () => {
    const shared = memoryFileSystem();
    const first = createHarness({ fileSystem: shared.fileSystem });
    await first.tracker.load();
    await first.tracker.track("home", "watch-folder", [
      { documentId: "doc-1", name: "invoice.pdf" },
    ]);
    await first.tracker.poll();
    await first.tracker.stop();

    const restarted = createHarness({
      fileSystem: shared.fileSystem,
      states: { "doc-1": { state: "settled", kind: "review" } },
    });
    await restarted.tracker.load();
    await restarted.tracker.poll();

    expect(restarted.batches).toEqual([
      {
        kind: "review",
        profileId: "home",
        documents: [{ documentId: "doc-1", name: "invoice.pdf" }],
      },
    ]);
  });

  it("only polls the connected archive and keeps the others pending", async () => {
    const harness = createHarness();
    await harness.tracker.load();
    await harness.tracker.track("home", "picker", [
      { documentId: "doc-home", name: "home.pdf" },
    ]);
    await harness.tracker.track("work", "picker", [
      { documentId: "doc-work", name: "work.pdf" },
    ]);
    harness.settle("doc-home", { state: "settled", kind: "completed" });
    harness.settle("doc-work", { state: "settled", kind: "completed" });

    await harness.tracker.poll();
    expect(harness.batches).toHaveLength(1);
    expect(harness.batches[0]!.profileId).toBe("home");
    expect(harness.inspect).not.toHaveBeenCalledWith("home", "doc-work");

    harness.switchProfile("work");
    await harness.tracker.poll();
    expect(harness.batches).toHaveLength(2);
    expect(harness.batches[1]!.profileId).toBe("work");
  });

  it("stays quiet while no archive is connected", async () => {
    const harness = createHarness({ profileId: null });
    await harness.tracker.load();
    await harness.tracker.track("home", "picker", [
      { documentId: "doc-1", name: "invoice.pdf" },
    ]);
    harness.settle("doc-1", { state: "settled", kind: "completed" });

    await harness.tracker.poll();

    expect(harness.inspect).not.toHaveBeenCalled();
    expect(harness.batches).toEqual([]);
    expect(harness.tracker.pendingCount()).toBe(1);
  });

  it("forgets a document that was deleted before it settled", async () => {
    const harness = createHarness({
      states: { "doc-1": { state: "missing" } },
    });
    await harness.tracker.load();
    await harness.tracker.track("home", "picker", [
      { documentId: "doc-1", name: "invoice.pdf" },
    ]);

    await harness.tracker.poll();

    expect(harness.batches).toEqual([]);
    expect(harness.tracker.pendingCount()).toBe(0);
  });

  it("keeps a document pending while its archive is unreachable", async () => {
    const harness = createHarness({
      states: { "doc-1": { state: "unavailable" } },
    });
    await harness.tracker.load();
    await harness.tracker.track("home", "picker", [
      { documentId: "doc-1", name: "invoice.pdf" },
    ]);
    await harness.tracker.poll();
    expect(harness.tracker.pendingCount()).toBe(1);

    harness.settle("doc-1", { state: "settled", kind: "completed" });
    await harness.tracker.poll();
    expect(harness.batches).toHaveLength(1);
  });

  it("gives up on a document that never settles", async () => {
    const harness = createHarness();
    await harness.tracker.load();
    await harness.tracker.track("home", "picker", [
      { documentId: "doc-1", name: "invoice.pdf" },
    ]);

    harness.advance(25 * 60 * 60 * 1_000);
    await harness.tracker.poll();

    expect(harness.batches).toEqual([]);
    expect(harness.tracker.pendingCount()).toBe(0);
  });

  it("ignores a repeated report of the same document", async () => {
    const harness = createHarness();
    await harness.tracker.load();
    await harness.tracker.track("home", "picker", [
      { documentId: "doc-1", name: "invoice.pdf" },
    ]);
    await harness.tracker.track("home", "picker", [
      { documentId: "doc-1", name: "invoice.pdf" },
    ]);

    expect(harness.tracker.pendingCount()).toBe(1);
  });

  it("drops the pending imports of a removed profile", async () => {
    const harness = createHarness();
    await harness.tracker.load();
    await harness.tracker.track("home", "picker", [
      { documentId: "doc-1", name: "invoice.pdf" },
    ]);
    await harness.tracker.forgetProfile("home");
    harness.settle("doc-1", { state: "settled", kind: "completed" });

    await harness.tracker.poll();

    expect(harness.batches).toEqual([]);
    expect(harness.tracker.pendingCount()).toBe(0);
  });
});
