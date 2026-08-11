import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { apiUrl } from "./api-url";
import {
  makeCorrespondent,
  makeDocument,
  makeDocumentType,
  makeTag,
} from "./fixtures";
import { renderAuthenticatedApp } from "./render-app";
import { server } from "./msw-server";

const documentId = "11111111-1111-4111-8111-111111111111";

function documentHandlers() {
  return [
    http.get(apiUrl(`/api/documents/${documentId}`), () =>
      HttpResponse.json(
        makeDocument({
          id: documentId,
          title: "Native Save Invoice",
          searchablePdfAvailable: true,
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
        headers: { "content-type": "application/pdf" },
      }),
    ),
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

describe("host-owned save seam", () => {
  it("delegates original and searchable document saves without downloading in the renderer", async () => {
    server.use(...documentHandlers());
    const fileSaver = vi
      .fn()
      .mockResolvedValueOnce({ status: "saved" as const })
      .mockResolvedValueOnce({
        status: "failed" as const,
        message: "The destination is not writable.",
      });
    const { user } = renderAuthenticatedApp({
      route: `/documents/${documentId}`,
      fileSaver,
    });

    expect(
      (await screen.findAllByText("Native Save Invoice")).length,
    ).toBeGreaterThan(0);
    await user.click(
      screen.getByRole("button", { name: "Download Original" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Download Searchable PDF" }),
    );

    expect(fileSaver).toHaveBeenNthCalledWith(1, {
      kind: "document-original",
      documentId,
    });
    expect(fileSaver).toHaveBeenNthCalledWith(2, {
      kind: "document-searchable",
      documentId,
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The destination is not writable.",
    );
  });

  it("delegates archive export to the host and surfaces a sanitized failure", async () => {
    server.use(
      http.get(apiUrl("/api/auth/tokens"), () => HttpResponse.json([])),
    );
    const fileSaver = vi.fn(async () => ({
      status: "failed" as const,
      message: "OpenKeep could not write the selected file.",
    }));
    const { user } = renderAuthenticatedApp({ route: "/profile", fileSaver });

    await user.click(
      await screen.findByRole("button", { name: "Export archive" }),
    );

    expect(fileSaver).toHaveBeenCalledWith({ kind: "archive-export" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "OpenKeep could not write the selected file.",
    );
  });

  it("keeps archive export browser-native when no host adapter is present", async () => {
    let exportRequests = 0;
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    server.use(
      http.get(apiUrl("/api/auth/tokens"), () => HttpResponse.json([])),
      http.get(apiUrl("/api/archive/export"), () => {
        exportRequests += 1;
        return HttpResponse.json({ exportedAt: "2026-08-11T10:00:00.000Z" });
      }),
    );
    const { user } = renderAuthenticatedApp({ route: "/profile" });

    await user.click(
      await screen.findByRole("button", { name: "Export archive" }),
    );

    await waitFor(() => expect(exportRequests).toBe(1));
    expect(window.URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:mock-object-url",
    );
    expect(anchorClick).toHaveBeenCalledOnce();
  });
});
