import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { ReactNode } from "react";
import {
  availableTaxYears,
  defaultTaxYear,
  documentsFilterForGroup,
  formatIssueDate,
} from "../api/taxes";
import { I18nProvider } from "../i18n";
import { TaxesScreen } from "../screens/TaxesScreen";
import { ThemeProvider } from "../theme";

const mockAuthFetch = jest.fn();
const mockNavigate = jest.fn();
const mockShare = jest.fn(async () => undefined);
let mockOffline = false;

jest.mock("expo-sharing", () => ({
  shareAsync: (...args: unknown[]) => (mockShare as jest.Mock)(...args),
}));

jest.mock("../auth", () => ({
  useAuth: () => ({
    apiUrl: "https://archive.example.com",
    authFetch: mockAuthFetch,
    isOfflineSession: false,
  }),
}));

jest.mock("../offline-archive", () => ({
  useOfflineArchive: () => ({ shouldUseCache: mockOffline }),
}));

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockNavigate }),
  // No navigator in this render: run the focus effect once, as a first focus would.
  useFocusEffect: (effect: () => void) => {
    const { useEffect } = jest.requireActual("react");
    useEffect(effect, [effect]);
  },
  useScrollToTop: () => {},
}));

const YEAR = {
  year: 2025,
  documentCount: 2,
  unsummedCount: 1,
  totals: [
    { currency: "EUR", sum: 100, count: 1 },
    { currency: "USD", sum: 50, count: 1 },
  ],
  groups: [
    {
      documentTypeId: "type-1",
      documentType: "Tax notice",
      count: 2,
      unsummedCount: 1,
      totals: [{ currency: "EUR", sum: 100, count: 1 }],
      documents: [
        {
          id: "doc-1",
          title: "Bescheid",
          issueDate: "2025-11-20",
          correspondentName: "Finanzamt",
          amount: 100,
          currency: "EUR",
          memberVia: "both",
        },
        {
          id: "doc-2",
          title: "Belege",
          issueDate: null,
          correspondentName: null,
          amount: null,
          currency: null,
          memberVia: "type",
        },
      ],
    },
    {
      documentTypeId: null,
      documentType: null,
      count: 0,
      unsummedCount: 0,
      totals: [],
      documents: [],
    },
  ],
};

function respond(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body } as unknown as Response;
}

let client: QueryClient;

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
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function serve(taxYear: Response) {
  mockAuthFetch.mockImplementation(async (path: string) =>
    path.startsWith("/api/taxes/")
      ? taxYear
      : respond({ correspondents: [], documentTypes: [], tags: [], statuses: [], years: [] }),
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockAuthFetch.mockReset();
  mockNavigate.mockReset();
  mockShare.mockClear();
  mockOffline = false;
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

describe("the tax year", () => {
  it("defaults to the last complete calendar year", () => {
    expect(defaultTaxYear(new Date(2026, 2, 20))).toBe(2025);
  });

  it("offers years that hold documents, the one in view, and the default, newest first", () => {
    expect(
      availableTaxYears(2019, [{ year: 2024 }, { year: 2022 }], new Date(2026, 2, 20)),
    ).toEqual([2025, 2024, 2022, 2019]);
  });

  it("still has years before the facets arrive", () => {
    expect(availableTaxYears(2025, undefined, new Date(2026, 2, 20))).toEqual([2025]);
  });

  it("reads an issue date as the day it says, not UTC midnight", () => {
    // The suite runs in Los Angeles, where UTC midnight is the previous day.
    expect(formatIssueDate("2025-11-20", "de")).toBe("20.11.2025");
    expect(formatIssueDate("2025-11-20", "en")).toBe("20/11/2025");
    expect(formatIssueDate(null, "en")).toBeNull();
  });

  it("links a typed group to Documents, and an unfiled one nowhere", () => {
    expect(documentsFilterForGroup({ documentTypeId: "t" }, 2025)).toEqual({
      year: 2025,
      documentTypeIds: ["t"],
    });
    expect(documentsFilterForGroup({ documentTypeId: null }, 2025)).toBeNull();
  });
});

describe("the screen", () => {
  it("makes no request offline and says so calmly", async () => {
    mockOffline = true;
    const screen = await render(<TaxesScreen />, { wrapper });
    expect(screen.getByText("Taxes need a connection")).toBeTruthy();
    expect(screen.queryByText("Export year")).toBeNull();
    expect(mockAuthFetch).not.toHaveBeenCalled();
  });

  it("shows the summary and the without-amount and membership indicators", async () => {
    serve(respond(YEAR));
    const screen = await render(<TaxesScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText("Total (EUR)")).toBeTruthy());
    expect(screen.getByText("Total (USD)")).toBeTruthy();
    expect(screen.getByText("Without amount")).toBeTruthy();
    expect(screen.getByText("1 without amount")).toBeTruthy();
    expect(screen.getByText("No amount")).toBeTruthy();
    expect(screen.getByText("Tag + Type")).toBeTruthy();
    expect(screen.getByText("Type")).toBeTruthy();
    // An unfiled group has nothing to filter by.
    expect(screen.getAllByText("Open in Documents")).toHaveLength(1);
  });

  it("collapses a group", async () => {
    serve(respond(YEAR));
    const screen = await render(<TaxesScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText("Bescheid")).toBeTruthy());
    await fireEvent.press(screen.getByLabelText("Tax notice, 2"));
    expect(screen.queryByText("Bescheid")).toBeNull();
  });

  it("opens a document, and a group in Documents with its filter", async () => {
    serve(respond(YEAR));
    const screen = await render(<TaxesScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText("Bescheid")).toBeTruthy());
    await fireEvent.press(screen.getByText("Bescheid"));
    expect(mockNavigate).toHaveBeenCalledWith("DocumentDetail", {
      documentId: "doc-1",
      title: "Bescheid",
    });
    await fireEvent.press(screen.getByText("Open in Documents"));
    expect(mockNavigate).toHaveBeenCalledWith("Home", {
      screen: "Documents",
      params: { applyFilters: { year: defaultTaxYear(), documentTypeIds: ["type-1"] } },
    });
  });

  it("says when a year is empty, and offers no export", async () => {
    serve(respond({ year: 2025, documentCount: 0, unsummedCount: 0, totals: [], groups: [] }));
    const screen = await render(<TaxesScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText(/Nothing is filed under tax year/)).toBeTruthy());
    await fireEvent.press(screen.getByText("Export year"));
    expect(mockAuthFetch.mock.calls.map(([path]) => path)).not.toContain(
      `/api/taxes/${defaultTaxYear()}/export`,
    );
  });

  it("exports through the share sheet", async () => {
    const zip = {
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(4),
    } as unknown as Response;
    mockAuthFetch.mockImplementation(async (path: string) =>
      path.endsWith("/export") ? zip : path.startsWith("/api/taxes/") ? respond(YEAR) : respond({}),
    );
    const screen = await render(<TaxesScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText("Bescheid")).toBeTruthy());
    await fireEvent.press(screen.getByText("Export year"));
    await waitFor(() => expect(mockShare).toHaveBeenCalled());
    expect((mockShare as jest.Mock).mock.calls[0][0]).toContain(`tax-year-${defaultTaxYear()}.zip`);
  });

  it("says when the export fails", async () => {
    mockAuthFetch.mockImplementation(async (path: string) =>
      path.endsWith("/export")
        ? respond({}, false)
        : path.startsWith("/api/taxes/")
          ? respond(YEAR)
          : respond({}),
    );
    const screen = await render(<TaxesScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText("Bescheid")).toBeTruthy());
    await fireEvent.press(screen.getByText("Export year"));
    await waitFor(() => expect(screen.getByText("Export failed. Try again.")).toBeTruthy());
    expect(mockShare).not.toHaveBeenCalled();
  });

  it("offers a retry when the year fails to load", async () => {
    serve(respond({}, false));
    const screen = await render(<TaxesScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText("Failed to load the tax year.")).toBeTruthy());
    serve(respond(YEAR));
    await fireEvent.press(screen.getByText("Retry"));
    await waitFor(() => expect(screen.getByText("Bescheid")).toBeTruthy());
  });
});
