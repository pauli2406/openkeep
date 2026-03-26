import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { apiUrl } from "./api-url";
import { renderAuthenticatedApp } from "./render-app";
import {
  makeDocument,
  makeUser,
    makeHealthResponse,
    makeProcessingStatusResponse,
    makeReadinessResponse,
    makeSearchDocumentsResponse,
    makeWatchFolderScanResponse,
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
              reviewReasons: ["classification_ambiguous"],
              metadata: {
                intelligence: {
                  routing: {
                    documentType: "invoice",
                  },
                  summary: {
                    value: "Supplier invoice with unclear classification confidence.",
                  },
                  validation: {
                    normalizedFields: {},
                    warnings: ["routing_low_confidence"],
                    errors: [],
                    duplicateSignals: {},
                  },
                },
              },
            }),
            makeDocument({
              id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
              title: "Requeue Invoice",
              reviewStatus: "pending",
              reviewReasons: ["missing_key_fields"],
              dueDate: null,
              referenceNumber: null,
              metadata: {
                reviewEvidence: {
                  documentClass: "invoice",
                  requiredFields: [
                    "correspondent",
                    "issueDate",
                    "dueDate",
                    "amount",
                    "currency",
                    "referenceNumber",
                  ],
                  missingFields: ["dueDate", "referenceNumber"],
                  extracted: {
                    correspondent: true,
                    issueDate: true,
                    dueDate: false,
                    amount: true,
                    currency: true,
                    referenceNumber: false,
                    expiryDate: false,
                    holderName: false,
                    issuingAuthority: false,
                  },
                  activeReasons: ["missing_key_fields"],
                  confidence: 0.66,
                  confidenceThreshold: 0.8,
                },
              },
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
    expect(screen.getByText("Classification Ambiguous")).toBeInTheDocument();
    expect(screen.getByText("invoice")).toBeInTheDocument();
    expect(screen.getAllByText(/verify extracted fields/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Due Date").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Reference Number").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Supplier invoice with unclear classification confidence."),
    ).toBeInTheDocument();

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

/** Common MSW handlers for the settings page */
function settingsHandlers(overrides?: {
  tags?: unknown[];
  correspondents?: unknown[];
  documentTypes?: unknown[];
  document?: ReturnType<typeof makeDocument>;
}) {
  return [
    http.get(apiUrl("/api/health"), () => HttpResponse.json(makeHealthResponse())),
    http.get(apiUrl("/api/auth/tokens"), () => HttpResponse.json([])),
    http.get(apiUrl("/api/taxonomies/tags"), () =>
      HttpResponse.json(
        overrides?.tags ?? [{ id: "1", name: "Important", slug: "important" }],
      ),
    ),
    http.get(apiUrl("/api/taxonomies/correspondents"), () =>
      HttpResponse.json(
        overrides?.correspondents ?? [{ id: "2", name: "Acme Corp", slug: "acme-corp" }],
      ),
    ),
    http.get(apiUrl("/api/taxonomies/document-types"), () =>
      HttpResponse.json(
        overrides?.documentTypes ?? [
          {
            id: "3",
            name: "Invoice",
            slug: "invoice",
            description: "Billing documents",
          },
        ],
      ),
    ),
    http.get(apiUrl("/api/health/status"), () =>
      HttpResponse.json(makeProcessingStatusResponse()),
    ),
    http.get(apiUrl("/api/health/ready"), () =>
      HttpResponse.json(makeReadinessResponse()),
    ),
    http.get(apiUrl("/api/documents/:id"), ({ params }) =>
      HttpResponse.json(
        makeDocument({
          id: params.id as string,
          title: "Watch Folder Invoice",
          issueDate: "2026-03-01",
          dueDate: null,
          amount: 123.45,
          currency: "EUR",
          referenceNumber: null,
          metadata: {
            detectedKeywords: ["invoice"],
            reviewReasons: ["missing_key_fields"],
            chunkCount: 2,
            pageCount: 1,
            reviewEvidence: {
              documentClass: "invoice",
              requiredFields: [
                "correspondent",
                "issueDate",
                "dueDate",
                "amount",
                "currency",
                "referenceNumber",
              ],
              missingFields: ["dueDate", "referenceNumber"],
              extracted: {
                correspondent: true,
                issueDate: true,
                dueDate: false,
                amount: true,
                currency: true,
                referenceNumber: false,
                expiryDate: false,
                holderName: false,
                issuingAuthority: false,
              },
              activeReasons: ["missing_key_fields"],
              confidence: 0.62,
              confidenceThreshold: 0.8,
            },
          },
          ...overrides?.document,
        }),
      ),
    ),
  ];
}

describe("settings smoke", () => {
  it("renders processing activity and system health data without raw object output", async () => {
    server.use(...settingsHandlers());

    renderAuthenticatedApp({
      route: "/settings",
    });

    expect(
      await screen.findByRole("heading", { name: /settings/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Processing Activity")).toBeInTheDocument();
    expect(screen.getByText("System Health")).toBeInTheDocument();
    expect(screen.getByText("Taxonomy Management")).toBeInTheDocument();
    expect(screen.getByText("Archive Portability")).toBeInTheDocument();
    expect(await screen.findByText("OCR Queue")).toBeInTheDocument();
    expect(await screen.findByText("Readiness Checks")).toBeInTheDocument();
    expect(screen.queryByText("[object Object]")).not.toBeInTheDocument();
  });

  it("shows a stable error state when processing status fails to load", async () => {
    server.use(
      http.get(apiUrl("/api/health"), () => HttpResponse.json(makeHealthResponse())),
      http.get(apiUrl("/api/auth/tokens"), () => HttpResponse.json([])),
      http.get(apiUrl("/api/taxonomies/tags"), () => HttpResponse.json([])),
      http.get(apiUrl("/api/taxonomies/correspondents"), () => HttpResponse.json([])),
      http.get(apiUrl("/api/taxonomies/document-types"), () => HttpResponse.json([])),
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

  it("runs a watch-folder scan from settings", async () => {
    server.use(
      ...settingsHandlers(),
      http.post(apiUrl("/api/archive/watch-folder/scan"), async ({ request }) => {
        const body = (await request.json()) as { dryRun: boolean };
        expect(body).toEqual({ dryRun: true });
        return HttpResponse.json(makeWatchFolderScanResponse({ dryRun: true }));
      }),
    );

    const { user } = renderAuthenticatedApp({
      route: "/settings",
    });

    await user.click(
      await screen.findByRole("button", { name: /scan watch folder/i }),
    );

    expect(await screen.findByText("Watch Folder Scan")).toBeInTheDocument();
    expect(screen.getByText("Path: /watch-folder")).toBeInTheDocument();
    expect(screen.getByText("Current scan results")).toBeInTheDocument();
    expect(screen.getByText("/watch-folder/invoice.pdf")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open document/i })).toHaveAttribute(
      "href",
      "/documents/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    );

    await user.click(screen.getByText(/inspect extracted fields/i));

    expect(await screen.findByText("Found values")).toBeInTheDocument();
    expect(screen.getAllByText("Acme Corp").length).toBeGreaterThan(1);
    expect(screen.getByText("123.45 EUR")).toBeInTheDocument();
    expect(screen.getByText("Missing key fields")).toBeInTheDocument();
    expect(screen.getByText("Due Date")).toBeInTheDocument();
    expect(screen.getByText("Reference Number")).toBeInTheDocument();
    expect(screen.queryByText("None missing.")).not.toBeInTheDocument();
  });

  it("saves language preference changes from settings", async () => {
    server.use(...settingsHandlers());
    const updatePreferences = vi.fn().mockResolvedValue(undefined);

    const { user } = renderAuthenticatedApp({
      route: "/settings",
      authState: { updatePreferences },
    });

    const comboboxes = await screen.findAllByRole("combobox");
    await user.click(comboboxes[0]!);
    await user.click(await screen.findByRole("option", { name: "German" }));
    await user.click(await screen.findByRole("button", { name: /save preferences/i }));

    await waitFor(() => {
      expect(updatePreferences).toHaveBeenCalledWith({
        uiLanguage: "de",
        aiProcessingLanguage: "en",
        aiChatLanguage: "en",
      });
    });

    expect(screen.getByText("Preferences saved.")).toBeInTheDocument();
  });

  it("renders the settings screen in German when the UI preference is German", async () => {
    server.use(...settingsHandlers());

    renderAuthenticatedApp({
      route: "/settings",
      authState: {
        user: makeUser({
          preferences: {
            uiLanguage: "de" as const,
            aiProcessingLanguage: "en" as const,
            aiChatLanguage: "en" as const,
          },
        }) as never,
      },
    });

    expect(await screen.findByRole("heading", { name: "Einstellungen" })).toBeInTheDocument();
    expect(screen.getByText("Spracheinstellungen")).toBeInTheDocument();
    expect(screen.getByText("Benutzerprofil")).toBeInTheDocument();
  });

  it("creates a new tag via taxonomy management", async () => {
    const createCalls: unknown[] = [];

    server.use(
      ...settingsHandlers({ tags: [] }),
      http.post(apiUrl("/api/taxonomies/tags"), async ({ request }) => {
        const body = await request.json();
        createCalls.push(body);
        return HttpResponse.json({
          id: "new-tag-id",
          name: (body as { name: string }).name,
          slug: "urgent",
        });
      }),
    );

    const { user } = renderAuthenticatedApp({
      route: "/settings",
    });

    expect(await screen.findByText("Taxonomy Management")).toBeInTheDocument();

    const tagInputs = await screen.findAllByPlaceholderText(/create tag/i);
    await user.type(tagInputs[0], "Urgent");
    await user.click(screen.getAllByRole("button", { name: /add/i })[0]);

    await waitFor(() => {
      expect(createCalls).toEqual([{ name: "Urgent" }]);
    });
  });

  it("deletes a correspondent via taxonomy management", async () => {
    const deleteCalls: string[] = [];

    server.use(
      ...settingsHandlers(),
      http.delete(apiUrl("/api/taxonomies/correspondents/:id"), ({ params }) => {
        deleteCalls.push(params.id as string);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { user } = renderAuthenticatedApp({
      route: "/settings",
    });

    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();

    // Find the delete button within the correspondents section
    const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
    // The correspondents delete button — Acme Corp is the second taxonomy section
    // Each taxonomy item has Edit, Merge, Delete buttons
    // Tags section has "Important" with 3 buttons, correspondents section has "Acme Corp" with 3 buttons
    // We need the delete button for "Acme Corp"
    await user.click(deleteButtons[1]);

    await waitFor(() => {
      expect(deleteCalls).toEqual(["2"]);
    });
  });

  it("exports and displays the archive snapshot", async () => {
    server.use(
      ...settingsHandlers(),
      http.get(apiUrl("/api/archive/export"), () =>
        HttpResponse.json({
          version: 1,
          exportedAt: "2026-03-22T12:00:00.000Z",
          documents: [{ id: "doc-1", title: "Test Document" }],
          taxonomies: { tags: [], correspondents: [], documentTypes: [] },
        }),
      ),
    );

    const { user } = renderAuthenticatedApp({
      route: "/settings",
    });

    expect(await screen.findByText("Archive Portability")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /export snapshot/i }));

    // The exported JSON should be displayed in the textarea
    await waitFor(() => {
      const textarea = screen.getByPlaceholderText(
        /export a snapshot or paste one here/i,
      ) as HTMLTextAreaElement;
      expect(textarea.value).toContain('"version": 1');
      expect(textarea.value).toContain('"Test Document"');
    });
  });

  it("imports an archive snapshot and shows the result", async () => {
    const importCalls: unknown[] = [];

    server.use(
      ...settingsHandlers(),
      http.post(apiUrl("/api/archive/import"), async ({ request }) => {
        const body = await request.json();
        importCalls.push(body);
        return HttpResponse.json({
          imported: true,
          mode: "replace",
          documentCount: 0,
          fileCount: 0,
        });
      }),
    );

    const { user } = renderAuthenticatedApp({
      route: "/settings",
    });

    expect(await screen.findByText("Archive Portability")).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText(
      /export a snapshot or paste one here/i,
    ) as HTMLTextAreaElement;

    const snapshotJson = JSON.stringify({ version: 1, documents: [] });
    await user.clear(textarea);
    // user.type() interprets `{` as a keyboard modifier; use click + paste instead
    await user.click(textarea);
    await user.paste(snapshotJson);

    await user.click(screen.getByRole("button", { name: /import snapshot/i }));

    await waitFor(() => {
      expect(importCalls.length).toBe(1);
      expect((importCalls[0] as { mode: string }).mode).toBe("replace");
    });

    expect(await screen.findByText("Last Import Result")).toBeInTheDocument();
  });
});
