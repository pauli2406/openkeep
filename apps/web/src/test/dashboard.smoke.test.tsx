import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { apiUrl } from "./api-url";
import { renderAuthenticatedApp } from "./render-app";
import { makeDocument, makeSearchDocumentsResponse } from "./fixtures";
import { server } from "./msw-server";

// Today derives its queue from the documents endpoint sorted by due date;
// insights only feeds the top-bar counts.
function mockInsights() {
  server.use(
    http.get(apiUrl("/api/dashboard/insights"), () =>
      HttpResponse.json({
        stats: {
          totalDocuments: 2,
          pendingReview: 1,
          documentTypesCount: 1,
          correspondentsCount: 1,
        },
        topCorrespondents: [],
        upcomingDeadlines: [],
        overdueItems: [],
        recentDocuments: [],
        monthlyActivity: [{ month: "2026-03", count: 2 }],
      }),
    ),
  );
}

describe("dashboard smoke", () => {
  it("renders the Today queue from the documents endpoint", async () => {
    const seenSortParams: Array<string | null> = [];
    mockInsights();
    server.use(
      http.get(apiUrl("/api/documents"), ({ request }) => {
        seenSortParams.push(new URL(request.url).searchParams.get("sort"));
        return HttpResponse.json(
          makeSearchDocumentsResponse([
            makeDocument({ title: "Invoice #389", dueDate: "2026-03-31" }),
            makeDocument({
              id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
              title: "Insurance Policy",
              dueDate: "2026-04-05",
            }),
          ]),
        );
      }),
      http.get(apiUrl("/api/documents/:id"), () =>
        HttpResponse.json(makeDocument({ title: "Invoice #389" })),
      ),
      http.get(apiUrl("/api/documents/:id/download"), () =>
        HttpResponse.json({ message: "no preview" }, { status: 404 }),
      ),
    );

    renderAuthenticatedApp({ route: "/" });

    expect(await screen.findByText("Invoice #389")).toBeInTheDocument();
    expect(screen.getByText("Insurance Policy")).toBeInTheDocument();
    // the filter strip and count
    expect(screen.getByText("Open tasks")).toBeInTheDocument();
    expect(screen.getByText(/sorted by/i)).toBeInTheDocument();
    // the task column derives Pay from the Invoice type
    expect(screen.getAllByText(/^pay/i).length).toBeGreaterThanOrEqual(1);
    // the queue is fetched sorted by due date
    expect(seenSortParams).toContain("dueDate");
  });

  it("confirms a task from the preview rail and refreshes the queue", async () => {
    let completed = false;

    mockInsights();
    server.use(
      http.get(apiUrl("/api/documents"), () =>
        HttpResponse.json(
          makeSearchDocumentsResponse(
            completed
              ? []
              : [makeDocument({ title: "Invoice #389", dueDate: "2026-03-31" })],
          ),
        ),
      ),
      http.get(apiUrl("/api/documents/:id"), () =>
        HttpResponse.json(makeDocument({ title: "Invoice #389" })),
      ),
      http.get(apiUrl("/api/documents/:id/download"), () =>
        HttpResponse.json({ message: "no preview" }, { status: 404 }),
      ),
      http.patch(apiUrl("/api/documents/:id"), async ({ request, params }) => {
        expect(params.id).toBe("11111111-1111-1111-1111-111111111111");
        const body = (await request.json()) as { taskCompletedAt?: string };
        expect(typeof body.taskCompletedAt).toBe("string");
        completed = true;
        return HttpResponse.json(
          makeDocument({ taskCompletedAt: body.taskCompletedAt ?? null }),
        );
      }),
    );

    const { user } = renderAuthenticatedApp({ route: "/" });

    expect(await screen.findByText("Invoice #389")).toBeInTheDocument();

    await user.click(
      await screen.findByRole("button", { name: /confirm and file/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("Nothing needs you right now"),
      ).toBeInTheDocument();
    });
  });

  it("shows an error state and retries successfully", async () => {
    let shouldFail = true;

    mockInsights();
    server.use(
      http.get(apiUrl("/api/documents"), () => {
        if (shouldFail) {
          return HttpResponse.json({ message: "failed" }, { status: 500 });
        }
        return HttpResponse.json(makeSearchDocumentsResponse([]));
      }),
    );

    const { user } = renderAuthenticatedApp({ route: "/" });

    expect(
      await screen.findByText("Failed to load dashboard insights. Please try again."),
    ).toBeInTheDocument();

    shouldFail = false;
    await user.click(screen.getByRole("button", { name: /retry/i }));

    expect(
      await screen.findByText("Nothing needs you right now"),
    ).toBeInTheDocument();
  });
});
