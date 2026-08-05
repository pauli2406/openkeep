/**
 * The fixture archive, behind the same two functions the app uses to reach a
 * server: `authFetch` and `streamFetch`. Nothing else about the app is replaced,
 * so the screenshots render the real screens, the real navigation and the real
 * query layer — only the responses are fixed.
 */
import {
  CORRESPONDENT_INSIGHTS,
  DASHBOARD,
  DOCUMENTS,
  FACETS,
  HISTORY,
  QA_HISTORY,
  REVIEW_QUEUE,
  SEARCH_RESULT,
  TAXONOMIES,
  TEXT,
} from "./fixtures";

/**
 * `?settled=1` hides the queued and failed documents. Their presence makes the
 * list poll every four seconds, and a list that re-renders on a timer never
 * settles enough for Playwright to synthesise a long press on a row. The states
 * themselves are covered by the shots that do not pass this flag.
 */
function settled() {
  return typeof window !== "undefined" && window.location.search.includes("settled=1");
}

function visibleDocuments() {
  return settled() ? DOCUMENTS.filter((entry) => entry.status === "ready") : DOCUMENTS;
}

function json(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function notFound(): Response {
  return {
    ok: false,
    status: 404,
    headers: new Headers(),
    json: async () => ({ message: "Not found" }),
    text: async () => "Not found",
  } as unknown as Response;
}

export async function visualAuthFetch(path: string): Promise<Response> {
  const [route, query = ""] = path.split("?");
  const params = new URLSearchParams(query);

  if (route === "/api/auth/me") {
    return json({
      id: "u-1",
      email: "you@example.com",
      displayName: "You",
      isOwner: true,
      preferences: {
        uiLanguage: "en",
        aiProcessingLanguage: "de",
        aiChatLanguage: "en",
      },
    });
  }
  if (route === "/api/dashboard/insights") {
    return json(DASHBOARD);
  }
  if (route === "/api/documents/facets") {
    return json(FACETS);
  }
  if (route === "/api/documents/review") {
    return json(REVIEW_QUEUE);
  }
  if (route === "/api/documents") {
    // The list screen asks for a filtered page; the fixture answers with the
    // documents that match, so the chips show real counts rather than the lot.
    const pool = visibleDocuments();
    const items = params.get("year")
      ? pool.filter((entry) => (entry.issueDate ?? entry.createdAt).startsWith("2026"))
      : params.get("sort") === "dueDate"
        ? pool.filter((entry) => entry.dueDate)
        : pool;
    return json({ items, total: items.length, page: 1, pageSize: 25 });
  }
  if (route === "/api/search/documents") {
    return json(SEARCH_RESULT);
  }
  if (route === "/api/health/providers") {
    return json({
      activeParseProvider: "azure-document-intelligence",
      fallbackParseProvider: "tesseract",
      activeChatProvider: "anthropic",
      activeEmbeddingProvider: "voyage",
      parseProviders: [
        { id: "azure-document-intelligence", available: true, model: "prebuilt-layout" },
        { id: "tesseract", available: true, model: null },
      ],
      embeddingProviders: [{ id: "voyage", available: true, model: "voyage-3" }],
    });
  }
  if (route.startsWith("/api/taxonomies/")) {
    const kind = route.slice("/api/taxonomies/".length);
    if (kind === "correspondents") return json(TAXONOMIES.correspondents);
    if (kind === "document-types") return json(TAXONOMIES.documentTypes);
    if (kind === "tags") return json(TAXONOMIES.tags);
  }
  if (route.startsWith("/api/correspondents/")) {
    return json(CORRESPONDENT_INSIGHTS);
  }
  if (route.startsWith("/api/documents/")) {
    const rest = route.slice("/api/documents/".length);
    const [id, sub] = rest.split("/");
    const found = DOCUMENTS.find((entry) => entry.id === id) ?? DOCUMENTS[1];
    if (sub === "text") return json({ ...TEXT, documentId: id });
    if (sub === "history") return json({ ...HISTORY, documentId: id });
    if (sub === "qa-history") return json(QA_HISTORY);
    if (!sub) return json(found);
    return json({});
  }

  return notFound();
}

const ANSWER = [
  "Your household premium rises from **79,00 €** to **84,50 €** a month, effective ",
  "1 April 2026 [1]. The letter gives claims development as the reason [2], and the ",
  "cancellation window runs until 28 February each year [3].",
].join("");

/** The same SSE shape `useAnswerStream` reads from the real endpoint. */
export async function visualStreamFetch(): Promise<Response> {
  const events: string[] = [
    `event: search-results\ndata: ${JSON.stringify({
      results: DOCUMENTS.slice(0, 5).map((document) => ({ document, score: 0.82 })),
    })}\n\n`,
    `event: answer-token\ndata: ${JSON.stringify({ text: ANSWER })}\n\n`,
    `event: done\ndata: ${JSON.stringify({
      status: "answered",
      route: "hybrid",
      lowConfidence: false,
      fullAnswer: ANSWER,
      citations: [
        {
          documentId: "d-2",
          documentTitle: "Beitragsanpassung Hausrat",
          chunkIndex: 0,
          quote: "monatlich 84,50 EUR statt 79,00 EUR",
          pageFrom: 2,
          pageTo: 2,
          index: 1,
        },
        {
          documentId: "d-2",
          documentTitle: "Beitragsanpassung Hausrat",
          chunkIndex: 1,
          quote: "Die Anpassung folgt der Schadensentwicklung",
          pageFrom: 2,
          pageTo: 2,
          index: 2,
        },
        {
          documentId: "d-2",
          documentTitle: "Beitragsanpassung Hausrat",
          chunkIndex: 2,
          quote: "Kündigung ist bis 28.02. eines Jahres möglich",
          pageFrom: 3,
          pageTo: 3,
          index: 3,
        },
      ],
      structuredData: null,
    })}\n\n`,
  ];

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const event of events) {
        controller.enqueue(encoder.encode(event));
      }
      controller.close();
    },
  });

  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "text/event-stream" }),
    body,
  } as unknown as Response;
}
