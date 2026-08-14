/**
 * A fixed-response stand-in for the API, used only by the visual suite.
 *
 * Screenshots have to move when the *design* changes and at no other time.
 * Pointing them at a real backend would mean baselines churning on every
 * reseed, every clock tick and every ordering difference, which trains people
 * to re-bless diffs without reading them — at which point the suite is worse
 * than nothing.
 *
 * So: no database, no clock, no randomness. Every response below is a literal.
 * Dates are fixed and chosen to sit either side of the frozen "today" the
 * browser is given in `freeze-time.mjs`, so relative labels ("3 days overdue")
 * are stable too.
 */
import { createServer } from "node:http";

/** The instant the browser's clock is pinned to. Keep in sync with freeze-time. */
export const FROZEN_NOW = "2026-03-20T09:00:00.000Z";

const USER = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "owner@example.com",
  displayName: "Owner",
  isOwner: true,
  twoFactorEnabled: false,
  preferences: {
    uiLanguage: "en",
    aiProcessingLanguage: "en",
    aiChatLanguage: "en",
  },
};

const CORRESPONDENTS = [
  { id: "c0000000-0000-4000-8000-000000000001", name: "Stadtwerke München", slug: "stadtwerke-muenchen" },
  { id: "c0000000-0000-4000-8000-000000000002", name: "Finanzamt München", slug: "finanzamt-muenchen" },
  { id: "c0000000-0000-4000-8000-000000000003", name: "HUK-Coburg", slug: "huk-coburg" },
  { id: "c0000000-0000-4000-8000-000000000004", name: "Telekom Deutschland", slug: "telekom-deutschland" },
];

const TYPES = [
  { id: "t0000000-0000-4000-8000-000000000001", name: "Utility Bill", slug: "utility-bill", description: null, requiredFields: [] },
  { id: "t0000000-0000-4000-8000-000000000002", name: "Tax notice", slug: "tax-notice", description: null, requiredFields: [] },
  { id: "t0000000-0000-4000-8000-000000000003", name: "Insurance", slug: "insurance", description: null, requiredFields: [] },
];

const TAGS = [
  { id: "a0000000-0000-4000-8000-000000000001", name: "Finance", slug: "finance" },
  { id: "a0000000-0000-4000-8000-000000000002", name: "Household", slug: "household" },
  { id: "a0000000-0000-4000-8000-000000000003", name: "Important", slug: "important" },
];

function makeDocument(index, overrides = {}) {
  const correspondent = CORRESPONDENTS[index % CORRESPONDENTS.length];
  const documentType = TYPES[index % TYPES.length];
  return {
    id: `d0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    title: [
      "Stromabrechnung 2026",
      "Einkommensteuerbescheid 2025",
      "Haftpflicht Police",
      "Mobilfunk Rechnung März",
      "Grundsteuerbescheid",
      "Hausratversicherung",
    ][index % 6],
    source: "upload",
    mimeType: "application/pdf",
    checksum: "a".repeat(64),
    storageKey: `documents/${index}`,
    status: "ready",
    language: "de",
    issueDate: `2026-0${(index % 3) + 1}-1${index % 9}`,
    dueDate: index % 4 === 0 ? "2026-03-18" : "2026-04-15",
    taskCompletedAt: null,
    expiryDate: null,
    amount: 40 + index * 13.5,
    currency: "EUR",
    referenceNumber: `INV-2026-${String(index).padStart(4, "0")}`,
    holderName: null,
    issuingAuthority: null,
    correspondent,
    documentType,
    tags: [TAGS[index % TAGS.length]],
    confidence: index % 5 === 0 ? 0.52 : 0.94,
    reviewStatus: index % 5 === 0 ? "pending" : "not_required",
    reviewReasons: index % 5 === 0 ? ["low_confidence"] : [],
    reviewedAt: null,
    reviewNote: null,
    searchablePdfAvailable: true,
    parseProvider: "local-ocr",
    chunkCount: 4,
    embeddingStatus: "ready",
    embeddingProvider: "openai",
    embeddingModel: "text-embedding-3-small",
    embeddingsStale: false,
    lastProcessingError: null,
    latestProcessingJob: {
      id: "44444444-4444-4444-4444-444444444444",
      status: "completed",
      attempts: 1,
      lastError: null,
      startedAt: "2026-03-19T10:00:00.000Z",
      finishedAt: "2026-03-19T10:01:00.000Z",
      createdAt: "2026-03-19T09:59:00.000Z",
      updatedAt: "2026-03-19T10:01:00.000Z",
    },
    latestEmbeddingJob: null,
    metadata: { detectedKeywords: ["rechnung"], reviewReasons: [], chunkCount: 4, pageCount: 2 },
    createdAt: "2026-03-19T09:59:00.000Z",
    processedAt: "2026-03-19T10:01:00.000Z",
    ...overrides,
  };
}

const DOCUMENTS = Array.from({ length: 12 }, (_, index) => makeDocument(index));

const ROUTES = [
  ["GET", /^\/api\/health$/, () => ({
    status: "ok",
    provider: {
      mode: "local-only",
      activeParseProvider: "local-ocr",
      fallbackParseProvider: null,
      activeChatProvider: "openai",
      activeEmbeddingProvider: "openai",
      openaiModel: "gpt-4.1-mini",
      openaiEmbeddingModel: "text-embedding-3-small",
      hasOpenAiKey: true,
      hasGeminiKey: false,
      hasMistralKey: false,
      hasVoyageKey: false,
      hasGoogleCloudConfig: false,
      hasAwsTextractConfig: false,
      hasAzureDocumentIntelligenceConfig: false,
      hasMistralOcrConfig: false,
      hasMistralEmbeddingConfig: false,
    },
  })],
  ["GET", /^\/api\/health\/ready$/, () => ({
    status: "ok",
    checks: { database: true, objectStorage: true, queue: true },
  })],
  ["GET", /^\/api\/health\/providers$/, () => ({
    activeParseProvider: "local-ocr",
    fallbackParseProvider: null,
    activeChatProvider: "openai",
    activeEmbeddingProvider: "openai",
    parseProviders: [
      { id: "local-ocr", available: true },
      { id: "amazon-textract", available: false },
    ],
    embeddingProviders: [
      { id: "openai", available: true, model: "text-embedding-3-small" },
      { id: "voyage", available: false, model: null },
    ],
  })],
  ["GET", /^\/api\/health\/status$/, () => ({
    queues: { processing: { depth: 2 }, embedding: { depth: 1 } },
    documents: { byStatus: { ready: 11, processing: 1, failed: 0 }, pendingReview: 3 },
    recentJobs: [
      {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        documentId: DOCUMENTS[0].id,
        queueName: "document.process",
        status: "completed",
        attempts: 1,
        lastError: null,
        startedAt: "2026-03-19T10:00:00.000Z",
        finishedAt: "2026-03-19T10:00:12.000Z",
        createdAt: "2026-03-19T09:59:00.000Z",
        updatedAt: "2026-03-19T10:00:12.000Z",
      },
    ],
  })],
  ["GET", /^\/api\/auth\/me$/, () => USER],
  ["GET", /^\/api\/auth\/tokens$/, () => []],
  ["GET", /^\/api\/taxonomies\/tags$/, () => TAGS],
  ["GET", /^\/api\/taxonomies\/correspondents$/, () => CORRESPONDENTS],
  ["GET", /^\/api\/taxonomies\/document-types$/, () => TYPES],
  ["GET", /^\/api\/documents\/facets$/, () => ({
    years: [{ year: 2026, count: 12 }, { year: 2025, count: 4 }],
    correspondents: CORRESPONDENTS.map((entry, index) => ({
      ...entry,
      count: 12 - index * 2,
      dominantTypeName: TYPES[index % TYPES.length].name,
    })),
    documentTypes: TYPES.map((entry, index) => ({ ...entry, count: 6 - index })),
    tags: TAGS.map((entry, index) => ({ ...entry, count: 5 - index })),
    amountRange: { min: 12, max: 980 },
    statuses: [{ status: "ready", count: 11 }, { status: "processing", count: 1 }],
  })],
  ["GET", /^\/api\/taxes\/\d+$/, () => ({
    year: 2025,
    documentCount: 4,
    unsummedCount: 1,
    totals: [
      { currency: "EUR", sum: 1874.4, count: 3 },
    ],
    groups: [
      {
        documentTypeId: TYPES[1].id,
        documentType: TYPES[1].name,
        count: 2,
        unsummedCount: 1,
        totals: [{ currency: "EUR", sum: 1650.4, count: 1 }],
        documents: [
          {
            id: "d0000000-0000-4000-8000-000000000101",
            title: "Einkommensteuerbescheid 2025",
            issueDate: "2025-11-20",
            correspondentName: "Finanzamt München",
            amount: 1650.4,
            currency: "EUR",
            memberVia: "both",
          },
          {
            id: "d0000000-0000-4000-8000-000000000102",
            title: "Belegsammlung Werbungskosten",
            issueDate: "2025-12-30",
            correspondentName: "Finanzamt München",
            amount: null,
            currency: null,
            memberVia: "type",
          },
        ],
      },
      {
        documentTypeId: TYPES[2].id,
        documentType: TYPES[2].name,
        count: 1,
        unsummedCount: 0,
        totals: [{ currency: "EUR", sum: 189, count: 1 }],
        documents: [
          {
            id: "d0000000-0000-4000-8000-000000000103",
            title: "Haftpflicht Beitragsrechnung 2025",
            issueDate: "2025-01-05",
            correspondentName: "HUK-Coburg",
            amount: 189,
            currency: "EUR",
            memberVia: "tag",
          },
        ],
      },
      {
        documentTypeId: null,
        documentType: null,
        count: 1,
        unsummedCount: 0,
        totals: [{ currency: "EUR", sum: 35, count: 1 }],
        documents: [
          {
            id: "d0000000-0000-4000-8000-000000000104",
            title: "Spendenquittung Rotes Kreuz",
            issueDate: "2025-06-14",
            correspondentName: "Rotes Kreuz",
            amount: 35,
            currency: "EUR",
            memberVia: "tag",
          },
        ],
      },
    ],
  })],
  ["GET", /^\/api\/documents\/review$/, () => ({
    items: DOCUMENTS.filter((doc) => doc.reviewStatus === "pending"),
    total: 3,
    page: 1,
    pageSize: 100,
    appliedFilters: {},
  })],
  ["GET", /^\/api\/documents\/timeline$/, () => ({
    years: [
      {
        year: 2026,
        count: 12,
        months: [
          { month: 3, count: 6, topCorrespondents: ["Stadtwerke München"], topTypes: ["Utility Bill"] },
          { month: 2, count: 4, topCorrespondents: ["Finanzamt München"], topTypes: ["Tax notice"] },
          { month: 1, count: 2, topCorrespondents: ["HUK-Coburg"], topTypes: ["Insurance"] },
        ],
      },
    ],
  })],
  ["GET", /^\/api\/dashboard\/insights$/, () => ({
    stats: { totalDocuments: 12, pendingReview: 3, documentTypesCount: 3, correspondentsCount: 4 },
    topCorrespondents: CORRESPONDENTS.slice(0, 4).map((entry, index) => ({
      id: entry.id,
      name: entry.name,
      slug: entry.slug,
      count: 12 - index * 2,
      documentTypes: [{ name: TYPES[index % TYPES.length].name, count: 4 }],
    })),
    upcomingDeadlines: DOCUMENTS.slice(0, 3),
    overdueItems: DOCUMENTS.slice(3, 5),
    recentDocuments: DOCUMENTS.slice(0, 5),
    monthlyActivity: [
      { month: "2026-01", count: 2 },
      { month: "2026-02", count: 4 },
      { month: "2026-03", count: 6 },
    ],
  })],
  ["GET", /^\/api\/archive\/watch-folder$/, () => ({
    configured: true,
    configuredPath: "/srv/watch",
    lastScan: { scannedAt: "2026-03-20T08:00:00.000Z", imported: 2, dryRun: false },
    lastImport: { scannedAt: "2026-03-20T08:00:00.000Z", imported: 2, dryRun: false },
    history: [{ scannedAt: "2026-03-20T08:00:00.000Z", imported: 2, dryRun: false }],
  })],
  ["GET", /^\/api\/documents$/, () => ({
    items: DOCUMENTS,
    total: DOCUMENTS.length,
    page: 1,
    pageSize: 20,
    appliedFilters: {},
  })],
  ["GET", /^\/api\/documents\/[^/]+\/text$/, () => ({
    documentId: DOCUMENTS[0].id,
    blocks: [
      { documentId: DOCUMENTS[0].id, page: 1, lineIndex: 0, boundingBox: null, text: "Rechnungsbetrag 128,50 EUR" },
    ],
  })],
  ["GET", /^\/api\/documents\/[^/]+\/history$/, () => ({ documentId: DOCUMENTS[0].id, items: [] })],
  ["GET", /^\/api\/documents\/[^/]+$/, () => DOCUMENTS[0]],
];

export function startMockApi(port) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const route = ROUTES.find(
      ([method, pattern]) => method === request.method && pattern.test(url.pathname),
    );

    response.setHeader("Content-Type", "application/json");
    if (!route) {
      // Loud rather than silent: an unmocked call means a screen is rendering
      // an error state, which would otherwise quietly become the baseline.
      console.warn(`[mock-api] unhandled ${request.method} ${url.pathname}`);
      response.statusCode = 404;
      response.end(JSON.stringify({ message: "Not mocked", path: url.pathname }));
      return;
    }

    response.statusCode = 200;
    response.end(JSON.stringify(route[2](url)));
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

if (process.argv[1]?.endsWith("mock-api.mjs")) {
  const port = Number(process.env.MOCK_API_PORT ?? 3000);
  await startMockApi(port);
  console.log(`[mock-api] listening on ${port}`);
}
