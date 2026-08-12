import { describe, expect, it, vi } from "vitest";
import { createDesktopBridge, DESKTOP_CHANNELS } from "./desktop-api";

describe("preload bridge contract", () => {
  it("exposes named operations over fixed channels", async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const bridge = createDesktopBridge(invoke, subscribe);

    await bridge.session.restore();
    await bridge.session.connect({
      serverUrl: "https://archive.example.com",
      apiToken: "secret",
    });
    await bridge.session.retry();
    await bridge.session.signOut();
    await bridge.session.openOffline({ profileId: "profile-id" });
    await bridge.session.offlineAvailability();
    await bridge.profiles.list();
    await bridge.profiles.activate({ profileId: "profile-id" });
    await bridge.profiles.rename({ profileId: "profile-id", label: "Home" });
    await bridge.profiles.remove({ profileId: "profile-id" });
    await bridge.imports.pick();
    await bridge.imports.pending();
    await bridge.imports.assign({ batchId: "batch-id", profileId: "profile-id" });
    await bridge.imports.consume();
    await bridge.imports.reportCreated({
      documents: [{ documentId: "document-id", name: "invoice.pdf" }],
    });
    const stop = bridge.imports.onChanged(() => undefined);
    await bridge.save.request({
      kind: "document-original",
      documentId: "11111111-1111-4111-8111-111111111111",
    });
    await bridge.watchFolders.list();
    await bridge.watchFolders.add();
    await bridge.watchFolders.setPaused({ folderId: "folder-id", paused: true });
    await bridge.watchFolders.remove({ folderId: "folder-id" });
    const stopWatching = bridge.watchFolders.onChanged(() => undefined);
    await bridge.notifications.getSettings();
    await bridge.notifications.setPreference({ kind: "review", enabled: false });
    await bridge.lifecycle.getSettings();
    await bridge.lifecycle.setCloseBehavior({ closeBehavior: "quit" });
    await bridge.runtime.getInfo();

    expect(invoke).toHaveBeenNthCalledWith(1, DESKTOP_CHANNELS.sessionRestore);
    expect(invoke).toHaveBeenNthCalledWith(2, DESKTOP_CHANNELS.sessionConnect, {
      serverUrl: "https://archive.example.com",
      apiToken: "secret",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, DESKTOP_CHANNELS.sessionRetry);
    expect(invoke).toHaveBeenNthCalledWith(4, DESKTOP_CHANNELS.sessionSignOut);
    expect(invoke).toHaveBeenNthCalledWith(5, DESKTOP_CHANNELS.sessionOpenOffline, {
      profileId: "profile-id",
    });
    expect(invoke).toHaveBeenNthCalledWith(
      6,
      DESKTOP_CHANNELS.sessionOfflineAvailability,
    );
    expect(invoke).toHaveBeenNthCalledWith(7, DESKTOP_CHANNELS.profilesList);
    expect(invoke).toHaveBeenNthCalledWith(8, DESKTOP_CHANNELS.profilesActivate, {
      profileId: "profile-id",
    });
    expect(invoke).toHaveBeenNthCalledWith(9, DESKTOP_CHANNELS.profilesRename, {
      profileId: "profile-id",
      label: "Home",
    });
    expect(invoke).toHaveBeenNthCalledWith(10, DESKTOP_CHANNELS.profilesRemove, {
      profileId: "profile-id",
    });
    expect(invoke).toHaveBeenNthCalledWith(11, DESKTOP_CHANNELS.importsPick);
    expect(invoke).toHaveBeenNthCalledWith(12, DESKTOP_CHANNELS.importsPending);
    expect(invoke).toHaveBeenNthCalledWith(13, DESKTOP_CHANNELS.importsAssign, {
      batchId: "batch-id",
      profileId: "profile-id",
    });
    expect(invoke).toHaveBeenNthCalledWith(14, DESKTOP_CHANNELS.importsConsume);
    expect(invoke).toHaveBeenNthCalledWith(
      15,
      DESKTOP_CHANNELS.importsReportCreated,
      { documents: [{ documentId: "document-id", name: "invoice.pdf" }] },
    );
    expect(invoke).toHaveBeenNthCalledWith(16, DESKTOP_CHANNELS.saveRequest, {
      kind: "document-original",
      documentId: "11111111-1111-4111-8111-111111111111",
    });
    expect(invoke).toHaveBeenNthCalledWith(17, DESKTOP_CHANNELS.watchFoldersList);
    expect(invoke).toHaveBeenNthCalledWith(18, DESKTOP_CHANNELS.watchFoldersAdd);
    expect(invoke).toHaveBeenNthCalledWith(
      19,
      DESKTOP_CHANNELS.watchFoldersSetPaused,
      { folderId: "folder-id", paused: true },
    );
    expect(invoke).toHaveBeenNthCalledWith(
      20,
      DESKTOP_CHANNELS.watchFoldersRemove,
      { folderId: "folder-id" },
    );
    expect(invoke).toHaveBeenNthCalledWith(
      21,
      DESKTOP_CHANNELS.notificationsGetSettings,
    );
    expect(invoke).toHaveBeenNthCalledWith(
      22,
      DESKTOP_CHANNELS.notificationsSetPreference,
      { kind: "review", enabled: false },
    );
    expect(invoke).toHaveBeenNthCalledWith(
      23,
      DESKTOP_CHANNELS.lifecycleGetSettings,
    );
    expect(invoke).toHaveBeenNthCalledWith(
      24,
      DESKTOP_CHANNELS.lifecycleSetCloseBehavior,
      { closeBehavior: "quit" },
    );
    expect(invoke).toHaveBeenNthCalledWith(25, DESKTOP_CHANNELS.runtimeGetInfo);
    expect(subscribe).toHaveBeenCalledWith(
      DESKTOP_CHANNELS.importsChanged,
      expect.any(Function),
    );
    expect(subscribe).toHaveBeenCalledWith(
      DESKTOP_CHANNELS.watchFoldersChanged,
      expect.any(Function),
    );
    stop();
    stopWatching();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
    expect(Object.isFrozen(bridge)).toBe(true);
    expect(Object.keys(bridge)).toEqual([
      "session",
      "profiles",
      "imports",
      "save",
      "watchFolders",
      "notifications",
      "lifecycle",
      "runtime",
    ]);
  });
});
