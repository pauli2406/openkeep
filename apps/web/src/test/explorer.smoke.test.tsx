import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { apiUrl } from "./api-url";
import { renderAuthenticatedApp } from "./render-app";
import { makeDocument } from "./fixtures";
import { server } from "./msw-server";

describe("explorer smoke", () => {
  it("renders the documents explorer with list and facet sidebar", async () => {
    server.use(
      http.get(apiUrl("/api/documents/facets"), () =>
        HttpResponse.json({
          years: [{ year: 2026, count: 2 }],
          correspondents: [
            {
              id: "22222222-2222-2222-2222-222222222222",
              name: "Adidas",
              slug: "adidas",
              count: 2,
            },
          ],
          documentTypes: [
            {
              id: "33333333-3333-3333-3333-333333333333",
              name: "Invoice",
              slug: "invoice",
              count: 2,
            },
          ],
          tags: [],
          amountRange: { min: 10, max: 200 },
          statuses: [{ status: "ready", count: 2 }],
        }),
      ),
      http.get(apiUrl("/api/documents"), () =>
        HttpResponse.json({
          items: [
            makeDocument({ title: "Adidas Invoice March" }),
            makeDocument({
              id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
              title: "Adidas Receipt February",
            }),
          ],
          total: 2,
          page: 1,
          pageSize: 20,
          appliedFilters: {},
        }),
      ),
    );

    renderAuthenticatedApp({ route: "/documents" });

    expect(await screen.findByRole("heading", { name: /documents/i })).toBeInTheDocument();
    expect(screen.getByText("Explorer Filters")).toBeInTheDocument();
    expect(await screen.findByText("Adidas Invoice March")).toBeInTheDocument();
    expect(screen.getByText("Adidas")).toBeInTheDocument();
  });

  it("renders the correspondent detail page and polls pending summaries", async () => {
    let hits = 0;

    server.use(
      http.get(apiUrl("/api/correspondents/adidas/insights"), () => {
        hits += 1;
        return HttpResponse.json({
          correspondent: {
            id: "22222222-2222-2222-2222-222222222222",
            name: "Adidas",
            slug: "adidas",
            summaryGeneratedAt: null,
          },
          summaryStatus: hits > 1 ? "ready" : "pending",
          summary:
            hits > 1
              ? "Adidas is a recurring retailer in your archive."
              : null,
          stats: {
            documentCount: 2,
            totalAmount: 239.49,
            currency: "EUR",
            dateRange: { from: "2026-02-18", to: "2026-03-10" },
            avgConfidence: 0.92,
          },
          documentTypeBreakdown: [{ name: "Invoice", count: 2 }],
          timeline: [{ month: "2026-03", count: 2 }],
          recentDocuments: [],
          upcomingDeadlines: [],
        });
      }),
      http.get(apiUrl("/api/documents"), () =>
        HttpResponse.json({
          items: [makeDocument({ title: "Adidas Invoice March" })],
          total: 1,
          page: 1,
          pageSize: 20,
          appliedFilters: {},
        }),
      ),
    );

    renderAuthenticatedApp({ route: "/correspondents/adidas" });

    expect(await screen.findByRole("heading", { name: /^adidas$/i })).toBeInTheDocument();
    expect(
      await screen.findByText(/summary generation is in progress/i),
    ).toBeInTheDocument();
  });

  it("renders timeline buckets even when the API returns an invalid month", async () => {
    server.use(
      http.get(apiUrl("/api/documents/facets"), () =>
        HttpResponse.json({
          years: [{ year: 2026, count: 1 }],
          correspondents: [],
          documentTypes: [],
          tags: [],
          amountRange: { min: null, max: null },
          statuses: [],
        }),
      ),
      http.get(apiUrl("/api/documents/timeline"), () =>
        HttpResponse.json({
          years: [
            {
              year: 2026,
              count: 1,
              months: [
                {
                  month: 13,
                  count: 1,
                  topCorrespondents: ["Adidas"],
                  topTypes: ["Invoice"],
                },
              ],
            },
          ],
        }),
      ),
    );

    renderAuthenticatedApp({ route: "/documents?view=timeline" });

    expect(await screen.findByRole("heading", { name: /documents/i })).toBeInTheDocument();
    expect(await screen.findByText("Unknown month")).toBeInTheDocument();
    expect(screen.getAllByText("1 docs")).toHaveLength(2);
  });

  it("supports selecting multiple documents and deleting them in batch", async () => {
    let documents = [
      makeDocument({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", title: "Adidas Invoice March" }),
      makeDocument({
        id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        title: "Adidas Receipt February",
      }),
      makeDocument({
        id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        title: "Archive Export",
      }),
    ];

    server.use(
      http.get(apiUrl("/api/documents/facets"), () =>
        HttpResponse.json({
          years: [{ year: 2026, count: documents.length }],
          correspondents: [
            {
              id: "22222222-2222-2222-2222-222222222222",
              name: "Adidas",
              slug: "adidas",
              count: 2,
            },
          ],
          documentTypes: [
            {
              id: "33333333-3333-3333-3333-333333333333",
              name: "Invoice",
              slug: "invoice",
              count: 2,
            },
          ],
          tags: [],
          amountRange: { min: 10, max: 200 },
          statuses: [{ status: "ready", count: documents.length }],
        }),
      ),
      http.get(apiUrl("/api/documents"), () =>
        HttpResponse.json({
          items: documents,
          total: documents.length,
          page: 1,
          pageSize: 20,
          appliedFilters: {},
        }),
      ),
      http.delete(apiUrl("/api/documents/:id"), ({ params }) => {
        documents = documents.filter((document) => document.id !== params.id);
        return HttpResponse.json({ deleted: true });
      }),
    );

    const { user } = renderAuthenticatedApp({ route: "/documents" });

    expect(await screen.findByText("Adidas Invoice March")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /select multiple/i }));
    await user.click(screen.getByRole("button", { name: /select adidas invoice march/i }));
    await user.click(screen.getByRole("button", { name: /select adidas receipt february/i }));

    expect(screen.getByText("2 selected across the current list")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /delete selected/i }));
    expect(
      await screen.findByRole("heading", { name: /delete 2 documents/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /delete now/i }));

    await waitFor(() => {
      expect(screen.queryByText("Adidas Invoice March")).not.toBeInTheDocument();
      expect(screen.queryByText("Adidas Receipt February")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Archive Export")).toBeInTheDocument();
  });
});
