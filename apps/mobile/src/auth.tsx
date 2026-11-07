import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
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
import {
  createOfflineReconnect,
  type OfflineReconnect,
  type SessionProbe,
} from "./offline-reconnect";

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
  /** Optional on the wire: the server always sends it, older clients never did. */
  emailDigestEnabled?: boolean;
};

type User = {
  id: string;
  email: string;
  displayName: string;
  isOwner: boolean;
  twoFactorEnabled?: boolean;
  preferences: UserLanguagePreferences;
};

/** Where a sign-in goes: the server, and the Cloudflare Access pass to reach it. */
export type ServerConnection = {
  apiUrl: string;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
};

/** A password login either finishes or asks for the second factor. */
export type LoginResult =
  | { requiresTwoFactor: false }
  | { requiresTwoFactor: true; twoFactorToken: string };

/** A refused auth request, with the status a screen needs to word it. */
export class AuthRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AuthRequestError";
  }
}

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
  /** Email and password. Replaces any API token this device held. */
  login: (args: ServerConnection & { email: string; password: string }) => Promise<LoginResult>;
  completeTwoFactorLogin: (
    args: ServerConnection & { twoFactorToken: string; code: string },
  ) => Promise<void>;
  /**
   * Creates the owner account. The session starts at once, because the rest of
   * the wizard needs it, but `isAuthenticated` stays false until `finishSetup`:
   * entering the app here would unmount the wizard on its first step.
   */
  setupOwner: (
    args: ServerConnection & { email: string; password: string; displayName: string },
  ) => Promise<void>;
  finishSetup: () => void;
  /** The owner exists and the wizard's later steps are still ahead. */
  isCompletingSetup: boolean;
  /** Re-reads the current user, after something on the server changed it. */
  refreshUser: () => Promise<void>;
  updatePreferences: (preferences: UserLanguagePreferences) => Promise<void>;
  logout: () => Promise<void>;
  /** Asks the archive whether this session still works. */
  revalidateSession: () => Promise<SessionProbe>;
  /** Explicit retry from an offline session; true when it is live again. */
  retryOfflineSession: () => Promise<boolean>;
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

/**
 * The `/api/auth/*` routes that take no session. Everything else under that
 * prefix needs a valid access token like any other route, so an expired one has
 * to be refreshed there too: `/tokens`, `/2fa/*` and `/me/preferences` included.
 */
const SESSIONLESS_AUTH_PATHS = new Set([
  "/api/auth/setup",
  "/api/auth/login",
  "/api/auth/login/2fa",
  "/api/auth/refresh",
  "/api/auth/logout",
]);

/**
 * Where a 401 means "wrong code or password", not "this session is over". Mistyping
 * a two-factor code must not sign you out of the app.
 */
const CREDENTIAL_CHECK_PATHS = new Set(["/api/auth/2fa/enable", "/api/auth/2fa/disable"]);

function pathnameOf(path: string) {
  return path.split("?")[0];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [apiUrl, setApiUrlState] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionMode, setSessionMode] = useState<"none" | "online" | "offline">("none");
  const [hasStoredUser, setHasStoredUser] = useState(false);
  const [setupWizardActive, setSetupWizardActive] = useState(false);
  const apiUrlRef = useRef("");
  const apiTokenRef = useRef("");
  const tokensRef = useRef({ accessToken: "", refreshToken: "" });
  // The one refresh in flight. See `refreshAccessToken`.
  const refreshInFlightRef = useRef<Promise<boolean> | null>(null);
  // Bumped when a session ends, so a refresh answering afterwards can tell.
  const sessionGenerationRef = useRef(0);

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
    sessionGenerationRef.current += 1;
    setSetupWizardActive(false);
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

  /**
   * Trades the refresh token for a new pair.
   *
   * The API rotates refresh tokens and treats a replayed one as theft, revoking
   * every session. Screens fire requests in parallel, so several can hit an expired
   * access token together; they have to share one refresh, or the second would
   * replay the token the first just rotated and sign the user out everywhere.
   *
   * Only the server refusing the token ends the session. A 5xx, a 429 from the auth
   * throttle or a gateway error says nothing about it, and those throw, the same
   * way a dropped connection does, so an offline copy stays usable.
   */
  const refreshAccessToken = useCallback((): Promise<boolean> => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    const run = async () => {
      const currentApiUrl = apiUrlRef.current;
      const presented = tokensRef.current.refreshToken;
      if (!currentApiUrl || !presented) {
        return false;
      }

      const generation = sessionGenerationRef.current;
      const response = await withTimeout(
        fetch(resolveUrl(currentApiUrl, "/api/auth/refresh"), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...cfAccessHeaders() },
          body: JSON.stringify({ refreshToken: presented }),
        }),
        "Session refresh",
      );

      // Signed out or signed in afresh while this was on its way: the answer is
      // about a session that no longer exists, and must not touch the current one.
      if (generation !== sessionGenerationRef.current) {
        return false;
      }

      if (response.status === 400 || response.status === 401 || response.status === 403) {
        await clearSession();
        return false;
      }
      if (!response.ok) {
        throw new Error(`Session refresh failed with ${response.status}`);
      }

      const payload = (await response.json()) as {
        accessToken: string;
        refreshToken: string;
      };
      await persistTokens(payload.accessToken, payload.refreshToken);
      return true;
    };

    const inFlight = run().finally(() => {
      refreshInFlightRef.current = null;
    });
    refreshInFlightRef.current = inFlight;
    return inFlight;
  }, [clearSession, persistTokens]);

  /**
   * After a 401 on a request sent with `sentToken`: get a usable token. A parallel
   * request may have refreshed already, in which case there is nothing to do but
   * retry with the new one.
   */
  const recoverFromExpiredToken = useCallback(
    async (sentToken: string) => {
      if (tokensRef.current.accessToken && tokensRef.current.accessToken !== sentToken) {
        return true;
      }
      return refreshAccessToken();
    },
    [refreshAccessToken],
  );

  const authFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const currentApiUrl = apiUrlRef.current;
      if (!currentApiUrl) {
        throw new Error("Set your OpenKeep server URL first.");
      }

      let sentToken = "";
      const execute = async () => {
        const headers = new Headers(init?.headers ?? {});
        const bearerToken = apiTokenRef.current || tokensRef.current.accessToken;
        sentToken = bearerToken;
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
      const pathname = pathnameOf(path);
      const allowRefresh = !isApiTokenSession && !SESSIONLESS_AUTH_PATHS.has(pathname);
      if (response.status === 401 && allowRefresh && (await recoverFromExpiredToken(sentToken))) {
        response = await execute();
      }

      if (
        response.status === 401 &&
        (allowRefresh || isApiTokenSession) &&
        !CREDENTIAL_CHECK_PATHS.has(pathname)
      ) {
        await clearSession();
      }

      return response;
    },
    // Reads the URL from the ref, so it stays the same function when the URL changes.
    // The bootstrap effect below depends on it through `loadCurrentUser`: a new
    // identity here re-ran the bootstrap in the middle of every sign-in, which read
    // the store before the tokens were in it and overwrote them with nothing.
    [clearSession, recoverFromExpiredToken],
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

      const baseHeaders: Record<string, string> = {};
      if (init?.headers) {
        const h = init.headers;
        if (h instanceof Headers) {
          h.forEach((v, k) => {
            baseHeaders[k] = v;
          });
        } else if (Array.isArray(h)) {
          for (const [k, v] of h) {
            baseHeaders[k] = v;
          }
        } else {
          Object.assign(baseHeaders, h);
        }
      }

      let sentToken = "";
      const execute = () => {
        const headers = { ...baseHeaders };
        const bearerToken = apiTokenRef.current || tokensRef.current.accessToken;
        sentToken = bearerToken;
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
      };

      const response = await execute();
      // An access token lives for 15 minutes. A chat question asked after that has
      // to refresh like any other request; API tokens have nothing to refresh.
      if (
        response.status === 401 &&
        !apiTokenRef.current &&
        (await recoverFromExpiredToken(sentToken))
      ) {
        return execute();
      }
      return response;
    },
    [apiUrl, recoverFromExpiredToken],
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

  /**
   * Asks the archive whether this session still works, and tells the answers
   * apart: reachable, credentials refused, or simply not reachable. Returning a
   * bare boolean is what made the offline session a dead end — a refused token
   * and a dropped connection are the same word, so neither could be acted on.
   */
  const revalidateSession = useCallback(async (): Promise<SessionProbe> => {
    if (
      !apiUrlRef.current ||
      (!apiTokenRef.current && (!tokensRef.current.accessToken || !tokensRef.current.refreshToken))
    ) {
      return "rejected";
    }

    let response: Response;
    try {
      response = await withTimeout(authFetch("/api/auth/me"), "Session restore");
    } catch {
      return "unreachable";
    }

    if (response.ok) {
      const payload = (await response.json()) as User;
      await persistUser(payload);
      setSessionMode("online");
      return "online";
    }

    // Only the archive saying "not you" ends the session. A 500 or a gateway
    // error means it could not answer, and tearing down a usable offline copy
    // over that would be the wrong way round.
    return response.status === 401 || response.status === 403 ? "rejected" : "unreachable";
  }, [authFetch, persistUser]);

  const reconnectRef = useRef<OfflineReconnect | null>(null);
  const sessionModeRef = useRef(sessionMode);
  sessionModeRef.current = sessionMode;

  useEffect(() => {
    if (sessionMode !== "offline") {
      reconnectRef.current?.stop();
      reconnectRef.current = null;
      return;
    }

    let handle: ReturnType<typeof setInterval> | null = null;
    const reconnect = createOfflineReconnect({
      probe: () => revalidateSession(),
      isOffline: () => sessionModeRef.current === "offline",
      onOnline: () => undefined,
      onRejected: () => void clearSession(),
      timer: {
        start: (run, intervalMs) => {
          handle = setInterval(run, intervalMs);
        },
        stop: () => {
          if (handle) {
            clearInterval(handle);
            handle = null;
          }
        },
      },
    });
    reconnectRef.current = reconnect;
    reconnect.start();

    // A connectivity change is the signal worth acting on immediately; the
    // interval is the fallback for a network that never announces itself.
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        void reconnect.check();
      }
    });

    return () => {
      unsubscribe();
      reconnect.stop();
      reconnectRef.current = null;
    };
  }, [clearSession, revalidateSession, sessionMode]);

  /** An explicit retry, for the button on the Offline screen. */
  const retryOfflineSession = useCallback(async () => {
    const outcome = await (reconnectRef.current?.check() ?? revalidateSession());
    return outcome === "online";
  }, [revalidateSession]);

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
      sessionGenerationRef.current += 1;
      await setApiUrl(nextApiUrl);
      await persistApiToken(nextApiToken);
      await persistCfAccess(cfAccessCreds.clientId, cfAccessCreds.clientSecret);
      await clearTokens();
      await persistUser(payload);
      setSessionMode("online");
    },
    [clearTokens, persistApiToken, persistCfAccess, persistUser, probeServer, setApiUrl],
  );

  /**
   * Turns freshly issued tokens into the session. The user is read before anything
   * is stored, so a failure here leaves the device as it was; setting the user last
   * is what lets the app in, once every other piece is in place.
   */
  const establishPasswordSession = useCallback(
    async (nextApiUrl: string, tokens: { accessToken: string; refreshToken: string }) => {
      const response = await withTimeout(
        fetch(resolveUrl(nextApiUrl, "/api/auth/me"), {
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            ...cfAccessHeaders(),
          },
        }),
        "Session restore",
      );
      if (!response.ok) {
        throw new AuthRequestError(await readResponseMessage(response), response.status);
      }
      const payload = (await response.json()) as User;

      sessionGenerationRef.current += 1;
      await setApiUrl(nextApiUrl);
      // The bearer prefers an API token, so a leftover one would shadow this login.
      await clearApiToken();
      await persistTokens(tokens.accessToken, tokens.refreshToken);
      await persistCfAccess(cfAccessCreds.clientId, cfAccessCreds.clientSecret);
      await persistUser(payload);
      setSessionMode("online");
    },
    [clearApiToken, persistCfAccess, persistTokens, persistUser, setApiUrl],
  );

  /** POSTs to a sessionless auth route, with the Cloudflare pass but no bearer. */
  const postAuth = useCallback(async (nextApiUrl: string, path: string, body: unknown, label: string) => {
    const response = await withTimeout(
      fetch(resolveUrl(nextApiUrl, path), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cfAccessHeaders() },
        body: JSON.stringify(body),
      }),
      label,
    );
    if (!response.ok) {
      throw new AuthRequestError(await readResponseMessage(response), response.status);
    }
    return response;
  }, []);

  const applyCfAccess = useCallback((connection: ServerConnection) => {
    // In memory before the first request, as `connect` does, so the probe and the
    // login itself pass through Cloudflare Access.
    cfAccessCreds = {
      clientId: (connection.cfAccessClientId ?? "").trim(),
      clientSecret: (connection.cfAccessClientSecret ?? "").trim(),
    };
  }, []);

  const login = useCallback(
    async ({
      email,
      password,
      ...connection
    }: ServerConnection & { email: string; password: string }): Promise<LoginResult> => {
      const nextApiUrl = normalizeApiUrl(connection.apiUrl);
      applyCfAccess(connection);
      await probeServer(nextApiUrl);

      const response = await postAuth(
        nextApiUrl,
        "/api/auth/login",
        { email: email.trim(), password },
        "Sign in",
      );
      const payload = (await response.json()) as {
        accessToken?: string;
        refreshToken?: string;
        requiresTwoFactor?: boolean;
        twoFactorToken?: string;
      };

      if (payload.requiresTwoFactor && payload.twoFactorToken) {
        return { requiresTwoFactor: true, twoFactorToken: payload.twoFactorToken };
      }
      if (!payload.accessToken || !payload.refreshToken) {
        throw new Error("The server sent an incomplete login response.");
      }

      await establishPasswordSession(nextApiUrl, {
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
      });
      return { requiresTwoFactor: false };
    },
    [applyCfAccess, establishPasswordSession, postAuth, probeServer],
  );

  const completeTwoFactorLogin = useCallback(
    async ({
      twoFactorToken,
      code,
      ...connection
    }: ServerConnection & { twoFactorToken: string; code: string }) => {
      const nextApiUrl = normalizeApiUrl(connection.apiUrl);
      applyCfAccess(connection);
      const response = await postAuth(
        nextApiUrl,
        "/api/auth/login/2fa",
        { twoFactorToken, code: code.trim() },
        "Two-factor sign in",
      );
      const tokens = (await response.json()) as { accessToken: string; refreshToken: string };
      await establishPasswordSession(nextApiUrl, tokens);
    },
    [applyCfAccess, establishPasswordSession, postAuth],
  );

  const setupOwner = useCallback(
    async ({
      email,
      password,
      displayName,
      ...connection
    }: ServerConnection & { email: string; password: string; displayName: string }) => {
      const nextApiUrl = normalizeApiUrl(connection.apiUrl);
      applyCfAccess(connection);
      await probeServer(nextApiUrl);
      const response = await postAuth(
        nextApiUrl,
        "/api/auth/setup",
        { email: email.trim(), password, displayName: displayName.trim() },
        "Setup",
      );
      const tokens = (await response.json()) as { accessToken: string; refreshToken: string };
      // Before the session exists, so there is no render in which the app opens.
      setSetupWizardActive(true);
      try {
        await establishPasswordSession(nextApiUrl, tokens);
      } catch (error) {
        setSetupWizardActive(false);
        throw error;
      }
    },
    [applyCfAccess, establishPasswordSession, postAuth, probeServer],
  );

  const finishSetup = useCallback(() => {
    setSetupWizardActive(false);
  }, []);

  const refreshUser = useCallback(async () => {
    const response = await authFetch("/api/auth/me");
    if (!response.ok) {
      throw new Error(await readResponseMessage(response));
    }
    await persistUser((await response.json()) as User);
  }, [authFetch, persistUser]);

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
      isAuthenticated: Boolean(user) && !setupWizardActive,
      isLoading,
      isOfflineSession: sessionMode === "offline",
      openOfflineCopy,
      hasRestorableSession: hasStoredUser,
      setApiUrl,
      probeServer,
      connect,
      login,
      completeTwoFactorLogin,
      setupOwner,
      finishSetup,
      isCompletingSetup: setupWizardActive,
      refreshUser,
      updatePreferences,
      logout,
      retryOfflineSession,
      revalidateSession,
      authFetch,
      streamFetch,
    }),
    [
      apiUrl,
      authFetch,
      completeTwoFactorLogin,
      connect,
      finishSetup,
      hasStoredUser,
      isLoading,
      login,
      logout,
      refreshUser,
      setupOwner,
      setupWizardActive,
      probeServer,
      retryOfflineSession,
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
