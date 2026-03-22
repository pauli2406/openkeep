import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { apiUrl } from "./api-url";
import { renderAuthenticatedApp } from "./render-app";
import {
  makeDocument,
  makeHealthResponse,
  makeProcessingStatusResponse,
  makeReadinessResponse,
  makeSearchDocumentsResponse,
} from "./fixtures";
import { server } from "./msw-server";

describe("review smoke", () => {
  it("renders the review queue and sends resolve/requeue actions through typed endpoints", async () => {
    const resolveCalls: unknown[] = [];
    const requeueCalls: unknown[] = [];

    server.use(
      http.get(apiUrl("/api/documents/review"), () =>
        HttpResponse.json(
          makeSearchDocumentsResponse([
            makeDocument({
              id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
              title: "Review Invoice",
              reviewStatus: "pending",
              reviewReasons: ["low_confidence"],
            }),
            makeDocument({
              id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
              title: "Requeue Invoice",
              reviewStatus: "pending",
              reviewReasons: ["missing_key_fields"],
            }),
          ]),
        ),
      ),
      http.post(apiUrl("/api/documents/:id/review/resolve"), async ({ params, request }) => {
        resolveCalls.push({
          id: params.id,
          body: await request.json(),
        });

        return HttpResponse.json(
          makeDocument({
            id: params.id as string,
            reviewStatus: "resolved",
            reviewReasons: [],
          }),
        );
      }),
      http.post(apiUrl("/api/documents/:id/review/requeue"), async ({ params, request }) => {
        requeueCalls.push({
          id: params.id,
          body: await request.json(),
        });

        return HttpResponse.json({
          queued: true,
          documentId: params.id,
          processingJobId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        });
      }),
    );

    const { user } = renderAuthenticatedApp({
      route: "/review",
    });

    expect(
      await screen.findByRole("heading", { name: /review queue/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Review Invoice")).toBeInTheDocument();
    expect(screen.getByText("Requeue Invoice")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /^resolve$/i })[0]);
    await waitFor(() => {
      expect(resolveCalls).toEqual([
        { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", body: {} },
      ]);
    });

    await user.click(screen.getAllByRole("button", { name: /^requeue$/i })[1]);
    await waitFor(() => {
      expect(requeueCalls).toEqual([
        {
          id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          body: { force: true },
        },
      ]);
    });
  });
});

describe("settings smoke", () => {
  it("renders processing activity and system health data without raw object output", async () => {
    server.use(
      http.get(apiUrl("/api/health"), () => HttpResponse.json(makeHealthResponse())),
      http.get(apiUrl("/api/auth/tokens"), () => HttpResponse.json({ tokens: [] })),
      http.get(apiUrl("/api/health/status"), () =>
        HttpResponse.json(makeProcessingStatusResponse()),
      ),
      http.get(apiUrl("/api/health/ready"), () =>
        HttpResponse.json(makeReadinessResponse()),
      ),
    );

    renderAuthenticatedApp({
      route: "/settings",
    });

    expect(
      await screen.findByRole("heading", { name: /settings/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Processing Activity")).toBeInTheDocument();
    expect(screen.getByText("System Health")).toBeInTheDocument();
    expect(await screen.findByText("OCR Queue")).toBeInTheDocument();
    expect(await screen.findByText("Readiness Checks")).toBeInTheDocument();
    expect(screen.queryByText("[object Object]")).not.toBeInTheDocument();
  });

  it("shows a stable error state when processing status fails to load", async () => {
    server.use(
      http.get(apiUrl("/api/health"), () => HttpResponse.json(makeHealthResponse())),
      http.get(apiUrl("/api/auth/tokens"), () => HttpResponse.json({ tokens: [] })),
      http.get(apiUrl("/api/health/status"), () =>
        HttpResponse.json(
          { message: "Processing status failed" },
          { status: 500 },
        ),
      ),
      http.get(apiUrl("/api/health/ready"), () =>
        HttpResponse.json(makeReadinessResponse()),
      ),
    );

    renderAuthenticatedApp({
      route: "/settings",
    });

    expect(
      await screen.findByText("Failed to load processing status."),
    ).toBeInTheDocument();
  });
});
