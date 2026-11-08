import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import * as DocumentPicker from "expo-document-picker";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { ReactNode } from "react";
import { I18nProvider } from "../i18n";
import { ThemeProvider } from "../theme";
import { ScanScreen } from "../screens/ScanScreen";

const mockAuthFetch = jest.fn();
const mockNavigate = jest.fn();
let mockOffline = false;

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useScrollToTop: jest.fn(),
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

jest.mock("../auth", () => ({
  useAuth: () => ({
    apiUrl: "https://archive.example.com",
    isOfflineSession: false,
    authFetch: (path: string, init?: RequestInit) => mockAuthFetch(path, init),
  }),
}));

jest.mock("../offline-archive", () => ({
  useOfflineArchive: () => ({ shouldUseCache: mockOffline }),
}));

function ok(body: unknown) {
  return { ok: true, status: 201, json: async () => body, text: async () => "" };
}

function picked(...names: string[]) {
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({
    canceled: false,
    assets: names.map((name) => ({
      uri: `file:///cache/${name}`,
      name,
      size: 2048,
      mimeType: name.endsWith(".pdf") ? "application/pdf" : "application/msword",
    })),
  } as never);
}

function uploads() {
  return mockAuthFetch.mock.calls.filter(
    ([path, init]) => path === "/api/documents" && init?.method === "POST",
  );
}

let client: QueryClient | null = null;

async function renderScan() {
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
  return await render(<ScanScreen />, { wrapper: Wrapper });
}

beforeEach(() => {
  mockOffline = false;
  mockNavigate.mockReset();
  mockAuthFetch.mockReset();
  mockAuthFetch.mockImplementation(async (path: string) => {
    if (path === "/api/archive/watch-folder") {
      return ok({
        configured: true,
        configuredPath: "/srv/watch",
        lastImport: null,
        history: [],
      });
    }
    return ok({});
  });
});

afterEach(async () => {
  await cleanup();
  await waitFor(() => expect(true).toBe(true));
  client?.clear();
  client = null;
});

describe("the empty screen", () => {
  it("offers the scanner, the picker and the images-to-PDF route, and explains itself", async () => {
    const view = await renderScan();
    expect(view.getByText("Scan")).toBeTruthy();
    expect(view.getByText("Choose files")).toBeTruthy();
    expect(view.getByText("Images from files")).toBeTruthy();
    for (const step of ["Upload", "OCR", "Extract", "Embed"]) {
      expect(view.getByText(step)).toBeTruthy();
    }
    await waitFor(() => expect(view.getByText("/srv/watch")).toBeTruthy());
  });
});

describe("several files", () => {
  it("go straight into the queue, and a refused one is never sent", async () => {
    mockAuthFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/documents" && init?.method === "POST") {
        return ok({ id: `doc-${uploads().length}`, duplicateOf: null });
      }
      return ok({ status: "pending" });
    });
    picked("a.pdf", "b.pdf", "notes.docx");
    const view = await renderScan();

    fireEvent.press(view.getByText("Choose files"));

    await waitFor(() => expect(uploads()).toHaveLength(2));
    expect(view.getByText("a.pdf")).toBeTruthy();
    expect(view.getByText(/Unsupported file type/)).toBeTruthy();
  });

  it("flags a duplicate and opens the original (#284)", async () => {
    mockAuthFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/documents" && init?.method === "POST") {
        return ok({
          id: "new-doc",
          duplicateOf: { id: "original-doc", title: "Original", createdAt: "2026-01-01" },
        });
      }
      return ok({});
    });
    picked("a.pdf", "b.pdf");
    const view = await renderScan();

    fireEvent.press(view.getByText("Choose files"));

    await waitFor(() => expect(view.getAllByText("Open original")).toHaveLength(2));
    expect(view.getAllByText("Already in archive")).toHaveLength(2);
    fireEvent.press(view.getAllByText("Open original")[0]);
    expect(mockNavigate).toHaveBeenCalledWith("DocumentDetail", { documentId: "original-doc" });
  });

  it("retries a failed upload by uploading it again", async () => {
    let attempts = 0;
    mockAuthFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/documents" && init?.method === "POST") {
        attempts += 1;
        return attempts <= 2
          ? {
              ok: false,
              status: 500,
              json: async () => ({ message: "down" }),
              text: async () => JSON.stringify({ message: "down" }),
            }
          : ok({ id: "doc-1", duplicateOf: { id: "x", title: "X" } });
      }
      return ok({});
    });
    picked("a.pdf", "b.pdf");
    const view = await renderScan();

    fireEvent.press(view.getByText("Choose files"));
    await waitFor(() => expect(view.getAllByText("Retry")).toHaveLength(2));

    fireEvent.press(view.getAllByText("Retry")[0]);
    await waitFor(() => expect(uploads()).toHaveLength(3));
    await waitFor(() => expect(view.getAllByText("Retry")).toHaveLength(1));
  });

  it("clears finished rows and cancels everything else", async () => {
    mockAuthFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/documents" && init?.method === "POST") {
        return ok({ id: "doc", duplicateOf: { id: "x", title: "X" } });
      }
      return ok({});
    });
    picked("a.pdf", "b.pdf");
    const view = await renderScan();

    fireEvent.press(view.getByText("Choose files"));
    await waitFor(() => expect(view.getByText("Clear finished")).toBeTruthy());

    fireEvent.press(view.getByText("Clear finished"));
    await waitFor(() => expect(view.queryByText("a.pdf")).toBeNull());
    // Back to the explainer, which only an empty queue shows.
    expect(view.getByText("Embed")).toBeTruthy();
  });

  it("stops taking files after Cancel all", async () => {
    let release: (value: unknown) => void = () => undefined;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    mockAuthFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/documents" && init?.method === "POST") {
        await gate;
        return ok({ id: "doc", duplicateOf: null });
      }
      return ok({});
    });
    picked("a.pdf", "b.pdf", "c.pdf", "d.pdf", "e.pdf");
    const view = await renderScan();

    fireEvent.press(view.getByText("Choose files"));
    await waitFor(() => expect(uploads()).toHaveLength(3));
    const signal = uploads()[0][1].signal as AbortSignal;

    fireEvent.press(view.getByText("Cancel all"));
    expect(signal.aborted).toBe(true);
    release(null);
    await waitFor(() => expect(view.queryByText("a.pdf")).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(uploads()).toHaveLength(3);
  });
});

describe("one file", () => {
  it("stops at a draft, where its title can be set", async () => {
    picked("vertrag.pdf");
    mockAuthFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/documents" && init?.method === "POST") {
        return ok({ id: "doc-1", duplicateOf: { id: "x", title: "X" } });
      }
      return ok({});
    });
    const view = await renderScan();

    fireEvent.press(view.getByText("Choose files"));
    await waitFor(() => expect(view.getByText("Upload this PDF")).toBeTruthy());
    expect(uploads()).toHaveLength(0);

    await fireEvent.changeText(view.getByPlaceholderText("Otherwise detected from the document"), "Mein Vertrag");
    fireEvent.press(view.getByText("Upload this PDF"));

    await waitFor(() => expect(uploads()).toHaveLength(1));
    const form = uploads()[0][1].body as FormData;
    expect(form.getAll("title")).toEqual(["Mein Vertrag"]);
    await waitFor(() => expect(view.getByText("Mein Vertrag")).toBeTruthy());
  });
});

describe("offline", () => {
  it("keeps a draft on the device and sends nothing", async () => {
    mockOffline = true;
    picked("vertrag.pdf");
    const view = await renderScan();

    expect(view.getByText("Offline · the scan stays on this device until you upload it")).toBeTruthy();
    fireEvent.press(view.getByText("Choose files"));
    await waitFor(() => expect(view.getByText("Upload this PDF")).toBeTruthy());
    expect(jest.mocked(DocumentPicker.getDocumentAsync).mock.lastCall?.[0]).toMatchObject({
      multiple: false,
    });

    fireEvent.press(view.getByText("Upload this PDF"));
    expect(mockAuthFetch).not.toHaveBeenCalled();
  });
});
