import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { apiUrl } from "./api-url";
import { renderApp } from "./render-app";
import {
  makeHealthResponse,
  makeSearchDocumentsResponse,
  makeUser,
  makeDocument,
} from "./fixtures";
import { server } from "./msw-server";

function mockDashboardData() {
  server.use(
    http.get(apiUrl("/api/documents"), () =>
      HttpResponse.json(makeSearchDocumentsResponse([makeDocument()])),
    ),
    http.get(apiUrl("/api/documents/review"), () =>
      HttpResponse.json(
        makeSearchDocumentsResponse([
          makeDocument({
            id: "99999999-9999-9999-9999-999999999999",
            reviewStatus: "pending",
            reviewReasons: ["low_confidence"],
          }),
        ]),
      ),
    ),
    http.get(apiUrl("/api/documents/facets"), () =>
      HttpResponse.json({
        years: [{ year: 2026, count: 1 }],
        correspondents: [{ id: "c1", name: "Acme Corp", count: 1 }],
        documentTypes: [{ id: "d1", name: "Invoice", count: 1 }],
        tags: [],
      }),
    ),
  );
}

describe("auth smoke", () => {
  it("redirects unauthenticated users to /login", async () => {
    server.use(
      http.get(apiUrl("/api/health"), () => HttpResponse.json(makeHealthResponse())),
      http.get(apiUrl("/api/documents"), () =>
        HttpResponse.json(makeSearchDocumentsResponse([])),
      ),
      http.get(apiUrl("/api/documents/review"), () =>
        HttpResponse.json(makeSearchDocumentsResponse([])),
      ),
      http.get(apiUrl("/api/documents/facets"), () =>
        HttpResponse.json({
          years: [],
          correspondents: [],
          documentTypes: [],
          tags: [],
        }),
      ),
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
      await screen.findByText("Your document archive at a glance"),
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
      await screen.findByText("Your document archive at a glance"),
    ).toBeInTheDocument();
    expect(screen.getByText("Pending Review")).toBeInTheDocument();
    expect(screen.queryByText("Sign in to your document archive")).not.toBeInTheDocument();
  });

  it("clears stored tokens and returns to the login flow when refresh fails", async () => {
    server.use(
      http.get(apiUrl("/api/health"), () => HttpResponse.json(makeHealthResponse())),
      http.get(apiUrl("/api/auth/me"), () => new HttpResponse(null, { status: 401 })),
      http.post(apiUrl("/api/auth/refresh"), () => new HttpResponse(null, { status: 401 })),
      http.get(apiUrl("/api/documents"), () =>
        HttpResponse.json(makeSearchDocumentsResponse([])),
      ),
      http.get(apiUrl("/api/documents/review"), () =>
        HttpResponse.json(makeSearchDocumentsResponse([])),
      ),
      http.get(apiUrl("/api/documents/facets"), () =>
        HttpResponse.json({
          years: [],
          correspondents: [],
          documentTypes: [],
          tags: [],
        }),
      ),
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
