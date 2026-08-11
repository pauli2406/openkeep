import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesktopLifecycleControl } from "./desktop-lifecycle-control";

describe("desktop lifecycle control", () => {
  it("explains background impact and changes the global close preference", async () => {
    const user = userEvent.setup();
    const lifecycle = {
      getSettings: vi.fn(async () => ({
        closeBehavior: "tray" as const,
        trayAvailable: true,
      })),
      setCloseBehavior: vi.fn(async () => ({
        closeBehavior: "quit" as const,
        trayAvailable: true,
      })),
    };
    render(<DesktopLifecycleControl bridge={{ lifecycle }} />);

    await user.click(screen.getByRole("button", { name: "Desktop behavior" }));
    expect(await screen.findByText(/imports and background work can continue/i)).toBeVisible();
    await user.click(screen.getByRole("radio", { name: /Quit OpenKeep/i }));

    expect(lifecycle.setCloseBehavior).toHaveBeenCalledWith({ closeBehavior: "quit" });
    expect(await screen.findByRole("radio", { name: /Quit OpenKeep/i })).toBeChecked();
  });

  it("explains the safe quit fallback when the system tray is unavailable", async () => {
    const user = userEvent.setup();
    const lifecycle = {
      getSettings: vi.fn(async () => ({
        closeBehavior: "tray" as const,
        trayAvailable: false,
      })),
      setCloseBehavior: vi.fn(),
    };
    render(<DesktopLifecycleControl bridge={{ lifecycle }} />);

    await user.click(screen.getByRole("button", { name: "Desktop behavior" }));

    expect(await screen.findByText(/avoid leaving an invisible process/i)).toBeVisible();
    expect(screen.getByRole("radio", { name: /Keep OpenKeep running/i })).toBeDisabled();
  });
});
