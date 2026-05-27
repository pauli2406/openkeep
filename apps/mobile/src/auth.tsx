import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetch as expoFetch } from "expo/fetch";
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

const API_URL_KEY = "openkeep.mobile.api-url";
const API_TOKEN_KEY = "openkeep.mobile.api-token";
const ACCESS_TOKEN_KEY = "openkeep.mobile.access-token";
const REFRESH_TOKEN_KEY = "openkeep.mobile.refresh-token";
const USER_KEY = "openkeep.mobile.user";
const AUTH_REQUEST_TIMEOUT_MS = 12000;

type UserLanguagePreferences = {
  uiLanguage: "en" | "de";
  aiProcessingLanguage: "en" | "de";
  aiChatLanguage: "en" | "de";
};

type User = {
  id: string;
  email: string;
  displayName: string;
  isOwner: boolean;
  preferences: UserLanguagePreferences;
};

type AuthContextValue = {
  apiUrl: string;
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isOfflineSession: boolean;
  setApiUrl: (value: string) => Promise<void>;
  probeServer: (value: string) => Promise<void>;
  connect: (args: { apiUrl: string; apiToken: string }) => Promise<void>;
  updatePreferences: (preferences: UserLanguagePreferences) => Promise<void>;
  logout: () => Promise<void>;
  revalidateSession: () => Promise<boolean>;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  streamFetch: (path: string, init?: RequestInit) => Promise<Response>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function normalizeApiUrl(input: string) {
  const value = input.trim().replace(/\/$/, "");
  if (!value) {
    return "";
  }

  if (!/^https?:\/\//i.test(value)) {
    return `https://${value}`;
  }

  return value;
}

function resolveUrl(apiUrl: string, path: string) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return `${apiUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = AUTH_REQUEST_TIMEOUT_MS) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out. Check your connection and try again.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function readResponseMessage(response: Response) {
  const text = await response.text();
  if (!text) {
    return `Request failed with ${response.status}`;
  }

  try {
    const parsed = JSON.parse(text) as { message?: string | string[] };
    if (typeof parsed.message === "string") {
      return parsed.message;
    }
    if (Array.isArray(parsed.message)) {
      return parsed.message.join(", ");
    }
  } catch {
    return text;
  }

  return text;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [apiUrl, setApiUrlState] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionMode, setSessionMode] = useState<"none" | "online" | "offline">("none");
  const apiUrlRef = useRef("");
  const apiTokenRef = useRef("");
  const tokensRef = useRef({ accessToken: "", refreshToken: "" });

  const persistApiToken = useCallback(async (apiToken: string) => {
    apiTokenRef.current = apiToken;
    await SecureStore.setItemAsync(API_TOKEN_KEY, apiToken);
  }, []);

  const clearApiToken = useCallback(async () => {
    apiTokenRef.current = "";
    await SecureStore.deleteItemAsync(API_TOKEN_KEY);
  }, []);

  const persistTokens = useCallback(async (accessToken: string, refreshToken: string) => {
    tokensRef.current = { accessToken, refreshToken };
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken);
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
  }, []);

  const clearTokens = useCallback(async () => {
    tokensRef.current = { accessToken: "", refreshToken: "" };
    await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  }, []);

  const persistUser = useCallback(async (nextUser: User | null) => {
    setUser(nextUser);
    if (nextUser) {
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(nextUser));
      return;
    }

    await AsyncStorage.removeItem(USER_KEY);
  }, []);

  const clearSession = useCallback(async () => {
    apiUrlRef.current = "";
    setApiUrlState("");
    await AsyncStorage.removeItem(API_URL_KEY);
    await clearApiToken();
    await clearTokens();
    await persistUser(null);
    setSessionMode("none");
  }, [clearApiToken, clearTokens, persistUser]);

  const setApiUrl = useCallback(async (value: string) => {
    const next = normalizeApiUrl(value);
    apiUrlRef.current = next;
    setApiUrlState(next);
    if (next) {
      await AsyncStorage.setItem(API_URL_KEY, next);
    } else {
      await AsyncStorage.removeItem(API_URL_KEY);
    }
  }, []);

  const probeServer = useCallback(async (value: string) => {
    const next = normalizeApiUrl(value);
    if (!next) {
      throw new Error("Enter your OpenKeep server URL.");
    }

    let response: Response;
    try {
      response = await withTimeout(fetch(resolveUrl(next, "/api/health")), "Server health check");
    } catch {
      throw new Error("Could not reach the OpenKeep server.");
    }

    if (!response.ok) {
      throw new Error(`Health check failed with ${response.status}`);
    }
  }, []);

  const refreshAccessToken = useCallback(async () => {
    const currentApiUrl = apiUrlRef.current;
    if (!currentApiUrl || !tokensRef.current.refreshToken) {
      return false;
    }

    const response = await withTimeout(
      fetch(resolveUrl(currentApiUrl, "/api/auth/refresh"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: tokensRef.current.refreshToken }),
      }),
      "Session refresh",
    );

    if (!response.ok) {
      await clearSession();
      return false;
    }

    const payload = (await response.json()) as {
      accessToken: string;
      refreshToken: string;
    };
    await persistTokens(payload.accessToken, payload.refreshToken);
    return true;
  }, [clearSession, persistTokens]);

  const authFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!apiUrl) {
        const currentApiUrl = apiUrlRef.current;
        if (!currentApiUrl) {
          throw new Error("Set your OpenKeep server URL first.");
        }
      }

      const currentApiUrl = apiUrlRef.current;
      if (!currentApiUrl) {
        throw new Error("Set your OpenKeep server URL first.");
      }

      const execute = async () => {
        const headers = new Headers(init?.headers ?? {});
        const bearerToken = apiTokenRef.current || tokensRef.current.accessToken;
        if (bearerToken) {
          headers.set("Authorization", `Bearer ${bearerToken}`);
        }

        return fetch(resolveUrl(currentApiUrl, path), {
          ...init,
          headers,
        });
      };

      let response = await execute();
      const isApiTokenSession = Boolean(apiTokenRef.current);
      const isAuthRequest = path.startsWith("/api/auth/");
      const allowRefresh = !isApiTokenSession && (!isAuthRequest || path === "/api/auth/me");
      if (response.status === 401 && allowRefresh && (await refreshAccessToken())) {
        response = await execute();
      }

      if (response.status === 401 && (allowRefresh || isApiTokenSession)) {
        await clearSession();
      }

      return response;
    },
    [apiUrl, clearSession, refreshAccessToken],
  );

  /**
   * Like authFetch but uses Expo's native fetch which supports
   * ReadableStream on response.body — required for SSE streaming.
   */
  const streamFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const currentApiUrl = apiUrlRef.current;
      if (!currentApiUrl) {
        throw new Error("Set your OpenKeep server URL first.");
      }

      const headers: Record<string, string> = {};
      if (init?.headers) {
        const h = init.headers;
        if (h instanceof Headers) {
          h.forEach((v, k) => {
            headers[k] = v;
          });
        } else if (Array.isArray(h)) {
          for (const [k, v] of h) {
            headers[k] = v;
          }
        } else {
          Object.assign(headers, h);
        }
      }

      const bearerToken = apiTokenRef.current || tokensRef.current.accessToken;
      if (bearerToken) {
        headers["Authorization"] = `Bearer ${bearerToken}`;
      }

      return expoFetch(resolveUrl(currentApiUrl, path), {
        ...init,
        headers,
      });
    },
    [apiUrl],
  );

  const loadCurrentUser = useCallback(async () => {
    const response = await withTimeout(authFetch("/api/auth/me"), "Session restore");
    if (!response.ok) {
      throw new Error(await readResponseMessage(response));
    }

    const payload = (await response.json()) as User;
    await persistUser(payload);
    setSessionMode("online");
  }, [authFetch, persistUser]);

  const restoreCachedSession = useCallback(async (storedUser: User | null) => {
    if (!storedUser) {
      return false;
    }

    await persistUser(storedUser);
    setSessionMode("offline");
    return true;
  }, [persistUser]);

  const revalidateSession = useCallback(async () => {
    if (
      !apiUrlRef.current ||
      (!apiTokenRef.current && (!tokensRef.current.accessToken || !tokensRef.current.refreshToken))
    ) {
      return false;
    }

    try {
      await loadCurrentUser();
      return true;
    } catch {
      return false;
    }
  }, [loadCurrentUser]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const [storedApiUrl, apiToken, accessToken, refreshToken, storedUserRaw] = await Promise.all([
          AsyncStorage.getItem(API_URL_KEY),
          SecureStore.getItemAsync(API_TOKEN_KEY),
          SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
          SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
          AsyncStorage.getItem(USER_KEY),
        ]);

        if (cancelled) {
          return;
        }

        const nextApiUrl = normalizeApiUrl(storedApiUrl ?? "");
        let storedUser: User | null = null;
        if (storedUserRaw) {
          try {
            storedUser = JSON.parse(storedUserRaw) as User;
          } catch {
            await AsyncStorage.removeItem(USER_KEY);
          }
        }

        apiUrlRef.current = nextApiUrl;
        setApiUrlState(nextApiUrl);
        apiTokenRef.current = apiToken ?? "";
        tokensRef.current = {
          accessToken: accessToken ?? "",
          refreshToken: refreshToken ?? "",
        };

        if (nextApiUrl && apiToken) {
          try {
            const response = await withTimeout(
              fetch(resolveUrl(nextApiUrl, "/api/auth/me"), {
                headers: {
                  Authorization: `Bearer ${apiToken}`,
                },
              }),
              "Session restore",
            );

            if (response.ok) {
              const payload = (await response.json()) as User;
              if (!cancelled) {
                await persistUser(payload);
                setSessionMode("online");
              }
            } else if (response.status === 401) {
              if (!cancelled) {
                await clearSession();
              }
            } else if (!cancelled) {
              await restoreCachedSession(storedUser);
            }
          } catch {
            if (!cancelled) {
              await restoreCachedSession(storedUser);
            }
          }
        } else if (nextApiUrl && accessToken && refreshToken) {
          try {
            const response = await withTimeout(
              fetch(resolveUrl(nextApiUrl, "/api/auth/me"), {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              }),
              "Session restore",
            );

            if (response.ok) {
              const payload = (await response.json()) as User;
              if (!cancelled) {
                await persistUser(payload);
                setSessionMode("online");
              }
            } else if (response.status === 401) {
              setApiUrlState(nextApiUrl);
              if (!cancelled) {
                try {
                  const refreshed = await refreshAccessToken();
                  if (refreshed) {
                    await loadCurrentUser();
                  }
                } catch {
                  const restored = await restoreCachedSession(storedUser);
                  if (!restored) {
                    await clearSession();
                  }
                }
              }
            } else if (!cancelled) {
              await restoreCachedSession(storedUser);
            }
          } catch {
            if (!cancelled) {
              await restoreCachedSession(storedUser);
            }
          }
        } else if (!cancelled && storedUser && nextApiUrl) {
          await restoreCachedSession(storedUser);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [clearSession, loadCurrentUser, persistUser, refreshAccessToken, restoreCachedSession]);

  const connect = useCallback(
    async ({ apiUrl: inputApiUrl, apiToken }: { apiUrl: string; apiToken: string }) => {
      const nextApiUrl = normalizeApiUrl(inputApiUrl);
      const nextApiToken = apiToken.trim();
      if (!nextApiToken) {
        throw new Error("Enter your OpenKeep API token.");
      }

      await probeServer(nextApiUrl);
      const response = await withTimeout(
        fetch(resolveUrl(nextApiUrl, "/api/auth/me"), {
          headers: {
            Authorization: `Bearer ${nextApiToken}`,
          },
        }),
        "Token verification",
      );

      if (!response.ok) {
        throw new Error(await readResponseMessage(response));
      }

      const payload = (await response.json()) as User;
      await setApiUrl(nextApiUrl);
      await persistApiToken(nextApiToken);
      await clearTokens();
      await persistUser(payload);
      setSessionMode("online");
    },
    [clearTokens, persistApiToken, persistUser, probeServer, setApiUrl],
  );

  const updatePreferences = useCallback(
    async (preferences: UserLanguagePreferences) => {
      const response = await authFetch("/api/auth/me/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      });

      if (!response.ok) {
        throw new Error(await readResponseMessage(response));
      }

      const payload = (await response.json()) as User;
      await persistUser(payload);
      setSessionMode("online");
    },
    [authFetch, persistUser],
  );

  const logout = useCallback(async () => {
    await clearSession();
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      apiUrl,
      user,
      isAuthenticated: Boolean(user),
      isLoading,
      isOfflineSession: sessionMode === "offline",
      setApiUrl,
      probeServer,
      connect,
      updatePreferences,
      logout,
      revalidateSession,
      authFetch,
      streamFetch,
    }),
    [
      apiUrl,
      authFetch,
      connect,
      isLoading,
      logout,
      probeServer,
      revalidateSession,
      sessionMode,
      setApiUrl,
      streamFetch,
      updatePreferences,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
