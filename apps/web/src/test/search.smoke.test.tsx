import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { apiUrl } from "./api-url";
import { renderAuthenticatedApp } from "./render-app";

describe("search smoke", () => {
  it("renders structured operational answers with an auditable item list", async () => {
    const originalFetch = globalThis.fetch;

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === apiUrl("/api/search/answer/stream")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          query: "Welche Rechnungen habe ich noch diesen Monat zu bezahlen?",
          maxDocuments: 5,
          maxCitations: 6,
          maxChunkMatches: 6,
        });

        return Promise.resolve(
          new Response(
            [
              "event: search-results\n",
              `data: ${JSON.stringify({ results: [] })}\n\n`,
              "event: done\n",
              `data: ${JSON.stringify({
                status: "answered",
                route: "structured",
                fullAnswer: "Ich habe 1 offene Rechnung gefunden. Zusammen ergibt das 89,00 €.",
                citations: [],
                structuredData: {
                  kind: "deadline_items",
                  title: "Offene Rechnungen in diesem Monat",
                  description:
                    "Offene Rechnungen im aktuellen Monatsfenster auf Basis strukturierter Falligkeitsfelder.",
                  totalOpenCount: 1,
                  totalAmount: 89,
                  currency: "EUR",
                  windowStart: "2026-04-01",
                  windowEnd: "2026-04-30",
                  items: [
                    {
                      documentId: "11111111-1111-1111-1111-111111111111",
                      title: "Strom Rechnung April 2026",
                      referenceNumber: "INV-APR-2026",
                      dueDate: "2026-04-18",
                      amount: 89,
                      currency: "EUR",
                      correspondentName: "Hamburg Energie",
                      documentTypeName: "Invoice",
                      taskLabel: "Pay",
                      daysUntilDue: 17,
                      isOverdue: false,
                      taskCompletedAt: null,
                    },
                  ],
                },
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

    renderAuthenticatedApp({
      route: "/search?q=Welche%20Rechnungen%20habe%20ich%20noch%20diesen%20Monat%20zu%20bezahlen%3F",
    });

    expect(await screen.findByRole("heading", { name: /search/i })).toBeInTheDocument();
    expect(await screen.findByText("Answer ready", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("Ich habe 1 offene Rechnung gefunden. Zusammen ergibt das 89,00 €.")).toBeInTheDocument();
    expect(screen.getByText("Offene Rechnungen in diesem Monat")).toBeInTheDocument();
    expect(screen.getByText(/Matches: 1/i)).toBeInTheDocument();
    expect(screen.getByText("Strom Rechnung April 2026")).toBeInTheDocument();
    expect(screen.getByText(/Due: 2026-04-18/i)).toBeInTheDocument();
    expect(screen.getByText(/Amount: €89.00/i)).toBeInTheDocument();
  });

  it("shows insufficient evidence fallback for unanswerable semantic queries", async () => {
    const originalFetch = globalThis.fetch;

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
              "event: search-results\n",
              `data: ${JSON.stringify({ results: [] })}\n\n`,
              "event: done\n",
              `data: ${JSON.stringify({
                status: "insufficient_evidence",
                route: "semantic",
                fullAnswer: "",
                citations: [],
                structuredData: null,
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

    renderAuthenticatedApp({
      route: "/search?q=What%20is%20the%20meaning%20of%20life%3F",
    });

    expect(await screen.findByText("Answer ready", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(
      screen.getByText(
        /Not enough evidence in your archive to answer this question confidently\./i,
      ),
    ).toBeInTheDocument();
  });

  it("renders structured pending review answers", async () => {
    const originalFetch = globalThis.fetch;

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === apiUrl("/api/search/answer/stream")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          query: "Which documents still need review?",
          maxDocuments: 5,
          maxCitations: 6,
          maxChunkMatches: 6,
        });

        return Promise.resolve(
          new Response(
            [
              "event: search-results\n",
              `data: ${JSON.stringify({ results: [] })}\n\n`,
              "event: done\n",
              `data: ${JSON.stringify({
                status: "answered",
                route: "structured",
                fullAnswer: "I found 1 documents pending review. Common reasons: low confidence, missing key fields.",
                citations: [],
                structuredData: {
                  kind: "pending_review_documents",
                  title: "Documents pending review",
                  description: "Documents with structured review status 'pending'.",
                  totalCount: 1,
                  items: [
                    {
                      id: "11111111-1111-1111-1111-111111111111",
                      title: "Insurance notice",
                      source: "upload",
                      mimeType: "application/pdf",
                      checksum: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                      storageKey: "documents/insurance-notice.pdf",
                      status: "ready",
                      language: "en",
                      issueDate: "2026-04-01",
                      dueDate: null,
                      taskCompletedAt: null,
                      expiryDate: null,
                      amount: null,
                      currency: null,
                      referenceNumber: null,
                      holderName: null,
                      issuingAuthority: null,
                      correspondent: null,
                      documentType: null,
                      tags: [],
                      confidence: 0.71,
                      reviewStatus: "pending",
                      reviewReasons: ["low_confidence", "missing_key_fields"],
                      reviewedAt: null,
                      reviewNote: null,
                      searchablePdfAvailable: true,
                      parseProvider: "local-ocr",
                      chunkCount: 0,
                      embeddingStatus: "not_configured",
                      embeddingProvider: null,
                      embeddingModel: null,
                      embeddingsStale: false,
                      lastProcessingError: null,
                      latestProcessingJob: null,
                      latestEmbeddingJob: null,
                      metadata: { detectedKeywords: [], reviewReasons: [], chunkCount: 0 },
                      createdAt: "2026-04-01T00:00:00.000Z",
                      processedAt: "2026-04-01T00:00:00.000Z",
                      snippets: [],
                      matchingLines: [],
                    },
                  ],
                },
              })}\n\n`,
            ].join(""),
            { headers: { "Content-Type": "text/event-stream" } },
          ),
        );
      }

      return originalFetch(input, init);
    });

    renderAuthenticatedApp({ route: "/search?q=Which%20documents%20still%20need%20review%3F" });

    expect(await screen.findByText("Answer ready", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("Documents pending review")).toBeInTheDocument();
    expect(screen.getByText("Insurance notice")).toBeInTheDocument();
    expect(screen.getByText(/Reasons: low_confidence, missing_key_fields/i)).toBeInTheDocument();
  });
});
