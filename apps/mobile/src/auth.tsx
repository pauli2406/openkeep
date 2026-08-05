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
const CF_ACCESS_ID_KEY = "openkeep.mobile.cf-access-client-id";
const CF_ACCESS_SECRET_KEY = "openkeep.mobile.cf-access-client-secret";
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
  connect: (args: {
    apiUrl: string;
    apiToken: string;
    cfAccessClientId?: string;
    cfAccessClientSecret?: string;
  }) => Promise<void>;
  updatePreferences: (preferences: UserLanguagePreferences) => Promise<void>;
  logout: () => Promise<void>;
  revalidateSession: () => Promise<boolean>;
  /**
   * Enter the offline session on purpose. Until #118 this only happened at boot
   * when the server was unreachable, so the Connect screen had no way to offer
   * the local copy as a choice.
   */
  openOfflineCopy: () => Promise<boolean>;
  /**
   * Whether `openOfflineCopy` has a session to restore. Cached documents can
   * outlive the stored user — a 401 clears the user but not the cache — and
   * without one the offline session cannot be entered.
   */
  hasRestorableSession: boolean;
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

// Cloudflare Access service-token credentials. Single AuthProvider => module singleton.
// Sent as CF-Access-Client-Id / CF-Access-Client-Secret so the native app can pass
// through a Cloudflare Access "Service Auth" policy without an interactive login.
let cfAccessCreds = { clientId: "", clientSecret: "" };

function cfAccessHeaders(): Record<string, string> {
  if (cfAccessCreds.clientId && cfAccessCreds.clientSecret) {
    return {
      "CF-Access-Client-Id": cfAccessCreds.clientId,
      "CF-Access-Client-Secret": cfAccessCreds.clientSecret,
    };
  }
  return {};
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
  const [hasStoredUser, setHasStoredUser] = useState(false);
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

  const persistCfAccess = useCallback(async (clientId: string, clientSecret: string) => {
    cfAccessCreds = { clientId, clientSecret };
    if (clientId) {
      await SecureStore.setItemAsync(CF_ACCESS_ID_KEY, clientId);
    } else {
      await SecureStore.deleteItemAsync(CF_ACCESS_ID_KEY);
    }
    if (clientSecret) {
      await SecureStore.setItemAsync(CF_ACCESS_SECRET_KEY, clientSecret);
    } else {
      await SecureStore.deleteItemAsync(CF_ACCESS_SECRET_KEY);
    }
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
    setHasStoredUser(Boolean(nextUser));
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
    await persistCfAccess("", "");
    await persistUser(null);
    setSessionMode("none");
  }, [clearApiToken, clearTokens, persistCfAccess, persistUser]);

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
      response = await withTimeout(
        fetch(resolveUrl(next, "/api/health"), { headers: cfAccessHeaders() }),
        "Server health check",
      );
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
        headers: { "Content-Type": "application/json", ...cfAccessHeaders() },
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
        for (const [key, value] of Object.entries(cfAccessHeaders())) {
          headers.set(key, value);
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
      Object.assign(headers, cfAccessHeaders());

      // `expo/fetch` types `body` as `BodyInit | undefined` while the ambient
      // `RequestInit` these callers use allows `null`. The wrapper passes
      // whatever it was given straight through, so it takes the init type of the
      // fetch it calls rather than asserting the two agree.
      return expoFetch(resolveUrl(currentApiUrl, path), {
        ...init,
        headers,
      } as Parameters<typeof expoFetch>[1]);
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

  const openOfflineCopy = useCallback(async () => {
    const raw = await AsyncStorage.getItem(USER_KEY);
    if (!raw) {
      return false;
    }
    try {
      return await restoreCachedSession(JSON.parse(raw) as User);
    } catch {
      return false;
    }
  }, [restoreCachedSession]);

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
        const [
          storedApiUrl,
          apiToken,
          accessToken,
          refreshToken,
          storedUserRaw,
          cfClientId,
          cfClientSecret,
        ] = await Promise.all([
          AsyncStorage.getItem(API_URL_KEY),
          SecureStore.getItemAsync(API_TOKEN_KEY),
          SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
          SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
          AsyncStorage.getItem(USER_KEY),
          SecureStore.getItemAsync(CF_ACCESS_ID_KEY),
          SecureStore.getItemAsync(CF_ACCESS_SECRET_KEY),
        ]);

        if (cancelled) {
          return;
        }

        // Restore CF Access service-token creds first so session-restore
        // requests below can pass through Cloudflare Access.
        cfAccessCreds = {
          clientId: cfClientId ?? "",
          clientSecret: cfClientSecret ?? "",
        };

        const nextApiUrl = normalizeApiUrl(storedApiUrl ?? "");
        let storedUser: User | null = null;
        if (storedUserRaw) {
          try {
            storedUser = JSON.parse(storedUserRaw) as User;
          } catch {
            await AsyncStorage.removeItem(USER_KEY);
          }
        }
        setHasStoredUser(Boolean(storedUser));

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
                  ...cfAccessHeaders(),
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
                  ...cfAccessHeaders(),
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
    async ({
      apiUrl: inputApiUrl,
      apiToken,
      cfAccessClientId,
      cfAccessClientSecret,
    }: {
      apiUrl: string;
      apiToken: string;
      cfAccessClientId?: string;
      cfAccessClientSecret?: string;
    }) => {
      const nextApiUrl = normalizeApiUrl(inputApiUrl);
      const nextApiToken = apiToken.trim();
      if (!nextApiToken) {
        throw new Error("Enter your OpenKeep API token.");
      }

      // Apply CF Access service-token creds in-memory *before* probing, so the
      // health check + token verification pass through Cloudflare Access.
      cfAccessCreds = {
        clientId: (cfAccessClientId ?? "").trim(),
        clientSecret: (cfAccessClientSecret ?? "").trim(),
      };

      await probeServer(nextApiUrl);
      const response = await withTimeout(
        fetch(resolveUrl(nextApiUrl, "/api/auth/me"), {
          headers: {
            Authorization: `Bearer ${nextApiToken}`,
            ...cfAccessHeaders(),
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
      await persistCfAccess(cfAccessCreds.clientId, cfAccessCreds.clientSecret);
      await clearTokens();
      await persistUser(payload);
      setSessionMode("online");
    },
    [clearTokens, persistApiToken, persistCfAccess, persistUser, probeServer, setApiUrl],
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
      openOfflineCopy,
      hasRestorableSession: hasStoredUser,
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
      hasStoredUser,
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
