import { screen, waitFor, within } from "@testing-library/react";
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
  it("polls document detail until processing completes", async () => {
    let documentHits = 0;
    let textHits = 0;
    let processingFinished = false;

    server.use(
      ...taxonomyHandlers(),
      // The test decides when processing finishes, rather than counting a
      // fixed number of polls. Tying it to a poll count made this racy under
      // load: the transition could land before the processing state was ever
      // observable, or after the wait window closed.
      http.get(apiUrl(`/api/documents/${documentId}`), () => {
        documentHits += 1;
        const done = processingFinished;
        return HttpResponse.json(
          makeDocument({
            id: documentId,
            title: done ? "Processed March Invoice" : "Processing March Invoice",
            status: done ? "ready" : "processing",
            processedAt: done ? "2026-03-20T10:01:00.000Z" : null,
            latestProcessingJob: {
              ...makeDocument().latestProcessingJob!,
              status: done ? "completed" : "running",
              finishedAt: done ? "2026-03-20T10:01:00.000Z" : null,
            },
          }),
        );
      }),
      http.get(apiUrl(`/api/documents/${documentId}/text`), () => {
        textHits += 1;
        return HttpResponse.json({
          documentId,
          blocks:
            textHits > 1
              ? [
                  {
                    documentId,
                    page: 1,
                    lineIndex: 0,
                    boundingBox: { x: 0, y: 0, width: 100, height: 10 },
                    text: "Processed OCR line",
                  },
                ]
              : [],
        });
      }),
      http.get(apiUrl(`/api/documents/${documentId}/history`), () =>
        HttpResponse.json({
          documentId,
          items: [],
        }),
      ),
      http.get(apiUrl(`/api/documents/${documentId}/download`), () =>
        new HttpResponse(new Blob(["pdf"], { type: "application/pdf" })),
      ),
      http.get(apiUrl("/api/health/providers"), () => HttpResponse.json(makeHealthProvidersResponse())),
    );

    renderAuthenticatedApp({ route: `/documents/${documentId}` });

    // The processing state is on screen ...
    expect(
      (await screen.findAllByText("Processing March Invoice")).length,
    ).toBeGreaterThan(0);

    // ... and both queries keep polling while it lasts. These conditions
    // recur until they hold, so no wait depends on a poll landing inside a
    // particular window.
    await waitFor(() => expect(documentHits).toBeGreaterThan(1));
    await waitFor(() => expect(textHits).toBeGreaterThan(1));

    // Let processing finish; the next poll picks it up.
    processingFinished = true;
    await waitFor(() =>
      expect(screen.getAllByText("Processed March Invoice").length).toBeGreaterThan(0),
    );
  });

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
      (await screen.findAllByText("March Invoice"))[0],
    ).toBeInTheDocument();
    // The header carries the review state; the rail carries the fields and
    // the manual-override count.
    expect(screen.getByText("Needs review")).toBeInTheDocument();
    expect(screen.getByText("fields locked")).toHaveTextContent("2 fields locked");
    expect(screen.getByText("Issue date")).toBeInTheDocument();
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

    // Two OCR providers are available, so the rail's Reprocess opens the
    // provider picker instead of firing straight away.
    await user.click(screen.getByRole("button", { name: /^reprocess$/i }));
    const reprocessDialog = await screen.findByRole("dialog");
    await user.click(
      within(reprocessDialog).getByRole("combobox", { name: /ocr provider/i }),
    );
    await user.click(await screen.findByRole("option", { name: /amazon textract/i }));
    await user.click(
      within(reprocessDialog).getByRole("button", { name: /^reprocess$/i }),
    );

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
      (await screen.findAllByText("March Invoice"))[0],
    ).toBeInTheDocument();

    // The rail summarises the manual overrides above the fields.
    expect(screen.getByText("fields locked")).toHaveTextContent("2 fields locked");

    // Each locked field carries its own unlock affordance; issueDate comes
    // first in the rail's field order.
    await user.click(screen.getByRole("button", { name: "Unlock Issue date" }));

    // Verify the PATCH was sent with clearLockedFields
    await waitFor(() => {
      expect(patchCalls.length).toBe(1);
      expect(patchCalls[0]).toEqual({ clearLockedFields: ["issueDate"] });
    });
  });

  it("edits fields in place, warns which fields will lock and saves the overrides", async () => {
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
    const financeTag = makeTag({
      id: "aaa44444-4444-4444-4444-444444444444",
      name: "Finance",
      slug: "finance",
    });
    const patchCalls: unknown[] = [];
    const createCalls: unknown[] = [];
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
      http.post(apiUrl("/api/taxonomies/tags"), async ({ request }) => {
        const body = await request.json();
        createCalls.push(body);
        return HttpResponse.json(financeTag);
      }),
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
      (await screen.findAllByText("March Invoice"))[0],
    ).toBeInTheDocument();

    // There is no edit mode: the tag box is always live and only matches
    // once you type, so a large tag vocabulary never floods the rail.
    const tagInput = screen.getByPlaceholderText(/add tag/i);
    expect(screen.queryByRole("button", { name: /^urgent$/i })).not.toBeInTheDocument();

    await user.type(tagInput, "urg");
    expect(screen.getByRole("button", { name: /^urgent$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^travel$/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^urgent$/i }));

    // An unmatched query offers to create the tag.
    await user.type(tagInput, "Finance");
    await user.click(screen.getByRole("button", { name: /^finance$/i }));
    await waitFor(() => {
      expect(createCalls).toEqual([{ name: "Finance" }]);
    });

    // Amount edits in place: click the value, type, commit with Enter.
    await user.click(screen.getByRole("button", { name: /123\.45/ }));
    const amountInput = screen.getByRole("spinbutton");
    await user.clear(amountInput);
    await user.type(amountInput, "88{Enter}");

    expect(screen.getByText("Saving will lock Amount, Tags.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(patchCalls).toEqual([
        {
          amount: 88,
          tagIds: [importantTag.id, urgentTag.id, financeTag.id],
        },
      ]);
    });

    expect(await screen.findByText("fields locked")).toHaveTextContent(
      "2 fields locked",
    );
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
      (await screen.findAllByText("March Invoice"))[0],
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: /delete permanently/i }),
    );

    await waitFor(() => {
      expect(deleteCalls).toEqual([documentId]);
    });
    expect(await screen.findByRole("heading", { name: /documents/i })).toBeInTheDocument();
  });

  it("creates a correspondent from the rail and saves the assignment", async () => {
    const utilityCorrespondent = makeCorrespondent({
      id: "33333333-3333-3333-3333-333333333333",
      name: "Utility Co",
      slug: "utility-co",
    });
    const createCalls: unknown[] = [];
    const patchCalls: unknown[] = [];
    let correspondents = [makeCorrespondent()];

    server.use(
      http.get(apiUrl("/api/taxonomies/tags"), () => HttpResponse.json([makeTag()])),
      http.get(apiUrl("/api/taxonomies/correspondents"), () =>
        HttpResponse.json(correspondents),
      ),
      http.post(apiUrl("/api/taxonomies/correspondents"), async ({ request }) => {
        createCalls.push(await request.json());
        correspondents = [...correspondents, utilityCorrespondent];
        return HttpResponse.json(utilityCorrespondent);
      }),
      http.get(apiUrl("/api/taxonomies/document-types"), () =>
        HttpResponse.json([makeDocumentType()]),
      ),
      http.get(apiUrl(`/api/documents/${documentId}`), () =>
        HttpResponse.json(makeDocument({ id: documentId, correspondent: null })),
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
        patchCalls.push(await request.json());
        return HttpResponse.json(
          makeDocument({ id: documentId, correspondent: utilityCorrespondent }),
        );
      }),
    );

    const { user } = renderAuthenticatedApp({ route: `/documents/${documentId}` });

    expect((await screen.findAllByText("March Invoice"))[0]).toBeInTheDocument();

    // The Correspondent row shows an em dash until one is picked. Clicking it
    // opens a search-and-create field, so a correspondent that does not exist
    // yet can be added without leaving the document.
    const correspondentRow = screen.getByText("Correspondent").parentElement!;
    await user.click(within(correspondentRow).getByRole("button", { name: "—" }));
    await user.type(
      within(correspondentRow).getByPlaceholderText("Search or add…"),
      "Utility Co",
    );
    await user.click(
      within(correspondentRow).getByRole("button", { name: "Utility Co" }),
    );

    await waitFor(() => {
      expect(createCalls).toEqual([{ name: "Utility Co" }]);
    });
    expect(
      await screen.findByText("Saving will lock Correspondent."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(patchCalls).toEqual([{ correspondentId: utilityCorrespondent.id }]);
    });
  });
});
