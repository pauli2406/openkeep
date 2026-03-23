import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { apiUrl } from "./api-url";
import { renderApp } from "./render-app";
import {
  makeHealthResponse,
  makeUser,
  makeDocument,
} from "./fixtures";
import { server } from "./msw-server";

function mockDashboardData() {
  server.use(
    http.get(apiUrl("/api/dashboard/insights"), () =>
      HttpResponse.json(
        {
          stats: {
            totalDocuments: 1,
            pendingReview: 1,
            documentTypesCount: 1,
            correspondentsCount: 1,
          },
          topCorrespondents: [
            {
              id: "22222222-2222-2222-2222-222222222222",
              name: "Acme Corp",
              slug: "acme-corp",
              documentCount: 1,
              totalAmount: 123.45,
              currency: "EUR",
              latestDocDate: "2026-03-20",
              documentTypes: [{ name: "Invoice", count: 1 }],
            },
          ],
          upcomingDeadlines: [
            {
              documentId: "11111111-1111-1111-1111-111111111111",
              title: "March Invoice",
              dueDate: "2026-03-31",
              amount: 123.45,
              currency: "EUR",
              correspondentName: "Acme Corp",
              daysUntilDue: 9,
              isOverdue: false,
            },
          ],
          overdueItems: [],
          recentDocuments: [makeDocument()],
          monthlyActivity: [{ month: "2026-03", count: 1 }],
        },
      ),
    ),
  );
}

describe("auth smoke", () => {
  it("redirects unauthenticated users to /login", async () => {
    server.use(
      http.get(apiUrl("/api/health"), () => HttpResponse.json(makeHealthResponse())),
    );

    renderApp({ route: "/" });

    expect(
      await screen.findByText("Sign in to your document archive"),
    ).toBeInTheDocument();
  });

  it("logs in successfully, stores tokens, and lands on the dashboard", async () => {
    server.use(
      http.get(apiUrl("/api/health"), () => HttpResponse.json(makeHealthResponse())),
      http.post(apiUrl("/api/auth/login"), async ({ request }) => {
        const body = (await request.json()) as { email: string; password: string };
        expect(body.email).toBe("owner@example.com");
        expect(body.password).toBe("super-secret-pass");

        return HttpResponse.json({
          accessToken: "access-token",
          refreshToken: "refresh-token",
        });
      }),
      http.get(apiUrl("/api/auth/me"), () => HttpResponse.json(makeUser())),
    );
    mockDashboardData();

    const { user } = renderApp({ route: "/login" });

    await user.type(
      await screen.findByLabelText(/^email$/i),
      "owner@example.com",
    );
    await user.type(
      screen.getByLabelText(/^password$/i),
      "super-secret-pass",
    );
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(
      await screen.findByText(/a high-level reading room for your archive/i),
    ).toBeInTheDocument();
    expect(localStorage.getItem("openkeep.access-token")).toBe("access-token");
    expect(localStorage.getItem("openkeep.refresh-token")).toBe("refresh-token");
  });

  it("restores an existing session from stored tokens on boot", async () => {
    server.use(
      http.get(apiUrl("/api/health"), () => HttpResponse.json(makeHealthResponse())),
      http.get(apiUrl("/api/auth/me"), () => HttpResponse.json(makeUser())),
    );
    mockDashboardData();

    renderApp({
      route: "/",
      accessToken: "saved-access-token",
      refreshToken: "saved-refresh-token",
    });

    expect(
      await screen.findByText(/a high-level reading room for your archive/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Upcoming tasks")).toBeInTheDocument();
    expect(screen.queryByText("Sign in to your document archive")).not.toBeInTheDocument();
  });

  it("clears stored tokens and returns to the login flow when refresh fails", async () => {
    server.use(
      http.get(apiUrl("/api/health"), () => HttpResponse.json(makeHealthResponse())),
      http.get(apiUrl("/api/auth/me"), () => new HttpResponse(null, { status: 401 })),
      http.post(apiUrl("/api/auth/refresh"), () => new HttpResponse(null, { status: 401 })),
    );

    renderApp({
      route: "/",
      accessToken: "expired-access-token",
      refreshToken: "expired-refresh-token",
    });

    expect(
      await screen.findByText("Sign in to your document archive"),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(localStorage.getItem("openkeep.access-token")).toBeNull();
      expect(localStorage.getItem("openkeep.refresh-token")).toBeNull();
    });
  });
});
