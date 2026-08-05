import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { ReactNode } from "react";
import { I18nProvider } from "../i18n";
import { ThemeProvider } from "../theme";
import { ReviewScreen } from "../screens/ReviewScreen";

/**
 * The one piece of behaviour in this redesign that was reasoned into place rather
 * than observed: confirming a review is held for the undo window instead of
 * being sent and then un-sent. That removed a race with the in-flight resolve
 * and, more importantly, stopped an undo from going through `requeue`, which
 * clears the review state and enqueues a forced processing job.
 *
 * Nothing else asserts it, so a later change could quietly restore the old
 * shape. This test is the thing that would notice.
 */
const QUEUE = {
  items: [
    {
      id: "doc-1",
      title: "Stadtwerke invoice",
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
      metadata: {
        reviewEvidence: {
          requiredFields: ["issueDate", "amount"],
          missingFields: [],
          confidence: 0.62,
          confidenceThreshold: 0.8,
        },
      },
    },
  ],
  total: 1,
  page: 1,
  pageSize: 25,
};

// `mock` prefix: jest allows only these in a module factory.
const mockAuthFetch = jest.fn();

jest.mock("../auth", () => ({
  useAuth: () => ({
    apiUrl: "https://archive.example.com",
    isOfflineSession: false,
    authFetch: (path: string, init?: RequestInit) => mockAuthFetch(path, init),
    streamFetch: jest.fn(),
  }),
}));

jest.mock("../offline-archive", () => ({
  useOfflineArchive: () => ({
    isConnected: true,
    shouldUseCache: false,
    cacheSummary: { documentCount: 0, fileStorageBytes: 0, updatedAt: null },
    loadCachedDocument: jest.fn(async () => null),
    queryCachedDocuments: jest.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 25 })),
    ensureCachedFile: jest.fn(),
    cacheOpenedDocument: jest.fn(),
  }),
}));

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => "" };
}

let client: QueryClient | null = null;

async function renderReview() {
  await AsyncStorage.clear();
  // `gcTime: 0` keeps the cache from holding a garbage-collection timer open
  // after the test has finished.
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

  const view = await render(<ReviewScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(view.getByText("Stadtwerke invoice")).toBeTruthy());
  return view;
}

function resolveCalls() {
  return mockAuthFetch.mock.calls.filter(([path]) => String(path).includes("/review/"));
}

describe("confirming a review", () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
    mockAuthFetch.mockImplementation(async (path: string) => {
      if (path.includes("/api/documents/review")) {
        return ok(QUEUE);
      }
      if (path.includes("/text")) {
        return ok({ documentId: "doc-1", blocks: [] });
      }
      return ok({});
    });
  });

  // Unmount inside the test's own lifetime: leaving the screen sends the held
  // confirm, and that request has to settle before the environment goes away.
  afterEach(async () => {
    await cleanup();
    await waitFor(() => expect(true).toBe(true));
    client?.clear();
    client = null;
  });

  it("offers an undo and sends nothing yet", async () => {
    const view = await renderReview();

    fireEvent.press(view.getByText("Confirm"));

    await waitFor(() => expect(view.getByText("Undo")).toBeTruthy());
    expect(resolveCalls()).toHaveLength(0);
  });

  /**
   * Leaving the screen closes the window too, and that path is testable without
   * advancing a clock: the queue polls itself while a document is processing, and
   * fake timers plus that interval turn `waitFor` into a refetch loop.
   */
  it("sends the resolve exactly once when the window closes", async () => {
    const view = await renderReview();

    fireEvent.press(view.getByText("Confirm"));
    await waitFor(() => expect(view.getByText("Undo")).toBeTruthy());
    view.unmount();

    await waitFor(() => expect(resolveCalls()).toHaveLength(1));
    expect(resolveCalls()[0][0]).toBe("/api/documents/doc-1/review/resolve");
    expect(resolveCalls()[0][1]).toMatchObject({ method: "POST" });
  });

  it("sends nothing at all when the confirm is taken back", async () => {
    const view = await renderReview();

    fireEvent.press(view.getByText("Confirm"));
    await waitFor(() => expect(view.getByText("Undo")).toBeTruthy());
    fireEvent.press(view.getByText("Undo"));

    // The document is back at the head of the queue …
    await waitFor(() => expect(view.getByText("Stadtwerke invoice")).toBeTruthy());
    view.unmount();

    // … and nothing was sent. In particular no `requeue`, which would have
    // cleared the review state and queued a fresh processing job for a mis-tap.
    expect(resolveCalls()).toHaveLength(0);
  });

  it("keeps the undo reachable after the last item clears the queue", async () => {
    // The snackbar used to be nested inside the document branch, so on a
    // one-item queue it appeared exactly never.
    const view = await renderReview();

    fireEvent.press(view.getByText("Confirm"));

    await waitFor(() => expect(view.getByText("Undo")).toBeTruthy());
  });
});
