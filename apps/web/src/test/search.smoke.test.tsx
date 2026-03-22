import { screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { apiUrl } from "./api-url";
import {
  makeDocument,
  makeSemanticSearchResponse,
} from "./fixtures";
import { renderAuthenticatedApp } from "./render-app";
import { server } from "./msw-server";

describe("search smoke", () => {
  it("renders grounded answer results with citations", async () => {
    server.use(
      http.post(apiUrl("/api/search/answer"), async ({ request }) => {
        const body = (await request.json()) as { query: string };
        expect(body).toEqual({
          query: "When is the invoice due?",
          maxDocuments: 3,
          maxCitations: 4,
          maxChunkMatches: 4,
        });

        return HttpResponse.json({
          status: "answered",
          answer: "The invoice is due on March 31, 2026.",
          reasoning: "Matched invoice due date fields in the top ranked document.",
          citations: [
            {
              documentId: "11111111-1111-1111-1111-111111111111",
              documentTitle: "March Invoice",
              chunkIndex: 0,
              pageFrom: 1,
              pageTo: 1,
              quote: "Due date: 2026-03-31",
              score: 0.96,
            },
          ],
          results: [
            {
              document: makeDocument(),
              score: 0.96,
              semanticScore: 0.91,
              keywordScore: 0.88,
              matchedChunks: [
                {
                  chunkIndex: 0,
                  heading: "Payment details",
                  text: "Due date: 2026-03-31",
                  pageFrom: 1,
                  pageTo: 1,
                  score: 0.96,
                  distance: 0.04,
                },
              ],
            },
          ],
        });
      }),
    );

    renderAuthenticatedApp({
      route: "/search?mode=answer&q=When%20is%20the%20invoice%20due%3F",
    });

    expect(
      await screen.findByRole("heading", { name: /search/i }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Document Answer")).toBeInTheDocument();
    expect(
      screen.getByText("The invoice is due on March 31, 2026."),
    ).toBeInTheDocument();
    expect(screen.getByText("Citations")).toBeInTheDocument();
    expect(screen.getAllByText("Due date: 2026-03-31").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Supporting Documents")).toBeInTheDocument();
  });

  it("renders semantic search results with scores and matched chunks", async () => {
    server.use(
      http.post(apiUrl("/api/search/semantic"), async ({ request }) => {
        const body = (await request.json()) as { query: string };
        expect(body).toEqual({
          query: "professional services",
          page: 1,
          pageSize: 20,
          maxChunkMatches: 3,
        });

        return HttpResponse.json(
          makeSemanticSearchResponse({
            items: [
              {
                document: makeDocument({ title: "March Invoice" }),
                score: 0.88,
                semanticScore: 0.92,
                keywordScore: 0.75,
                matchedChunks: [
                  {
                    chunkIndex: 0,
                    heading: "Summary",
                    text: "Professional services rendered in March.",
                    pageFrom: 1,
                    pageTo: 1,
                    score: 0.92,
                    distance: 0.08,
                  },
                ],
              },
              {
                document: makeDocument({
                  id: "22222222-2222-2222-2222-222222222222",
                  title: "Consulting Agreement",
                }),
                score: 0.72,
                semanticScore: 0.68,
                keywordScore: null,
                matchedChunks: [
                  {
                    chunkIndex: 1,
                    heading: "Scope",
                    text: "Consulting and advisory services.",
                    pageFrom: 2,
                    pageTo: 2,
                    score: 0.68,
                    distance: 0.32,
                  },
                ],
              },
            ],
            total: 2,
          }),
        );
      }),
    );

    renderAuthenticatedApp({
      route: "/search?mode=semantic&q=professional%20services",
    });

    expect(
      await screen.findByRole("heading", { name: /search/i }),
    ).toBeInTheDocument();

    // Should display both results
    expect(await screen.findByText("March Invoice")).toBeInTheDocument();
    expect(screen.getByText("Consulting Agreement")).toBeInTheDocument();
    expect(screen.getByText("2 results found")).toBeInTheDocument();

    // Should show combined scores
    expect(screen.getByText("Score: 88%")).toBeInTheDocument();
    expect(screen.getByText("Score: 72%")).toBeInTheDocument();

    // Should show semantic scores
    expect(screen.getByText("Semantic: 92%")).toBeInTheDocument();
    expect(screen.getByText("Semantic: 68%")).toBeInTheDocument();

    // Should show matched chunk text
    expect(
      screen.getByText("Professional services rendered in March."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Consulting and advisory services."),
    ).toBeInTheDocument();
  });

  it("shows insufficient evidence fallback for unanswerable queries", async () => {
    server.use(
      http.post(apiUrl("/api/search/answer"), () =>
        HttpResponse.json({
          status: "insufficient_evidence",
          answer: null,
          reasoning: null,
          citations: [],
          results: [],
        }),
      ),
    );

    renderAuthenticatedApp({
      route: "/search?mode=answer&q=What%20is%20the%20meaning%20of%20life%3F",
    });

    expect(
      await screen.findByText(
        /not enough grounded evidence to answer confidently/i,
      ),
    ).toBeInTheDocument();
  });
});
