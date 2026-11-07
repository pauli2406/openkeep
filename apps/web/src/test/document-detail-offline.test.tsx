import { screen, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { apiUrl } from "./api-url";
import {
  makeCorrespondent,
  makeDocument,
  makeDocumentType,
  makeHealthProvidersResponse,
  makeTag,
} from "./fixtures";
import { server } from "./msw-server";
import { renderAuthenticatedApp } from "./render-app";

vi.mock("@/lib/host-shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/host-shell")>()),
  useOfflineReadOnly: () => true,
}));

const documentId = "11111111-1111-1111-1111-111111111111";

describe("document detail on an offline copy", () => {
  it("reads everything but offers nothing that would change the archive", async () => {
    server.use(
      http.get(apiUrl("/api/taxonomies/tags"), () => HttpResponse.json([makeTag()])),
      http.get(apiUrl("/api/taxonomies/correspondents"), () =>
        HttpResponse.json([makeCorrespondent()]),
      ),
      http.get(apiUrl("/api/taxonomies/document-types"), () =>
        HttpResponse.json([makeDocumentType()]),
      ),
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
    );

    const { user } = renderAuthenticatedApp({ route: `/documents/${documentId}` });
    expect((await screen.findAllByText("March Invoice"))[0]).toBeInTheDocument();

    // The fields read but do not edit; the disclosure next to them still works.
    expect(screen.getByRole("button", { name: /123\.45/ })).toBeDisabled();
    expect(screen.getByPlaceholderText(/add tag/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /more fields/i })).toBeEnabled();

    // The header's actions are outside any fieldset, so each one guards itself.
    expect(screen.getByRole("button", { name: /resolve review/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /more actions/i }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /^reprocess$/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(within(menu).getByRole("menuitem", { name: /^delete$/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(within(menu).getByRole("menuitem", { name: /^original$/i })).not.toHaveAttribute(
      "aria-disabled",
    );
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("tab", { name: "Q&A" }));
    expect(
      within(screen.getByRole("tabpanel")).getByRole("status"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /ask a question/i })).not.toBeInTheDocument();
  });
});
