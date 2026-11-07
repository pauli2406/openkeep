/**
 * One archive, fixed. Every screenshot renders from this and nothing else — no
 * clock, no network, no device state — so a diff means the rendering changed.
 *
 * The shapes are the API's, not invented: `ArchiveDocument`, `DashboardInsights`,
 * `ReviewQueueResponse`, `FacetsResponse` and the correspondent insights payload.
 */
import type { TaxYearResponse } from "../src/api/taxes";
import type {
  ArchiveDocument,
  CorrespondentInsightsResponse,
  DashboardInsights,
  DocumentHistoryResponse,
  DocumentTextResponse,
  FacetsResponse,
  QaHistoryEntry,
  SearchDocumentsResponse,
  TaxonomyOption,
} from "../src/lib";
import type { DocumentsTimelineResponse } from "../src/api/documents";

/** Every relative date on a screen is measured from here. */
export const NOW = new Date("2026-03-20T09:00:00.000Z");

const CORRESPONDENTS: TaxonomyOption[] = [
  { id: "c-stadtwerke", name: "Stadtwerke München", slug: "stadtwerke-muenchen" },
  { id: "c-allianz", name: "Allianz Versicherung", slug: "allianz-versicherung" },
  { id: "c-telekom", name: "Deutsche Telekom", slug: "deutsche-telekom" },
  { id: "c-finanzamt", name: "Finanzamt München", slug: "finanzamt-muenchen" },
  { id: "c-vermieter", name: "Hausverwaltung Lindwurm", slug: "hausverwaltung-lindwurm" },
];

const TYPES: TaxonomyOption[] = [
  { id: "t-invoice", name: "Invoice", slug: "invoice" },
  { id: "t-contract", name: "Contract", slug: "contract" },
  { id: "t-statement", name: "Statement", slug: "statement" },
  { id: "t-letter", name: "Letter", slug: "letter" },
];

const CATEGORIES: TaxonomyOption[] = [
  { id: "cat-housing", name: "Housing", slug: "housing" },
  { id: "cat-insurance", name: "Insurance", slug: "insurance" },
  { id: "cat-taxes", name: "Taxes", slug: "taxes" },
];

const TAGS: TaxonomyOption[] = [
  { id: "tag-home", name: "Home", slug: "home" },
  { id: "tag-tax", name: "Tax", slug: "tax" },
  { id: "tag-insurance", name: "Insurance", slug: "insurance" },
  { id: "tag-utilities", name: "Utilities", slug: "utilities" },
];

function document(fields: Partial<ArchiveDocument> & { id: string }): ArchiveDocument {
  return {
    status: "ready",
    reviewStatus: "not_required",
    reviewReasons: [],
    mimeType: "application/pdf",
    searchablePdfAvailable: true,
    createdAt: "2026-03-18T07:40:00.000Z",
    processedAt: "2026-03-18T07:41:12.000Z",
    issueDate: null,
    dueDate: null,
    expiryDate: null,
    amount: null,
    currency: "EUR",
    referenceNumber: null,
    holderName: null,
    issuingAuthority: null,
    confidence: 0.94,
    correspondent: null,
    documentType: null,
    tags: [],
    taskCompletedAt: null,
    lastProcessingError: null,
    latestProcessingJob: null,
    parseProvider: "azure-document-intelligence",
    chunkCount: 4,
    embeddingStatus: "ready",
    embeddingProvider: "voyage",
    embeddingModel: "voyage-3",
    metadata: { pageCount: 2 },
    ...fields,
  } as ArchiveDocument;
}

export const DOCUMENTS: ArchiveDocument[] = [
  document({
    id: "d-1",
    title: "Stromabrechnung 2026",
    correspondent: CORRESPONDENTS[0],
    documentType: TYPES[0],
    tags: [TAGS[3], TAGS[0]],
    issueDate: "2026-03-14",
    dueDate: "2026-03-28",
    amount: 284.5,
    referenceNumber: "SWM-2026-88214",
    createdAt: "2026-03-20T06:15:00.000Z",
    confidence: 0.96,
  }),
  document({
    id: "d-2",
    title: "Beitragsanpassung Hausrat",
    correspondent: CORRESPONDENTS[1],
    documentType: TYPES[1],
    tags: [TAGS[2]],
    issueDate: "2026-03-11",
    expiryDate: "2027-04-01",
    amount: 84.5,
    referenceNumber: "AZ-4711-2026",
    reviewStatus: "pending",
    reviewReasons: ["low_confidence"],
    confidence: 0.62,
    createdAt: "2026-03-19T16:02:00.000Z",
    metadata: {
      pageCount: 3,
      reviewEvidence: {
        requiredFields: ["issueDate", "amount", "correspondentName", "dueDate"],
        missingFields: ["dueDate"],
        confidence: 0.62,
        confidenceThreshold: 0.8,
      },
      manual: { lockedFields: ["referenceNumber"], values: { referenceNumber: "AZ-4711-2026" } },
      email: {
        from: "kundenservice@allianz.example",
        subject: "Ihre Beitragsanpassung",
        receivedAt: "2026-03-19T15:58:00.000Z",
      },
      summary: "Allianz raises the household premium from 79,00 EUR to 84,50 EUR a month.",
      intelligence: {
        routing: {
          documentType: "Contract",
          subtype: "Premium adjustment",
          confidence: 0.88,
          reasoningHints: ["Beitrag", "Vertragsnummer"],
          provider: "anthropic",
          model: "claude-haiku",
        },
        title: { value: "Beitragsanpassung Hausrat", confidence: 0.91 },
        summary: {
          value:
            "**Allianz** raises the household premium from 79,00 EUR to **84,50 EUR** a month, effective 1 April 2026. The letter gives claims development as the reason, and the contract can be cancelled until 28 February each year.",
          provider: "anthropic",
          model: "claude-haiku",
        },
        extraction: {
          documentType: "Contract",
          fields: { amount: 84.5, currency: "EUR", effectiveDate: "2026-04-01", contractNumber: "AZ-4711-2026" },
          fieldConfidence: { amount: 0.58, correspondentName: 0.71, issueDate: 0.93, effectiveDate: 0.86 },
          fieldProvenance: {
            amount: {
              source: "ocr",
              provider: "anthropic",
              page: 2,
              lineIndex: 1,
              snippet: "monatlich 84,50 EUR statt 79,00 EUR.",
            },
          },
          provider: "anthropic",
          model: "claude-haiku",
        },
        tagging: { tags: ["Insurance", "Household"], confidence: 0.84 },
        correspondentResolution: {
          resolvedName: "Allianz Versicherung",
          confidence: 0.71,
          strategy: "fuzzy-match",
        },
        validation: {
          normalizedFields: {},
          warnings: ["low_confidence"],
          errors: [],
          duplicateSignals: {},
        },
        pipeline: {
          framework: "langgraph",
          runId: "run_8f2c41",
          status: "completed",
          providerOrder: ["anthropic", "openai"],
          durationsMs: { parse: 2140, extract: 870 },
        },
      },
    },
  }),
  document({
    id: "d-3",
    title: "Mobilfunkrechnung März",
    correspondent: CORRESPONDENTS[2],
    documentType: TYPES[0],
    tags: [TAGS[3]],
    issueDate: "2026-03-08",
    dueDate: "2026-03-15",
    amount: 39.99,
    referenceNumber: "DT-9930-2026",
    createdAt: "2026-03-18T09:20:00.000Z",
  }),
  document({
    id: "d-4",
    title: "Einkommensteuerbescheid 2025",
    correspondent: CORRESPONDENTS[3],
    documentType: TYPES[3],
    tags: [TAGS[1]],
    issueDate: "2026-02-27",
    amount: -412.0,
    referenceNumber: "FA-2025-77121",
    createdAt: "2026-03-16T11:05:00.000Z",
    confidence: 0.88,
  }),
  document({
    id: "d-5",
    title: "Nebenkostenabrechnung 2025",
    correspondent: CORRESPONDENTS[4],
    documentType: TYPES[2],
    tags: [TAGS[0]],
    issueDate: "2026-02-19",
    dueDate: "2026-04-02",
    amount: 612.4,
    createdAt: "2026-03-14T08:30:00.000Z",
  }),
  document({
    id: "d-6",
    title: "Scan vom 20.03.2026",
    status: "pending",
    latestProcessingJob: {
      id: "job-1",
      status: "queued",
      attempts: 0,
      lastError: null,
      startedAt: null,
      finishedAt: null,
      createdAt: "2026-03-20T08:58:00.000Z",
      updatedAt: "2026-03-20T08:58:00.000Z",
    },
    confidence: null,
    searchablePdfAvailable: false,
    createdAt: "2026-03-20T08:58:00.000Z",
    metadata: {},
  }),
  document({
    id: "d-7",
    title: "Kontoauszug Februar",
    status: "failed",
    lastProcessingError: "OCR returned no text for pages 2-4 (unsupported scan resolution).",
    correspondent: CORRESPONDENTS[4],
    confidence: null,
    searchablePdfAvailable: false,
    createdAt: "2026-03-17T13:45:00.000Z",
    metadata: {},
  }),
];

export const REVIEW_QUEUE: SearchDocumentsResponse = {
  items: [DOCUMENTS[1]],
  total: 1,
  page: 1,
  pageSize: 25,
};

/** `?reviewqueue=many`: a queue with something to filter and to walk. */
export const REVIEW_QUEUE_MANY: SearchDocumentsResponse = {
  items: [
    DOCUMENTS[1],
    {
      ...DOCUMENTS[2],
      id: "d-3-review",
      reviewStatus: "pending",
      reviewReasons: ["missing_key_fields", "low_confidence"],
      confidence: 0.41,
      amount: null,
      createdAt: "2026-03-14T09:20:00.000Z",
    },
    {
      ...DOCUMENTS[0],
      id: "d-1-review",
      reviewStatus: "pending",
      reviewReasons: ["classification_ambiguous"],
      confidence: 0.88,
      createdAt: "2026-03-18T06:15:00.000Z",
    },
    {
      ...DOCUMENTS[3],
      id: "d-4-review",
      reviewStatus: "pending",
      reviewReasons: ["correspondent_unresolved"],
      confidence: 0.91,
      createdAt: "2026-03-17T11:05:00.000Z",
    },
  ],
  total: 4,
  page: 1,
  pageSize: 100,
};

export const WATCH_FOLDER = {
  configured: true,
  configuredPath: "/srv/watch",
  lastImport: { scannedAt: "2026-03-20T08:00:00.000Z", imported: 2 },
  history: [{ scannedAt: "2026-03-20T08:00:00.000Z", imported: 2, dryRun: false }],
};

export const SEARCH_RESULT: SearchDocumentsResponse = {
  items: DOCUMENTS,
  total: DOCUMENTS.length,
  page: 1,
  pageSize: 25,
};

export const DASHBOARD: DashboardInsights = {
  stats: {
    totalDocuments: 248,
    pendingReview: 1,
    documentTypesCount: TYPES.length,
    correspondentsCount: CORRESPONDENTS.length,
  },
  recentDocuments: DOCUMENTS.slice(0, 4),
  topCorrespondents: [
    { id: "c-stadtwerke", name: "Stadtwerke München", slug: "stadtwerke-muenchen", count: 34 },
    { id: "c-allianz", name: "Allianz Versicherung", slug: "allianz-versicherung", count: 21 },
    { id: "c-telekom", name: "Deutsche Telekom", slug: "deutsche-telekom", count: 18 },
  ],
  upcomingDeadlines: [
    {
      documentId: "d-1",
      title: "Stromabrechnung 2026",
      referenceNumber: "SWM-2026-88214",
      dueDate: "2026-03-28",
      amount: 284.5,
      currency: "EUR",
      correspondentName: "Stadtwerke München",
      documentTypeName: "Invoice",
      taskLabel: "Stromabrechnung 2026",
      daysUntilDue: 8,
      isOverdue: false,
      taskCompletedAt: null,
    },
    {
      documentId: "d-5",
      title: "Nebenkostenabrechnung 2025",
      referenceNumber: null,
      dueDate: "2026-04-02",
      amount: 612.4,
      currency: "EUR",
      correspondentName: "Hausverwaltung Lindwurm",
      documentTypeName: "Statement",
      taskLabel: "Nebenkostenabrechnung 2025",
      daysUntilDue: 13,
      isOverdue: false,
      taskCompletedAt: null,
    },
  ],
  overdueItems: [
    {
      documentId: "d-3",
      title: "Mobilfunkrechnung März",
      referenceNumber: "DT-9930-2026",
      dueDate: "2026-03-15",
      amount: 39.99,
      currency: "EUR",
      correspondentName: "Deutsche Telekom",
      documentTypeName: "Invoice",
      taskLabel: "Mobilfunkrechnung März",
      daysUntilDue: -5,
      isOverdue: true,
      taskCompletedAt: null,
    },
  ],
  monthlyActivity: [
    { month: "2025-10", count: 12 },
    { month: "2025-11", count: 18 },
    { month: "2025-12", count: 24 },
    { month: "2026-01", count: 15 },
    { month: "2026-02", count: 21 },
    { month: "2026-03", count: 9 },
  ],
};

export const FACETS: FacetsResponse = {
  correspondents: CORRESPONDENTS.map((entry, index) => ({
    ...entry,
    count: 34 - index * 6,
    dominantTypeName: TYPES[index % TYPES.length].name,
  })),
  documentTypes: TYPES.map((entry, index) => ({ ...entry, count: 96 - index * 20 })),
  tags: TAGS.map((entry, index) => ({ ...entry, count: 41 - index * 9 })),
  statuses: [
    { status: "ready", count: 245 },
    { status: "pending", count: 2 },
    { status: "failed", count: 1 },
  ],
  years: [
    { year: 2026, count: 41 },
    { year: 2025, count: 112 },
    { year: 2024, count: 95 },
  ],
  categories: [
    {
      ...CATEGORIES[0],
      count: 62,
      topCorrespondents: ["Stadtwerke München", "Hausverwaltung Lindwurm"],
    },
    { ...CATEGORIES[1], count: 21, topCorrespondents: ["Allianz Versicherung"] },
    { ...CATEGORIES[2], count: 16, topCorrespondents: ["Finanzamt München"] },
  ],
  uncategorizedCount: 18,
};

export const TIMELINE: DocumentsTimelineResponse = {
  years: [
    {
      year: 2026,
      count: 7,
      months: [
        { month: 3, count: 4, topCorrespondents: ["Stadtwerke München"], topTypes: ["Invoice", "Contract"] },
        { month: 2, count: 3, topCorrespondents: ["Finanzamt München"], topTypes: ["Letter", "Statement"] },
      ],
    },
    {
      year: 2025,
      count: 5,
      months: [
        { month: 11, count: 2, topCorrespondents: ["Allianz Versicherung"], topTypes: ["Contract"] },
        { month: 6, count: 3, topCorrespondents: ["Deutsche Telekom"], topTypes: ["Invoice"] },
      ],
    },
  ],
};

export const TEXT: DocumentTextResponse = {
  documentId: "d-2",
  blocks: [
    { page: 1, lineIndex: 0, text: "Allianz Versicherung AG · Kundenservice" },
    { page: 1, lineIndex: 1, text: "Beitragsanpassung zum 01.04.2026" },
    { page: 1, lineIndex: 2, text: "Vertrag AZ-4711-2026 · Hausratversicherung" },
    { page: 1, lineIndex: 3, text: "Ausgestellt am 11.03.2026" },
    { page: 2, lineIndex: 0, text: "Ihr Beitrag beträgt ab dem 1. April" },
    { page: 2, lineIndex: 1, text: "monatlich 84,50 EUR statt 79,00 EUR." },
    { page: 2, lineIndex: 2, text: "Die Anpassung folgt der Schadensentwicklung." },
    { page: 3, lineIndex: 0, text: "Kündigung ist bis 28.02. eines Jahres möglich." },
  ],
};

export const HISTORY: DocumentHistoryResponse = {
  documentId: "d-2",
  items: [
    {
      id: "h-1",
      eventType: "document.uploaded",
      createdAt: "2026-03-19T16:02:00.000Z",
      actor: "watch-folder",
      details: null,
    },
    {
      id: "h-2",
      eventType: "processing.completed",
      createdAt: "2026-03-19T16:03:41.000Z",
      actor: "worker",
      details: null,
    },
    {
      id: "h-3",
      eventType: "review.flagged",
      createdAt: "2026-03-19T16:03:42.000Z",
      actor: "system",
      details: null,
    },
  ],
} as DocumentHistoryResponse;

export const QA_HISTORY: QaHistoryEntry[] = [
  {
    id: "qa-1",
    question: "How much does the premium go up?",
    answer: "From **79,00 EUR** to **84,50 EUR** per month, effective 1 April 2026 [1].",
    status: "answered",
    citations: [
      {
        chunkIndex: 1,
        pageFrom: 2,
        pageTo: 2,
        index: 1,
        used: true,
        quote: "monatlich 84,50 EUR statt 79,00 EUR.",
        score: 0.91,
      },
      {
        chunkIndex: 2,
        pageFrom: 3,
        pageTo: 3,
        index: 2,
        used: false,
        quote: "Kündigung ist bis 28.02. eines Jahres möglich.",
        score: 0.42,
      },
    ],
    createdAt: "2026-03-19T17:10:00.000Z",
  },
] as QaHistoryEntry[];

export const CORRESPONDENT_INSIGHTS: CorrespondentInsightsResponse = {
  correspondent: {
    id: "c-allianz",
    name: "Allianz Versicherung",
    slug: "allianz-versicherung",
    categoryId: "cat-insurance",
    categoryName: "Insurance",
    categorySource: "llm",
  },
  summary:
    "Allianz insures the household contents. Premium letters arrive once a year, usually in March.",
  stats: {
    documentCount: 21,
    dateRange: { from: "2022-05-04", to: "2026-03-11" },
    totalAmount: 1842.5,
    currency: "EUR",
  },
  documentTypeBreakdown: [
    { name: "Contract", count: 9 },
    { name: "Invoice", count: 8 },
    { name: "Letter", count: 4 },
  ],
  timeline: [
    { month: "2025-04", count: 1 },
    { month: "2025-06", count: 2 },
    { month: "2025-09", count: 1 },
    { month: "2025-11", count: 3 },
    { month: "2026-01", count: 2 },
    { month: "2026-03", count: 1 },
  ],
  summaryStatus: "ready",
  intelligenceStatus: "ready",
  intelligence: {
    overview:
      "Household insurance since 2022. One policy, adjusted twice; the last change raised the monthly premium by 7 percent.",
    profile: {
      category: "Insurance",
      subcategory: "Household",
      keySignals: ["annual premium", "policy AZ-4711-2026"],
    },
    currentState: [
      { label: "Monthly premium", value: "84,50 €", asOf: "2026-03-11" },
      { label: "Policy", value: "AZ-4711-2026", asOf: null },
    ],
    timeline: [
      {
        title: "Premium raised to 84,50 €",
        description: "Adjustment following claims development",
        date: "2026-03-11",
      },
      {
        title: "Coverage extended to bicycles",
        description: "Added on request",
        date: "2025-11-02",
      },
    ],
    changes: [
      {
        title: "Monthly premium",
        description: "Adjustment following claims development",
        direction: "increase",
        valueBefore: "79,00 €",
        valueAfter: "84,50 €",
        effectiveDate: "2026-04-01",
      },
    ],
    domainInsights: {
      insurance: {
        policyReferences: ["AZ-4711-2026"],
        latestPremiumAmount: 84.5,
        latestPremiumCurrency: "EUR",
        premiumChangeSummary: "Up 7 percent from 1 April 2026",
        coverageHighlights: ["Household contents", "Bicycle theft"],
        renewalDate: "2027-04-01",
        cancellationWindow: "Until 28 February each year",
      },
    },
    sourceDocumentIds: ["d-2"],
  },
} as CorrespondentInsightsResponse;

export const TAXONOMIES = {
  correspondents: CORRESPONDENTS,
  documentTypes: TYPES,
  tags: TAGS,
  categories: CATEGORIES,
};

export const SUGGESTIONS = [
  "What did I pay Stadtwerke last year?",
  "Which contracts expire this year?",
  "Open invoices this month",
  "Documents from the Finanzamt",
];

/** The web's own tax fixture, so the two clients can be compared side by side. */
export const TAX_YEAR: TaxYearResponse = {
  year: 2025,
  documentCount: 4,
  unsummedCount: 1,
  totals: [{ currency: "EUR", sum: 1874.4, count: 3 }],
  groups: [
    {
      documentTypeId: "t-letter",
      documentType: "Tax notice",
      count: 2,
      unsummedCount: 1,
      totals: [{ currency: "EUR", sum: 1650.4, count: 1 }],
      documents: [
        {
          id: "d-4",
          title: "Einkommensteuerbescheid 2025",
          issueDate: "2025-11-20",
          correspondentName: "Finanzamt München",
          amount: 1650.4,
          currency: "EUR",
          memberVia: "both",
        },
        {
          id: "d-5",
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
      documentTypeId: "t-contract",
      documentType: "Insurance",
      count: 1,
      unsummedCount: 0,
      totals: [{ currency: "EUR", sum: 189, count: 1 }],
      documents: [
        {
          id: "d-2",
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
          id: "d-1",
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
};

/* ── Settings and Profile ───────────────────────────────────────────────── */

export const HEALTH = {
  status: "ok",
  provider: {
    mode: "cloud",
    activeParseProvider: "local-ocr",
    fallbackParseProvider: "mistral-ocr",
    activeChatProvider: "openai",
    activeEmbeddingProvider: "voyage",
    openaiModel: "gpt-5.1-mini",
    voyageEmbeddingModel: "voyage-3",
    hasOpenAiKey: true,
    hasGeminiKey: false,
    hasMistralKey: false,
    hasVoyageKey: true,
    hasGoogleCloudConfig: false,
    hasAwsTextractConfig: false,
    hasAzureDocumentIntelligenceConfig: false,
    hasMistralOcrConfig: true,
    hasMistralEmbeddingConfig: false,
    hasSmtpConfig: true,
    hasImapConfig: true,
  },
};

export const PROVIDERS = {
  activeParseProvider: "local-ocr",
  fallbackParseProvider: "mistral-ocr",
  activeChatProvider: "openai",
  activeEmbeddingProvider: "voyage",
  parseProviders: [
    { id: "local-ocr", available: true },
    { id: "mistral-ocr", available: true },
    { id: "amazon-textract", available: false },
    { id: "azure-ai-document-intelligence", available: false },
  ],
  embeddingProviders: [
    { id: "voyage", available: true, model: "voyage-3" },
    { id: "openai", available: false, model: null },
  ],
};

export const READINESS = {
  status: "ok",
  checks: { database: true, objectStorage: true, queue: true },
};

export const PROCESSING_STATUS = {
  queues: { processing: { depth: 2 }, embedding: { depth: 1 } },
  documents: { byStatus: { ready: 245, pending: 2, failed: 1 }, pendingReview: 3 },
  recentJobs: [
    {
      id: "job-1",
      documentId: "d-2",
      queueName: "document.process",
      status: "completed",
      attempts: 1,
      lastError: null,
      startedAt: "2026-03-20T08:40:00.000Z",
      finishedAt: "2026-03-20T08:40:12.000Z",
      createdAt: "2026-03-20T08:39:50.000Z",
    },
    {
      id: "job-2",
      documentId: "d-3",
      queueName: "document.embed",
      status: "running",
      attempts: 1,
      lastError: null,
      startedAt: "2026-03-20T08:58:00.000Z",
      finishedAt: null,
      createdAt: "2026-03-20T08:57:30.000Z",
    },
    {
      id: "job-3",
      documentId: "d-4",
      queueName: "document.process",
      status: "failed",
      attempts: 3,
      lastError: "The PDF could not be read.",
      startedAt: "2026-03-19T18:00:00.000Z",
      finishedAt: "2026-03-19T18:00:04.000Z",
      createdAt: "2026-03-19T17:59:50.000Z",
    },
  ],
};

export const WATCH_FOLDER_SCAN = {
  configuredPath: "/srv/watch",
  dryRun: true,
  summary: { total: 3, imported: 0, duplicate: 1, unsupported: 1, failed: 0, planned: 1 },
  items: [
    {
      path: "scans/stadtwerke-maerz.pdf",
      action: "planned",
      destinationPath: null,
      documentId: null,
      reason: "dry_run",
      mimeType: "application/pdf",
      failureCode: null,
      detail: null,
    },
    {
      path: "scans/hausrat.pdf",
      action: "duplicate",
      destinationPath: null,
      documentId: "d-2",
      reason: "checksum_match",
      mimeType: "application/pdf",
      failureCode: null,
      detail: null,
    },
    {
      path: "scans/notes.txt",
      action: "unsupported",
      destinationPath: null,
      documentId: null,
      reason: "mime_type_not_allowed",
      mimeType: "text/plain",
      failureCode: "mime_type_not_allowed",
      detail: null,
    },
  ],
  history: [
    {
      scannedAt: "2026-03-20T06:00:00.000Z",
      dryRun: false,
      imported: 3,
      duplicate: 1,
      unsupported: 0,
      failed: 0,
      planned: 0,
    },
  ],
};

export const EMAIL_INGEST = {
  configured: true,
  mailbox: { host: "imap.example.com", folder: "INBOX", user: "archive" },
  lastPoll: { at: "2026-03-20T08:30:00.000Z" },
  counts: { imported: 14, skipped: 2, rejected: 1 },
  recentRejections: [
    {
      fromAddress: "noreply@unknown.example",
      subject: "Your statement",
      status: "rejected",
      reason: "Sender not allowed",
      createdAt: "2026-03-18T10:00:00.000Z",
    },
  ],
};

export const API_TOKENS = [
  {
    id: "token-1",
    name: "Paperless import",
    tokenPrefix: "okp_3fa91c",
    lastUsedAt: "2026-03-18T10:00:00.000Z",
    expiresAt: null,
    createdAt: "2026-01-02T10:00:00.000Z",
  },
  {
    id: "token-2",
    name: "Backup script",
    tokenPrefix: "okp_a07be2",
    lastUsedAt: null,
    expiresAt: "2026-12-31T00:00:00.000Z",
    createdAt: "2026-02-12T10:00:00.000Z",
  },
];

export const CREATED_API_TOKEN = {
  id: "token-3",
  token: "okp_5c1e7d9a02bf.8c3f51a9d27e4b06a1c89f3de7425b10c6fd92e1a83b7d04",
  name: "New token",
  expiresAt: null,
};

/** A real QR-shaped PNG, so the enrolment sheet shows what it will on a phone. */
export const TWO_FACTOR_SETUP = {
  secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  otpauthUrl: "otpauth://totp/OpenKeep:you@example.com?secret=JBSWY3DPEHPK3PXP",
  qrDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAK4AAACuAQAAAACHdwtDAAABPklEQVR42sWW0Q3EMAhDkRggI7F6RsoAkTiwk/a6AFRq1b7+WDEGRPKyuHWJ+/Ql71WL1d2XyZgazF2XxbMHL8nXZfF/i8U79LZhGSFKnO+9+LrnjRim3aMS/3hZiqkLtTN5Wn/1XYodF0yzPfgVShuwpi4YNZynFTa24BC1M9mwzmdqXNaDb/0GQMqTtOCMFGtnzLRuZLORFox2C5CFHM99hkA9nrpOpJgqHlU9ZpohEym/4a7HWcLQiGTPN9zl+BGTX1lB58DqMVq+oZydoykKeXdgMLvdhZtUD1YI3CdMma3rZTUOo9jkNPvu5FCSDnxGIf+g9crxshrfZQE7C4bS8bIccySicFJd9r+MVAfmog3HqBin1YeX+FlyjdtMF2Zr2RjR+gqsxce0Z8U2zOoG/CzaaDBp3f7s32X4BzpEDZ7GzvasAAAAAElFTkSuQmCC",
  enrollmentToken: "enrollment-token",
};

export const RECOVERY_CODES = [
  "a1b2-c3d4",
  "e5f6-a7b8",
  "c9d0-e1f2",
  "a3b4-c5d6",
  "e7f8-a9b0",
  "c1d2-e3f4",
  "a5b6-c7d8",
  "e9f0-a1b2",
];

/** With `?taxonomy=rich`: entries that exercise the unused and duplicates filters. */
export const TAXONOMY_RICH_TAGS = [
  { id: "tag-tax-returns", name: "Tax returns", slug: "tax-returns" },
  { id: "tag-insurances", name: "Insurances", slug: "insurances" },
  { id: "tag-old", name: "Old stuff", slug: "old-stuff" },
  { id: "tag-misc", name: "Miscellaneous", slug: "miscellaneous" },
];

export const TAXONOMY_RICH_CATEGORIES = [
  { id: "cat-housing", name: "Housing", slug: "housing", builtin: true },
  { id: "cat-insurance", name: "Insurance", slug: "insurance", builtin: true },
  { id: "cat-other", name: "Other", slug: "other", builtin: true },
  { id: "cat-garden", name: "Garden", slug: "garden", builtin: false },
];
