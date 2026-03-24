import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { apiUrl } from "./api-url";
import { renderAuthenticatedApp } from "./render-app";
import {
  makeCorrespondent,
  makeDocument,
  makeDocumentType,
  makeHealthProvidersResponse,
  makeTag,
} from "./fixtures";
import { server } from "./msw-server";

const documentId = "11111111-1111-1111-1111-111111111111";

function taxonomyHandlers() {
  return [
    http.get(apiUrl("/api/taxonomies/tags"), () =>
      HttpResponse.json([makeTag()]),
    ),
    http.get(apiUrl("/api/taxonomies/correspondents"), () =>
      HttpResponse.json([makeCorrespondent()]),
    ),
    http.get(apiUrl("/api/taxonomies/document-types"), () =>
      HttpResponse.json([makeDocumentType()]),
    ),
  ];
}

describe("document detail smoke", () => {
  it("loads the detail page and reprocesses with the selected OCR provider", async () => {
    let reprocessBody: unknown = null;

    server.use(
      ...taxonomyHandlers(),
      http.get(apiUrl(`/api/documents/${documentId}`), () =>
        HttpResponse.json(
          makeDocument({
            id: documentId,
            reviewStatus: "pending",
            reviewReasons: ["low_confidence"],
            metadata: {
              detectedKeywords: ["invoice", "march"],
              reviewReasons: ["low_confidence"],
              chunkCount: 2,
              pageCount: 1,
              intelligence: {
                routing: {
                  documentType: "invoice",
                  confidence: 0.82,
                  reasoningHints: ["keyword:invoice"],
                },
                summary: {
                  value: "Invoice for March services with payment due at month end.",
                },
                extraction: {
                  fields: {
                    amount: 123.45,
                    referenceNumber: "INV-2026-03",
                  },
                  fieldConfidence: {
                    amount: 0.91,
                  },
                  fieldProvenance: {
                    amount: {
                      source: "llm_structured_extraction",
                      provider: "mistral",
                      page: 1,
                      lineIndex: 0,
                      snippet: "Invoice line one",
                    },
                  },
                },
                validation: {
                  normalizedFields: {
                    amount: 123.45,
                  },
                  warnings: ["routing_low_confidence"],
                  errors: [],
                  duplicateSignals: {},
                },
                pipeline: {
                  framework: "langgraph-ready",
                  status: "completed",
                  providerOrder: ["mistral", "gemini", "openai"],
                  durationsMs: { routing: 12 },
                  agentVersions: { routing: "v1" },
                },
              },
              manual: {
                lockedFields: ["issueDate", "amount"],
                values: {
                  issueDate: "2026-03-01",
                  amount: 123.45,
                },
                updatedAt: "2026-03-22T09:00:00.000Z",
                updatedByUserId: "11111111-1111-1111-1111-111111111111",
              },
            },
          }),
        ),
      ),
      http.get(apiUrl(`/api/documents/${documentId}/text`), () =>
        HttpResponse.json({
          documentId,
          blocks: [
            {
              documentId,
              page: 1,
              lineIndex: 0,
              boundingBox: { x: 0, y: 0, width: 100, height: 10 },
              text: "Invoice line one",
            },
          ],
        }),
      ),
      http.get(apiUrl(`/api/documents/${documentId}/history`), () =>
        HttpResponse.json({
          documentId,
          items: [
            {
              id: "66666666-6666-6666-6666-666666666666",
              actorUserId: "11111111-1111-1111-1111-111111111111",
              actorDisplayName: "Owner",
              actorEmail: "owner@example.com",
              documentId,
              eventType: "document.updated",
              payload: { title: "March Invoice" },
              createdAt: "2026-03-22T09:00:00.000Z",
            },
          ],
        }),
      ),
      http.get(apiUrl(`/api/documents/${documentId}/download`), () =>
        new HttpResponse(new Uint8Array([1, 2, 3]), {
          headers: {
            "Content-Type": "application/pdf",
          },
        }),
      ),
      http.get(apiUrl("/api/health/providers"), () =>
        HttpResponse.json(
          makeHealthProvidersResponse({
            activeParseProvider: "local-ocr",
            parseProviders: [
              { id: "local-ocr", available: true },
              { id: "amazon-textract", available: true },
            ],
          }),
        ),
      ),
      http.post(apiUrl(`/api/documents/${documentId}/reprocess`), async ({ request }) => {
        reprocessBody = await request.json();
        return HttpResponse.json({
          queued: true,
          documentId,
          processingJobId: "55555555-5555-5555-5555-555555555555",
        });
      }),
    );

    const { user } = renderAuthenticatedApp({
      route: `/documents/${documentId}`,
    });

    expect(
      await screen.findByRole("heading", { name: "March Invoice" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Pending Review").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Manual Overrides")).toBeInTheDocument();
    expect(screen.getAllByText("Issue Date").length).toBeGreaterThanOrEqual(1);
    await waitFor(() => {
      expect(window.URL.createObjectURL).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("tab", { name: /history/i }));
    expect(await screen.findByText("Document Updated")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /intelligence/i }));
    expect(await screen.findByText("Document Intelligence")).toBeInTheDocument();
    expect(screen.getByText("Invoice for March services with payment due at month end.")).toBeInTheDocument();
    expect(screen.getByText("llm_structured_extraction / mistral")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /reprocess document/i })[0]);
    await user.click(screen.getByRole("combobox", { name: /ocr provider/i }));
    await user.click(await screen.findByRole("option", { name: /amazon textract/i }));
    await user.click(screen.getByRole("button", { name: /^reprocess$/i }));

    await waitFor(() => {
      expect(reprocessBody).toEqual({ parseProvider: "amazon-textract" });
    });
  });

  it("shows the unsupported preview fallback for non-previewable documents", async () => {
    server.use(
      ...taxonomyHandlers(),
      http.get(apiUrl(`/api/documents/${documentId}`), () =>
        HttpResponse.json(
          makeDocument({
            id: documentId,
            title: "Archive Export",
            mimeType: "application/zip",
            searchablePdfAvailable: false,
          }),
        ),
      ),
      http.get(apiUrl(`/api/documents/${documentId}/text`), () =>
        HttpResponse.json({ documentId, blocks: [] }),
      ),
      http.get(apiUrl(`/api/documents/${documentId}/history`), () =>
        HttpResponse.json({ documentId, items: [] }),
      ),
      http.get(apiUrl(`/api/documents/${documentId}/download`), () =>
        new HttpResponse(new Uint8Array([4, 5, 6]), {
          headers: {
            "Content-Type": "application/zip",
          },
        }),
      ),
      http.get(apiUrl("/api/health/providers"), () =>
        HttpResponse.json(makeHealthProvidersResponse()),
      ),
    );

    renderAuthenticatedApp({
      route: `/documents/${documentId}`,
    });

    expect(
      await screen.findByText("Preview not available"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/zip archive/i),
    ).toBeInTheDocument();
  });

  it("unlocks a manually overridden field via the inline unlock button", async () => {
    const patchCalls: unknown[] = [];

    server.use(
      ...taxonomyHandlers(),
      http.get(apiUrl(`/api/documents/${documentId}`), () =>
        HttpResponse.json(
          makeDocument({
            id: documentId,
            metadata: {
              detectedKeywords: ["invoice"],
              reviewReasons: [],
              chunkCount: 2,
              pageCount: 1,
              manual: {
                lockedFields: ["issueDate", "amount"],
                values: {
                  issueDate: "2026-03-01",
                  amount: 123.45,
                },
                updatedAt: "2026-03-22T09:00:00.000Z",
                updatedByUserId: "11111111-1111-1111-1111-111111111111",
              },
            },
          }),
        ),
      ),
      http.get(apiUrl(`/api/documents/${documentId}/text`), () =>
        HttpResponse.json({ documentId, blocks: [] }),
      ),
      http.get(apiUrl(`/api/documents/${documentId}/history`), () =>
        HttpResponse.json({ documentId, items: [] }),
      ),
      http.get(apiUrl(`/api/documents/${documentId}/download`), () =>
        new HttpResponse(new Uint8Array([1, 2, 3]), {
          headers: { "Content-Type": "application/pdf" },
        }),
      ),
      http.get(apiUrl("/api/health/providers"), () =>
        HttpResponse.json(makeHealthProvidersResponse()),
      ),
      http.patch(apiUrl(`/api/documents/${documentId}`), async ({ request }) => {
        const body = await request.json();
        patchCalls.push(body);
        return HttpResponse.json(
          makeDocument({
            id: documentId,
            metadata: {
              detectedKeywords: ["invoice"],
              reviewReasons: [],
              chunkCount: 2,
              pageCount: 1,
              manual: {
                lockedFields: ["amount"],
                values: { amount: 123.45 },
                updatedAt: "2026-03-22T09:00:00.000Z",
                updatedByUserId: "11111111-1111-1111-1111-111111111111",
              },
            },
          }),
        );
      }),
    );

    const { user } = renderAuthenticatedApp({
      route: `/documents/${documentId}`,
    });

    // Wait for the document to load and display locked fields
    expect(
      await screen.findByRole("heading", { name: "March Invoice" }),
    ).toBeInTheDocument();

    // Should show "2 fields locked" in manual overrides section
    expect(screen.getByText(/2 fields? locked/i)).toBeInTheDocument();

    // Find and click the first Unlock button (for issueDate inline indicator)
    const unlockButtons = screen.getAllByRole("button", { name: /unlock/i });
    expect(unlockButtons.length).toBeGreaterThanOrEqual(1);
    await user.click(unlockButtons[0]);

    // Verify the PATCH was sent with clearLockedFields
    await waitFor(() => {
      expect(patchCalls.length).toBe(1);
      expect(patchCalls[0]).toEqual({ clearLockedFields: ["issueDate"] });
    });
  });

  it("shows pending lock feedback and filtered tag editing while saving overrides", async () => {
    const importantTag = makeTag({
      id: "aaa11111-1111-1111-1111-111111111111",
      name: "Important",
      slug: "important",
    });
    const urgentTag = makeTag({
      id: "aaa22222-2222-2222-2222-222222222222",
      name: "Urgent",
      slug: "urgent",
    });
    const travelTag = makeTag({
      id: "aaa33333-3333-3333-3333-333333333333",
      name: "Travel",
      slug: "travel",
    });
    const patchCalls: unknown[] = [];
    let currentDocument = makeDocument({
      id: documentId,
      tags: [importantTag],
      metadata: {
        detectedKeywords: ["invoice"],
        reviewReasons: [],
        chunkCount: 2,
        pageCount: 1,
      },
    });

    server.use(
      http.get(apiUrl("/api/taxonomies/tags"), () =>
        HttpResponse.json([importantTag, urgentTag, travelTag]),
      ),
      http.get(apiUrl("/api/taxonomies/correspondents"), () =>
        HttpResponse.json([makeCorrespondent()]),
      ),
      http.get(apiUrl("/api/taxonomies/document-types"), () =>
        HttpResponse.json([makeDocumentType()]),
      ),
      http.get(apiUrl(`/api/documents/${documentId}`), () =>
        HttpResponse.json(currentDocument),
      ),
      http.get(apiUrl(`/api/documents/${documentId}/text`), () =>
        HttpResponse.json({ documentId, blocks: [] }),
      ),
      http.get(apiUrl(`/api/documents/${documentId}/history`), () =>
        HttpResponse.json({ documentId, items: [] }),
      ),
      http.get(apiUrl(`/api/documents/${documentId}/download`), () =>
        new HttpResponse(new Uint8Array([1, 2, 3]), {
          headers: { "Content-Type": "application/pdf" },
        }),
      ),
      http.get(apiUrl("/api/health/providers"), () =>
        HttpResponse.json(makeHealthProvidersResponse()),
      ),
      http.patch(apiUrl(`/api/documents/${documentId}`), async ({ request }) => {
        const body = await request.json();
        patchCalls.push(body);
        currentDocument = makeDocument({
          id: documentId,
          amount: 88,
          tags: [importantTag, urgentTag],
          metadata: {
            detectedKeywords: ["invoice"],
            reviewReasons: [],
            chunkCount: 2,
            pageCount: 1,
            manual: {
              lockedFields: ["amount", "tagIds"],
              values: {
                amount: 88,
                tagIds: [importantTag.id, urgentTag.id],
              },
              updatedAt: "2026-03-22T09:00:00.000Z",
              updatedByUserId: "11111111-1111-1111-1111-111111111111",
            },
          },
        });
        return HttpResponse.json(currentDocument);
      }),
    );

    const { user } = renderAuthenticatedApp({
      route: `/documents/${documentId}`,
    });

    expect(
      await screen.findByRole("heading", { name: "March Invoice" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^edit$/i }));

    expect(
      screen.getByText(/Only the fields you change will become sticky manual overrides/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Selected tags")).toBeInTheDocument();
    expect(screen.getByText("Available tags")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Filter tags..."), "urg");
    expect(screen.getByRole("button", { name: /Urgent/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Travel/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Urgent/i }));
    await user.clear(screen.getByPlaceholderText("0.00"));
    await user.type(screen.getByPlaceholderText("0.00"), "88");

    expect(screen.getByText("Saving will lock Amount, Tags.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(patchCalls).toEqual([
        {
          amount: 88,
          tagIds: [importantTag.id, urgentTag.id],
        },
      ]);
    });

    expect(await screen.findByText(/2 fields locked/i)).toBeInTheDocument();
  });

  it("deletes a document after confirmation and returns to the documents list", async () => {
    const deleteCalls: string[] = [];

    server.use(
      ...taxonomyHandlers(),
      http.get(apiUrl(`/api/documents/${documentId}`), () =>
        HttpResponse.json(
          makeDocument({
            id: documentId,
            searchablePdfAvailable: false,
          }),
        ),
      ),
      http.get(apiUrl(`/api/documents/${documentId}/text`), () =>
        HttpResponse.json({ documentId, blocks: [] }),
      ),
      http.get(apiUrl(`/api/documents/${documentId}/history`), () =>
        HttpResponse.json({ documentId, items: [] }),
      ),
      http.get(apiUrl(`/api/documents/${documentId}/download`), () =>
        new HttpResponse(new Uint8Array([1, 2, 3]), {
          headers: { "Content-Type": "application/pdf" },
        }),
      ),
      http.get(apiUrl("/api/health/providers"), () =>
        HttpResponse.json(makeHealthProvidersResponse()),
      ),
      http.delete(apiUrl(`/api/documents/${documentId}`), () => {
        deleteCalls.push(documentId);
        return HttpResponse.json({ deleted: true });
      }),
      http.get(apiUrl("/api/documents/facets"), () =>
        HttpResponse.json({
          years: [],
          correspondents: [],
          documentTypes: [],
          tags: [],
          amountRange: { min: null, max: null },
          statuses: [],
        }),
      ),
      http.get(apiUrl("/api/documents"), () =>
        HttpResponse.json({
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
          appliedFilters: {},
        }),
      ),
    );

    const { user } = renderAuthenticatedApp({
      route: `/documents/${documentId}`,
    });

    expect(
      await screen.findByRole("heading", { name: "March Invoice" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /delete document/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /delete permanently/i }));

    await waitFor(() => {
      expect(deleteCalls).toEqual([documentId]);
    });
    expect(await screen.findByRole("heading", { name: /documents/i })).toBeInTheDocument();
  });
});
