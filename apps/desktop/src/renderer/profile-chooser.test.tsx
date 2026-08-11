import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DesktopBridge, DesktopSessionState } from "../shared/desktop-api";
import { ProfileChooser } from "./profile-chooser";

const profiles = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    label: "Home",
    serverUrl: "https://home.example.com",
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    label: "Work",
    serverUrl: "https://work.example.com",
  },
];

const connected: DesktopSessionState = {
  status: "connected",
  profile: profiles[1],
  user: {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    email: "owner@example.com",
    displayName: "Owner",
    isOwner: true,
    twoFactorEnabled: false,
    preferences: {
      uiLanguage: "en",
      aiProcessingLanguage: "en",
      aiChatLanguage: "en",
    },
    createdAt: "2026-08-10T00:00:00.000Z",
  },
};

function installBridge() {
  const bridge: DesktopBridge = {
    session: {
      restore: vi.fn(async (): Promise<DesktopSessionState> => ({
        status: "disconnected",
        reason: "choose-profile",
      })),
      connect: vi.fn(async () => connected),
      retry: vi.fn(async () => connected),
      signOut: vi.fn(async (): Promise<DesktopSessionState> => ({
        status: "disconnected",
        reason: "signed-out",
      })),
    },
    profiles: {
      list: vi.fn(async () => ({ profiles, activeProfileId: profiles[0].id })),
      activate: vi.fn(async () => connected),
      rename: vi.fn(async () => ({ profiles, activeProfileId: profiles[0].id })),
      remove: vi.fn(async (): Promise<DesktopSessionState> => ({
        status: "disconnected",
        reason: "choose-profile",
      })),
    },
    runtime: {
      getInfo: vi.fn(async () => ({ platform: "darwin" as const, version: "0.1.0" })),
    },
  };
  Object.defineProperty(window, "openkeepDesktop", {
    configurable: true,
    value: bridge,
  });
  return bridge;
}

describe("desktop profile chooser", () => {
  it("activates a saved archive without installing it in the shell renderer", async () => {
    const bridge = installBridge();
    const user = userEvent.setup();
    render(
      <ProfileChooser
        initialState={{ status: "disconnected", reason: "choose-profile" }}
        snapshot={{ profiles, activeProfileId: profiles[0].id }}
        onSnapshotChange={vi.fn()}
        onStateChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /active archive home/i }));
    await user.click(
      screen.getByRole("menuitem", {
        name: "Switch to Work (https://work.example.com)",
      }),
    );

    expect(bridge.profiles.activate).toHaveBeenCalledWith({
      profileId: profiles[1].id,
    });
    expect(await screen.findByText("Opening Work…")).toBeInTheDocument();
  });
});
