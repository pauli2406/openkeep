import { screen, waitFor } from "@testing-library/react";
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
            {
              id: "33333333-3333-3333-3333-333333333333",
              name: "TK",
              slug: "tk",
              documentCount: 7,
              totalAmount: 420,
              currency: "EUR",
              latestDocDate: "2026-03-14",
              documentTypes: [{ name: "Insurance", count: 7 }],
            },
            {
              id: "44444444-4444-4444-4444-444444444444",
              name: "Concordia",
              slug: "concordia",
              documentCount: 5,
              totalAmount: 99,
              currency: "EUR",
              latestDocDate: "2026-03-10",
              documentTypes: [{ name: "Letter", count: 5 }],
            },
            {
              id: "55555555-5555-5555-5555-555555555555",
              name: "Hamburg Wasser",
              slug: "hamburg-wasser",
              documentCount: 4,
              totalAmount: 88,
              currency: "EUR",
              latestDocDate: "2026-03-09",
              documentTypes: [{ name: "Utility Bill", count: 4 }],
            },
            {
              id: "66666666-6666-6666-6666-666666666666",
              name: "Should Not Render",
              slug: "should-not-render",
              documentCount: 3,
              totalAmount: 10,
              currency: "EUR",
              latestDocDate: "2026-03-01",
              documentTypes: [{ name: "Other", count: 3 }],
            },
          ],
          upcomingDeadlines: [
            {
              documentId: "11111111-1111-1111-1111-111111111111",
              title: "Invoice #389",
              referenceNumber: "INV-389",
              dueDate: "2026-03-31",
              amount: 149.99,
              currency: "EUR",
              correspondentName: "Adidas",
              documentTypeName: "Invoice",
              taskLabel: "Pay",
              daysUntilDue: 9,
              isOverdue: false,
              taskCompletedAt: null,
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
    expect(screen.getAllByText("Adidas").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Invoice #389 (INV-389)")).toBeInTheDocument();
    expect(screen.getByText("What to do")).toBeInTheDocument();
    expect(screen.getByText("Pay")).toBeInTheDocument();
    expect(screen.getByText("Hamburg Wasser")).toBeInTheDocument();
    expect(screen.queryByText("Should Not Render")).not.toBeInTheDocument();
    expect(screen.getAllByText("24").length).toBeGreaterThanOrEqual(1);
  });

  it("marks a dashboard task as done and refreshes the list", async () => {
    let completed = false;

    server.use(
      http.get(apiUrl("/api/dashboard/insights"), () =>
        HttpResponse.json({
          stats: {
            totalDocuments: 4,
            pendingReview: 0,
            documentTypesCount: 2,
            correspondentsCount: 2,
          },
          topCorrespondents: [],
          upcomingDeadlines: completed
            ? []
            : [
                {
                  documentId: "11111111-1111-1111-1111-111111111111",
                  title: "Invoice #389",
                  referenceNumber: "INV-389",
                  dueDate: "2026-03-31",
                  amount: 149.99,
                  currency: "EUR",
                  correspondentName: "Adidas",
                  documentTypeName: "Invoice",
                  taskLabel: "Pay",
                  daysUntilDue: 9,
                  isOverdue: false,
                  taskCompletedAt: null,
                },
              ],
          overdueItems: [],
          recentDocuments: [],
          monthlyActivity: [{ month: "2026-03", count: 4 }],
        }),
      ),
      http.patch(apiUrl("/api/documents/:id"), async ({ request, params }) => {
        expect(params.id).toBe("11111111-1111-1111-1111-111111111111");
        const body = (await request.json()) as { taskCompletedAt?: string };
        expect(typeof body.taskCompletedAt).toBe("string");
        completed = true;
        return HttpResponse.json(makeDocument({ taskCompletedAt: body.taskCompletedAt ?? null }));
      }),
    );

    const { user } = renderAuthenticatedApp({ route: "/" });

    expect(await screen.findByText("Invoice #389 (INV-389)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /done/i }));

    await waitFor(() => {
      expect(screen.getByText("No tasks in view")).toBeInTheDocument();
    });
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

    expect(await screen.findByText("No tasks in view")).toBeInTheDocument();
  });
});
