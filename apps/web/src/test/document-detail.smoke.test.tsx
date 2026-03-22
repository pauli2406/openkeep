import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { apiUrl } from "./api-url";
import { renderAuthenticatedApp } from "./render-app";
import {
  makeDocument,
  makeHealthProvidersResponse,
} from "./fixtures";
import { server } from "./msw-server";

const documentId = "11111111-1111-1111-1111-111111111111";

describe("document detail smoke", () => {
  it("loads the detail page and reprocesses with the selected OCR provider", async () => {
    let reprocessBody: unknown = null;

    server.use(
      http.get(apiUrl(`/api/documents/${documentId}`), () =>
        HttpResponse.json(
          makeDocument({
            id: documentId,
            reviewStatus: "pending",
            reviewReasons: ["low_confidence"],
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
    await waitFor(() => {
      expect(window.URL.createObjectURL).toHaveBeenCalled();
    });

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
});
