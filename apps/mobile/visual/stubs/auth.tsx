/**
 * Stands in for `src/auth` in the visual build only (see `metro.config.js`).
 *
 * The session is already established, because the screenshots are of the app in
 * use rather than of the connect flow — that screen gets its own shot by turning
 * `isAuthenticated` off through the URL.
 */
import type { ReactNode } from "react";
import { visualAuthFetch, visualStreamFetch } from "../api";

function signedOut() {
  return typeof window !== "undefined" && window.location.search.includes("signedOut=1");
}

function offline() {
  return typeof window !== "undefined" && window.location.search.includes("offline=1");
}

const USER = {
  id: "u-1",
  email: "you@example.com",
  displayName: "You",
  isOwner: true,
  preferences: {
    uiLanguage: "en" as const,
    aiProcessingLanguage: "de" as const,
    aiChatLanguage: "en" as const,
  },
};

export function AuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useAuth() {
  return {
    apiUrl: "https://archive.example.com",
    user: signedOut() ? null : USER,
    isAuthenticated: !signedOut(),
    isLoading: false,
    isOfflineSession: offline(),
    hasRestorableSession: true,
    setApiUrl: async () => {},
    probeServer: async () => {},
    connect: async () => {},
    updatePreferences: async () => {},
    logout: async () => {},
    revalidateSession: async () => true,
    openOfflineCopy: async () => true,
    authFetch: (path: string) => visualAuthFetch(path),
    streamFetch: () => visualStreamFetch(),
  };
}
