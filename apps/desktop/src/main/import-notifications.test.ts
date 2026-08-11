import { describe, expect, it, vi } from "vitest";
import {
  createDesktopImportNotifier,
  type DesktopNotificationRequest,
  type NotificationTarget,
} from "./import-notifications";
import { createDesktopNotificationRouter } from "./notification-routing";
import type {
  DesktopNotificationPreferences,
  DesktopNotificationKind,
} from "../shared/desktop-api";

function createNotifierHarness(
  options: {
    preferences?: Partial<DesktopNotificationPreferences>;
    supported?: boolean;
  } = {},
) {
  const shown: DesktopNotificationRequest[] = [];
  const opened: NotificationTarget[] = [];
  const preferences: DesktopNotificationPreferences = {
    completed: true,
    failed: true,
    review: true,
    ...options.preferences,
  };
  const notifier = createDesktopImportNotifier({
    notifier: {
      isSupported: () => options.supported !== false,
      show: (request) => shown.push(request),
    },
    preferences: () => preferences,
    open: (target) => opened.push(target),
  });
  return { notifier, shown, opened };
}

function batch(
  kind: DesktopNotificationKind,
  documents: Array<{ documentId: string; name: string }>,
) {
  return { kind, profileId: "home", documents };
}

describe("desktop import notifications", () => {
  it("names one document and counts a batch, for each outcome", () => {
    const harness = createNotifierHarness();

    harness.notifier.present(batch("completed", [{ documentId: "d1", name: "a.pdf" }]));
    harness.notifier.present(
      batch("review", [
        { documentId: "d2", name: "b.pdf" },
        { documentId: "d3", name: "c.pdf" },
      ]),
    );
    harness.notifier.present(batch("failed", [{ documentId: "d4", name: "d.pdf" }]));

    expect(harness.shown.map(({ title, body }) => ({ title, body }))).toEqual([
      { title: "Document imported", body: "a.pdf is ready." },
      { title: "Documents need review", body: "2 documents are waiting for you." },
      { title: "Import failed", body: "d.pdf could not be processed." },
    ]);
  });

  it("opens the document itself, and the queue for a batch", () => {
    const harness = createNotifierHarness();

    harness.notifier.present(batch("completed", [{ documentId: "d1", name: "a.pdf" }]));
    harness.shown[0]!.onClick();
    expect(harness.opened[0]).toEqual({
      profileId: "home",
      url: "openkeep://app/documents/d1",
    });

    harness.notifier.present(
      batch("review", [
        { documentId: "d2", name: "b.pdf" },
        { documentId: "d3", name: "c.pdf" },
      ]),
    );
    harness.shown[1]!.onClick();
    expect(harness.opened[1]).toEqual({
      profileId: "home",
      url: "openkeep://app/review",
    });
  });

  it("respects each preference independently", () => {
    const harness = createNotifierHarness({
      preferences: { completed: false, review: true, failed: false },
    });

    harness.notifier.present(batch("completed", [{ documentId: "d1", name: "a.pdf" }]));
    harness.notifier.present(batch("failed", [{ documentId: "d2", name: "b.pdf" }]));
    harness.notifier.present(batch("review", [{ documentId: "d3", name: "c.pdf" }]));

    expect(harness.shown).toHaveLength(1);
    expect(harness.shown[0]!.title).toBe("Document needs review");
  });

  it("stays silent where the system has no notification service", () => {
    const harness = createNotifierHarness({ supported: false });
    harness.notifier.present(batch("completed", [{ documentId: "d1", name: "a.pdf" }]));
    expect(harness.shown).toEqual([]);
    expect(harness.notifier.supported()).toBe(false);
  });

  it("carries nothing beyond a file name and a count", () => {
    const harness = createNotifierHarness();
    harness.notifier.present(
      batch("completed", [{ documentId: "d1", name: "invoice.pdf" }]),
    );
    const serialized = JSON.stringify(harness.shown[0]);
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("cf-access");
    expect(serialized).toContain("invoice.pdf");
  });
});

function createRouterHarness(activeProfileId: string | null) {
  let active = activeProfileId;
  const navigate = vi.fn();
  const showWindow = vi.fn();
  const confirmSwitch = vi.fn(async () => true);
  const activateProfile = vi.fn(async (profileId: string) => {
    active = profileId;
  });
  const router = createDesktopNotificationRouter({
    activeProfileId: () => active,
    confirmSwitch,
    activateProfile,
    navigate,
    showWindow,
  });
  return {
    router,
    navigate,
    showWindow,
    confirmSwitch,
    activateProfile,
    connect(profileId: string) {
      active = profileId;
      router.profileConnected(profileId);
    },
  };
}

describe("desktop notification routing", () => {
  it("reveals and navigates the window of the archive that is already active", async () => {
    const harness = createRouterHarness("home");
    await harness.router.open({
      profileId: "home",
      url: "openkeep://app/documents/d1",
    });

    expect(harness.showWindow).toHaveBeenCalledOnce();
    expect(harness.navigate).toHaveBeenCalledWith("openkeep://app/documents/d1");
    expect(harness.confirmSwitch).not.toHaveBeenCalled();
  });

  it("waits for authentication when clicked from a cold start", async () => {
    const harness = createRouterHarness(null);
    await harness.router.open({
      profileId: "home",
      url: "openkeep://app/documents/d1",
    });

    expect(harness.navigate).not.toHaveBeenCalled();
    expect(harness.showWindow).toHaveBeenCalledOnce();

    // A different archive connecting first must not consume the intent.
    harness.router.profileConnected("work");
    expect(harness.navigate).not.toHaveBeenCalled();

    harness.connect("home");
    expect(harness.navigate).toHaveBeenCalledWith("openkeep://app/documents/d1");

    harness.router.profileConnected("home");
    expect(harness.navigate).toHaveBeenCalledOnce();
  });

  it("never switches archives without asking", async () => {
    const harness = createRouterHarness("work");
    harness.confirmSwitch.mockResolvedValueOnce(false);

    await harness.router.open({
      profileId: "home",
      url: "openkeep://app/documents/d1",
    });

    expect(harness.confirmSwitch).toHaveBeenCalledWith("home");
    expect(harness.activateProfile).not.toHaveBeenCalled();
    expect(harness.navigate).not.toHaveBeenCalled();
    expect(harness.router.pendingTarget()).toBeNull();
  });

  it("activates a confirmed archive and routes once it is connected", async () => {
    const harness = createRouterHarness("work");
    await harness.router.open({
      profileId: "home",
      url: "openkeep://app/review",
    });

    expect(harness.activateProfile).toHaveBeenCalledWith("home");
    // Activation replaces the window; the route is applied by the connect signal.
    expect(harness.navigate).not.toHaveBeenCalled();

    harness.router.profileConnected("home");
    expect(harness.navigate).toHaveBeenCalledWith("openkeep://app/review");
  });

  it("refuses a target that is not a trusted application route", async () => {
    const harness = createRouterHarness("home");
    await harness.router.open({
      profileId: "home",
      url: "https://evil.example.com/",
    });

    expect(harness.navigate).not.toHaveBeenCalled();
    expect(harness.showWindow).not.toHaveBeenCalled();
  });
});
