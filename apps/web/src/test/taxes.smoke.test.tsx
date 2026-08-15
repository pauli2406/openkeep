import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { apiUrl } from "./api-url";
import { renderAuthenticatedApp } from "./render-app";
import { server } from "./msw-server";

const TAX_TYPE_ID = "77777777-7777-4777-8777-777777777777";

function makeTaxYearResponse(year: number) {
  return {
    year,
    documentCount: 3,
    unsummedCount: 1,
    totals: [
      { currency: "EUR", sum: 150.5, count: 2 },
    ],
    groups: [
      {
        documentTypeId: TAX_TYPE_ID,
        documentType: "Tax Document",
        count: 2,
        unsummedCount: 1,
        totals: [{ currency: "EUR", sum: 100, count: 1 }],
        documents: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            title: `Steuerbescheid ${year}`,
            issueDate: `${year}-01-15`,
            correspondentName: "Finanzamt",
            amount: 100,
            currency: "EUR",
            memberVia: "type",
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            title: "Unterlagen ohne Betrag",
            issueDate: `${year}-07-01`,
            correspondentName: "Finanzamt",
            amount: null,
            currency: null,
            memberVia: "both",
          },
        ],
      },
      {
        documentTypeId: null,
        documentType: null,
        count: 1,
        unsummedCount: 0,
        totals: [{ currency: "EUR", sum: 50.5, count: 1 }],
        documents: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            title: "Spendenquittung",
            issueDate: `${year}-06-15`,
            correspondentName: "Rotes Kreuz",
            amount: 50.5,
            currency: "EUR",
            memberVia: "tag",
          },
        ],
      },
    ],
  };
}

function makeEmptyTaxYearResponse(year: number) {
  return {
    year,
    documentCount: 0,
    unsummedCount: 0,
    totals: [],
    groups: [],
  };
}

function mockShellEndpoints() {
  server.use(
    http.get(apiUrl("/api/dashboard/insights"), () =>
      HttpResponse.json({
        stats: { totalDocuments: 3, pendingReview: 0, documentTypesCount: 2, correspondentsCount: 2 },
        topCorrespondents: [],
        upcomingDeadlines: [],
        overdueItems: [],
        recentDocuments: [],
        monthlyActivity: [],
      }),
    ),
    http.get(apiUrl("/api/documents/facets"), () =>
      HttpResponse.json({
        years: [{ year: 2025, count: 3 }, { year: 2024, count: 1 }],
        correspondents: [],
        documentTypes: [],
        tags: [],
        amountRange: { min: null, max: null },
        statuses: [],
      }),
    ),
  );
}

describe("taxes smoke", () => {
  it("renders a tax year with groups, sums, and membership hints", async () => {
    mockShellEndpoints();
    const requestedYears: string[] = [];
    server.use(
      http.get(apiUrl("/api/taxes/:year"), ({ params }) => {
        requestedYears.push(String(params.year));
        return HttpResponse.json(makeTaxYearResponse(Number(params.year)));
      }),
    );

    renderAuthenticatedApp({ route: "/taxes?year=2025" });

    expect(await screen.findByText("Steuerbescheid 2025")).toBeInTheDocument();
    expect(requestedYears).toContain("2025");

    // Groups: the tax type and the unfiled bucket.
    expect(screen.getByText("Tax Document")).toBeInTheDocument();
    expect(screen.getByText("Unfiled")).toBeInTheDocument();

    // Membership chips explain inclusion.
    expect(screen.getByText("Tag")).toBeInTheDocument();
    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByText("Tag + Type")).toBeInTheDocument();

    // The document without an amount is visible and marked, not summed.
    expect(screen.getByText("Unterlagen ohne Betrag")).toBeInTheDocument();
    expect(screen.getByText("No amount")).toBeInTheDocument();
    expect(screen.getByText("1 without amount")).toBeInTheDocument();

    // The typed group links into the explorer with its filters.
    const explorerLinks = screen.getAllByRole("link", { name: /open in explorer/i });
    expect(explorerLinks.length).toBe(1);
    const href = explorerLinks[0]!.getAttribute("href") ?? "";
    expect(href).toContain("/documents");
    expect(href).toContain("year=2025");
    expect(href).toContain(TAX_TYPE_ID);
  });

  it("switches the year via the picker and shows an honest empty state", async () => {
    mockShellEndpoints();
    server.use(
      http.get(apiUrl("/api/taxes/:year"), ({ params }) => {
        const year = Number(params.year);
        return HttpResponse.json(
          year === 2025 ? makeTaxYearResponse(year) : makeEmptyTaxYearResponse(year),
        );
      }),
    );

    const { user } = renderAuthenticatedApp({ route: "/taxes?year=2025" });

    expect(await screen.findByText("Steuerbescheid 2025")).toBeInTheDocument();

    const picker = screen.getByLabelText(/year/i);
    await user.selectOptions(picker, "2024");

    await waitFor(() => {
      expect(screen.getByText(/nothing is filed under tax year 2024/i)).toBeInTheDocument();
    });
    expect(screen.queryByText("Steuerbescheid 2025")).not.toBeInTheDocument();
  });
});
