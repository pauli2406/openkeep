import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { ReactNode } from "react";
import { I18nProvider } from "../i18n";
import { offlineCacheScope } from "../offline-scope";
import { ThemeProvider } from "../theme";
import { ReviewScreen } from "../screens/ReviewScreen";

/**
 * What the screen does with a queue beyond the undo window, which has its own
 * suite: reading all of it, saving corrections before a confirm is held, requeueing,
 * filtering and the bulk action.
 */
function mockReviewDoc(id: string, fields: Record<string, unknown> = {}) {
  return {
    id,
    title: `Title ${id}`,
    status: "ready",
    reviewStatus: "pending",
    reviewReasons: ["low_confidence"],
    mimeType: "application/pdf",
    searchablePdfAvailable: false,
    createdAt: "2026-03-01T08:00:00.000Z",
    issueDate: "2026-02-27",
    dueDate: null,
    expiryDate: null,
    amount: 84.5,
    currency: "EUR",
    referenceNumber: "4711",
    holderName: null,
    issuingAuthority: null,
    confidence: 0.62,
    tags: [],
    metadata: {},
    ...fields,
  };
}

const OUTBOX_KEY = "openkeep.mobile.review-outbox";
const mockAuthFetch = jest.fn();
let mockOffline = false;

jest.mock("../auth", () => ({
  useAuth: () => ({
    apiUrl: "https://archive.example.com",
    user: { id: "u-1" },
    isOfflineSession: false,
    authFetch: (path: string, init?: RequestInit) => mockAuthFetch(path, init),
    streamFetch: jest.fn(),
  }),
}));

jest.mock("../offline-archive", () => ({
  useOfflineArchive: () => ({
    isConnected: !mockOffline,
    shouldUseCache: mockOffline,
    cacheSummary: { documentCount: 0, fileStorageBytes: 0, updatedAt: null },
    loadCachedDocument: jest.fn(async () => null),
    queryCachedDocuments: jest.fn(async () => ({
      items: [mockReviewDoc("offline-1")],
      total: 1,
      page: 1,
      pageSize: 100,
    })),
    ensureCachedFile: jest.fn(),
    cacheOpenedDocument: jest.fn(),
  }),
}));

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => "" };
}

function failing(message: string) {
  return {
    ok: false,
    status: 400,
    json: async () => ({ message }),
    text: async () => JSON.stringify({ message }),
  };
}

function serve(items: unknown[], overrides: (path: string, init?: RequestInit) => unknown = () => null) {
  mockAuthFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    const override = overrides(path, init);
    if (override) {
      return override;
    }
    if (path.startsWith("/api/documents/review")) {
      return ok({ items, total: items.length, page: 1, pageSize: 100 });
    }
    if (path.includes("/text")) {
      return ok({ documentId: "x", blocks: [] });
    }
    if (path === "/api/taxonomies/correspondents") {
      return ok([{ id: "c-1", name: "Allianz", slug: "allianz" }]);
    }
    if (path === "/api/taxonomies/document-types") {
      return ok([{ id: "t-1", name: "Invoice", slug: "invoice" }]);
    }
    return ok({});
  });
}

function callsTo(fragment: string, method?: string) {
  return mockAuthFetch.mock.calls.filter(
    ([path, init]) =>
      String(path).includes(fragment) && (!method || init?.method === method),
  );
}

let client: QueryClient | null = null;

async function renderReview() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 393, height: 852 },
          insets: { top: 59, left: 0, right: 0, bottom: 34 },
        }}
      >
        <QueryClientProvider client={client!}>
          <ThemeProvider>
            <I18nProvider language="en">{children}</I18nProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    );
  }
  return await render(<ReviewScreen />, { wrapper: Wrapper });
}

beforeEach(async () => {
  mockOffline = false;
  mockAuthFetch.mockReset();
  await AsyncStorage.clear();
});

afterEach(async () => {
  await cleanup();
  await waitFor(() => expect(true).toBe(true));
  client?.clear();
  client = null;
  jest.restoreAllMocks();
});

describe("the queue", () => {
  it("asks for 100 at a time and reads past the first page", async () => {
    mockAuthFetch.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/documents/review")) {
        const page = Number(new URL(path, "https://x").searchParams.get("page"));
        return ok({
          items: page === 1 ? [mockReviewDoc("a")] : [mockReviewDoc("b")],
          total: 101,
          page,
          pageSize: 100,
        });
      }
      return ok({});
    });
    const view = await renderReview();

    await waitFor(() => expect(view.getByText("1 of 2")).toBeTruthy());
    const paths = callsTo("/api/documents/review").map(([path]) => path);
    expect(paths).toContain("/api/documents/review?page=1&pageSize=100");
    expect(paths).toContain("/api/documents/review?page=2&pageSize=100");
  });

  it("is a pleasant place to be when empty", async () => {
    serve([]);
    const view = await renderReview();
    await waitFor(() => expect(view.getByText("All caught up")).toBeTruthy());
  });

  it("filters by reason, explains it, and has a way back", async () => {
    serve([
      mockReviewDoc("a"),
      mockReviewDoc("b", { reviewReasons: ["ocr_empty"], confidence: 0.3 }),
    ]);
    const view = await renderReview();
    await waitFor(() => expect(view.getByText("Title a")).toBeTruthy());

    fireEvent.press(view.getByText("No text found · 1"));
    await waitFor(() => expect(view.getByText("Title b")).toBeTruthy());
    expect(view.queryByText("Title a")).toBeNull();
    expect(view.getAllByText(/Text recognition returned nothing readable/).length).toBeGreaterThan(0);
    expect(view.getByText("1 of 1")).toBeTruthy();
  });

  it("skips to the next document and can take that back", async () => {
    serve([mockReviewDoc("a"), mockReviewDoc("b")]);
    const view = await renderReview();
    await waitFor(() => expect(view.getByText("Title a")).toBeTruthy());

    fireEvent.press(view.getByRole("button", { name: /Skip/ }));
    await waitFor(() => expect(view.getByText("Title b")).toBeTruthy());

    fireEvent.press(view.getByText("Undo"));
    await waitFor(() => expect(view.getByText("Title a")).toBeTruthy());
    expect(callsTo("/review/")).toHaveLength(0);
  });
});

describe("confirming with corrections", () => {
  async function renderEdited(patchResponse: unknown) {
    serve([mockReviewDoc("a"), mockReviewDoc("b")], (path, init) =>
      path === "/api/documents/a" && init?.method === "PATCH" ? patchResponse : null,
    );
    const view = await renderReview();
    await waitFor(() => expect(view.getByText("Title a")).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText("Amount"), "99,90");
    return view;
  }

  it("saves them first and holds the resolve for the undo window", async () => {
    const view = await renderEdited(ok({}));
    fireEvent.press(view.getByText("Confirm and file"));

    await waitFor(() => expect(view.getByText("Undo")).toBeTruthy());
    const [[, init]] = callsTo("/api/documents/a", "PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ amount: 99.9 });
    expect(callsTo("/review/")).toHaveLength(0);
    // Kill-safe from here on: the next launch can finish it.
    await waitFor(async () =>
      expect(JSON.parse((await AsyncStorage.getItem(OUTBOX_KEY)) ?? "{}").documentId).toBe("a"),
    );
  });

  it("takes back the decision but not the correction", async () => {
    const view = await renderEdited(ok({}));
    fireEvent.press(view.getByText("Confirm and file"));
    await waitFor(() => expect(view.getByText("Undo")).toBeTruthy());

    fireEvent.press(view.getByText("Undo"));
    await waitFor(() => expect(view.getByText("Title a")).toBeTruthy());
    expect(callsTo("/review/")).toHaveLength(0);
    expect(callsTo("/api/documents/a", "PATCH")).toHaveLength(1);
    await waitFor(async () => expect(await AsyncStorage.getItem(OUTBOX_KEY)).toBeNull());
  });

  it("holds nothing when saving fails, and says why", async () => {
    const view = await renderEdited(failing("Amount is locked"));
    fireEvent.press(view.getByText("Confirm and file"));

    await waitFor(() => expect(view.getByText("Amount is locked")).toBeTruthy());
    expect(view.getByText("Title a")).toBeTruthy();
    expect(view.queryByText("Undo")).toBeNull();
    expect(await AsyncStorage.getItem(OUTBOX_KEY)).toBeNull();
  });

  it("sends nothing for a date that does not exist", async () => {
    serve([mockReviewDoc("a")]);
    const view = await renderReview();
    await waitFor(() => expect(view.getByText("Title a")).toBeTruthy());

    await fireEvent.changeText(view.getByLabelText("Issue date"), "31.02.2026");
    fireEvent.press(view.getByText("Confirm and file"));

    await waitFor(() =>
      expect(view.getByText("Issue date: Use a date like 2026-03-18.")).toBeTruthy(),
    );
    expect(callsTo("/api/documents/a", "PATCH")).toHaveLength(0);
    expect(view.queryByText("Undo")).toBeNull();
  });

  it("does not touch the record when nothing was edited", async () => {
    serve([mockReviewDoc("a")]);
    const view = await renderReview();
    await waitFor(() => expect(view.getByText("Title a")).toBeTruthy());

    fireEvent.press(view.getByText("Confirm and file"));
    await waitFor(() => expect(view.getByText("Undo")).toBeTruthy());
    expect(callsTo("/api/documents/a", "PATCH")).toHaveLength(0);
  });
});

describe("the outbox", () => {
  it("finishes a confirm the app was killed on top of", async () => {
    await AsyncStorage.setItem(
      OUTBOX_KEY,
      JSON.stringify({
        documentId: "killed",
        scope: offlineCacheScope({ apiUrl: "https://archive.example.com", userId: "u-1" }),
        heldAt: new Date().toISOString(),
      }),
    );
    serve([mockReviewDoc("a")]);
    await renderReview();

    await waitFor(() =>
      expect(callsTo("/api/documents/killed/review/resolve", "POST")).toHaveLength(1),
    );
  });
});

describe("reprocessing", () => {
  it("requeues with force, as the web's button does", async () => {
    serve([mockReviewDoc("a"), mockReviewDoc("b")]);
    const view = await renderReview();
    await waitFor(() => expect(view.getByText("Title a")).toBeTruthy());

    fireEvent.press(view.getByText("Reprocess"));
    await waitFor(() => expect(callsTo("/api/documents/a/review/requeue", "POST")).toHaveLength(1));
    const [[, init]] = callsTo("/api/documents/a/review/requeue");
    expect(JSON.parse(String(init.body))).toEqual({ force: true });
    await waitFor(() => expect(view.getByText("Title b")).toBeTruthy());
  });
});

describe("bulk confirming", () => {
  const queue = [
    mockReviewDoc("low", { confidence: 0.5 }),
    mockReviewDoc("high-1", { confidence: 0.85 }),
    mockReviewDoc("high-2", { confidence: 0.9, reviewReasons: ["classification_ambiguous"] }),
    mockReviewDoc("defect", { confidence: 0.99, reviewReasons: ["ocr_empty"] }),
  ];

  it("files only what the rule allows, after asking", async () => {
    serve(queue);
    const alert = jest.spyOn(Alert, "alert");
    const view = await renderReview();
    await waitFor(() => expect(view.getByText("Confirm 2 above 80%")).toBeTruthy());

    fireEvent.press(view.getByText("Confirm 2 above 80%"));
    expect(callsTo("/review/resolve")).toHaveLength(0);

    const buttons = alert.mock.calls[0][2] ?? [];
    buttons[buttons.length - 1].onPress?.();

    await waitFor(() => expect(callsTo("/review/resolve", "POST")).toHaveLength(2));
    expect(callsTo("/api/documents/high-1/review/resolve")).toHaveLength(1);
    expect(callsTo("/api/documents/high-2/review/resolve")).toHaveLength(1);
    expect(callsTo("/api/documents/defect/review/resolve")).toHaveLength(0);
    // Filed, so out of the walk: two left of the four, and the bulk action is spent.
    await waitFor(() => expect(view.queryByText(/above 80%/)).toBeNull());
    expect(view.getByText("All · 2")).toBeTruthy();
  });

  it("does not offer itself when nothing qualifies", async () => {
    serve([mockReviewDoc("low", { confidence: 0.5 })]);
    const view = await renderReview();
    await waitFor(() => expect(view.getByText("Title low")).toBeTruthy());
    expect(view.queryByText(/above 80%/)).toBeNull();
  });
});

describe("offline", () => {
  it("reads the local copy and writes nothing", async () => {
    mockOffline = true;
    serve([]);
    const view = await renderReview();
    await waitFor(() => expect(view.getByText("Title offline-1")).toBeTruthy());

    fireEvent.press(view.getByText("Confirm and file"));
    fireEvent.press(view.getByText("Reprocess"));

    expect(mockAuthFetch).not.toHaveBeenCalled();
    expect(view.queryByText(/above 80%/)).toBeNull();
    expect(view.getByLabelText("Amount").props.editable).toBe(false);
  });
});
