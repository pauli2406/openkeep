import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  makeCorrespondent,
  makeDocument,
  makeDocumentType,
  makeHealthProvidersResponse,
  makeSearchDocumentsResponse,
  makeTag,
} from "@/test/fixtures";
import {
  desktopApiUrl,
  desktopParityServer,
  emptyFacets,
  emptyInsights,
} from "./msw-server";
import { renderDesktopArchive } from "./render-desktop-app";

beforeAll(() => desktopParityServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => desktopParityServer.resetHandlers());
afterAll(() => desktopParityServer.close());

function installObjectUrlSpies() {
  let next = 0;
  const create = vi.fn(() => `blob:desktop-review-${++next}`);
  const revoke = vi.fn();
  Object.defineProperty(window.URL, "createObjectURL", {
    configurable: true,
    value: create,
  });
  Object.defineProperty(window.URL, "revokeObjectURL", {
    configurable: true,
    value: revoke,
  });
  return { create, revoke };
}

describe("desktop review and document-management parity", () => {
  it("corrects and resolves one review item, then requeues the next", async () => {
    const urls = installObjectUrlSpies();
    let queue = [
      makeDocument({
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        title: "Desktop Review Invoice",
        amount: 41,
        confidence: 0.62,
        reviewStatus: "pending",
        reviewReasons: ["classification_ambiguous"],
      }),
      makeDocument({
        id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        title: "Desktop OCR Failure",
        confidence: 0.3,
        reviewStatus: "pending",
        reviewReasons: ["ocr_empty"],
      }),
    ];
    const patches: Array<{ id: string; body: unknown }> = [];
    const resolved: string[] = [];
    const requeued: string[] = [];

    desktopParityServer.use(
      http.get(desktopApiUrl("/api/documents/review"), () =>
        HttpResponse.json(makeSearchDocumentsResponse(queue)),
      ),
      http.get(desktopApiUrl("/api/taxonomies/correspondents"), () =>
        HttpResponse.json([makeCorrespondent()]),
      ),
      http.get(desktopApiUrl("/api/taxonomies/document-types"), () =>
        HttpResponse.json([makeDocumentType()]),
      ),
      http.get(desktopApiUrl("/api/documents/:id/download"), () =>
        new HttpResponse(new Blob(["preview"], { type: "application/pdf" })),
      ),
      http.patch(desktopApiUrl("/api/documents/:id"), async ({ params, request }) => {
        const body = await request.json();
        patches.push({ id: String(params.id), body });
        queue = queue.map((item) =>
          item.id === params.id ? { ...item, ...(body as object) } : item,
        );
        return HttpResponse.json(queue.find((item) => item.id === params.id));
      }),
      http.post(
        desktopApiUrl("/api/documents/:id/review/resolve"),
        ({ params }) => {
          const id = String(params.id);
          resolved.push(id);
          queue = queue.filter((item) => item.id !== id);
          return HttpResponse.json({ resolved: true });
        },
      ),
      http.post(
        desktopApiUrl("/api/documents/:id/review/requeue"),
        ({ params }) => {
          requeued.push(String(params.id));
          return HttpResponse.json({ queued: true, documentId: params.id });
        },
      ),
    );

    const view = renderDesktopArchive({ route: "/review" });

    expect(
      await screen.findByRole("heading", { name: /desktop review invoice/i }),
    ).toBeInTheDocument();
    expect(await screen.findByTitle("Desktop Review Invoice")).toHaveAttribute(
      "src",
      "blob:desktop-review-1",
    );

    const amount = screen.getByRole("spinbutton");
    await view.user.clear(amount);
    await view.user.type(amount, "89.5");
    await view.user.click(
      screen.getByRole("button", { name: /confirm and file/i }),
    );

    await waitFor(() => {
      expect(patches).toEqual([
        {
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          body: { amount: 89.5 },
        },
      ]);
      expect(resolved).toEqual(["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]);
    });
    expect(
      await screen.findByRole("heading", { name: /desktop ocr failure/i }),
    ).toBeInTheDocument();
    expect(urls.revoke).toHaveBeenCalledWith("blob:desktop-review-1");

    await view.user.click(screen.getByRole("button", { name: /^reprocess$/i }));
    await waitFor(() =>
      expect(requeued).toEqual(["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"]),
    );

    view.unmount();
    expect(urls.revoke).toHaveBeenCalledWith("blob:desktop-review-2");
  });

  it("bulk-confirms only confidence-only review reasons and exposes failures", async () => {
    const eligible = makeDocument({
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      title: "Confident classification",
      confidence: 0.94,
      reviewStatus: "pending",
      reviewReasons: ["low_confidence"],
    });
    const ineligible = makeDocument({
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      title: "Missing required field",
      confidence: 0.99,
      reviewStatus: "pending",
      reviewReasons: ["missing_key_fields"],
    });
    const resolved: string[] = [];

    desktopParityServer.use(
      http.get(desktopApiUrl("/api/documents/review"), () =>
        HttpResponse.json(makeSearchDocumentsResponse([eligible, ineligible])),
      ),
      http.get(desktopApiUrl("/api/taxonomies/correspondents"), () =>
        HttpResponse.json([makeCorrespondent()]),
      ),
      http.get(desktopApiUrl("/api/taxonomies/document-types"), () =>
        HttpResponse.json([makeDocumentType()]),
      ),
      http.get(desktopApiUrl("/api/documents/:id/download"), () =>
        new HttpResponse(new Blob(["preview"], { type: "application/pdf" })),
      ),
      http.post(
        desktopApiUrl("/api/documents/:id/review/resolve"),
        ({ params }) => {
          const id = String(params.id);
          if (id === ineligible.id) {
            return HttpResponse.json(
              { message: "Archive refused review mutation" },
              { status: 409 },
            );
          }
          resolved.push(id);
          return HttpResponse.json({ resolved: true });
        },
      ),
    );

    const { user } = renderDesktopArchive({ route: "/review" });
    await screen.findByText("Confident classification");
    await user.click(
      screen.getByRole("button", { name: /confirm 1 above 80%/i }),
    );
    await waitFor(() => expect(resolved).toEqual([eligible.id]));

    await user.click(screen.getByText("Missing required field"));
    await user.click(screen.getByRole("button", { name: /confirm and file/i }));
    expect(
      await screen.findByText("Archive refused review mutation"),
    ).toHaveAttribute("role", "alert");
    expect(resolved).not.toContain(ineligible.id);
  });

  it("renders and manages the complete shared document-detail workflow", async () => {
    const urls = installObjectUrlSpies();
    const documentId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const vendor = makeCorrespondent({
      id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      name: "Desktop Vendor",
      slug: "desktop-vendor",
    });
    let correspondents = [
      makeCorrespondent({
        id: "22222222-2222-2222-2222-222222222222",
        name: "Acme Corp",
        slug: "acme-corp",
      }),
    ];
    let document = makeDocument({
      id: documentId,
      title: "Desktop Managed Invoice",
      reviewStatus: "pending",
      reviewReasons: ["missing_key_fields"],
      metadata: {
        detectedKeywords: ["invoice"],
        reviewReasons: ["missing_key_fields"],
        chunkCount: 2,
        pageCount: 2,
        manual: {
          lockedFields: ["issueDate"],
          values: { issueDate: "2026-03-01" },
          updatedAt: "2026-08-10T10:00:00.000Z",
          updatedByUserId: "11111111-1111-1111-1111-111111111111",
        },
        intelligence: {
          routing: {
            documentType: "invoice",
            confidence: 0.88,
            reasoningHints: ["keyword:invoice"],
          },
          summary: { value: "Desktop invoice intelligence summary." },
          extraction: {
            fields: { amount: 123.45 },
            fieldConfidence: { amount: 0.91 },
            fieldProvenance: {
              amount: {
                source: "llm_structured_extraction",
                provider: "openai",
                page: 2,
                lineIndex: 1,
                snippet: "Total 123.45 EUR",
              },
            },
          },
          validation: {
            warnings: ["missing_key_fields"],
            normalizedFields: {},
            errors: [],
            duplicateSignals: {},
          },
          pipeline: {
            framework: "langgraph-ready",
            status: "completed",
            durationsMs: {},
            agentVersions: {},
          },
        },
      },
    });
    const patches: unknown[] = [];
    const reprocessBodies: unknown[] = [];
    let deleteCalls = 0;

    desktopParityServer.use(
      http.get(desktopApiUrl("/api/documents/:id"), () =>
        HttpResponse.json(document),
      ),
      http.get(desktopApiUrl("/api/documents/:id/text"), () =>
        HttpResponse.json({
          documentId,
          blocks: [
            {
              documentId,
              page: 2,
              lineIndex: 1,
              boundingBox: { x: 0, y: 0, width: 100, height: 10 },
              text: "OCR evidence from the desktop archive",
            },
          ],
        }),
      ),
      http.get(desktopApiUrl("/api/documents/:id/history"), () =>
        HttpResponse.json({
          documentId,
          items: [
            {
              id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
              actorUserId: null,
              actorDisplayName: "OpenKeep Worker",
              actorEmail: null,
              documentId,
              eventType: "document.processed",
              payload: { provider: "local-ocr" },
              createdAt: "2026-08-10T10:00:00.000Z",
            },
          ],
        }),
      ),
      http.get(desktopApiUrl("/api/documents/:id/download"), () =>
        new HttpResponse(new Blob(["pdf"], { type: "application/pdf" })),
      ),
      http.get(desktopApiUrl("/api/taxonomies/tags"), () =>
        HttpResponse.json([makeTag()]),
      ),
      http.get(desktopApiUrl("/api/taxonomies/correspondents"), () =>
        HttpResponse.json(correspondents),
      ),
      http.get(desktopApiUrl("/api/taxonomies/document-types"), () =>
        HttpResponse.json([makeDocumentType()]),
      ),
      http.get(desktopApiUrl("/api/health/providers"), () =>
        HttpResponse.json(makeHealthProvidersResponse()),
      ),
      http.post(desktopApiUrl("/api/taxonomies/correspondents"), () => {
        correspondents = [...correspondents, vendor];
        return HttpResponse.json(vendor);
      }),
      http.patch(desktopApiUrl("/api/documents/:id"), async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patches.push(body);
        if (body.clearLockedFields) {
          document = {
            ...document,
            metadata: {
              ...document.metadata,
              manual: {
                ...(document.metadata.manual ?? { values: {} }),
                lockedFields: [],
              },
            },
          };
        }
        if (body.correspondentId === vendor.id) {
          document = { ...document, correspondent: vendor };
        }
        return HttpResponse.json(document);
      }),
      http.post(desktopApiUrl("/api/documents/:id/review/resolve"), () => {
        document = { ...document, reviewStatus: "resolved", reviewReasons: [] };
        return HttpResponse.json(document);
      }),
      http.post(desktopApiUrl("/api/documents/:id/review/requeue"), () => {
        document = {
          ...document,
          reviewStatus: "pending",
          reviewReasons: ["low_confidence"],
        };
        return HttpResponse.json({ queued: true, documentId });
      }),
      http.post(desktopApiUrl("/api/documents/:id/reprocess"), async ({ request }) => {
        reprocessBodies.push(await request.json());
        return HttpResponse.json({ queued: true, documentId });
      }),
      http.delete(desktopApiUrl("/api/documents/:id"), () => {
        deleteCalls += 1;
        return HttpResponse.json({ deleted: true });
      }),
      http.get(desktopApiUrl("/api/documents/facets"), () =>
        HttpResponse.json(emptyFacets),
      ),
      http.get(desktopApiUrl("/api/documents"), () =>
        HttpResponse.json(makeSearchDocumentsResponse([])),
      ),
      http.get(desktopApiUrl("/api/dashboard/insights"), () =>
        HttpResponse.json(emptyInsights),
      ),
    );

    const view = renderDesktopArchive({ route: `/documents/${documentId}` });

    expect(
      await screen.findByRole("heading", { name: "Desktop Managed Invoice" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(urls.create).toHaveBeenCalledTimes(1));

    await view.user.click(screen.getByRole("tab", { name: /ocr text/i }));
    expect(
      await screen.findByText("OCR evidence from the desktop archive"),
    ).toBeInTheDocument();
    await view.user.click(screen.getByRole("tab", { name: /intelligence/i }));
    expect(await screen.findByText("Document Intelligence")).toBeInTheDocument();
    expect(screen.getByText("Desktop invoice intelligence summary.")).toBeInTheDocument();
    expect(screen.getByText("llm_structured_extraction / openai")).toBeInTheDocument();
    await view.user.click(screen.getByRole("tab", { name: /history/i }));
    expect(await screen.findByText("Document Processed")).toBeInTheDocument();
    expect(screen.getByText("OpenKeep Worker")).toBeInTheDocument();

    const rail = screen.getByRole("complementary");
    await view.user.click(
      within(rail).getByRole("button", { name: /unlock issue date/i }),
    );
    await waitFor(() =>
      expect(patches).toContainEqual({ clearLockedFields: ["issueDate"] }),
    );

    await view.user.click(within(rail).getByRole("button", { name: "Acme Corp" }));
    await view.user.type(
      within(rail).getByPlaceholderText(/search or add/i),
      "Desktop Vendor",
    );
    await view.user.click(
      within(rail).getByRole("button", { name: "Desktop Vendor" }),
    );
    expect(
      await within(rail).findByRole("button", { name: "Desktop Vendor" }),
    ).toBeInTheDocument();
    await view.user.click(within(rail).getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(patches).toContainEqual({ correspondentId: vendor.id }),
    );

    await view.user.click(
      screen.getByRole("button", { name: /resolve review/i }),
    );
    expect(
      await screen.findByRole("button", { name: /^requeue$/i }),
    ).toBeInTheDocument();
    await view.user.click(screen.getByRole("button", { name: /^requeue$/i }));
    expect(
      await screen.findByRole("button", { name: /resolve review/i }),
    ).toBeInTheDocument();

    await view.user.click(within(rail).getByRole("button", { name: /^reprocess$/i }));
    let dialog = await screen.findByRole("dialog");
    await view.user.click(within(dialog).getByRole("button", { name: /^cancel$/i }));
    expect(reprocessBodies).toEqual([]);
    await view.user.click(within(rail).getByRole("button", { name: /^reprocess$/i }));
    dialog = await screen.findByRole("dialog");
    await view.user.click(
      within(dialog).getByRole("button", { name: /^reprocess$/i }),
    );
    await waitFor(() => expect(reprocessBodies).toEqual([{ parseProvider: "local-ocr" }]));

    await view.user.click(within(rail).getByRole("button", { name: /^delete$/i }));
    dialog = await screen.findByRole("dialog");
    await view.user.click(within(dialog).getByRole("button", { name: /^cancel$/i }));
    expect(deleteCalls).toBe(0);

    view.unmount();
    expect(urls.revoke).toHaveBeenCalledWith("blob:desktop-review-1");
  });

  it("represents failed conversion, missing preview, and empty evidence", async () => {
    const documentId = "ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb";
    desktopParityServer.use(
      http.get(desktopApiUrl("/api/documents/:id"), () =>
        HttpResponse.json(
          makeDocument({
            id: documentId,
            title: "Failed Desktop Conversion",
            status: "failed",
            searchablePdfAvailable: false,
            lastProcessingError: "Conversion failed: unsupported source encoding",
            metadata: { detectedKeywords: [], reviewReasons: [], chunkCount: 0 },
          }),
        ),
      ),
      http.get(desktopApiUrl("/api/documents/:id/text"), () =>
        HttpResponse.json({ documentId, blocks: [] }),
      ),
      http.get(desktopApiUrl("/api/documents/:id/history"), () =>
        HttpResponse.json({ documentId, items: [] }),
      ),
      http.get(desktopApiUrl("/api/documents/:id/download"), () =>
        HttpResponse.json({ message: "preview missing" }, { status: 404 }),
      ),
      http.get(desktopApiUrl("/api/taxonomies/tags"), () => HttpResponse.json([])),
      http.get(desktopApiUrl("/api/taxonomies/correspondents"), () => HttpResponse.json([])),
      http.get(desktopApiUrl("/api/taxonomies/document-types"), () => HttpResponse.json([])),
      http.get(desktopApiUrl("/api/health/providers"), () =>
        HttpResponse.json(makeHealthProvidersResponse()),
      ),
    );

    const { user } = renderDesktopArchive({ route: `/documents/${documentId}` });
    expect(await screen.findByText("failed")).toBeInTheDocument();
    expect(
      await screen.findByText("Failed to load document preview."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /processing local ocr/i }));
    expect(
      screen.getByText("Conversion failed: unsupported source encoding"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /ocr text/i }));
    expect(
      await screen.findByText("No OCR text available for this document."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /intelligence/i }));
    expect(
      await screen.findByText("No agent intelligence available for this document yet."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /history/i }));
    expect(
      await screen.findByText("No audit events recorded for this document yet."),
    ).toBeInTheDocument();
  });
});
