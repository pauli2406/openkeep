import { describe, expect, it, vi } from "vitest";
import {
  createDesktopLifecycleStateStore,
  type LifecycleStateFileSystem,
} from "./lifecycle-state";

function memoryFileSystem(initial?: string) {
  let contents = initial;
  const fileSystem: LifecycleStateFileSystem = {
    mkdir: vi.fn(async () => undefined),
    readFile: vi.fn(async () => {
      if (contents === undefined) {
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return contents;
    }),
    writeFile: vi.fn(async (_path, next) => {
      contents = next;
    }),
    rename: vi.fn(async () => undefined),
  };
  return { fileSystem, contents: () => contents };
}

describe("desktop lifecycle state", () => {
  it("defaults to close-to-tray and persists global preference, bounds, and trusted routes", async () => {
    const memory = memoryFileSystem();
    const store = createDesktopLifecycleStateStore({
      filePath: "/state/desktop-lifecycle.json",
      fileSystem: memory.fileSystem,
      createTemporaryId: () => "temp",
    });

    await store.load();
    expect(store.snapshot()).toEqual({
      closeBehavior: "tray",
      profileRoutes: {},
    });

    await store.setCloseBehavior("quit");
    await store.setWindowBounds({ x: 40, y: 50, width: 1280, height: 820 });
    await store.rememberProfileRoute("profile-one", "openkeep://app/documents/1");

    expect(JSON.parse(memory.contents()!)).toEqual({
      version: 1,
      closeBehavior: "quit",
      windowBounds: { x: 40, y: 50, width: 1280, height: 820 },
      profileRoutes: { "profile-one": "openkeep://app/documents/1" },
    });
  });

  it("fails closed to defaults when persisted lifecycle state is malformed", async () => {
    const memory = memoryFileSystem(JSON.stringify({
      version: 1,
      closeBehavior: "hide-forever",
      windowBounds: { x: "secret", y: 0, width: -1, height: 0 },
      profileRoutes: { profile: 42 },
    }));
    const store = createDesktopLifecycleStateStore({
      filePath: "/state/desktop-lifecycle.json",
      fileSystem: memory.fileSystem,
    });

    await store.load();

    expect(store.snapshot()).toEqual({
      closeBehavior: "tray",
      profileRoutes: {},
    });
  });

  it("recovers persistence after one failed write", async () => {
    const memory = memoryFileSystem();
    let failNextWrite = true;
    const fileSystem = {
      ...memory.fileSystem,
      writeFile: vi.fn(async (filePath: string, contents: string) => {
        if (failNextWrite) {
          failNextWrite = false;
          throw new Error("transient filesystem lock");
        }
        return memory.fileSystem.writeFile(filePath, contents);
      }),
    };
    const store = createDesktopLifecycleStateStore({
      filePath: "/state/desktop-lifecycle.json",
      fileSystem,
      createTemporaryId: () => "temp",
    });
    await store.load();

    // The failed write reports to its caller...
    await expect(store.setCloseBehavior("quit")).rejects.toThrow(
      "transient filesystem lock",
    );

    // ...and must not disable every later write until restart.
    await store.setWindowBounds({ x: 1, y: 2, width: 1280, height: 820 });
    await store.idle();
    expect(JSON.parse(memory.contents()!)).toMatchObject({
      windowBounds: { x: 1, y: 2, width: 1280, height: 820 },
    });
  });

  it("serializes concurrent updates without losing fields", async () => {
    const memory = memoryFileSystem();
    const store = createDesktopLifecycleStateStore({
      filePath: "/state/desktop-lifecycle.json",
      fileSystem: memory.fileSystem,
    });
    await store.load();

    await Promise.all([
      store.setCloseBehavior("quit"),
      store.setWindowBounds({ x: 1, y: 2, width: 1000, height: 700 }),
      store.rememberProfileRoute("profile", "openkeep://app/search?q=tax"),
    ]);

    expect(store.snapshot()).toMatchObject({
      closeBehavior: "quit",
      windowBounds: { x: 1, y: 2, width: 1000, height: 700 },
      profileRoutes: { profile: "openkeep://app/search?q=tax" },
    });
  });
});
