import { render, screen } from "@testing-library/react";
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
  return { lifecycle, notifications };
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
});
