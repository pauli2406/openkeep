import type {
  AnswerQueryResponse,
  Correspondent,
  Document,
  DocumentType,
  HealthProvidersResponse,
  HealthResponse,
  ProcessingStatusResponse,
  ProviderConfig,
  ReadinessResponse,
  SearchDocumentsResponse,
  SemanticSearchResponse,
  Tag,
  WatchFolderScanResponse,
} from "@openkeep/types";

export function makeUser(overrides: Partial<{
  id: string;
  email: string;
  displayName: string;
  isOwner: boolean;
}> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    email: "owner@example.com",
    displayName: "Owner",
    isOwner: true,
    ...overrides,
  };
}

export function makeProviderConfig(
  overrides: Partial<ProviderConfig> = {},
): ProviderConfig {
  return {
    mode: "local-only",
    activeParseProvider: "local-ocr",
    fallbackParseProvider: null,
    activeEmbeddingProvider: "openai",
    openaiModel: "gpt-4.1-mini",
    geminiModel: undefined,
    mistralModel: undefined,
    openaiEmbeddingModel: "text-embedding-3-small",
    geminiEmbeddingModel: undefined,
    voyageEmbeddingModel: undefined,
    mistralEmbeddingModel: undefined,
    hasOpenAiKey: true,
    hasGeminiKey: false,
    hasMistralKey: false,
    hasVoyageKey: false,
    hasGoogleCloudConfig: false,
    hasAwsTextractConfig: false,
    hasAzureDocumentIntelligenceConfig: false,
    hasMistralOcrConfig: false,
    hasMistralEmbeddingConfig: false,
    ...overrides,
  };
}

export function makeHealthResponse(
  overrides: Partial<HealthResponse> = {},
): HealthResponse {
  return {
    status: "ok",
    provider: makeProviderConfig(),
    ...overrides,
  };
}

export function makeReadinessResponse(
  overrides: Partial<ReadinessResponse> = {},
): ReadinessResponse {
  return {
    status: "ok",
    checks: {
      database: true,
      objectStorage: true,
      queue: true,
    },
    ...overrides,
  };
}

export function makeHealthProvidersResponse(
  overrides: Partial<HealthProvidersResponse> = {},
): HealthProvidersResponse {
  return {
    activeParseProvider: "local-ocr",
    fallbackParseProvider: null,
    activeEmbeddingProvider: "openai",
    parseProviders: [
      { id: "local-ocr", available: true },
      { id: "amazon-textract", available: true },
    ],
    embeddingProviders: [
      { id: "openai", available: true, model: "text-embedding-3-small" },
      { id: "voyage", available: false, model: null },
    ],
    ...overrides,
  };
}

export function makeProcessingStatusResponse(
  overrides: Partial<ProcessingStatusResponse> = {},
): ProcessingStatusResponse {
  return {
    queues: {
      processing: { depth: 2 },
      embedding: { depth: 1 },
    },
    documents: {
      byStatus: {
        ready: 12,
        processing: 1,
        failed: 1,
      },
      pendingReview: 3,
    },
    recentJobs: [
      {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        documentId: "11111111-1111-1111-1111-111111111111",
        queueName: "document.process",
        status: "running",
        attempts: 1,
        lastError: null,
        startedAt: "2026-03-22T10:01:00.000Z",
        finishedAt: null,
        createdAt: "2026-03-22T10:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

export function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    title: "March Invoice",
    source: "upload",
    mimeType: "application/pdf",
    checksum: "a".repeat(64),
    storageKey: "documents/march-invoice.pdf",
    status: "ready",
    language: "en",
    issueDate: "2026-03-01",
    dueDate: "2026-03-31",
    expiryDate: null,
    amount: 123.45,
    currency: "EUR",
    referenceNumber: "INV-2026-03",
    holderName: null,
    issuingAuthority: null,
    correspondent: {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Acme Corp",
      slug: "acme-corp",
    },
    documentType: {
      id: "33333333-3333-3333-3333-333333333333",
      name: "Invoice",
      slug: "invoice",
      description: null,
      requiredFields: [
        "correspondent",
        "issueDate",
        "dueDate",
        "amount",
        "currency",
        "referenceNumber",
      ],
    },
    tags: [],
    confidence: 0.94,
    reviewStatus: "not_required",
    reviewReasons: [],
    reviewedAt: null,
    reviewNote: null,
    searchablePdfAvailable: true,
    parseProvider: "local-ocr",
    chunkCount: 2,
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
      startedAt: "2026-03-20T10:00:00.000Z",
      finishedAt: "2026-03-20T10:01:00.000Z",
      createdAt: "2026-03-20T09:59:00.000Z",
      updatedAt: "2026-03-20T10:01:00.000Z",
    },
    latestEmbeddingJob: null,
    metadata: {
      detectedKeywords: ["invoice", "march"],
      reviewReasons: [],
      chunkCount: 2,
      pageCount: 1,
    },
    createdAt: "2026-03-20T09:59:00.000Z",
    processedAt: "2026-03-20T10:01:00.000Z",
    snippets: [],
    matchingLines: [],
    ...overrides,
  };
}

export function makeSearchDocumentsResponse(
  items: Document[],
  overrides: Partial<SearchDocumentsResponse> = {},
): SearchDocumentsResponse {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 20,
    appliedFilters: {},
    ...overrides,
  };
}

export function makeTag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: "aaa11111-1111-1111-1111-111111111111",
    name: "Important",
    slug: "important",
    ...overrides,
  };
}

export function makeCorrespondent(overrides: Partial<Correspondent> = {}): Correspondent {
  return {
    id: "bbb22222-2222-2222-2222-222222222222",
    name: "Acme Corp",
    slug: "acme-corp",
    ...overrides,
  };
}

export function makeDocumentType(overrides: Partial<DocumentType> = {}): DocumentType {
  return {
    id: "ccc33333-3333-3333-3333-333333333333",
    name: "Invoice",
    slug: "invoice",
    description: "Billing documents",
    requiredFields: [
      "correspondent",
      "issueDate",
      "dueDate",
      "amount",
      "currency",
      "referenceNumber",
    ],
    ...overrides,
  };
}

export function makeSemanticSearchResponse(
  overrides: Partial<SemanticSearchResponse> = {},
): SemanticSearchResponse {
  return {
    items: [
      {
        document: makeDocument(),
        score: 0.88,
        semanticScore: 0.92,
        keywordScore: 0.75,
        matchedChunks: [
          {
            chunkIndex: 0,
            heading: "Summary",
            text: "March invoice for professional services rendered.",
            pageFrom: 1,
            pageTo: 1,
            score: 0.92,
            distance: 0.08,
          },
        ],
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
    appliedFilters: {},
    ...overrides,
  };
}

export function makeAnswerQueryResponse(
  overrides: Partial<AnswerQueryResponse> = {},
): AnswerQueryResponse {
  return {
    status: "answered",
    answer: "The invoice is due on March 31, 2026.",
    reasoning: "Matched invoice due date fields in the top ranked document.",
    citations: [
      {
        documentId: "11111111-1111-1111-1111-111111111111",
        documentTitle: "March Invoice",
        chunkIndex: 0,
        pageFrom: 1,
        pageTo: 1,
        quote: "Due date: 2026-03-31",
        score: 0.96,
      },
    ],
    results: [
      {
        document: makeDocument(),
        score: 0.96,
        semanticScore: 0.91,
        keywordScore: 0.88,
        matchedChunks: [
          {
            chunkIndex: 0,
            heading: "Payment details",
            text: "Due date: 2026-03-31",
            pageFrom: 1,
            pageTo: 1,
            score: 0.96,
            distance: 0.04,
          },
        ],
      },
    ],
    ...overrides,
  };
}

export function makeWatchFolderScanResponse(
  overrides: Partial<WatchFolderScanResponse> = {},
): WatchFolderScanResponse {
  return {
    configuredPath: "/watch-folder",
    dryRun: false,
    summary: {
      total: 2,
      imported: 1,
      duplicate: 1,
      unsupported: 0,
      failed: 0,
      planned: 0,
    },
    items: [
      {
        path: "/watch-folder/invoice.pdf",
        action: "imported",
        destinationPath: "/watch-folder/processed/invoice.pdf",
        documentId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        reason: "imported",
        mimeType: "application/pdf",
        failureCode: null,
        detail: null,
      },
      {
        path: "/watch-folder/duplicate.pdf",
        action: "duplicate",
        destinationPath: "/watch-folder/processed/duplicate.pdf",
        documentId: null,
        reason: "duplicate_checksum",
        mimeType: "application/pdf",
        failureCode: null,
        detail: null,
      },
    ],
    history: [
      {
        scannedAt: "2026-03-22T10:00:00.000Z",
        dryRun: false,
        imported: 1,
        duplicate: 1,
        unsupported: 0,
        failed: 0,
        planned: 0,
      },
    ],
    ...overrides,
  };
}
