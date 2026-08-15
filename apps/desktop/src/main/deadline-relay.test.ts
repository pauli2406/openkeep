import { describe, expect, it, vi } from "vitest";

import { createDesktopDeadlineRelay } from "./deadline-relay";
import type { DesktopNotifier } from "./import-notifications";

const ACTIVE = {
  profile: { id: "profile-1", serverUrl: "https://archive.example.com" },
  credentials: { apiToken: "token-1" },
};

function jsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: async () => payload,
  } as unknown as Response;
}

function collectingNotifier(): DesktopNotifier & { shown: Array<{ title: string; body: string }> } {
  const shown: Array<{ title: string; body: string }> = [];
  return {
    shown,
    isSupported: () => true,
    show(request) {
      shown.push({ title: request.title, body: request.body });
      request.onClick();
    },
  };
}

const ITEM = {
  id: "11111111-1111-4111-8111-111111111111",
  documentId: "22222222-2222-4222-8222-222222222222",
  documentTitle: "Stromrechnung",
  correspondentName: "Stadtwerke",
  window: "overdue" as const,
  dueDate: "2026-06-01",
};

describe("desktop deadline relay", () => {
  it("claims a record before announcing, and announces only a successful claim", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchRequest = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.includes("undeliveredFor=desktop")) {
        return jsonResponse({ items: [ITEM] });
      }
      return jsonResponse({ delivered: true });
    });
    const notifier = collectingNotifier();
    const opened: string[] = [];

    const relay = createDesktopDeadlineRelay({
      fetchRequest: fetchRequest as never,
      activeArchive: () => ACTIVE,
      notifier,
      enabled: () => true,
      open: (target) => opened.push(target.url),
    });

    await relay.poll();

    // Claim precedes the announcement.
    const claimIndex = calls.findIndex((call) => call.method === "POST");
    expect(claimIndex).toBeGreaterThan(0);
    expect(calls[claimIndex].url).toContain(`/api/notifications/${ITEM.id}/delivered`);
    expect(notifier.shown).toEqual([
      { title: "Deadline overdue", body: "Stromrechnung (Stadtwerke) — due 2026-06-01" },
    ]);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toContain(ITEM.documentId);
  });

  it("stays quiet when another installation already delivered the record", async () => {
    const fetchRequest = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("undeliveredFor=desktop")) {
        return jsonResponse({ items: [ITEM] });
      }
      return jsonResponse({ delivered: false });
    });
    const notifier = collectingNotifier();

    const relay = createDesktopDeadlineRelay({
      fetchRequest: fetchRequest as never,
      activeArchive: () => ACTIVE,
      notifier,
      enabled: () => true,
      open: () => undefined,
    });

    await relay.poll();
    expect(notifier.shown).toHaveLength(0);
  });

  it("does nothing while disabled or disconnected, without error noise", async () => {
    const fetchRequest = vi.fn();
    const reportError = vi.fn();
    const notifier = collectingNotifier();

    const disabled = createDesktopDeadlineRelay({
      fetchRequest: fetchRequest as never,
      activeArchive: () => ACTIVE,
      notifier,
      enabled: () => false,
      open: () => undefined,
      reportError,
    });
    await disabled.poll();

    const disconnected = createDesktopDeadlineRelay({
      fetchRequest: fetchRequest as never,
      activeArchive: () => null,
      notifier,
      enabled: () => true,
      open: () => undefined,
      reportError,
    });
    await disconnected.poll();

    expect(fetchRequest).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("reports a network failure instead of throwing", async () => {
    const reportError = vi.fn();
    const relay = createDesktopDeadlineRelay({
      fetchRequest: (async () => {
        throw new Error("offline");
      }) as never,
      activeArchive: () => ACTIVE,
      notifier: collectingNotifier(),
      enabled: () => true,
      open: () => undefined,
      reportError,
    });

    await expect(relay.poll()).resolves.toBeUndefined();
    expect(reportError).toHaveBeenCalledOnce();
  });
});
