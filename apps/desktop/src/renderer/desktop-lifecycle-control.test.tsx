import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesktopLifecycleControl } from "./desktop-lifecycle-control";
import type { DesktopNotificationSettings } from "../shared/desktop-api";

function createBridge(
  options: {
    trayAvailable?: boolean;
    closeBehavior?: "tray" | "quit";
    notifications?: DesktopNotificationSettings;
  } = {},
) {
  const trayAvailable = options.trayAvailable ?? true;
  const notificationSettings: DesktopNotificationSettings =
    options.notifications ?? {
      preferences: { completed: true, failed: true, review: true },
      supported: true,
    };
  const lifecycle = {
    getSettings: vi.fn(async () => ({
      closeBehavior: options.closeBehavior ?? ("tray" as const),
      trayAvailable,
    })),
    setCloseBehavior: vi.fn(async () => ({
      closeBehavior: "quit" as const,
      trayAvailable,
    })),
  };
  const notifications = {
    getSettings: vi.fn(async () => notificationSettings),
    setPreference: vi.fn(async ({ kind, enabled }) => ({
      ...notificationSettings,
      preferences: { ...notificationSettings.preferences, [kind]: enabled },
    })),
  };
  const session = {
    offlineAvailability: vi.fn(async () => ({
      profiles: {
        "profile-1": {
          documentCount: 4,
          fileStorageBytes: 3 * 1024 * 1024,
          lastCachedAt: Date.parse("2026-08-11T10:00:00.000Z"),
          maxBytes: 1024 * 1024 * 1024,
          quarantined: 0,
        },
      },
    })),
    clearOfflineCopy: vi.fn(async () => ({ profiles: {} })),
    setOfflineCopyLimit: vi.fn(async () => ({ profiles: {} })),
  };
  return { lifecycle, notifications, session };
}

describe("desktop lifecycle control", () => {
  it("explains background impact and changes the global close preference", async () => {
    const user = userEvent.setup();
    const bridge = createBridge();
    render(<DesktopLifecycleControl bridge={bridge} />);

    await user.click(screen.getByRole("button", { name: "Desktop behavior" }));
    expect(
      await screen.findByText(/imports and background work can continue/i),
    ).toBeVisible();
    await user.click(screen.getByRole("radio", { name: /Quit OpenKeep/i }));

    expect(bridge.lifecycle.setCloseBehavior).toHaveBeenCalledWith({
      closeBehavior: "quit",
    });
    expect(await screen.findByRole("radio", { name: /Quit OpenKeep/i })).toBeChecked();
  });

  it("explains the safe quit fallback when the system tray is unavailable", async () => {
    const user = userEvent.setup();
    const bridge = createBridge({ trayAvailable: false });
    render(<DesktopLifecycleControl bridge={bridge} />);

    await user.click(screen.getByRole("button", { name: "Desktop behavior" }));

    expect(await screen.findByText(/avoid leaving an invisible process/i)).toBeVisible();
    expect(screen.getByRole("radio", { name: /Keep OpenKeep running/i })).toBeDisabled();
  });

  it("turns each notification kind on and off independently", async () => {
    const user = userEvent.setup();
    const bridge = createBridge();
    render(<DesktopLifecycleControl bridge={bridge} />);

    await user.click(screen.getByRole("button", { name: "Desktop behavior" }));
    const failed = await screen.findByRole("checkbox", { name: /Failed imports/i });
    expect(failed).toBeChecked();

    await user.click(failed);
    expect(bridge.notifications.setPreference).toHaveBeenCalledWith({
      kind: "failed",
      enabled: false,
    });
    expect(
      await screen.findByRole("checkbox", { name: /Failed imports/i }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /Documents needing review/i }),
    ).toBeChecked();
  });

  it("says so when the system cannot show notifications at all", async () => {
    const user = userEvent.setup();
    const bridge = createBridge({
      notifications: {
        preferences: { completed: true, failed: true, review: true },
        supported: false,
      },
    });
    render(<DesktopLifecycleControl bridge={bridge} />);

    await user.click(screen.getByRole("button", { name: "Desktop behavior" }));

    expect(
      await screen.findByText(/no notification service available/i),
    ).toBeVisible();
  });

  it("inspects the active archive's offline copy and deletes it after confirming", async () => {
    const user = userEvent.setup();
    const bridge = createBridge();
    render(<DesktopLifecycleControl bridge={bridge} profileId="profile-1" />);

    await user.click(screen.getByRole("button", { name: "Desktop behavior" }));
    expect(await screen.findByText(/4 documents/)).toBeVisible();
    expect(screen.getByText(/3\.0 MB/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: /Delete offline copy/ }));
    // Confirmation explains locality before anything is deleted.
    expect(
      await screen.findByText(/The archive itself is not changed/),
    ).toBeVisible();
    expect(bridge.session.clearOfflineCopy).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete copy" }));
    expect(bridge.session.clearOfflineCopy).toHaveBeenCalledWith({
      profileId: "profile-1",
    });
    await waitFor(() => {
      expect(screen.queryByText(/4 documents/)).not.toBeInTheDocument();
    });
  });

  it("shows nothing to inspect for an archive without an offline copy", async () => {
    const user = userEvent.setup();
    const bridge = createBridge();
    render(<DesktopLifecycleControl bridge={bridge} profileId="profile-2" />);

    await user.click(screen.getByRole("button", { name: "Desktop behavior" }));
    await screen.findByText(/When the window closes/i);
    expect(screen.queryByText(/Delete offline copy/)).not.toBeInTheDocument();
  });
});
