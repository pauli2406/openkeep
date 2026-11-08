/**
 * Password sessions, end to end through the real AuthProvider. Only the network
 * and the keychain are replaced.
 *
 * Until the login screen arrived the app effectively ran on API tokens, which
 * never refresh, so this path had never met an expired access token in anger.
 * The rules it has to keep come from the server: refresh tokens rotate, and
 * presenting a rotated one is treated as theft and revokes every session.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { fetch as expoFetch } from "expo/fetch";
import { act, cleanup, render, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { AuthProvider, useAuth } from "../auth";

jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));

const API = "https://archive.example.com";
const USER = {
  id: "u-1",
  email: "you@example.com",
  displayName: "You",
  isOwner: true,
  twoFactorEnabled: false,
  preferences: { uiLanguage: "en", aiProcessingLanguage: "en", aiChatLanguage: "en" },
};

type Handler = (url: string, init: RequestInit & { headers?: any }) => Response | Promise<Response>;

function json(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function bearerOf(init?: RequestInit): string | null {
  const headers = init?.headers;
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get("Authorization");
  return (headers as Record<string, string>).Authorization ?? null;
}

let keychain: Map<string, string>;
let calls: Array<{ path: string; bearer: string | null; body?: string }>;
let auth: ReturnType<typeof useAuth>;

function Probe() {
  auth = useAuth();
  return <Text>{auth.isAuthenticated ? "in" : "out"}</Text>;
}

function route(handler: Handler) {
  (global as any).fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace(API, "");
    calls.push({ path, bearer: bearerOf(init), body: init.body as string | undefined });
    return handler(path, init);
  });
}

/** A server: healthy, with one user, whose current access token is `valid`. */
function server(state: { valid: string; refresh: string }, extra?: Handler) {
  route(async (path, init) => {
    const extraResponse = extra ? await extra(path, init) : undefined;
    if (extraResponse) return extraResponse;
    if (path === "/api/health") return json(200, { status: "ok" });
    if (path === "/api/auth/refresh") {
      const presented = JSON.parse(init.body as string).refreshToken;
      if (presented !== state.refresh) return json(401, { message: "Refresh token reuse detected" });
      state.valid = `${state.valid}+`;
      state.refresh = `${state.refresh}+`;
      return json(201, { accessToken: state.valid, refreshToken: state.refresh });
    }
    if (bearerOf(init) !== `Bearer ${state.valid}`) return json(401, { message: "Unauthorized" });
    if (path === "/api/auth/me" || path === "/api/auth/me/preferences") return json(200, USER);
    return json(200, { ok: true });
  });
}

async function mount() {
  (auth as unknown) = undefined;
  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => expect(auth?.isLoading).toBe(false));
}

async function storedSession(access = "a1", refresh = "r1") {
  keychain.set("openkeep.mobile.access-token", access);
  keychain.set("openkeep.mobile.refresh-token", refresh);
  await AsyncStorage.setItem("openkeep.mobile.api-url", API);
  await AsyncStorage.setItem("openkeep.mobile.user", JSON.stringify(USER));
}

afterEach(async () => {
  await cleanup();
});

beforeEach(async () => {
  await AsyncStorage.clear();
  keychain = new Map();
  calls = [];
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => keychain.get(key) ?? null);
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (key: string, value: string) => {
    keychain.set(key, value);
  });
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (key: string) => {
    keychain.delete(key);
  });
  (expoFetch as jest.Mock).mockReset();
});

describe("signing in with a password", () => {
  it("stores the session and sends the new access token from then on", async () => {
    const state = { valid: "a1", refresh: "r1" };
    server(state, (path) =>
      path === "/api/auth/login"
        ? json(201, { accessToken: "a1", refreshToken: "r1" })
        : undefined as never,
    );
    await mount();

    await act(async () => {
      const result = await auth.login({ apiUrl: API, email: " you@example.com ", password: "correct horse" });
      expect(result).toEqual({ requiresTwoFactor: false });
    });

    expect(auth.isAuthenticated).toBe(true);
    expect(auth.user?.email).toBe("you@example.com");
    expect(keychain.get("openkeep.mobile.access-token")).toBe("a1");
    expect(keychain.get("openkeep.mobile.refresh-token")).toBe("r1");
    expect(await AsyncStorage.getItem("openkeep.mobile.api-url")).toBe(API);

    await act(async () => {
      await auth.authFetch("/api/documents");
    });
    expect(calls.at(-1)).toMatchObject({ path: "/api/documents", bearer: "Bearer a1" });
  });

  it("does not re-run the session restore in the middle of a sign-in", async () => {
    // It used to, because `authFetch` changed identity with the URL. The restore
    // then read the store before the tokens were in it and blanked them in memory.
    server({ valid: "a1", refresh: "r1" }, (path) =>
      path === "/api/auth/login"
        ? json(201, { accessToken: "a1", refreshToken: "r1" })
        : undefined as never,
    );
    await mount();
    const readsBefore = (SecureStore.getItemAsync as jest.Mock).mock.calls.length;

    await act(async () => {
      await auth.login({ apiUrl: API, email: "you@example.com", password: "correct horse" });
    });

    expect((SecureStore.getItemAsync as jest.Mock).mock.calls.length).toBe(readsBefore);
  });

  it("replaces an API token, which would otherwise win as the bearer", async () => {
    keychain.set("openkeep.mobile.api-token", "okp_old.secret");
    await AsyncStorage.setItem("openkeep.mobile.api-url", API);
    const state = { valid: "a1", refresh: "r1" };
    server(state, (path, init) => {
      if (path === "/api/auth/login") return json(201, { accessToken: "a1", refreshToken: "r1" });
      if (bearerOf(init) === "Bearer okp_old.secret") return json(200, USER);
      return undefined as never;
    });
    await mount();

    await act(async () => {
      await auth.login({ apiUrl: API, email: "you@example.com", password: "correct horse" });
    });
    await act(async () => {
      await auth.authFetch("/api/documents");
    });

    expect(keychain.has("openkeep.mobile.api-token")).toBe(false);
    expect(calls.at(-1)?.bearer).toBe("Bearer a1");
  });

  it("stores nothing when the password is refused", async () => {
    server({ valid: "a1", refresh: "r1" }, (path) =>
      path === "/api/auth/login" ? json(401, { message: "Invalid credentials" }) : undefined as never,
    );
    await mount();

    await expect(
      auth.login({ apiUrl: API, email: "you@example.com", password: "wrong password" }),
    ).rejects.toMatchObject({ status: 401, message: "Invalid credentials" });

    expect(auth.isAuthenticated).toBe(false);
    expect(keychain.size).toBe(0);
    expect(await AsyncStorage.getItem("openkeep.mobile.api-url")).toBeNull();
  });

  it("carries the Cloudflare Access pass through every step and keeps it", async () => {
    server({ valid: "a1", refresh: "r1" }, (path) =>
      path === "/api/auth/login"
        ? json(201, { accessToken: "a1", refreshToken: "r1" })
        : undefined as never,
    );
    await mount();

    await act(async () => {
      await auth.login({
        apiUrl: API,
        email: "you@example.com",
        password: "correct horse",
        cfAccessClientId: "id.access",
        cfAccessClientSecret: "shh",
      });
    });

    const fetchMock = (global as any).fetch as jest.Mock;
    for (const [, init] of fetchMock.mock.calls) {
      const headers = init?.headers ?? {};
      expect(headers["CF-Access-Client-Id"]).toBe("id.access");
    }
    expect(keychain.get("openkeep.mobile.cf-access-client-id")).toBe("id.access");
  });
});

describe("the two-factor step", () => {
  it("holds the session back until the code is in", async () => {
    const state = { valid: "a1", refresh: "r1" };
    server(state, (path, init) => {
      if (path === "/api/auth/login") return json(201, { requiresTwoFactor: true, twoFactorToken: "tf" });
      if (path === "/api/auth/login/2fa") {
        const { twoFactorToken, code } = JSON.parse(init.body as string);
        if (twoFactorToken !== "tf" || code !== "123456") {
          return json(401, { message: "Invalid authentication code" });
        }
        return json(201, { accessToken: "a1", refreshToken: "r1" });
      }
      return undefined as never;
    });
    await mount();

    let result: Awaited<ReturnType<typeof auth.login>>;
    await act(async () => {
      result = await auth.login({ apiUrl: API, email: "you@example.com", password: "correct horse" });
    });
    expect(result!).toEqual({ requiresTwoFactor: true, twoFactorToken: "tf" });
    expect(auth.isAuthenticated).toBe(false);
    expect(keychain.has("openkeep.mobile.access-token")).toBe(false);

    await expect(
      auth.completeTwoFactorLogin({ apiUrl: API, twoFactorToken: "tf", code: "000000" }),
    ).rejects.toMatchObject({ status: 401 });
    expect(auth.isAuthenticated).toBe(false);

    await act(async () => {
      await auth.completeTwoFactorLogin({ apiUrl: API, twoFactorToken: "tf", code: " 123456 " });
    });
    expect(auth.isAuthenticated).toBe(true);
    expect(keychain.get("openkeep.mobile.refresh-token")).toBe("r1");
  });
});

describe("the setup wizard", () => {
  it("starts the session without entering the app until it is finished", async () => {
    const state = { valid: "a1", refresh: "r1" };
    server(state, (path) =>
      path === "/api/auth/setup" ? json(201, { accessToken: "a1", refreshToken: "r1" }) : undefined as never,
    );
    await mount();

    await act(async () => {
      await auth.setupOwner({
        apiUrl: API,
        email: "you@example.com",
        password: "a long enough password",
        displayName: "You",
      });
    });

    expect(auth.user?.id).toBe("u-1");
    expect(auth.isAuthenticated).toBe(false);

    await act(async () => {
      await auth.updatePreferences({
        uiLanguage: "en",
        aiProcessingLanguage: "de",
        aiChatLanguage: "de",
      });
    });
    expect(auth.isAuthenticated).toBe(false);

    await act(async () => {
      auth.finishSetup();
    });
    expect(auth.isAuthenticated).toBe(true);
  });

  it("reports an archive that already has an owner, and stays signed out", async () => {
    server({ valid: "a1", refresh: "r1" }, (path) =>
      path === "/api/auth/setup" ? json(400, { message: "Owner already exists" }) : undefined as never,
    );
    await mount();

    await expect(
      auth.setupOwner({
        apiUrl: API,
        email: "you@example.com",
        password: "a long enough password",
        displayName: "You",
      }),
    ).rejects.toMatchObject({ status: 400, message: "Owner already exists" });
    expect(auth.user).toBeNull();
  });
});

describe("token refresh after a password login", () => {
  it("refreshes and retries once the access token has expired", async () => {
    await storedSession();
    const state = { valid: "a1", refresh: "r1" };
    server(state);
    await mount();
    expect(auth.isAuthenticated).toBe(true);

    state.valid = "a2";
    state.refresh = "r1"; // the refresh token is still good; only the access token ran out
    let response: Response;
    await act(async () => {
      response = await auth.authFetch("/api/documents");
    });

    expect(response!.status).toBe(200);
    expect(calls.filter((call) => call.path === "/api/auth/refresh")).toHaveLength(1);
    expect(keychain.get("openkeep.mobile.access-token")).toBe("a2+");
    expect(keychain.get("openkeep.mobile.refresh-token")).toBe("r1+");
    expect(auth.isAuthenticated).toBe(true);
  });

  it("shares one refresh between requests that expire together", async () => {
    // The server treats a replayed refresh token as theft and revokes everything,
    // so a second refresh with the same token would be a sign-out.
    await storedSession();
    const state = { valid: "a1", refresh: "r1" };
    server(state);
    await mount();

    state.valid = "a2";
    let responses: Response[];
    await act(async () => {
      responses = await Promise.all([
        auth.authFetch("/api/documents"),
        auth.authFetch("/api/dashboard/insights"),
        auth.authFetch("/api/documents/facets"),
      ]);
    });

    expect(responses!.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(calls.filter((call) => call.path === "/api/auth/refresh")).toHaveLength(1);
    expect(auth.isAuthenticated).toBe(true);
  });

  it.each(["/api/auth/tokens", "/api/auth/2fa/setup", "/api/auth/me/preferences"])(
    "covers the authenticated auth route %s",
    async (path) => {
      await storedSession();
      const state = { valid: "a1", refresh: "r1" };
      server(state);
      await mount();

      state.valid = "a2";
      let response: Response;
      await act(async () => {
        response = await auth.authFetch(path);
      });

      expect(response!.status).toBe(200);
      expect(calls.at(-1)).toMatchObject({ path, bearer: "Bearer a2+" });
    },
  );

  it("ends the session when the server refuses the refresh token", async () => {
    await storedSession();
    const state = { valid: "a1", refresh: "r1" };
    server(state);
    await mount();

    state.valid = "gone";
    state.refresh = "gone";
    await act(async () => {
      await auth.authFetch("/api/documents");
    });

    expect(auth.isAuthenticated).toBe(false);
    expect(keychain.has("openkeep.mobile.refresh-token")).toBe(false);
  });

  it.each([500, 502, 429])("keeps the session when the refresh answers %i", async (status) => {
    await storedSession();
    const state = { valid: "a1", refresh: "r1" };
    server(state, (path) => (path === "/api/auth/refresh" ? json(status) : undefined as never));
    await mount();

    state.valid = "a2";
    await act(async () => {
      await expect(auth.authFetch("/api/documents")).rejects.toThrow(String(status));
    });

    expect(auth.isAuthenticated).toBe(true);
    expect(keychain.get("openkeep.mobile.refresh-token")).toBe("r1");
  });

  it("refreshes for a chat stream too", async () => {
    await storedSession();
    const state = { valid: "a1", refresh: "r1" };
    server(state);
    await mount();
    state.valid = "a2";

    (expoFetch as jest.Mock).mockImplementation(async (_url: string, init: RequestInit) =>
      json(bearerOf(init) === `Bearer ${state.valid}` ? 200 : 401),
    );

    let response: Response;
    await act(async () => {
      response = await auth.streamFetch("/api/search/answer/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
    });

    expect(response!.status).toBe(200);
    expect(expoFetch).toHaveBeenCalledTimes(2);
    const retried = (expoFetch as jest.Mock).mock.calls[1][1];
    expect(retried.headers["Content-Type"]).toBe("application/json");
  });

  it("does not sign out over a mistyped two-factor code", async () => {
    await storedSession();
    const state = { valid: "a1", refresh: "r1" };
    server(state, (path) =>
      path === "/api/auth/2fa/disable" ? json(401, { message: "Invalid authentication code" }) : undefined as never,
    );
    await mount();

    let response: Response;
    await act(async () => {
      response = await auth.authFetch("/api/auth/2fa/disable", { method: "POST" });
    });

    expect(response!.status).toBe(401);
    expect(auth.isAuthenticated).toBe(true);
    expect(keychain.has("openkeep.mobile.refresh-token")).toBe(true);
  });

  it("a mistyped code does not end an API-token session either", async () => {
    keychain.set("openkeep.mobile.api-token", "okp_x.secret");
    await AsyncStorage.setItem("openkeep.mobile.api-url", API);
    route((path) => {
      if (path === "/api/auth/me") return json(200, USER);
      if (path === "/api/auth/2fa/enable") return json(401, { message: "Invalid authentication code" });
      return json(401);
    });
    await mount();

    await act(async () => {
      await auth.authFetch("/api/auth/2fa/enable", { method: "POST" });
    });
    expect(auth.isAuthenticated).toBe(true);

    await act(async () => {
      await auth.authFetch("/api/documents");
    });
    expect(auth.isAuthenticated).toBe(false);
  });
});

describe("offline, with a password session", () => {
  it("opens from the stored user when the server cannot be reached", async () => {
    await storedSession();
    (global as any).fetch = jest.fn(async () => {
      throw new Error("Network request failed");
    });
    await mount();

    expect(auth.isOfflineSession).toBe(true);
    expect(auth.isAuthenticated).toBe(true);
    expect(keychain.get("openkeep.mobile.refresh-token")).toBe("r1");
  });

  it("stays offline, signed in, when a refresh fails on the way back", async () => {
    await storedSession();
    const state = { valid: "a2", refresh: "r1" };
    server(state, (path) => (path === "/api/auth/refresh" ? json(503) : undefined as never));
    await mount();

    expect(auth.isOfflineSession).toBe(true);
    expect(auth.isAuthenticated).toBe(true);
    expect(keychain.has("openkeep.mobile.refresh-token")).toBe(true);
  });

  it("reconnects through a refresh", async () => {
    await storedSession();
    (global as any).fetch = jest.fn(async () => {
      throw new Error("Network request failed");
    });
    await mount();
    expect(auth.isOfflineSession).toBe(true);

    const state = { valid: "a2", refresh: "r1" };
    server(state);
    let live = false;
    await act(async () => {
      live = await auth.retryOfflineSession();
    });

    expect(live).toBe(true);
    expect(auth.isOfflineSession).toBe(false);
    expect(keychain.get("openkeep.mobile.access-token")).toBe("a2+");
  });
});
