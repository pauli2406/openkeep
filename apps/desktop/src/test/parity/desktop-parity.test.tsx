import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, delay, http } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { makeDocument, makeSearchDocumentsResponse } from "@/test/fixtures";
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

function facets(overrides: Partial<typeof emptyFacets> = {}) {
  return {
    ...emptyFacets,
    years: [{ year: 2026, count: 2 }],
    correspondents: [
      {
        id: "22222222-2222-2222-2222-222222222222",
        name: "Acme Corp",
        slug: "acme-corp",
        count: 2,
        dominantTypeName: "Invoice",
      },
    ],
    documentTypes: [
      {
        id: "33333333-3333-3333-3333-333333333333",
        name: "Invoice",
        slug: "invoice",
        count: 2,
      },
    ],
    statuses: [{ status: "ready", count: 2 }],
    amountRange: { min: 40, max: 180 },
    ...overrides,
  };
}

describe("desktop shared-app parity", () => {
  it("renders Today counts, task rows, document details, and a live preview", async () => {
    const createObjectUrl = vi.fn(() => "blob:desktop-preview");
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(window.URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(window.URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });

    const invoice = makeDocument({
      title: "Desktop March Invoice",
      dueDate: "2026-08-29",
    });
    const recentPolicy = makeDocument({
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      title: "Recently added Policy",
      dueDate: "2026-09-12",
      documentType: {
        ...makeDocument().documentType!,
        name: "Insurance Policy",
        slug: "insurance-policy",
      },
    });

    desktopParityServer.use(
      http.get(desktopApiUrl("/api/dashboard/insights"), () =>
        HttpResponse.json({
          ...emptyInsights,
          stats: {
            totalDocuments: 7,
            pendingReview: 2,
            documentTypesCount: 3,
            correspondentsCount: 4,
          },
          recentDocuments: [recentPolicy],
        }),
      ),
      http.get(desktopApiUrl("/api/documents"), () =>
        HttpResponse.json(makeSearchDocumentsResponse([invoice, recentPolicy])),
      ),
      http.get(desktopApiUrl("/api/documents/:id"), ({ params }) =>
        HttpResponse.json(params.id === invoice.id ? invoice : recentPolicy),
      ),
      http.get(desktopApiUrl("/api/documents/:id/download"), () =>
        new HttpResponse(new Blob(["preview"], { type: "application/pdf" }), {
          headers: { "Content-Type": "application/pdf" },
        }),
      ),
    );

    const view = renderDesktopArchive();

    expect(await screen.findByText("Desktop March Invoice")).toBeInTheDocument();
    expect(await screen.findByText("Personal archive")).toBeInTheDocument();
    expect(screen.getByText("Recently added Policy")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /documents 7/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /review 2/i })).toBeInTheDocument();
    expect(await screen.findByTitle("Desktop March Invoice")).toHaveAttribute(
      "src",
      "blob:desktop-preview",
    );
    expect(screen.getByText("INV-2026-03")).toBeInTheDocument();
    expect(createObjectUrl).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:desktop-preview");
  });

  it("supports explorer facets, text search, selection, export, and bulk deletion", async () => {
    let documents = [
      makeDocument({
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        title: "Desktop Invoice Alpha",
      }),
      makeDocument({
        id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        title: "Desktop Invoice Beta",
      }),
    ];
    const documentRequests: URL[] = [];
    const downloads: string[] = [];

    Object.defineProperty(window.URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:bulk-export"),
    });
    Object.defineProperty(window.URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    desktopParityServer.use(
      http.get(desktopApiUrl("/api/documents/facets"), () =>
        HttpResponse.json(facets()),
      ),
      http.get(desktopApiUrl("/api/documents"), ({ request }) => {
        documentRequests.push(new URL(request.url));
        return HttpResponse.json(makeSearchDocumentsResponse(documents));
      }),
      http.get(desktopApiUrl("/api/documents/:id/download"), ({ params }) => {
        downloads.push(String(params.id));
        return new HttpResponse(new Blob(["pdf"], { type: "application/pdf" }), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${params.id}.pdf"`,
          },
        });
      }),
      http.delete(desktopApiUrl("/api/documents/:id"), ({ params }) => {
        documents = documents.filter((document) => document.id !== params.id);
        return HttpResponse.json({ deleted: true });
      }),
    );

    const { user } = renderDesktopArchive({ route: "/documents" });

    expect(await screen.findByText("Desktop Invoice Alpha")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /acme corp/i })).toBeInTheDocument();

    const search = screen.getByPlaceholderText(
      "Search titles, snippets, or archive terms",
    );
    await user.type(search, "desktop invoice{Enter}");
    await waitFor(() =>
      expect(
        documentRequests.some(
          (url) => url.searchParams.get("query") === "desktop invoice",
        ),
      ).toBe(true),
    );

    await user.click(screen.getByRole("checkbox", { name: /acme corp/i }));
    await waitFor(() =>
      expect(
        documentRequests.some((url) =>
          url.searchParams
            .getAll("correspondentIds")
            .includes("22222222-2222-2222-2222-222222222222"),
        ),
      ).toBe(true),
    );

    await user.click(screen.getByRole("checkbox", { name: "Desktop Invoice Alpha" }));
    await user.click(screen.getByRole("checkbox", { name: "Desktop Invoice Beta" }));
    expect(screen.getByText(/^selected$/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^export$/i }));
    await waitFor(() => expect(downloads).toHaveLength(2));

    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/2 selected items/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /delete now/i }));

    await waitFor(() => {
      expect(screen.queryByText("Desktop Invoice Alpha")).not.toBeInTheDocument();
      expect(screen.queryByText("Desktop Invoice Beta")).not.toBeInTheDocument();
    });
  });

  it("switches the shared explorer between timeline and correspondent groups", async () => {
    desktopParityServer.use(
      http.get(desktopApiUrl("/api/documents/facets"), () =>
        HttpResponse.json(facets()),
      ),
      http.get(desktopApiUrl("/api/documents"), () =>
        HttpResponse.json(makeSearchDocumentsResponse([])),
      ),
      http.get(desktopApiUrl("/api/documents/timeline"), () =>
        HttpResponse.json({
          years: [
            {
              year: 2026,
              count: 2,
              months: [
                {
                  month: 8,
                  count: 2,
                  topCorrespondents: ["Acme Corp"],
                  topTypes: ["Invoice"],
                },
              ],
            },
          ],
        }),
      ),
    );

    const { user } = renderDesktopArchive({ route: "/documents" });
    expect(await screen.findByRole("heading", { name: "Documents" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Timeline" }));
    expect(await screen.findByRole("button", { name: /aug 2026/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Groups" }));
    const group = (await screen.findAllByRole("button", { name: /acme corp/i })).find(
      (candidate) => candidate.textContent?.includes("Invoice"),
    );
    expect(group).toHaveTextContent("2");
    expect(group).toHaveTextContent("Invoice");
  });

  it("renders a correspondent dossier with insights, timeline, and linked documents", async () => {
    const dossierDocument = makeDocument({ title: "Acme Renewal Invoice" });

    desktopParityServer.use(
      http.get(desktopApiUrl("/api/correspondents/acme-corp/insights"), () =>
        HttpResponse.json({
          correspondent: {
            id: "22222222-2222-2222-2222-222222222222",
            name: "Acme Corp",
            slug: "acme-corp",
            summaryGeneratedAt: "2026-08-10T10:00:00.000Z",
            intelligenceGeneratedAt: "2026-08-10T10:00:00.000Z",
          },
          summaryStatus: "ready",
          summary: "Acme is a recurring supplier.",
          intelligenceStatus: "ready",
          intelligence: {
            overview: "Acme is an active supplier relationship.",
            profile: {
              category: "supplier",
              subcategory: null,
              narrative: "Recurring invoices",
              keySignals: ["2 linked documents"],
            },
            timeline: [
              {
                date: "2026-08-01",
                title: "Contract renewed",
                description: "The annual supply agreement was renewed.",
              },
            ],
            changes: [],
            currentState: [
              { label: "Latest document type", value: "Invoice", asOf: "2026-08-01" },
            ],
            domainInsights: {},
            sourceDocumentIds: [dossierDocument.id],
          },
          stats: {
            documentCount: 2,
            totalAmount: 246.9,
            currency: "EUR",
            dateRange: { from: "2026-01-01", to: "2026-08-01" },
            avgConfidence: 0.94,
          },
          documentTypeBreakdown: [{ name: "Invoice", count: 2 }],
          timeline: [{ month: "2026-08", count: 2 }],
          recentDocuments: [dossierDocument],
          upcomingDeadlines: [],
        }),
      ),
      http.get(desktopApiUrl("/api/documents"), () =>
        HttpResponse.json(makeSearchDocumentsResponse([dossierDocument])),
      ),
    );

    renderDesktopArchive({ route: "/correspondents/acme-corp" });

    expect(await screen.findByRole("heading", { name: "Acme Corp" })).toBeInTheDocument();
    expect(screen.getByText("Acme is an active supplier relationship.")).toBeInTheDocument();
    expect(screen.getByText("Contract renewed")).toBeInTheDocument();
    expect(screen.getByText("The annual supply agreement was renewed.")).toBeInTheDocument();
    expect(await screen.findByText("Acme Renewal Invoice")).toBeInTheDocument();
  });

  it("opens the omnibar from the button and Cmd/Ctrl+K, then navigates", async () => {
    desktopParityServer.use(
      http.get(desktopApiUrl("/api/documents"), () =>
        HttpResponse.json(makeSearchDocumentsResponse([])),
      ),
    );

    const { user } = renderDesktopArchive();
    await screen.findByText("Nothing needs you right now");

    await user.click(screen.getByRole("button", { name: /ask the archive/i }));
    const palette = await screen.findByPlaceholderText("Search, ask, or jump to…");
    expect(palette).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByPlaceholderText("Search, ask, or jump to…")).not.toBeInTheDocument();

    await user.keyboard("{Meta>}k{/Meta}");
    const shortcutPalette = await screen.findByPlaceholderText(
      "Search, ask, or jump to…",
    );
    await user.type(shortcutPalette, ">documents{Enter}");

    expect(await screen.findByRole("heading", { name: "Documents" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/documents");
  });

  it("keeps loading, error, retry, and empty explorer states usable", async () => {
    let requestCount = 0;

    desktopParityServer.use(
      http.get(desktopApiUrl("/api/documents/facets"), () =>
        HttpResponse.json(emptyFacets),
      ),
      http.get(desktopApiUrl("/api/documents"), () => {
        requestCount += 1;
        if (requestCount <= 2) {
          return delay(40).then(() =>
            HttpResponse.json({ message: "offline" }, { status: 503 }),
          );
        }
        return HttpResponse.json(makeSearchDocumentsResponse([]));
      }),
    );

    const { user } = renderDesktopArchive({ route: "/documents" });
    expect(await screen.findByText("Loading filtered documents")).toBeInTheDocument();

    expect(
      await screen.findByText(/Failed to load the filtered archive list/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByText("No documents match the current explorer filters."),
    ).toBeInTheDocument();
  });

  it("creates a clean app and QueryClient when an archive profile is remounted", async () => {
    let archive: "alpha" | "beta" = "alpha";
    const requests: Array<{ archive: string; url: URL }> = [];

    desktopParityServer.use(
      http.get(desktopApiUrl("/api/documents/facets"), () =>
        HttpResponse.json(facets()),
      ),
      http.get(desktopApiUrl("/api/documents"), async ({ request }) => {
        const requestedArchive = archive;
        requests.push({ archive: requestedArchive, url: new URL(request.url) });
        if (requestedArchive === "beta") await delay(40);
        const title = requestedArchive === "alpha" ? "Alpha private row" : "Beta clean row";
        return HttpResponse.json(
          makeSearchDocumentsResponse([
            makeDocument({
              id:
                requestedArchive === "alpha"
                  ? "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
                  : "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
              title,
            }),
          ]),
        );
      }),
    );

    const alpha = renderDesktopArchive({
      route: "/documents",
      profile: {
        id: "aaaaaaaa-1111-1111-1111-111111111111",
        label: "Alpha archive",
        serverUrl: "https://alpha.example.test",
      },
    });
    expect(await screen.findByText("Alpha private row")).toBeInTheDocument();

    const search = screen.getByPlaceholderText(
      "Search titles, snippets, or archive terms",
    );
    await alpha.user.type(search, "private alpha filter{Enter}");
    await waitFor(() =>
      expect(
        requests.some(
          (entry) =>
            entry.archive === "alpha" &&
            entry.url.searchParams.get("query") === "private alpha filter",
        ),
      ).toBe(true),
    );
    alpha.unmount();

    archive = "beta";
    renderDesktopArchive({
      route: "/documents",
      profile: {
        id: "bbbbbbbb-1111-1111-1111-111111111111",
        label: "Beta archive",
        serverUrl: "https://beta.example.test",
      },
    });

    expect(screen.queryByText("Alpha private row")).not.toBeInTheDocument();
    expect(
      await screen.findByPlaceholderText("Search titles, snippets, or archive terms"),
    ).toHaveValue("");
    expect(await screen.findByText("Beta clean row")).toBeInTheDocument();
    expect(
      requests.some(
        (entry) =>
          entry.archive === "beta" &&
          !entry.url.searchParams.has("query") &&
          !entry.url.searchParams.has("statuses"),
      ),
    ).toBe(true);
  });
});
