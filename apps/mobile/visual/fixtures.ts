/**
 * One archive, fixed. Every screenshot renders from this and nothing else — no
 * clock, no network, no device state — so a diff means the rendering changed.
 *
 * The shapes are the API's, not invented: `ArchiveDocument`, `DashboardInsights`,
 * `ReviewQueueResponse`, `FacetsResponse` and the correspondent insights payload.
 */
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
      intelligence: {
        extraction: { fieldConfidence: { amount: 0.58, correspondentName: 0.71 } },
        tagging: { tags: ["Insurance", "Household"] },
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
  correspondents: CORRESPONDENTS.map((entry, index) => ({ ...entry, count: 34 - index * 6 })),
  documentTypes: TYPES.map((entry, index) => ({ ...entry, count: 96 - index * 20 })),
  tags: TAGS.map((entry, index) => ({ ...entry, count: 41 - index * 9 })),
  statuses: [
    { status: "ready", count: 245 },
    { status: "pending", count: 2 },
    { status: "failed", count: 1 },
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
    answer: "From 79,00 EUR to 84,50 EUR per month, effective 1 April 2026.",
    createdAt: "2026-03-19T17:10:00.000Z",
  },
] as QaHistoryEntry[];

export const CORRESPONDENT_INSIGHTS: CorrespondentInsightsResponse = {
  correspondent: { id: "c-allianz", name: "Allianz Versicherung", slug: "allianz-versicherung" },
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
    profile: { category: "Insurance" },
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

export const TAXONOMIES = { correspondents: CORRESPONDENTS, documentTypes: TYPES, tags: TAGS };

export const SUGGESTIONS = [
  "What did I pay Stadtwerke last year?",
  "Which contracts expire this year?",
  "Open invoices this month",
  "Documents from the Finanzamt",
];
