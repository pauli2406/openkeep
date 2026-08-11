import { createContext, useCallback, useContext, type ReactNode } from "react";
import { AuthContext, type AuthState } from "@openkeep/web/auth";
import { authFetch } from "@openkeep/web/api";
import { CurrentUserSchema } from "@openkeep/types";
import type { DesktopSessionState } from "../shared/desktop-api";

type DesktopSessionContextValue = {
  state: Extract<DesktopSessionState, { status: "connected" }>;
  setState: (state: DesktopSessionState) => void;
};

export const DesktopSessionContext = createContext<DesktopSessionContextValue | null>(null);

function unsupportedDesktopAuth(): never {
  throw new Error("Desktop uses an API token configured in the archive connection screen.");
}

export function DesktopAuthProvider({ children }: { children: ReactNode }) {
  const session = useContext(DesktopSessionContext);
  if (!session) {
    throw new Error("DesktopAuthProvider requires an active desktop archive session.");
  }

  const refreshUser = useCallback(async () => {
    const response = await authFetch("/api/auth/me");
    if (response.status === 401) {
      // The shared failure seam asks main to re-verify the profile. Main alone
      // decides whether its encrypted credentials need to be removed.
      throw new Error("The desktop archive session is no longer valid.");
    }
    if (!response.ok) {
      throw new Error("OpenKeep could not refresh the archive user.");
    }
    const user = CurrentUserSchema.safeParse(await response.json());
    if (!user.success) {
      throw new Error("The archive returned an invalid current-user response.");
    }
    session.setState({ ...session.state, user: user.data });
  }, [session]);

  const updatePreferences = useCallback<AuthState["updatePreferences"]>(
    async (preferences) => {
      const response = await authFetch("/api/auth/me/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(preferences),
      });
      if (!response.ok) {
        throw new Error("OpenKeep could not update the archive preferences.");
      }
      const user = CurrentUserSchema.safeParse(await response.json());
      if (!user.success) {
        throw new Error("The archive returned invalid preference data.");
      }
      session.setState({ ...session.state, user: user.data });
    },
    [session],
  );

  const logout = useCallback(() => {
    void window.openkeepDesktop.session
      .signOut()
      .then(session.setState)
      .catch(() => {
        session.setState({
          status: "error",
          code: "secure-storage-unavailable",
          message: "OpenKeep could not remove the encrypted desktop credentials.",
        });
      });
  }, [session]);

  const value: AuthState = {
    user: session.state.user,
    isAuthenticated: true,
    isLoading: false,
    needsSetup: false,
    login: async () => unsupportedDesktopAuth(),
    completeTwoFactorLogin: async () => unsupportedDesktopAuth(),
    setup: async () => unsupportedDesktopAuth(),
    updatePreferences,
    refreshUser,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
