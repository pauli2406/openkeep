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
  NOW,
  QA_HISTORY,
  REVIEW_QUEUE,
  REVIEW_QUEUE_MANY,
  SEARCH_RESULT,
  TAX_YEAR,
  TAXONOMIES,
  TEXT,
  TIMELINE,
  WATCH_FOLDER,
  API_TOKENS,
  CREATED_API_TOKEN,
  EMAIL_INGEST,
  HEALTH,
  PROCESSING_STATUS,
  PROVIDERS,
  READINESS,
  RECOVERY_CODES,
  TAXONOMY_RICH_CATEGORIES,
  TAXONOMY_RICH_TAGS,
  TWO_FACTOR_SETUP,
  WATCH_FOLDER_SCAN,
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

/**
 * `?manydocs=1` repeats the archive past a page, so "Showing x of y" and load
 * more have something to do.
 */
function documentPool() {
  const pool = visibleDocuments();
  if (typeof window === "undefined" || !window.location.search.includes("manydocs=1")) {
    return pool;
  }
  return Array.from({ length: 10 }, (_, round) =>
    pool.map((entry) => (round === 0 ? entry : { ...entry, id: `${entry.id}-${round}` })),
  ).flat();
}

/** The same filters the real endpoint takes, applied to the fixture. */
function matchesParams(entry: (typeof DOCUMENTS)[number], params: URLSearchParams) {
  const within = (key: string, value: string | undefined) => {
    const wanted = params.getAll(key);
    return wanted.length === 0 || (value !== undefined && wanted.includes(value));
  };
  const query = params.get("query")?.toLowerCase();
  const amountMin = params.get("amountMin");
  const amountMax = params.get("amountMax");
  return (
    (!query || entry.title.toLowerCase().includes(query)) &&
    within("statuses", entry.status) &&
    within("correspondentIds", entry.correspondent?.id) &&
    within("documentTypeIds", entry.documentType?.id) &&
    (params.getAll("tags").length === 0 ||
      entry.tags.some((tag) => params.getAll("tags").includes(tag.id))) &&
    (amountMin === null || (entry.amount !== null && entry.amount >= Number(amountMin))) &&
    (amountMax === null || (entry.amount !== null && entry.amount <= Number(amountMax)))
  );
}

function sortedBy(items: typeof DOCUMENTS, params: URLSearchParams) {
  const sort = params.get("sort");
  if (sort !== "title" && sort !== "issueDate") {
    return items;
  }
  const direction = params.get("direction") === "asc" ? 1 : -1;
  return [...items].sort(
    (left, right) => direction * String(left[sort] ?? "").localeCompare(String(right[sort] ?? "")),
  );
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

/**
 * An upload, in turn: a fresh document, a duplicate, a server failure. The rows
 * are only reachable through a file chooser, so a shot that picks three files sees
 * all three outcomes.
 */
let uploads = 0;
function uploadResponse(): Response {
  uploads += 1;
  const turn = uploads % 3;
  if (turn === 0) {
    return {
      ok: false,
      status: 500,
      headers: new Headers(),
      json: async () => ({ message: "Storage is not reachable" }),
      text: async () => JSON.stringify({ message: "Storage is not reachable" }),
    } as unknown as Response;
  }
  return json({
    id: `upload-${uploads}`,
    duplicateOf:
      turn === 2 ? { id: "d-1", title: "Stromabrechnung 2026", createdAt: NOW.toISOString() } : null,
  });
}

function flag(name: string) {
  return typeof window !== "undefined" && window.location.search.includes(name);
}

export async function visualAuthFetch(path: string, init?: RequestInit): Promise<Response> {
  const [route, query = ""] = path.split("?");
  const params = new URLSearchParams(query);

  if (route === "/api/documents" && init?.method === "POST") {
    return uploadResponse();
  }

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
  if (route === "/api/documents/timeline") {
    return json(TIMELINE);
  }
  if (route === "/api/documents/bulk/tags" || route === "/api/documents/bulk/type") {
    return json({ updated: [], failed: [] });
  }
  if (route === "/api/documents/reprocess/bulk") {
    return json({ queued: true, queuedCount: 0, skippedCount: 0 });
  }
  if (route === "/api/documents/review") {
    const wanted = typeof window === "undefined" ? "" : window.location.search;
    if (wanted.includes("reviewqueue=none")) {
      return json({ items: [], total: 0, page: 1, pageSize: 100 });
    }
    return json(wanted.includes("reviewqueue=many") ? REVIEW_QUEUE_MANY : REVIEW_QUEUE);
  }
  if (route === "/api/archive/watch-folder") {
    return json(WATCH_FOLDER);
  }
  if (route === "/api/documents") {
    // The list screen asks for a filtered page; the fixture answers with the
    // documents that match, so the chips show real counts rather than the lot.
    const pool = documentPool().filter((entry) => matchesParams(entry, params));
    const year = params.get("year");
    const dateFrom = params.get("dateFrom");
    const dateTo = params.get("dateTo");
    const items = sortedBy(
      year
        ? pool.filter((entry) => (entry.issueDate ?? entry.createdAt).startsWith(year))
        : params.get("sort") === "dueDate"
          ? pool.filter((entry) => entry.dueDate)
          : dateFrom && dateTo
            ? pool.filter((entry) => {
                const filed = (entry.issueDate ?? entry.createdAt).slice(0, 10);
                return filed >= dateFrom && filed <= dateTo;
              })
            : pool,
      params,
    );
    const page = Number(params.get("page") ?? 1);
    const pageSize = Number(params.get("pageSize") ?? 25);
    return json({
      items: items.slice((page - 1) * pageSize, page * pageSize),
      total: items.length,
      page,
      pageSize,
    });
  }
  if (route === "/api/search/documents") {
    return json(SEARCH_RESULT);
  }
  if (route === "/api/health") return json(HEALTH);
  if (route === "/api/health/ready") return json(READINESS);
  if (route === "/api/health/status") return json(PROCESSING_STATUS);
  if (route === "/api/health/providers") return json(PROVIDERS);
  if (route === "/api/archive/watch-folder/scan") return json(WATCH_FOLDER_SCAN);
  if (route === "/api/email-ingest/status") return json(EMAIL_INGEST);
  if (route === "/api/email-ingest/poll") return json({ success: true });
  if (route === "/api/auth/tokens") {
    if (init?.method === "POST") return json(CREATED_API_TOKEN);
    return json(flag("noTokens=1") ? [] : API_TOKENS);
  }
  if (route.startsWith("/api/auth/tokens/")) return json({ success: true });
  if (route === "/api/auth/2fa/setup") return json(TWO_FACTOR_SETUP);
  if (route === "/api/auth/2fa/enable") return json({ recoveryCodes: RECOVERY_CODES });
  if (route === "/api/auth/2fa/disable") return json({ success: true });
  if (route === "/api/taxonomies/tags" && flag("taxonomy=rich")) {
    return json([...TAXONOMIES.tags, ...TAXONOMY_RICH_TAGS]);
  }
  if (route === "/api/taxonomies/categories" && flag("taxonomy=rich")) {
    return json(TAXONOMY_RICH_CATEGORIES);
  }
  if (route === "/api/taxonomies/correspondents" && flag("taxonomy=rich")) {
    return json(
      TAXONOMIES.correspondents.map((entry, index) => ({
        ...entry,
        categoryId: TAXONOMY_RICH_CATEGORIES[index % 2].id,
        categoryName: TAXONOMY_RICH_CATEGORIES[index % 2].name,
      })),
    );
  }
  if (route.startsWith("/api/taxonomies/")) {
    const kind = route.slice("/api/taxonomies/".length);
    if ((kind === "tags" || kind === "correspondents") && init?.method === "POST") {
      const name = String(JSON.parse(String(init.body ?? "{}")).name ?? "New");
      return json({ id: `${kind}-${name.toLowerCase()}`, name, slug: name.toLowerCase() });
    }
    if (kind === "correspondents") return json(TAXONOMIES.correspondents);
    if (kind === "document-types") return json(TAXONOMIES.documentTypes);
    if (kind === "tags") return json(TAXONOMIES.tags);
    if (kind === "categories") return json(TAXONOMIES.categories);
    if (kind.startsWith("correspondents/")) return json({});
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
    if (sub === "qa-history") {
      if (init?.method === "DELETE") return json({ success: true });
      // The one document with a conversation, so the others show the empty state.
      return json(id === "d-2" ? QA_HISTORY : []);
    }
    if (!sub) return json(found);
    return json({});
  }

  if (route.startsWith("/api/taxes/")) {
    const [yearText, sub] = route.slice("/api/taxes/".length).split("/");
    const year = Number(yearText);
    if (sub === "export") {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/zip" }),
        arrayBuffer: async () => new ArrayBuffer(8),
      } as unknown as Response;
    }
    // Only 2025 is filed; any other year is the empty state.
    return json(
      year === TAX_YEAR.year
        ? TAX_YEAR
        : { year, documentCount: 0, unsummedCount: 0, totals: [], groups: [] },
    );
  }

  return notFound();
}

const ANSWER = [
  "Your household premium rises from **79,00 €** to **84,50 €** a month, effective ",
  "1 April 2026 [1]. The letter gives claims development as the reason [2], and the ",
  "cancellation window runs until 28 February each year [3].",
].join("");

function sseResponse(events: string[], delayMs = 0): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      for (const event of events) {
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
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

function questionOf(init?: RequestInit): string {
  try {
    return String(JSON.parse(String(init?.body ?? "{}")).query ?? "");
  } catch {
    return "";
  }
}

/** Asked about what is overdue, the archive answers with a structured result. */
function overdueEvents(): string[] {
  const answer = "Two invoices are overdue, 324,49 € in total [1].";
  return [
    `event: search-results\ndata: ${JSON.stringify({
      results: [DOCUMENTS[0], DOCUMENTS[2]].map((document) => ({ document, score: 0.9 })),
    })}\n\n`,
    `event: answer-token\ndata: ${JSON.stringify({ text: answer })}\n\n`,
    `event: done\ndata: ${JSON.stringify({
      status: "answered",
      route: "structured",
      lowConfidence: false,
      fullAnswer: answer,
      citations: [
        {
          documentId: "d-3",
          documentTitle: "Mobilfunkrechnung März",
          chunkIndex: 0,
          quote: "Zahlbar bis 15.03.2026",
          pageFrom: 1,
          pageTo: 1,
          index: 1,
          used: true,
        },
      ],
      structuredData: {
        kind: "deadline_items",
        title: "Overdue invoices",
        description: null,
        totalOpenCount: 2,
        totalAmount: 324.49,
        currency: "EUR",
        windowStart: null,
        windowEnd: null,
        items: [
          {
            documentId: "d-3",
            title: "Mobilfunkrechnung März",
            referenceNumber: "DT-9930-2026",
            dueDate: "2026-03-15",
            amount: 39.99,
            currency: "EUR",
            correspondentName: "Deutsche Telekom",
            documentTypeName: "Invoice",
            taskLabel: "Pay now",
            daysUntilDue: -5,
            isOverdue: true,
            taskCompletedAt: null,
          },
          {
            documentId: "d-1",
            title: "Stromabrechnung 2026",
            referenceNumber: "SWM-2026-88214",
            dueDate: "2026-03-28",
            amount: 284.5,
            currency: "EUR",
            correspondentName: "Stadtwerke München",
            documentTypeName: "Invoice",
            taskLabel: "Pay",
            daysUntilDue: 8,
            isOverdue: false,
            taskCompletedAt: null,
          },
        ],
      },
    })}\n\n`,
  ];
}

const DOCUMENT_SUMMARY =
  "The contract's household premium rises to **84,50 EUR** a month from 1 April 2026.";

const DOCUMENT_ANSWER =
  "The cancellation window runs until **28 February** each year [1], and the new premium applies from April [2].";

const DOCUMENT_CITATIONS = [
  {
    chunkIndex: 2,
    pageFrom: 3,
    pageTo: 3,
    index: 1,
    used: true,
    quote: "Kündigung ist bis 28.02. eines Jahres möglich.",
    score: 0.88,
  },
  {
    chunkIndex: 1,
    pageFrom: 2,
    pageTo: 2,
    index: 2,
    used: true,
    quote: "Ihr Beitrag beträgt ab dem 1. April",
    score: 0.74,
  },
];

/**
 * The same SSE shape `useAnswerStream` reads from the real endpoint. The question
 * picks the state: "overdue" a structured result, "fail" an error, "unknown" a
 * refusal with nothing to show, and "slowly" spaces the events out so the progress
 * trace can be seen. Anything else is the premium answer.
 */
export async function visualStreamFetch(path?: string, init?: RequestInit): Promise<Response> {
  if (path?.includes("/summarize/stream")) {
    return sseResponse([
      `event: done\ndata: ${JSON.stringify({
        summary: DOCUMENT_SUMMARY,
        provider: "anthropic",
        model: "claude-haiku",
        generatedAt: NOW.toISOString(),
      })}\n\n`,
    ]);
  }
  const question = questionOf(init).toLowerCase();
  if (path?.includes("/ask/stream") && !question.includes("fail")) {
    return sseResponse([
      `event: citations\ndata: ${JSON.stringify({ citations: DOCUMENT_CITATIONS })}\n\n`,
      `event: answer-token\ndata: ${JSON.stringify({ text: DOCUMENT_ANSWER })}\n\n`,
      `event: done\ndata: ${JSON.stringify({
        status: "answered",
        answer: DOCUMENT_ANSWER,
        citations: DOCUMENT_CITATIONS,
        historyEntryId: "qa-streamed",
      })}\n\n`,
    ]);
  }
  if (question.includes("overdue") || question.includes("überfällig")) {
    return sseResponse(overdueEvents());
  }
  if (question.includes("fail")) {
    return sseResponse([
      `event: error\ndata: ${JSON.stringify({ message: "The chat provider did not answer." })}\n\n`,
    ]);
  }
  if (question.includes("unknown")) {
    return sseResponse([
      `event: search-results\ndata: ${JSON.stringify({ results: [] })}\n\n`,
      `event: done\ndata: ${JSON.stringify({
        status: "insufficient_evidence",
        route: "semantic",
        lowConfidence: false,
        citations: [],
        structuredData: null,
      })}\n\n`,
    ]);
  }
  const slowly = question.includes("slowly");
  const events: string[] = [
    ...(slowly
      ? [
          `event: tool-status\ndata: ${JSON.stringify({
            status: "started",
            label: "Reading Beitragsanpassung Hausrat",
          })}\n\n`,
        ]
      : []),
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
          used: true,
        },
        {
          documentId: "d-2",
          documentTitle: "Beitragsanpassung Hausrat",
          chunkIndex: 1,
          quote: "Die Anpassung folgt der Schadensentwicklung",
          pageFrom: 2,
          pageTo: 2,
          index: 2,
          used: true,
        },
        {
          documentId: "d-2",
          documentTitle: "Beitragsanpassung Hausrat",
          chunkIndex: 2,
          quote: "Kündigung ist bis 28.02. eines Jahres möglich",
          pageFrom: 3,
          pageTo: 3,
          index: 3,
          used: true,
        },
        {
          documentId: "d-1",
          documentTitle: "Stromabrechnung 2026",
          chunkIndex: 0,
          quote: "Abschlag ab April 94,00 EUR",
          pageFrom: 1,
          pageTo: 1,
          index: 4,
          used: false,
        },
      ],
      structuredData: null,
    })}\n\n`,
  ];

  return sseResponse(events, slowly ? 2500 : 0);
}
