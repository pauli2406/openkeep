import { screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { apiUrl } from "./api-url";
import { renderAuthenticatedApp } from "./render-app";
import { makeDocument } from "./fixtures";
import { server } from "./msw-server";

describe("dashboard smoke", () => {
  it("renders the dashboard widgets from the insights endpoint", async () => {
    server.use(
      http.get(apiUrl("/api/dashboard/insights"), () =>
        HttpResponse.json({
          stats: {
            totalDocuments: 24,
            pendingReview: 3,
            documentTypesCount: 6,
            correspondentsCount: 8,
          },
          topCorrespondents: [
            {
              id: "22222222-2222-2222-2222-222222222222",
              name: "Adidas",
              slug: "adidas",
              documentCount: 12,
              totalAmount: 3240,
              currency: "EUR",
              latestDocDate: "2026-03-15",
              documentTypes: [
                { name: "Invoice", count: 8 },
                { name: "Receipt", count: 4 },
              ],
            },
          ],
          upcomingDeadlines: [
            {
              documentId: "11111111-1111-1111-1111-111111111111",
              title: "Invoice #389",
              dueDate: "2026-03-31",
              amount: 149.99,
              currency: "EUR",
              correspondentName: "Adidas",
              daysUntilDue: 9,
              isOverdue: false,
            },
          ],
          overdueItems: [],
          recentDocuments: [
            makeDocument({ title: "March Invoice" }),
            makeDocument({
              id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
              title: "Insurance Policy",
            }),
          ],
          monthlyActivity: [
            { month: "2026-02", count: 8 },
            { month: "2026-03", count: 12 },
          ],
        }),
      ),
    );

    renderAuthenticatedApp({ route: "/" });

    expect(await screen.findByRole("heading", { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByText("Adidas")).toBeInTheDocument();
    expect(screen.getByText("Invoice #389")).toBeInTheDocument();
    expect(screen.getByText("March Invoice")).toBeInTheDocument();
    expect(screen.getAllByText("24").length).toBeGreaterThanOrEqual(1);
  });

  it("shows an error state and retries successfully", async () => {
    let shouldFail = true;

    server.use(
      http.get(apiUrl("/api/dashboard/insights"), () => {
        if (shouldFail) {
          return HttpResponse.json({ message: "Dashboard failed" }, { status: 500 });
        }

        return HttpResponse.json({
          stats: {
            totalDocuments: 1,
            pendingReview: 0,
            documentTypesCount: 1,
            correspondentsCount: 1,
          },
          topCorrespondents: [],
          upcomingDeadlines: [],
          overdueItems: [],
          recentDocuments: [makeDocument({ title: "Recovered Document" })],
          monthlyActivity: [{ month: "2026-03", count: 1 }],
        });
      }),
    );

    const { user } = renderAuthenticatedApp({ route: "/" });

    expect(
      await screen.findByText("Failed to load dashboard insights. Please try again."),
    ).toBeInTheDocument();

    shouldFail = false;
    await user.click(screen.getByRole("button", { name: /retry/i }));

    expect(await screen.findByText("Recovered Document")).toBeInTheDocument();
  });
});
