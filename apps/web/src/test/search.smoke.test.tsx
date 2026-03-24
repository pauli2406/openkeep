import { screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { apiUrl } from "./api-url";
import {
  makeDocument,
  makeSemanticSearchResponse,
} from "./fixtures";
import { renderAuthenticatedApp } from "./render-app";
import { server } from "./msw-server";

describe("search smoke", () => {
  it("renders grounded answer results with citations", async () => {
    const originalFetch = globalThis.fetch;

    server.use(
      http.post(apiUrl("/api/search/semantic"), async ({ request }) => {
        const body = (await request.json()) as { query: string };
        expect(body).toEqual({
          query: "When is the invoice due?",
          page: 1,
          pageSize: 20,
          maxChunkMatches: 6,
        });

        return HttpResponse.json(
          makeSemanticSearchResponse({
            items: [
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
            total: 1,
          }),
        );
      }),
    );

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === apiUrl("/api/search/answer/stream")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          query: "When is the invoice due?",
          maxDocuments: 5,
          maxCitations: 6,
          maxChunkMatches: 6,
        });

        return Promise.resolve(
          new Response(
            [
              'event: search-results\n',
              `data: ${JSON.stringify({
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
              })}\n\n`,
              'event: answer-token\n',
              `data: ${JSON.stringify({ text: "The invoice is due on March 31, 2026." })}\n\n`,
              'event: done\n',
              `data: ${JSON.stringify({
                fullAnswer: "The invoice is due on March 31, 2026.",
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
              })}\n\n`,
            ].join(""),
            {
              headers: { "Content-Type": "text/event-stream" },
            },
          ),
        );
      }

      return originalFetch(input, init);
    });

    const { user } = renderAuthenticatedApp({
      route: "/search?mode=answer&q=When%20is%20the%20invoice%20due%3F",
    });

    expect(
      await screen.findByRole("heading", { name: /search/i }),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /ai answer/i }));
    await screen.findByText("Answer ready", {}, { timeout: 3000 });
    expect(
      screen.getByText("Sources"),
    ).toBeInTheDocument();
    expect(screen.getByText("The invoice is due on March 31, 2026.")).toBeInTheDocument();
    expect(screen.getAllByText("Due date: 2026-03-31").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/1 result/i)).toBeInTheDocument();
  });

  it("renders semantic search results with scores and matched chunks", async () => {
    server.use(
      http.post(apiUrl("/api/search/semantic"), async ({ request }) => {
        const body = (await request.json()) as { query: string };
        expect(body).toEqual({
          query: "professional services",
          page: 1,
          pageSize: 20,
          maxChunkMatches: 6,
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

    const { user } = renderAuthenticatedApp({
      route: "/search?mode=semantic&q=professional%20services",
    });

    expect(
      await screen.findByRole("heading", { name: /search/i }),
    ).toBeInTheDocument();

    // Should display both results
    expect(await screen.findByText("March Invoice")).toBeInTheDocument();
    expect(screen.getByText("Consulting Agreement")).toBeInTheDocument();
    expect(screen.getByText("2 results")).toBeInTheDocument();

    // Semantic score badges should be visible
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(screen.getByText("68%")).toBeInTheDocument();

    // Matched chunks are collapsed by default and can be expanded
    const excerptButtons = screen.getAllByRole("button", { name: /1 matched excerpt/i });
    await user.click(excerptButtons[0]!);
    await user.click(excerptButtons[1]!);

    expect(
      screen.getByText("Professional services rendered in March."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Consulting and advisory services."),
    ).toBeInTheDocument();
  });

  it("shows insufficient evidence fallback for unanswerable queries", async () => {
    const originalFetch = globalThis.fetch;

    server.use(
      http.post(apiUrl("/api/search/semantic"), async ({ request }) => {
        const body = (await request.json()) as { query: string };
        expect(body).toEqual({
          query: "What is the meaning of life?",
          page: 1,
          pageSize: 20,
          maxChunkMatches: 6,
        });
        return HttpResponse.json(makeSemanticSearchResponse({ items: [], total: 0 }));
      }),
    );

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === apiUrl("/api/search/answer/stream")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          query: "What is the meaning of life?",
          maxDocuments: 5,
          maxCitations: 6,
          maxChunkMatches: 6,
        });

        return Promise.resolve(
          new Response(
            [
              'event: search-results\n',
              `data: ${JSON.stringify({ results: [] })}\n\n`,
              'event: done\n',
              `data: ${JSON.stringify({ fullAnswer: "", citations: [] })}\n\n`,
            ].join(""),
            {
              headers: { "Content-Type": "text/event-stream" },
            },
          ),
        );
      }

      return originalFetch(input, init);
    });

    const { user } = renderAuthenticatedApp({
      route: "/search?mode=answer&q=What%20is%20the%20meaning%20of%20life%3F",
    });

    await user.click(await screen.findByRole("button", { name: /ai answer/i }));
    await screen.findByText("Answer ready", {}, { timeout: 3000 });

    expect(
      screen.getByText(
        /Not enough evidence in your archive to answer this question confidently\./i,
      ),
    ).toBeInTheDocument();
  });
});
