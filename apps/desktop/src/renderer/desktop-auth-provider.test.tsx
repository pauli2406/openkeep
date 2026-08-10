import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useAuth } from "@openkeep/web/auth";
import type { DesktopBridge, DesktopSessionState } from "../shared/desktop-api";
import {
  DesktopAuthProvider,
  DesktopSessionContext,
} from "./desktop-auth-provider";

const connected: Extract<DesktopSessionState, { status: "connected" }> = {
  status: "connected",
  profile: {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    label: "archive.example.com",
    serverUrl: "https://archive.example.com",
  },
  user: {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "owner@example.com",
    displayName: "Archive Owner",
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

function AuthConsumer() {
  const auth = useAuth();
  return <button onClick={auth.logout}>Sign out {auth.user?.displayName}</button>;
}

describe("desktop auth provider", () => {
  it("clears the main-owned session before leaving authenticated renderer state", async () => {
    const signedOut: DesktopSessionState = {
      status: "disconnected",
      reason: "signed-out",
    };
    const bridge: DesktopBridge = {
      session: {
        restore: vi.fn(async () => connected),
        connect: vi.fn(async () => connected),
        retry: vi.fn(async () => connected),
        signOut: vi.fn(async () => signedOut),
      },
      runtime: {
        getInfo: vi.fn(async () => ({ platform: "darwin" as const, version: "0.1.0" })),
      },
    };
    Object.defineProperty(window, "openkeepDesktop", {
      configurable: true,
      value: bridge,
    });
    const setState = vi.fn();

    render(
      <DesktopSessionContext.Provider value={{ state: connected, setState }}>
        <DesktopAuthProvider>
          <AuthConsumer />
        </DesktopAuthProvider>
      </DesktopSessionContext.Provider>,
    );
    await userEvent.click(screen.getByRole("button", { name: /sign out archive owner/i }));

    await waitFor(() => expect(bridge.session.signOut).toHaveBeenCalledOnce());
    expect(setState).toHaveBeenCalledWith(signedOut);
  });
});
