import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiUrl } from "./api-url";
import { makeDocument } from "./fixtures";
import { server } from "./msw-server";
import { renderAuthenticatedApp } from "./render-app";

const DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";

const CITATION = {
  index: 1,
  documentId: DOCUMENT_ID,
  documentTitle: "March Invoice",
  chunkIndex: 0,
  quote: "Amount due 123,45 EUR",
  pageFrom: 2,
  pageTo: 2,
  used: true,
};

/**
 * Answers the stream endpoint directly, like answer-stream.test.tsx: jsdom's
 * AbortSignal is not one Node's fetch accepts, so this request cannot reach MSW.
 */
function streamAnswer(events: Array<[string, unknown]>) {
  const realFetch = globalThis.fetch.bind(globalThis);
  const body = events
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    return url.includes("/api/search/answer/stream")
      ? Promise.resolve(
          new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
        )
      : realFetch(input, init);
  });
}

function answerWith(answer: string) {
  streamAnswer([
    ["answer-token", { text: answer }],
    ["done", { status: "answered", citations: [CITATION], fullAnswer: answer }],
  ]);
}

describe("omnibar", () => {
  beforeEach(() => {
    server.use(
      http.get(apiUrl("/api/documents"), () =>
        HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 100 }),
      ),
      http.get(apiUrl("/api/dashboard/insights"), () =>
        HttpResponse.json({
          stats: { totalDocuments: 1, pendingReview: 0, documentTypesCount: 0, correspondentsCount: 0 },
          topCorrespondents: [],
          upcomingDeadlines: [],
          overdueItems: [],
          recentDocuments: [makeDocument()],
          monthlyActivity: [],
        }),
      ),
      http.get(apiUrl("/api/documents/facets"), () =>
        HttpResponse.json({
          correspondents: [],
          documentTypes: [],
          tags: [],
          years: [],
          amountRange: { min: null, max: null },
          statuses: [],
        }),
      ),
    );
  });

  async function openWithShortcut(user: ReturnType<typeof renderAuthenticatedApp>["user"]) {
    await screen.findByRole("button", { name: /ask the archive/i });
    await user.keyboard("{Control>}k{/Control}");
    return screen.findByRole("dialog");
  }

  it("walks the palette with the arrow keys and runs the selected row", async () => {
    const { user, router } = renderAuthenticatedApp({ route: "/" });
    const dialog = await openWithShortcut(user);

    expect(within(dialog).getByRole("combobox")).toHaveFocus();
    const selected = () => dialog.querySelector('[cmdk-item][data-selected="true"]');
    await waitFor(() => expect(selected()).toHaveTextContent("Today"));

    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(selected()).toHaveTextContent("Documents"));
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe("/documents");
  });

  it("streams an answer, previews a citation, and steps back one level per Escape", async () => {
    answerWith("The amount due is 123,45 EUR [1].");
    server.use(
      http.get(apiUrl(`/api/documents/${DOCUMENT_ID}`), () =>
        HttpResponse.json(makeDocument({ id: DOCUMENT_ID, title: "March Invoice" })),
      ),
      http.get(apiUrl(`/api/documents/${DOCUMENT_ID}/text`), () =>
        HttpResponse.json({
          documentId: DOCUMENT_ID,
          blocks: [
            {
              documentId: DOCUMENT_ID,
              page: 2,
              lineIndex: 0,
              boundingBox: { x: 0, y: 0, width: 1, height: 1 },
              text: "Amount due 123,45 EUR",
            },
          ],
        }),
      ),
    );

    const { user } = renderAuthenticatedApp({ route: "/" });
    const dialog = await openWithShortcut(user);

    await user.keyboard("what is due{Enter}");
    expect(await within(dialog).findByText(/The amount due is/)).toBeInTheDocument();
    const fullSearch = within(dialog).getByRole("link", { name: /open full search/i });
    expect(fullSearch.getAttribute("href")).toContain("/search?q=what");

    // Enter on a button in the results must reach the button, not the palette.
    within(dialog).getByRole("button", { name: /March Invoice p\.2/ }).focus();
    await user.keyboard("{Enter}");
    expect(await within(dialog).findByText("Amount due 123,45 EUR")).toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(await within(dialog).findByRole("combobox")).toHaveValue("what is due");
    expect(within(dialog).getByText(/The amount due is/)).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(within(dialog).getByRole("combobox")).toHaveValue(""));
    expect(within(dialog).queryByText(/The amount due is/)).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("offers a retry when the answer fails", async () => {
    streamAnswer([["error", { message: "The chat provider did not respond." }]]);

    const { user } = renderAuthenticatedApp({ route: "/" });
    const dialog = await openWithShortcut(user);
    await user.keyboard("what is due{Enter}");

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The chat provider did not respond.",
    );

    vi.mocked(globalThis.fetch).mockRestore();
    answerWith("Fine now.");
    await user.click(within(dialog).getByRole("button", { name: /retry/i }));
    expect(await within(dialog).findByText("Fine now.")).toBeInTheDocument();
  });
});
