import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  api,
  authFetch,
  setTokens,
  clearTokens,
  hasTokens,
  setOnAuthFailure,
  syncTokensFromStorage,
} from "@/lib/api";
import type { QueryClient } from "@tanstack/react-query";

interface UserLanguagePreferences {
  uiLanguage: "en" | "de";
  aiProcessingLanguage: "en" | "de";
  aiChatLanguage: "en" | "de";
}

interface User {
  id: string;
  email: string;
  displayName: string;
  isOwner: boolean;
  twoFactorEnabled: boolean;
  preferences: UserLanguagePreferences;
}

export type LoginResult =
  | { requiresTwoFactor: false }
  | { requiresTwoFactor: true; twoFactorToken: string };

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  needsSetup: boolean | null;
  login: (email: string, password: string) => Promise<LoginResult>;
  completeTwoFactorLogin: (twoFactorToken: string, code: string) => Promise<void>;
  setup: (
    email: string,
    password: string,
    displayName: string,
  ) => Promise<void>;
  updatePreferences: (preferences: UserLanguagePreferences) => Promise<void>;
  refreshUser: () => Promise<void>;
  logout: () => void;
}

export interface RouterContext {
  queryClient: QueryClient;
  auth: AuthState;
}

export const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  const logout = useCallback(() => {
    clearTokens();
    setUser(null);
  }, []);

  useEffect(() => {
    setOnAuthFailure(logout);
    return () => setOnAuthFailure(() => {});
  }, [logout]);

  useEffect(() => {
    async function checkSetup() {
      syncTokensFromStorage();
      try {
        const { response } = await api.GET("/api/health");
        if (response.ok) {
          if (hasTokens()) {
            const { data, response: meResponse } = await api.GET(
              "/api/auth/me",
            );
            if (meResponse.ok && data) {
              setUser(data as unknown as User);
              setNeedsSetup(false);
            } else {
              clearTokens();
              setNeedsSetup(false);
            }
          } else {
            setNeedsSetup(false);
          }
        }
      } catch {
        setNeedsSetup(false);
      } finally {
        setIsLoading(false);
      }
    }
    checkSetup();
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      const { data, error, response } = await api.POST("/api/auth/login", {
        body: { email, password },
      });

      if (!response.ok || error) {
        const err = error as unknown as { message?: string };
        throw new Error(err?.message || "Login failed");
      }

      const result = data as unknown as {
        accessToken?: string;
        refreshToken?: string;
        requiresTwoFactor?: boolean;
        twoFactorToken?: string;
      };

      if (result.requiresTwoFactor && result.twoFactorToken) {
        return { requiresTwoFactor: true, twoFactorToken: result.twoFactorToken };
      }

      setTokens(result.accessToken!, result.refreshToken!);

      const { data: userData } = await api.GET("/api/auth/me");
      if (userData) {
        setUser(userData as unknown as User);
      }
      setNeedsSetup(false);
      return { requiresTwoFactor: false };
    },
    [],
  );

  const completeTwoFactorLogin = useCallback(
    async (twoFactorToken: string, code: string) => {
      const response = await authFetch("/api/auth/login/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ twoFactorToken, code }),
      });

      if (!response.ok) {
        let message = "Invalid authentication code";
        try {
          const payload = (await response.json()) as { message?: string | string[] };
          if (typeof payload.message === "string") {
            message = payload.message;
          } else if (Array.isArray(payload.message) && payload.message.length > 0) {
            message = payload.message.join(", ");
          }
        } catch {
          // ignore
        }
        throw new Error(message);
      }

      const tokens = (await response.json()) as {
        accessToken: string;
        refreshToken: string;
      };
      setTokens(tokens.accessToken, tokens.refreshToken);

      const { data: userData } = await api.GET("/api/auth/me");
      if (userData) {
        setUser(userData as unknown as User);
      }
      setNeedsSetup(false);
    },
    [],
  );

  const refreshUser = useCallback(async () => {
    const { data } = await api.GET("/api/auth/me");
    if (data) {
      setUser(data as unknown as User);
    }
  }, []);

  const setup = useCallback(
    async (email: string, password: string, displayName: string) => {
      const { data, error, response } = await api.POST("/api/auth/setup", {
        body: { email, password, displayName },
      });

      if (!response.ok || error) {
        const err = error as unknown as { message?: string };
        throw new Error(err?.message || "Setup failed");
      }

      const tokens = data as unknown as {
        accessToken: string;
        refreshToken: string;
      };
      setTokens(tokens.accessToken, tokens.refreshToken);

      const { data: userData } = await api.GET("/api/auth/me");
      if (userData) {
        setUser(userData as unknown as User);
      }
      setNeedsSetup(false);
    },
    [],
  );

  const updatePreferences = useCallback(async (preferences: UserLanguagePreferences) => {
    const response = await authFetch("/api/auth/me/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preferences),
    });

    if (!response.ok) {
      let message = "Failed to update preferences";
      try {
        const payload = (await response.json()) as { message?: string | string[] };
        if (typeof payload.message === "string") {
          message = payload.message;
        } else if (Array.isArray(payload.message) && payload.message.length > 0) {
          message = payload.message.join(", ");
        }
      } catch {
        // ignore JSON parse issues
      }
      throw new Error(message);
    }

    const userData = (await response.json()) as User;
    setUser(userData);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: user !== null,
        isLoading,
        needsSetup,
        login,
        completeTwoFactorLogin,
        setup,
        updatePreferences,
        refreshUser,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
