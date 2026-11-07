/**
 * The account screens' promises that only show when rendered: offline they ask the
 * server for nothing, a one-time secret is shown, and a sign-in reports its errors
 * under the right field.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import type { ReactElement } from "react";
import { AuthRequestError } from "../auth";
import { AuthScreen } from "../screens/AuthScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { renderThemed } from "./render";

const mockAuth: Record<string, any> = {};
const mockOffline: Record<string, any> = {};

jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
jest.mock("../auth", () => ({
  ...jest.requireActual("../auth"),
  useAuth: () => mockAuth,
}));
jest.mock("../offline-archive", () => ({
  useOfflineArchive: () => mockOffline,
}));

const USER = {
  id: "u-1",
  email: "you@example.com",
  displayName: "You",
  isOwner: true,
  twoFactorEnabled: false,
  preferences: { uiLanguage: "en", aiProcessingLanguage: "en", aiChatLanguage: "en" },
};

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

function reset({ offline = false }: { offline?: boolean } = {}) {
  Object.assign(mockAuth, {
    apiUrl: "https://archive.example.com",
    user: USER,
    isAuthenticated: true,
    isOfflineSession: offline,
    isCompletingSetup: false,
    hasRestorableSession: false,
    authFetch: jest.fn(async () => ok({})),
    login: jest.fn(async () => ({ requiresTwoFactor: false })),
    completeTwoFactorLogin: jest.fn(async () => undefined),
    setupOwner: jest.fn(async () => undefined),
    finishSetup: jest.fn(),
    connect: jest.fn(async () => undefined),
    openOfflineCopy: jest.fn(async () => true),
    updatePreferences: jest.fn(async () => undefined),
    refreshUser: jest.fn(async () => undefined),
    logout: jest.fn(async () => undefined),
    retryOfflineSession: jest.fn(async () => true),
  });
  Object.assign(mockOffline, {
    shouldUseCache: offline,
    isConnected: !offline,
    cacheSummary: { documentCount: 2, fileStorageBytes: 2048, lastCachedAt: null, revision: "r" },
    clearCachedDocuments: jest.fn(async () => undefined),
    loadCachedDashboard: jest.fn(async () => ({
      stats: { totalDocuments: 2, pendingReview: 0, documentTypesCount: 1, correspondentsCount: 1 },
    })),
  });
}

/** What the General tab reads as soon as Settings opens. */
function generalRoute(path: string): Response {
  if (path === "/api/health") return ok({ status: "ok", provider: {} });
  if (path === "/api/health/ready") return ok({ status: "ok", checks: { database: true } });
  if (path === "/api/health/status") {
    return ok({
      queues: { processing: { depth: 0 }, embedding: { depth: 0 } },
      documents: { byStatus: {}, pendingReview: 0 },
      recentJobs: [],
    });
  }
  if (path === "/api/archive/watch-folder") {
    return ok({ configured: false, configuredPath: null, lastScan: null, lastImport: null, history: [] });
  }
  if (path === "/api/email-ingest/status") {
    return ok({
      configured: false,
      mailbox: null,
      lastPoll: null,
      counts: { imported: 0, skipped: 0, rejected: 0 },
      recentRejections: [],
    });
  }
  return ok([]);
}

async function mount(ui: ReactElement) {
  const client = new QueryClient({
    // `gcTime: 0` keeps the cache from holding a timer open past the test.
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
  return renderThemed(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
});

describe("offline", () => {
  beforeEach(() => reset({ offline: true }));

  it("Settings keeps the device's own settings and asks the server for nothing", async () => {
    const screen = await mount(<SettingsScreen />);

    expect(screen.getByText("Appearance")).toBeTruthy();
    expect(screen.getByText("Available offline")).toBeTruthy();
    expect(screen.getByText("Available when you are back online")).toBeTruthy();
    expect(screen.queryByText("Save preferences")).toBeNull();

    await fireEvent.press(screen.getByText("Tags & taxonomy"));
    expect(screen.getByText("Tags and taxonomy need a connection")).toBeTruthy();
    await fireEvent.press(screen.getByText("AI providers"));
    expect(screen.getByText("Provider status needs a connection")).toBeTruthy();

    expect(mockAuth.authFetch).not.toHaveBeenCalled();
  });

  it("Profile reads its figures from the local copy and hides what needs the server", async () => {
    const screen = await mount(<ProfileScreen />);

    await waitFor(() => expect(mockOffline.loadCachedDashboard).toHaveBeenCalled());
    expect(screen.getByText("Sign out")).toBeTruthy();
    expect(screen.getByText("Needs a connection")).toBeTruthy();
    expect(screen.queryByText("Create Token")).toBeNull();
    expect(screen.queryByText("Export archive")).toBeNull();
    expect(mockAuth.authFetch).not.toHaveBeenCalled();
  });
});

describe("signing out", () => {
  it("clears the offline copy before the session", async () => {
    reset();
    const order: string[] = [];
    mockOffline.clearCachedDocuments = jest.fn(async () => {
      order.push("cache");
    });
    mockAuth.logout = jest.fn(async () => {
      order.push("session");
    });
    mockAuth.authFetch = jest.fn(async (path: string) =>
      ok(path === "/api/auth/tokens" ? [] : { stats: {}, recentDocuments: [] }),
    );
    const alert = jest.spyOn(Alert, "alert");

    const screen = await mount(<ProfileScreen />);
    await fireEvent.press(screen.getByText("Sign out"));
    const buttons = alert.mock.calls[0][2]!;
    await act(async () => {
      await buttons.find((button) => button.style === "destructive")!.onPress!();
    });

    await waitFor(() => expect(order).toEqual(["cache", "session"]));
  });
});

describe("API tokens", () => {
  it("shows the new secret once, and not after the sheet is closed", async () => {
    reset();
    const secret = "okp_abc.def";
    mockAuth.authFetch = jest.fn(async (path: string, init?: RequestInit) => {
      if (path === "/api/auth/tokens" && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ name: "CI" });
        return ok({ id: "t", token: secret, name: "CI", expiresAt: null });
      }
      if (path === "/api/auth/tokens") return ok([]);
      return ok({ stats: {}, recentDocuments: [] });
    });

    const screen = await mount(<ProfileScreen />);
    await waitFor(() => expect(screen.getByText("No API tokens created yet")).toBeTruthy());

    await fireEvent.press(screen.getByText("Create Token"));
    await fireEvent.changeText(screen.getByLabelText("Name"), "CI");
    await fireEvent.press(screen.getByText("Create"));
    await waitFor(() => expect(screen.getByText(secret)).toBeTruthy());

    await fireEvent.press(screen.getByText("Done"));
    await waitFor(() => expect(screen.queryByText(secret)).toBeNull());
  });
});

describe("the sign-in form", () => {
  beforeEach(() => {
    reset();
    mockAuth.user = null;
    mockAuth.isAuthenticated = false;
  });

  async function fillAndSubmit(screen: Awaited<ReturnType<typeof mount>>) {
    await fireEvent.changeText(screen.getByLabelText("Email"), "you@example.com");
    await fireEvent.changeText(screen.getByLabelText("Password"), "correct horse");
    await act(async () => {
      await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    });
  }

  it("goes through the server URL, including the Cloudflare pass", async () => {
    const screen = await mount(<AuthScreen />);
    await fireEvent.press(screen.getByText("Cloudflare Access"));
    await fireEvent.changeText(screen.getByLabelText("CF Access Client ID"), "id.access");
    await fillAndSubmit(screen);

    expect(mockAuth.login).toHaveBeenCalledWith(
      expect.objectContaining({
        apiUrl: "https://archive.example.com",
        email: "you@example.com",
        password: "correct horse",
        cfAccessClientId: "id.access",
      }),
    );
  });

  it("words a refused password itself, under the password", async () => {
    mockAuth.login = jest.fn(async () => {
      throw new AuthRequestError("Invalid credentials", 401);
    });
    const screen = await mount(<AuthScreen />);
    await fillAndSubmit(screen);
    expect(screen.getByText("That email and password do not match.")).toBeTruthy();
  });

  it("says when the throttle has stopped it", async () => {
    mockAuth.login = jest.fn(async () => {
      throw new AuthRequestError("ThrottlerException", 429);
    });
    const screen = await mount(<AuthScreen />);
    await fillAndSubmit(screen);
    expect(screen.getByText("Too many attempts. Wait a minute and try again.")).toBeTruthy();
  });

  it("puts an unreachable server under the URL, not the password", async () => {
    mockAuth.login = jest.fn(async () => {
      throw new Error("Could not reach the OpenKeep server.");
    });
    const screen = await mount(<AuthScreen />);
    await fillAndSubmit(screen);
    expect(screen.getByText("Could not reach the OpenKeep server. Check the server URL and connection.")).toBeTruthy();
  });

  it("asks for the second factor, then completes with the same server", async () => {
    mockAuth.login = jest.fn(async () => ({ requiresTwoFactor: true, twoFactorToken: "tf" }));
    const screen = await mount(<AuthScreen />);
    await fillAndSubmit(screen);

    expect(screen.getByText("Two-factor code")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Code"), "123456");
    await act(async () => {
      await fireEvent.press(screen.getByText("Verify"));
    });
    expect(mockAuth.completeTwoFactorLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        apiUrl: "https://archive.example.com",
        twoFactorToken: "tf",
        code: "123456",
      }),
    );
  });

  it("keeps API-token sign-in as the secondary way in", async () => {
    const screen = await mount(<AuthScreen />);
    await fireEvent.press(screen.getByText("Use an API token instead"));
    await fireEvent.changeText(screen.getByLabelText("API token"), "okp_abc.def");
    await act(async () => {
      await fireEvent.press(screen.getByText("Connect archive"));
    });
    expect(mockAuth.connect).toHaveBeenCalledWith(
      expect.objectContaining({ apiToken: "okp_abc.def", apiUrl: "https://archive.example.com" }),
    );
  });
});

describe("the setup wizard", () => {
  beforeEach(() => {
    reset();
    mockAuth.user = null;
    mockAuth.isAuthenticated = false;
  });

  it("validates the password, then walks through the steps to the end", async () => {
    const screen = await mount(<AuthScreen />);
    await fireEvent.press(screen.getByText("Go to setup"));
    await fireEvent.changeText(screen.getByLabelText("Display name"), "You");
    await fireEvent.changeText(screen.getByLabelText("Email"), "you@example.com");
    await fireEvent.changeText(screen.getByLabelText("Password"), "short");
    await fireEvent.changeText(screen.getByLabelText("Confirm password"), "short");
    await act(async () => {
      await fireEvent.press(screen.getByText("Continue"));
    });
    expect(mockAuth.setupOwner).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText("Password"), "a long enough password");
    await fireEvent.changeText(screen.getByLabelText("Confirm password"), "a different password!");
    await act(async () => {
      await fireEvent.press(screen.getByText("Continue"));
    });
    expect(mockAuth.setupOwner).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText("Confirm password"), "a long enough password");
    await act(async () => {
      await fireEvent.press(screen.getByText("Continue"));
    });
    expect(mockAuth.setupOwner).toHaveBeenCalledWith(
      expect.objectContaining({ apiUrl: "https://archive.example.com", displayName: "You" }),
    );

    expect(screen.getByText("Document language")).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByText("Save and continue"));
    });
    expect(mockAuth.updatePreferences).toHaveBeenCalledWith({
      uiLanguage: "en",
      aiProcessingLanguage: "de",
      aiChatLanguage: "de",
    });

    expect(screen.getByText("Watch folder")).toBeTruthy();
    await fireEvent.press(screen.getByText("Done"));
    expect(mockAuth.finishSetup).toHaveBeenCalled();
  });

  it("points to sign-in when the archive already has an owner", async () => {
    mockAuth.setupOwner = jest.fn(async () => {
      throw new AuthRequestError("Owner already exists", 400);
    });
    const screen = await mount(<AuthScreen />);
    await fireEvent.press(screen.getByText("Go to setup"));
    await fireEvent.changeText(screen.getByLabelText("Display name"), "You");
    await fireEvent.changeText(screen.getByLabelText("Email"), "you@example.com");
    await fireEvent.changeText(screen.getByLabelText("Password"), "a long enough password");
    await fireEvent.changeText(screen.getByLabelText("Confirm password"), "a long enough password");
    await act(async () => {
      await fireEvent.press(screen.getByText("Continue"));
    });
    expect(screen.getByText("This archive already has an owner. Sign in instead.")).toBeTruthy();
  });
});

describe("deleting from the taxonomy", () => {
  const TAGS = [
    { id: "t1", name: "Home", slug: "home" },
    { id: "t2", name: "Tax", slug: "tax" },
    { id: "t3", name: "Old", slug: "old" },
    { id: "t4", name: "Stale", slug: "stale" },
  ];
  const FACETS = {
    tags: [
      { id: "t1", name: "Home", slug: "home", count: 5 },
      { id: "t2", name: "Tax", slug: "tax", count: 2 },
    ],
    correspondents: [],
    documentTypes: [],
    statuses: [],
    years: [],
  };
  let deletes: string[];

  beforeEach(() => {
    reset();
    deletes = [];
    mockAuth.authFetch = jest.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        deletes.push(path);
        return ok({ success: true });
      }
      if (path === "/api/taxonomies/tags") return ok(TAGS);
      if (path === "/api/documents/facets") return ok(FACETS);
      return generalRoute(path);
    });
  });

  async function openTaxonomy() {
    const screen = await mount(<SettingsScreen />);
    await fireEvent.press(screen.getByText("Tags & taxonomy"));
    await waitFor(() => expect(screen.getByText("Home")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("5")).toBeTruthy());
    return screen;
  }

  it("asks first, states the documents affected, and only then deletes", async () => {
    const screen = await openTaxonomy();
    await fireEvent.press(screen.getByLabelText("Select Home"));
    await fireEvent.press(screen.getByLabelText("Select Tax"));

    await fireEvent.press(screen.getByText("Delete"));
    expect(screen.getByText("Delete 2 entries?")).toBeTruthy();
    expect(screen.getByText("7 documents lose this assignment. This cannot be undone.")).toBeTruthy();
    expect(deletes).toEqual([]);

    const buttons = screen.getAllByText("Delete");
    await act(async () => {
      await fireEvent.press(buttons[buttons.length - 1]);
    });
    await waitFor(() =>
      expect(deletes).toEqual(["/api/taxonomies/tags/t1", "/api/taxonomies/tags/t2"]),
    );
  });

  it("asks before the unused sweep, which takes only the unused", async () => {
    const screen = await openTaxonomy();
    await fireEvent.press(screen.getByText("Unused"));
    await fireEvent.press(screen.getByText("Delete all 2 unused"));
    expect(screen.getByText("No document uses any of these. This cannot be undone.")).toBeTruthy();
    expect(deletes).toEqual([]);

    const buttons = screen.getAllByText("Delete");
    await act(async () => {
      await fireEvent.press(buttons[buttons.length - 1]);
    });
    await waitFor(() =>
      expect(deletes).toEqual(["/api/taxonomies/tags/t3", "/api/taxonomies/tags/t4"]),
    );
  });

  it("will not bulk-delete a builtin category", async () => {
    mockAuth.authFetch = jest.fn(async (path: string) => {
      if (path === "/api/taxonomies/categories") {
        return ok([{ id: "c1", name: "Housing", slug: "housing", builtin: true }]);
      }
      if (path === "/api/taxonomies/tags") return ok(TAGS);
      if (path === "/api/documents/facets") return ok(FACETS);
      return generalRoute(path);
    });
    const screen = await openTaxonomy();
    await fireEvent.press(screen.getByText("Categories"));
    await waitFor(() => expect(screen.getByText("Housing")).toBeTruthy());
    expect(screen.queryByText("New entry…")).toBeNull();

    await fireEvent.press(screen.getByLabelText("Select Housing"));
    await fireEvent.press(screen.getByText("Delete"));
    expect(screen.queryByText("Delete 1 entry?")).toBeNull();
    expect(screen.getByText(/can be renamed but not deleted/)).toBeTruthy();
    expect(screen.queryByText("Merge into…")).toBeNull();
  });
});
