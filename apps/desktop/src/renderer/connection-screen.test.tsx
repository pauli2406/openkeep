import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DesktopBridge, DesktopSessionState } from "../shared/desktop-api";
import { ConnectionScreen } from "./connection-screen";

const currentUser = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "owner@example.com",
  displayName: "Archive Owner",
  isOwner: true,
  twoFactorEnabled: false,
  preferences: {
    uiLanguage: "en" as const,
    aiProcessingLanguage: "en" as const,
    aiChatLanguage: "en" as const,
  },
  createdAt: "2026-08-10T00:00:00.000Z",
};

function createBridge(
  connectResult: DesktopSessionState,
  retryResult: DesktopSessionState = connectResult,
): DesktopBridge {
  return {
    session: {
      restore: vi.fn(async (): Promise<DesktopSessionState> => ({ status: "disconnected", reason: "no-profile" })),
      connect: vi.fn(async () => connectResult),
      retry: vi.fn(async () => retryResult),
      signOut: vi.fn(async (): Promise<DesktopSessionState> => ({ status: "disconnected", reason: "signed-out" })),
    },
    profiles: {
      list: vi.fn(async () => ({ profiles: [], activeProfileId: null })),
      activate: vi.fn(async () => connectResult),
      rename: vi.fn(async () => ({ profiles: [], activeProfileId: null })),
      remove: vi.fn(async (): Promise<DesktopSessionState> => ({
        status: "disconnected",
        reason: "no-profile",
      })),
    },
    imports: {
      pick: vi.fn(async () => ({ files: [], rejected: [] })),
      pending: vi.fn(async () => ({ batches: [] })),
      assign: vi.fn(),
      consume: vi.fn(async () => ({ files: [], rejected: [] })),
      onChanged: vi.fn(() => () => undefined),
    },
    save: {
      request: vi.fn(async () => ({ status: "cancelled" as const })),
    },
    runtime: {
      getInfo: vi.fn(async () => ({ platform: "darwin" as const, version: "0.1.0" })),
    },
  };
}

describe("desktop connection screen", () => {
  it("opens the shared application after token verification", async () => {
    const onStateChange = vi.fn();
    const connected: DesktopSessionState = {
      status: "connected",
      profile: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        label: "archive.example.com",
        serverUrl: "https://archive.example.com",
      },
      user: currentUser,
    };
    const bridge = createBridge(connected);
    const user = userEvent.setup();
    render(
      <ConnectionScreen
        bridge={bridge}
        initialState={{ status: "disconnected", reason: "no-profile" }}
        onStateChange={onStateChange}
      />,
    );

    const address = screen.getByLabelText("Archive address");
    await user.clear(address);
    await user.type(address, "https://archive.example.com");
    await user.type(screen.getByLabelText("API token"), "openkeep_api_token");
    await user.click(screen.getByRole("button", { name: /connect archive/i }));

    expect(bridge.session.connect).toHaveBeenCalledWith({
      serverUrl: "https://archive.example.com",
      apiToken: "openkeep_api_token",
      cfAccessClientId: "",
      cfAccessClientSecret: "",
      allowInsecureHttp: false,
    });
    expect(onStateChange).toHaveBeenCalledWith(connected);
    expect(await screen.findByText("Desktop 0.1.0 · darwin")).toBeInTheDocument();
  });

  it("shows a sanitized connection failure and clears a rejected token", async () => {
    const bridge = createBridge({
      status: "error",
      code: "invalid-credentials",
      message: "The API token was not accepted.",
    });
    const user = userEvent.setup();
    render(
      <ConnectionScreen
        bridge={bridge}
        initialState={{ status: "disconnected", reason: "no-profile" }}
        onStateChange={vi.fn()}
      />,
    );

    const token = screen.getByLabelText("API token");
    await user.type(token, "rejected-token");
    await user.click(screen.getByRole("button", { name: /connect archive/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The API token was not accepted.",
    );
    expect(token).toHaveValue("");
  });

  it("requires a second explicit action for remote plaintext HTTP", async () => {
    const warning: DesktopSessionState = {
      status: "error",
      code: "insecure-http-confirmation-required",
      message: "The API token could be read in transit.",
      serverUrl: "http://archive.example.com",
    };
    const bridge = createBridge(warning);
    const user = userEvent.setup();
    render(
      <ConnectionScreen
        bridge={bridge}
        initialState={{ status: "disconnected", reason: "no-profile" }}
        onStateChange={vi.fn()}
      />,
    );

    await user.clear(screen.getByLabelText("Archive address"));
    await user.type(screen.getByLabelText("Archive address"), "http://archive.example.com");
    await user.type(screen.getByLabelText("API token"), "token");
    await user.click(screen.getByRole("button", { name: /connect archive/i }));

    expect(await screen.findByRole("button", { name: /connect over plaintext http/i }))
      .toBeInTheDocument();
  });

  it("offers retry and edit when a stored archive is unavailable", async () => {
    const unavailable: DesktopSessionState = {
      status: "unavailable",
      profile: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        label: "archive.example.com",
        serverUrl: "https://archive.example.com",
      },
      message: "The archive could not be reached.",
    };
    const bridge = createBridge(unavailable, unavailable);
    const user = userEvent.setup();
    render(
      <ConnectionScreen
        bridge={bridge}
        initialState={unavailable}
        onStateChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/could not reach archive.example.com/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /edit connection/i }));
    expect(screen.getByLabelText("Archive address")).toHaveValue(
      "https://archive.example.com",
    );
  });

  it("renames an existing profile without requiring its credentials again", async () => {
    const profile = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      label: "Home",
      serverUrl: "https://archive.example.com",
    };
    const bridge = createBridge({ status: "disconnected", reason: "choose-profile" });
    const onProfilesChanged = vi.fn();
    const onCancel = vi.fn();
    vi.mocked(bridge.profiles.rename).mockResolvedValue({
      profiles: [{ ...profile, label: "Family" }],
      activeProfileId: profile.id,
    });
    const user = userEvent.setup();
    render(
      <ConnectionScreen
        bridge={bridge}
        profile={profile}
        initialState={{ status: "disconnected", reason: "choose-profile" }}
        onStateChange={vi.fn()}
        onProfilesChanged={onProfilesChanged}
        onCancel={onCancel}
      />,
    );

    const label = screen.getByLabelText("Profile name");
    await user.clear(label);
    await user.type(label, "Family");
    await user.click(screen.getByRole("button", { name: /save profile name only/i }));

    expect(bridge.profiles.rename).toHaveBeenCalledWith({
      profileId: profile.id,
      label: "Family",
    });
    expect(onProfilesChanged).toHaveBeenCalledWith({
      profiles: [{ ...profile, label: "Family" }],
      activeProfileId: profile.id,
    });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
