import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/app";
import { AuthContext, type AuthState } from "@/hooks/use-auth";

const authenticatedState: AuthState = {
  user: {
    id: "11111111-1111-1111-1111-111111111111",
    email: "owner@example.com",
    displayName: "Owner",
    isOwner: true,
    twoFactorEnabled: false,
    preferences: {
      uiLanguage: "en",
      aiProcessingLanguage: "en",
      aiChatLanguage: "en",
    },
  },
  isAuthenticated: true,
  isLoading: false,
  needsSetup: false,
  login: async () => ({ requiresTwoFactor: false }),
  completeTwoFactorLogin: async () => {},
  setup: async () => {},
  updatePreferences: async () => {},
  refreshUser: async () => {},
  logout: () => {},
};

function AuthenticatedHostProvider({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider value={authenticatedState}>
      {children}
    </AuthContext.Provider>
  );
}

beforeEach(() => {
  window.history.replaceState({}, "", "/search");
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

describe("App auth provider", () => {
  it("renders through an injected auth provider", () => {
    function HostAuthProvider({
      children: _children,
    }: {
      children: ReactNode;
    }) {
      return <div>Host-owned authentication</div>;
    }

    render(<App AuthProvider={HostAuthProvider} />);

    expect(screen.getByText("Host-owned authentication")).toBeInTheDocument();
  });

  it("renders a host accessory in the authenticated shell", async () => {
    function ArchiveSwitcher() {
      return <button type="button">Personal archive</button>;
    }

    render(
      <App
        AuthProvider={AuthenticatedHostProvider}
        ShellAccessory={ArchiveSwitcher}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Personal archive" }),
    ).toBeInTheDocument();
  });

  it("omits the shell accessory by default", async () => {
    render(<App AuthProvider={AuthenticatedHostProvider} />);

    expect(
      await screen.findByRole("link", { name: "Import" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Personal archive" }),
    ).not.toBeInTheDocument();
  });
});
