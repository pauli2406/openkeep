import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { apiUrl } from "./api-url";
import { renderAuthenticatedApp } from "./render-app";
import { makeDocument, makeSearchDocumentsResponse } from "./fixtures";
import { server } from "./msw-server";

describe("dashboard smoke", () => {
  it("renders recent documents, facet counts, and pending review count", async () => {
    let documentsHits = 0;
    let reviewHits = 0;
    let facetsHits = 0;

    server.use(
      http.get(apiUrl("/api/documents"), () => {
        documentsHits += 1;
        return HttpResponse.json(
          makeSearchDocumentsResponse([
            makeDocument({ title: "March Invoice" }),
            makeDocument({
              id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
              title: "Insurance Policy",
            }),
          ]),
        );
      }),
      http.get(apiUrl("/api/documents/review"), () => {
        reviewHits += 1;
        return HttpResponse.json(
          makeSearchDocumentsResponse([
            makeDocument({
              id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
              reviewStatus: "pending",
              reviewReasons: ["low_confidence"],
            }),
          ]),
        );
      }),
      http.get(apiUrl("/api/documents/facets"), () => {
        facetsHits += 1;
        return HttpResponse.json({
          years: [{ year: 2026, count: 2 }],
          correspondents: [
            { id: "1", name: "Acme Corp", count: 1 },
            { id: "2", name: "Insure Co", count: 1 },
          ],
          documentTypes: [
            { id: "1", name: "Invoice", count: 1 },
            { id: "2", name: "Policy", count: 1 },
          ],
          tags: [],
        });
      }),
    );

    renderAuthenticatedApp({
      route: "/",
    });

    await waitFor(() => {
      expect(documentsHits).toBeGreaterThan(0);
      expect(reviewHits).toBeGreaterThan(0);
      expect(facetsHits).toBeGreaterThan(0);
    });

    expect(
      await screen.findByRole("heading", { name: /dashboard/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("March Invoice")).toBeInTheDocument();
    expect(screen.getByText("Insurance Policy")).toBeInTheDocument();
    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(1);
  });

  it("shows an error state and retries successfully", async () => {
    let documentsShouldFail = true;

    server.use(
      http.get(apiUrl("/api/documents"), () => {
        if (documentsShouldFail) {
          return HttpResponse.json(
            { message: "Dashboard failed" },
            { status: 500 },
          );
        }

        return HttpResponse.json(
          makeSearchDocumentsResponse([makeDocument({ title: "Recovered Document" })]),
        );
      }),
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

    const { user } = renderAuthenticatedApp({
      route: "/",
    });

    expect(
      await screen.findByText("Failed to load dashboard data. Please try again."),
    ).toBeInTheDocument();

    documentsShouldFail = false;
    await user.click(screen.getByRole("button", { name: /retry/i }));

    expect(await screen.findByText("Recovered Document")).toBeInTheDocument();
  });
});
