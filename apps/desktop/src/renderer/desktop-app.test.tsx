import { useContext, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { HostSaveRequest, HostSaveResult } from "@openkeep/web/app";
import type { DesktopBridge, DesktopSessionState } from "../shared/desktop-api";
import { createDesktopBridgeStub } from "../test/desktop-bridge-stub";
import { DesktopApp } from "./desktop-app";
import { DesktopSessionContext } from "./desktop-auth-provider";

const profileOne: Extract<DesktopSessionState, { status: "connected" }> = {
  status: "connected",
  profile: {
    id: "11111111-1111-4111-8111-111111111111",
    label: "Personal",
    serverUrl: "https://personal.example.com",
  },
  user: {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "owner@example.com",
    displayName: "Owner",
    isOwner: true,
    twoFactorEnabled: false,
    preferences: {
      uiLanguage: "en",
      aiProcessingLanguage: "en",
      aiChatLanguage: "en",
    },
    createdAt: "2026-08-11T00:00:00.000Z",
  },
};

const profileTwo: Extract<DesktopSessionState, { status: "connected" }> = {
  ...profileOne,
  profile: {
    id: "22222222-2222-4222-8222-222222222222",
    label: "Business",
    serverUrl: "https://business.example.com",
  },
};

const signedOut: DesktopSessionState = {
  status: "disconnected",
  reason: "signed-out",
};

const chooseProfile: DesktopSessionState = {
  status: "disconnected",
  reason: "choose-profile",
};

function StatefulSharedApp({
  fileSaver,
}: {
  fileSaver?: (request: HostSaveRequest) => Promise<HostSaveResult>;
}) {
  const session = useContext(DesktopSessionContext);
  const [draftCount, setDraftCount] = useState(0);
  if (!session) throw new Error("Missing desktop session");

  return (
    <div>
      <span>Profile {session.state.profile.label}</span>
      <span>Draft {draftCount}</span>
      <button onClick={() => setDraftCount((count) => count + 1)}>
        Edit draft
      </button>
      <button onClick={() => session.setState(profileTwo)}>
        Switch profile
      </button>
      <button onClick={() => void fileSaver?.({ kind: "archive-export" })}>
        Save export
      </button>
    </div>
  );
}

describe("desktop authenticated renderer", () => {
  it("remounts shared UI state immediately when the active profile changes", async () => {
    const bridge: DesktopBridge = createDesktopBridgeStub({
      session: {
        restore: vi.fn(async () => profileOne),
        connect: vi.fn(async () => profileOne),
        retry: vi.fn(async () => profileOne),
        signOut: vi.fn(async () => signedOut),
      },
      profiles: {
        list: vi.fn(async () => ({
          profiles: [profileOne.profile, profileTwo.profile],
          activeProfileId: profileOne.profile.id,
        })),
        activate: vi.fn(async () => profileTwo),
        rename: vi.fn(async () => ({
          profiles: [profileOne.profile, profileTwo.profile],
          activeProfileId: profileOne.profile.id,
        })),
        remove: vi.fn(async () => chooseProfile),
      },
    });
    Object.defineProperty(window, "openkeepDesktop", {
      configurable: true,
      value: bridge,
    });
    const user = userEvent.setup();
    render(<DesktopApp SharedApp={StatefulSharedApp} />);

    expect(await screen.findByText("Profile Personal")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save export" }));
    expect(bridge.save.request).toHaveBeenCalledWith({ kind: "archive-export" });
    await user.click(screen.getByRole("button", { name: "Edit draft" }));
    expect(screen.getByText("Draft 1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Switch profile" }));
    await waitFor(() =>
      expect(screen.getByText("Profile Business")).toBeInTheDocument(),
    );
    expect(screen.getByText("Draft 0")).toBeInTheDocument();
  });
});
