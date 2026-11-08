import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, renderHook, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { ReactNode } from "react";
import { Omnibar } from "../components/Omnibar";
import { ShellContext, type Shell } from "../components/shell-context";
import { useRecentSearches } from "../hooks/useRecentSearches";
import { I18nProvider } from "../i18n";
import { SearchScreen } from "../screens/SearchScreen";
import { ThemeProvider } from "../theme";

/**
 * The behaviour around the answer rather than its looks: what gets saved and for
 * whom, what is replayed to the server, and the levels the omnibar steps through.
 */

const mockAuthFetch = jest.fn();
const mockStreamFetch = jest.fn();
const mockNavigate = jest.fn();
const mockSetParams = jest.fn();
let mockOffline = false;
let mockUserId = "user-1";
let mockRouteParams: { q?: string } | undefined;

jest.mock("../auth", () => ({
  useAuth: () => ({
    apiUrl: "https://archive.example.com",
    user: { id: mockUserId },
    authFetch: mockAuthFetch,
    streamFetch: mockStreamFetch,
    isOfflineSession: false,
  }),
}));

jest.mock("../offline-archive", () => ({
  useOfflineArchive: () => ({
    shouldUseCache: mockOffline,
    cacheSummary: { revision: 0 },
    queryCachedDocuments: async () => ({ items: [], total: 0, page: 1, pageSize: 25 }),
    loadCachedFacets: async () => ({ correspondents: [], documentTypes: [], tags: [] }),
    loadCachedDashboard: async () => ({ stats: {} }),
  }),
}));

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockNavigate, setParams: mockSetParams }),
  useRoute: () => ({ params: mockRouteParams }),
  useScrollToTop: () => {},
}));

const CITATION = {
  documentId: "d-2",
  documentTitle: "Beitragsanpassung",
  chunkIndex: 0,
  quote: "monatlich 84,50 EUR",
  pageFrom: 2,
  pageTo: 2,
  index: 1,
  used: true,
};

/** An SSE response as `useAnswerStream` reads it from Expo's fetch. */
function sse(...events: Array<[string, unknown]>) {
  const chunks = events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          chunks.length > 0 ? { done: false, value: chunks.shift() } : { done: true, value: undefined },
      }),
    },
  } as unknown as Response;
}

function answered(text: string) {
  return sse(
    ["search-results", { results: [{ document: { id: "d-2", title: "Beitragsanpassung" }, score: 1 }] }],
    ["answer-token", { text }],
    ["done", { status: "answered", route: "hybrid", citations: [CITATION], fullAnswer: text }],
  );
}

function respond(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body } as unknown as Response;
}

let client: QueryClient;
let shell: Shell;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 393, height: 852 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <ThemeProvider>
        <I18nProvider language="en">
          <QueryClientProvider client={client}>
            <ShellContext.Provider value={shell}>{children}</ShellContext.Provider>
          </QueryClientProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function storedConversations() {
  const key = `openkeep.chat-conversations:${mockUserId}--archive-example-com`;
  return AsyncStorage.getItem(key).then((raw) => (raw ? JSON.parse(raw) : null));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockAuthFetch.mockReset();
  mockStreamFetch.mockReset();
  mockNavigate.mockReset();
  mockSetParams.mockReset();
  mockOffline = false;
  mockRouteParams = undefined;
  // Each test is its own account: the recent-question store outlives a render.
  mockUserId = `user-${Math.random().toString(36).slice(2)}`;
  shell = {
    active: "Chat",
    setActive: jest.fn(),
    openDrawer: jest.fn(),
    closeDrawer: jest.fn(),
    drawerOpen: false,
    openOmnibar: jest.fn(),
    omnibarOpen: true,
    closeOmnibar: jest.fn(),
  };
  mockAuthFetch.mockImplementation(async (path: string) => {
    if (path === "/api/health/providers") return respond({ activeChatProvider: "anthropic" });
    if (path === "/api/documents/facets") {
      return respond({
        correspondents: [{ id: "c-1", name: "Stadtwerke", slug: "s", count: 1 }],
        documentTypes: [],
        tags: [],
        statuses: [],
        years: [],
      });
    }
    if (path === "/api/dashboard/insights") {
      return respond({ stats: { pendingReview: 2 }, overdueItems: [], upcomingDeadlines: [] });
    }
    return respond({ blocks: [], title: "Beitragsanpassung" });
  });
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

async function ask(screen: Awaited<ReturnType<typeof render>>, question: string) {
  await fireEvent.changeText(screen.getByLabelText("Ask your archive…"), question);
  await fireEvent.press(screen.getByLabelText("Send"));
}

describe("Chat", () => {
  it("names the chat provider from health, not the answer's route", async () => {
    const screen = await render(<SearchScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText("anthropic · only extracted text")).toBeTruthy());

    mockStreamFetch.mockResolvedValue(answered("An answer"));
    await ask(screen, "Question");
    await waitFor(() => expect(screen.getByText("Used 1 source")).toBeTruthy());
    expect(screen.getByText("anthropic · only extracted text")).toBeTruthy();
    expect(screen.queryByText(/hybrid/)).toBeNull();
  });

  it("saves the conversation under this account and archive", async () => {
    mockStreamFetch.mockResolvedValue(answered("An answer"));
    const screen = await render(<SearchScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText("Ask your archive")).toBeTruthy());
    await ask(screen, "Question");
    await waitFor(() => expect(screen.getByText("1 turn")).toBeTruthy());

    const saved = await storedConversations();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ title: "Question" });
    expect(saved[0].turns[0]).toMatchObject({ question: "Question", answer: "An answer" });
    expect(await AsyncStorage.getItem("openkeep.chat-conversations")).toBeNull();
  });

  it("reopens on the latest saved conversation", async () => {
    await AsyncStorage.setItem(
      `openkeep.chat-conversations:${mockUserId}--archive-example-com`,
      JSON.stringify([
        {
          id: "saved",
          title: "From last time",
          at: 1,
          turns: [{ question: "From last time", answer: "Saved answer", citations: [], structuredRows: null, structuredTitle: null }],
        },
      ]),
    );
    const screen = await render(<SearchScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText("Saved answer")).toBeTruthy());
  });

  it("replays the answers on a follow-up, but never a failure", async () => {
    mockStreamFetch.mockResolvedValueOnce(answered("First answer"));
    const screen = await render(<SearchScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText("Ask your archive")).toBeTruthy());
    await ask(screen, "First");
    await waitFor(() => expect(screen.getByText("1 turn")).toBeTruthy());

    mockStreamFetch.mockResolvedValueOnce(sse(["error", { message: "Provider down" }]));
    await ask(screen, "Second");
    await waitFor(() => expect(screen.getByText("Provider down")).toBeTruthy());

    mockStreamFetch.mockResolvedValueOnce(answered("Third answer"));
    await ask(screen, "Third");
    await waitFor(() => expect(screen.getByText("3 turns")).toBeTruthy());

    const body = JSON.parse(mockStreamFetch.mock.calls[2][1].body);
    expect(body.history).toEqual([
      { role: "user", content: "First" },
      { role: "assistant", content: "First answer" },
    ]);
  });

  it("opens the cited passage and finds it in the document", async () => {
    mockStreamFetch.mockResolvedValue(answered("See [1]."));
    const screen = await render(<SearchScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText("Ask your archive")).toBeTruthy());
    await ask(screen, "Question");
    await waitFor(() => expect(screen.getByLabelText("1 · Beitragsanpassung")).toBeTruthy());

    await fireEvent.press(screen.getByLabelText("1 · Beitragsanpassung"));
    expect(screen.getByText("„monatlich 84,50 EUR“")).toBeTruthy();
    await fireEvent.press(screen.getByText("Find in document"));
    expect(mockNavigate).toHaveBeenCalledWith("DocumentDetail", {
      documentId: "d-2",
      title: "Beitragsanpassung",
      citation: { page: 2, quote: "monatlich 84,50 EUR" },
    });
  });

  it("asks a question handed over from the omnibar, once", async () => {
    mockRouteParams = { q: "From the omnibar" };
    // What the navigator does with it: the parameter is gone on the next render.
    mockSetParams.mockImplementation(() => {
      mockRouteParams = undefined;
    });
    mockStreamFetch.mockResolvedValue(answered("An answer"));
    const screen = await render(<SearchScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText("1 turn")).toBeTruthy());
    expect(mockSetParams).toHaveBeenCalledWith({ q: undefined });
    expect(mockStreamFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockStreamFetch.mock.calls[0][1].body).query).toBe("From the omnibar");
  });

  it("asks nothing offline, and makes no request for the provider", async () => {
    mockOffline = true;
    const screen = await render(<SearchScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText("Ask your archive")).toBeTruthy());
    await ask(screen, "Question");
    expect(mockStreamFetch).not.toHaveBeenCalled();
    expect(mockAuthFetch).not.toHaveBeenCalled();
  });
});

describe("the omnibar", () => {
  async function results() {
    mockStreamFetch.mockResolvedValue(answered("See [1]."));
    const screen = await render(<Omnibar />, { wrapper });
    await fireEvent.changeText(screen.getByLabelText("Search, ask, or jump to…"), "Question");
    await fireEvent.press(screen.getByLabelText("Question"));
    await waitFor(() => expect(screen.getByText("Used 1 source")).toBeTruthy());
    return screen;
  }

  it("steps back one level at a time: citation, answer, palette, closed", async () => {
    const screen = await results();
    await fireEvent.press(screen.getByLabelText("1 · Beitragsanpassung"));
    await waitFor(() => expect(screen.getByLabelText("Back to results")).toBeTruthy());

    await fireEvent.press(screen.getByLabelText("Back to results"));
    await waitFor(() => expect(screen.getByText("Used 1 source")).toBeTruthy());

    await fireEvent.press(screen.getByLabelText("Back"));
    await waitFor(() => expect(screen.getByLabelText("Close")).toBeTruthy());
    expect(screen.queryByText("Used 1 source")).toBeNull();
    expect(shell.closeOmnibar).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText("Close"));
    expect(shell.closeOmnibar).toHaveBeenCalledTimes(1);
  });

  it("hands a question over to Chat", async () => {
    const screen = await results();
    await fireEvent.press(screen.getByText("Open full search"));
    expect(shell.closeOmnibar).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("Home", {
      screen: "Chat",
      params: { q: "Question" },
    });
  });

  it("filters Documents by a matching correspondent", async () => {
    const screen = await render(<Omnibar />, { wrapper });
    await fireEvent.changeText(screen.getByLabelText("Search, ask, or jump to…"), "stadt");
    await waitFor(() => expect(screen.getByLabelText("Stadtwerke, correspondent")).toBeTruthy());
    await fireEvent.press(screen.getByLabelText("Stadtwerke, correspondent"));
    expect(mockNavigate).toHaveBeenCalledWith("Home", {
      screen: "Documents",
      params: { applyFilters: { correspondentIds: ["c-1"] } },
    });
  });

  it("jumps through commands after `>`", async () => {
    const screen = await render(<Omnibar />, { wrapper });
    await fireEvent.changeText(screen.getByLabelText("Search, ask, or jump to…"), ">import");
    await fireEvent.press(screen.getByLabelText("Import files"));
    expect(mockNavigate).toHaveBeenCalledWith("Scan");
  });

  it("offers nothing to ask offline", async () => {
    mockOffline = true;
    const screen = await render(<Omnibar />, { wrapper });
    await fireEvent.changeText(screen.getByLabelText("Search, ask, or jump to…"), "stadt");
    expect(screen.queryByLabelText("stadt")).toBeNull();
    expect(screen.getByText(/Asking needs a connection/)).toBeTruthy();
    await fireEvent(screen.getByLabelText("Search, ask, or jump to…"), "submitEditing");
    expect(mockStreamFetch).not.toHaveBeenCalled();
    expect(mockAuthFetch).not.toHaveBeenCalled();
  });
});

describe("recent questions", () => {
  it("are one list for every consumer", async () => {
    const first = await renderHook(() => useRecentSearches(), { wrapper });
    const second = await renderHook(() => useRecentSearches(), { wrapper });
    await act(async () => first.result.current.addSearch("From the omnibar"));
    await act(async () => second.result.current.addSearch("From chat"));
    expect(first.result.current.recentSearches.map((entry) => entry.query)).toEqual([
      "From chat",
      "From the omnibar",
    ]);
    await first.unmount();
    await second.unmount();
  });

  it("belong to one account", async () => {
    const hook = await renderHook(() => useRecentSearches(), { wrapper });
    await act(async () => hook.result.current.addSearch("Mine"));
    mockUserId = "someone-else";
    await hook.rerender(undefined);
    await waitFor(() => expect(hook.result.current.recentSearches).toEqual([]));
    await hook.unmount();
  });

  it("clear out the old list nothing says the owner of", async () => {
    await AsyncStorage.setItem(
      "openkeep.mobile.recent-searches",
      JSON.stringify([{ query: "Whose?", timestamp: 1 }]),
    );
    const hook = await renderHook(() => useRecentSearches(), { wrapper });
    await waitFor(async () =>
      expect(await AsyncStorage.getItem("openkeep.mobile.recent-searches")).toBeNull(),
    );
    expect(hook.result.current.recentSearches).toEqual([]);
    await hook.unmount();
  });
});
