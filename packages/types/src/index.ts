import { z } from "zod";

export const processingModes = ["local-only", "hybrid", "cloud-assisted"] as const;
export const parseProviders = [
  "local-ocr",
  "google-document-ai-enterprise-ocr",
  "google-document-ai-gemini-layout-parser",
  "amazon-textract",
  "azure-ai-document-intelligence",
  "mistral-ocr",
] as const;
export const embeddingProviders = ["openai", "google-gemini", "voyage", "mistral"] as const;
export const documentSources = ["upload", "watch-folder", "email", "api"] as const;
export const documentStatuses = ["pending", "processing", "ready", "failed"] as const;
export const reviewStatuses = ["not_required", "pending", "resolved"] as const;
export const embeddingStatuses = [
  "not_configured",
  "queued",
  "indexing",
  "ready",
  "stale",
  "failed",
] as const;
export const reviewReasons = [
  "low_confidence",
  "processing_failed",
  "ocr_empty",
  "missing_key_fields",
  "unsupported_format",
] as const;
export const processingJobStatuses = ["queued", "running", "completed", "failed"] as const;

export const ProcessingModeSchema = z.enum(processingModes);
export const ParseProviderSchema = z.enum(parseProviders);
export const EmbeddingProviderSchema = z.enum(embeddingProviders);
export const DocumentSourceSchema = z.enum(documentSources);
export const DocumentStatusSchema = z.enum(documentStatuses);
export const ReviewStatusSchema = z.enum(reviewStatuses);
export const EmbeddingStatusSchema = z.enum(embeddingStatuses);
export const ReviewReasonSchema = z.enum(reviewReasons);
export const ProcessingJobStatusSchema = z.enum(processingJobStatuses);

export const BoundingBoxSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

export const ParsedDocumentLineSchema = z.object({
  lineIndex: z.number().int().nonnegative(),
  text: z.string(),
  boundingBox: BoundingBoxSchema,
});

export const ParsedDocumentBlockSchema = z.object({
  blockIndex: z.number().int().nonnegative(),
  role: z.enum(["paragraph", "heading", "table", "key_value", "other"]).default("paragraph"),
  text: z.string(),
  boundingBox: BoundingBoxSchema.nullable().optional(),
  lineIndices: z.array(z.number().int().nonnegative()).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ParsedDocumentTableCellSchema = z.object({
  row: z.number().int().positive(),
  column: z.number().int().positive(),
  text: z.string(),
  rowSpan: z.number().int().positive().default(1),
  columnSpan: z.number().int().positive().default(1),
  boundingBox: BoundingBoxSchema.nullable().optional(),
  kind: z.enum(["header", "body", "footer"]).default("body"),
});

export const ParsedDocumentTableSchema = z.object({
  tableIndex: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  title: z.string().nullable().optional(),
  boundingBox: BoundingBoxSchema.nullable().optional(),
  cells: z.array(ParsedDocumentTableCellSchema),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ParsedDocumentKeyValueSchema = z.object({
  key: z.string(),
  value: z.string(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  page: z.number().int().positive().nullable().optional(),
  keyBoundingBox: BoundingBoxSchema.nullable().optional(),
  valueBoundingBox: BoundingBoxSchema.nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ParsedDocumentChunkHintSchema = z.object({
  chunkIndex: z.number().int().nonnegative(),
  heading: z.string().nullable().optional(),
  text: z.string(),
  pageFrom: z.number().int().positive().nullable().optional(),
  pageTo: z.number().int().positive().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ParsedDocumentPageSchema = z.object({
  pageNumber: z.number().int().positive(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  lines: z.array(ParsedDocumentLineSchema),
  blocks: z.array(ParsedDocumentBlockSchema).default([]),
});

export const ParsedDocumentSchema = z.object({
  provider: ParseProviderSchema,
  parseStrategy: z.string().min(1),
  text: z.string(),
  language: z.string().nullable(),
  pages: z.array(ParsedDocumentPageSchema),
  tables: z.array(ParsedDocumentTableSchema).default([]),
  keyValues: z.array(ParsedDocumentKeyValueSchema).default([]),
  chunkHints: z.array(ParsedDocumentChunkHintSchema).default([]),
  searchablePdfPath: z.string().optional(),
  reviewReasons: z.array(ReviewReasonSchema),
  warnings: z.array(z.string()).default([]),
  providerMetadata: z.record(z.string(), z.unknown()).default({}),
  temporaryPaths: z.array(z.string()).optional(),
});

export const DocumentChunkSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  chunkIndex: z.number().int().nonnegative(),
  heading: z.string().nullable(),
  text: z.string(),
  pageFrom: z.number().int().positive().nullable(),
  pageTo: z.number().int().positive().nullable(),
  strategyVersion: z.string().min(1),
  contentHash: z.string().min(64).max(64),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().min(1),
});

export const DocumentChunkEmbeddingSchema = z.object({
  documentId: z.string().uuid(),
  chunkIndex: z.number().int().nonnegative(),
  provider: EmbeddingProviderSchema,
  model: z.string().min(1),
  dimensions: z.number().int().positive(),
  contentHash: z.string().min(64).max(64),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const TagSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
});

export const CorrespondentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  summary: z.string().nullable().optional(),
});

export const DocumentTypeSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().nullable().optional(),
});

export const DocumentTextBlockSchema = z.object({
  documentId: z.string().uuid(),
  page: z.number().int().positive(),
  lineIndex: z.number().int().nonnegative(),
  boundingBox: BoundingBoxSchema,
  text: z.string().min(1),
});

export const ReviewEvidenceFieldSchema = z.enum([
  "correspondent",
  "issueDate",
  "amount",
  "currency",
]);

export const ReviewEvidenceSchema = z.object({
  documentClass: z.enum(["invoice", "generic"]),
  requiredFields: z.array(ReviewEvidenceFieldSchema),
  missingFields: z.array(ReviewEvidenceFieldSchema),
  extracted: z.object({
    correspondent: z.boolean(),
    issueDate: z.boolean(),
    amount: z.boolean(),
    currency: z.boolean(),
  }),
  activeReasons: z.array(ReviewReasonSchema),
  confidence: z.number().min(0).max(1).nullable().optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
  ocrTextLength: z.number().int().nonnegative().optional(),
  ocrEmptyThreshold: z.number().int().nonnegative().optional(),
});

export const ManualOverrideFieldSchema = z.enum([
  "issueDate",
  "dueDate",
  "amount",
  "currency",
  "referenceNumber",
  "correspondentId",
  "documentTypeId",
  "tagIds",
]);

export const ManualOverridesSchema = z.object({
  lockedFields: z.array(ManualOverrideFieldSchema).default([]),
  values: z
    .object({
      issueDate: z.string().nullable().optional(),
      dueDate: z.string().nullable().optional(),
      amount: z.number().nullable().optional(),
      currency: z.string().length(3).nullable().optional(),
      referenceNumber: z.string().nullable().optional(),
      correspondentId: z.string().uuid().nullable().optional(),
      documentTypeId: z.string().uuid().nullable().optional(),
      tagIds: z.array(z.string().uuid()).optional(),
    })
    .default({}),
  updatedAt: z.string().nullable().optional(),
  updatedByUserId: z.string().uuid().nullable().optional(),
});

export const DocumentMetadataSchema = z
  .object({
    extractionStrategy: z.string().optional(),
    normalizationStrategy: z.string().optional(),
    parseProvider: ParseProviderSchema.optional(),
    parseStrategy: z.string().optional(),
    documentTypeName: z.string().nullable().optional(),
    detectedKeywords: z.array(z.string()).optional(),
    pageCount: z.number().int().nonnegative().optional(),
    chunkCount: z.number().int().nonnegative().optional(),
    searchablePdfGenerated: z.boolean().optional(),
    reviewReasons: z.array(ReviewReasonSchema).optional(),
    parse: z
      .object({
        provider: ParseProviderSchema,
        strategy: z.string(),
        fallbackUsed: z.boolean().optional(),
        warnings: z.array(z.string()).optional(),
        keyValueCount: z.number().int().nonnegative().optional(),
        tableCount: z.number().int().nonnegative().optional(),
        providerMetadata: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
    chunking: z
      .object({
        strategy: z.string(),
        chunkCount: z.number().int().nonnegative(),
        usedProviderHints: z.boolean().optional(),
      })
      .optional(),
    embedding: z
      .object({
        provider: EmbeddingProviderSchema.optional(),
        model: z.string().optional(),
        configured: z.boolean().optional(),
        chunkCount: z.number().int().nonnegative().optional(),
      })
      .optional(),
    reviewEvidence: ReviewEvidenceSchema.optional(),
    manual: ManualOverridesSchema.optional(),
  })
  .passthrough();

export const ProcessingJobSummarySchema = z.object({
  id: z.string().uuid(),
  status: ProcessingJobStatusSchema,
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const DocumentSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  source: DocumentSourceSchema,
  mimeType: z.string().min(1),
  checksum: z.string().min(64).max(64),
  storageKey: z.string().min(1),
  status: DocumentStatusSchema,
  language: z.string().nullable(),
  issueDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  amount: z.number().nullable(),
  currency: z.string().length(3).nullable(),
  referenceNumber: z.string().nullable(),
  correspondent: CorrespondentSchema.nullable(),
  documentType: DocumentTypeSchema.nullable(),
  tags: z.array(TagSchema),
  confidence: z.number().min(0).max(1).nullable(),
  reviewStatus: ReviewStatusSchema,
  reviewReasons: z.array(ReviewReasonSchema),
  reviewedAt: z.string().nullable(),
  reviewNote: z.string().nullable(),
  searchablePdfAvailable: z.boolean(),
  parseProvider: ParseProviderSchema.nullable().optional(),
  chunkCount: z.number().int().nonnegative().default(0),
  embeddingStatus: EmbeddingStatusSchema.default("not_configured"),
  embeddingProvider: EmbeddingProviderSchema.nullable().optional(),
  embeddingModel: z.string().nullable().optional(),
  embeddingsStale: z.boolean().default(false),
  lastProcessingError: z.string().nullable(),
  latestProcessingJob: ProcessingJobSummarySchema.nullable(),
  latestEmbeddingJob: ProcessingJobSummarySchema.nullable().optional(),
  metadata: DocumentMetadataSchema,
  createdAt: z.string().min(1),
  processedAt: z.string().nullable(),
  snippets: z.array(z.string()).optional(),
  matchingLines: z.array(DocumentTextBlockSchema).optional(),
});

export const SearchDocumentsFiltersSchema = z.object({
  year: z.number().int().min(1970).max(2100).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  correspondentId: z.string().uuid().optional(),
  correspondentIds: z.array(z.string().uuid()).optional(),
  documentTypeId: z.string().uuid().optional(),
  documentTypeIds: z.array(z.string().uuid()).optional(),
  status: DocumentStatusSchema.optional(),
  statuses: z.array(DocumentStatusSchema).optional(),
  tags: z.array(z.string().uuid()).optional(),
  amountMin: z.number().optional(),
  amountMax: z.number().optional(),
});

export const SearchDocumentsRequestSchema = z.object({
  query: z.string().trim().optional(),
  filters: SearchDocumentsFiltersSchema.optional(),
  sort: z.enum(["createdAt", "issueDate", "dueDate", "title"]).default("createdAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const SearchDocumentsResponseSchema = z.object({
  items: z.array(DocumentSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  appliedFilters: SearchDocumentsFiltersSchema.default({}),
});

export const SemanticMatchedChunkSchema = z.object({
  chunkIndex: z.number().int().nonnegative(),
  heading: z.string().nullable(),
  text: z.string(),
  pageFrom: z.number().int().positive().nullable(),
  pageTo: z.number().int().positive().nullable(),
  score: z.number().nonnegative(),
  distance: z.number().nullable(),
});

export const SemanticSearchRequestSchema = z.object({
  query: z.string().trim().min(1),
  filters: SearchDocumentsFiltersSchema.optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  maxChunkMatches: z.number().int().min(1).max(10).default(3),
});

export const SemanticSearchResultSchema = z.object({
  document: DocumentSchema,
  score: z.number().nonnegative(),
  semanticScore: z.number().nonnegative().nullable(),
  keywordScore: z.number().nonnegative().nullable(),
  matchedChunks: z.array(SemanticMatchedChunkSchema),
});

export const SemanticSearchResponseSchema = z.object({
  items: z.array(SemanticSearchResultSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  appliedFilters: SearchDocumentsFiltersSchema.default({}),
});

export const DashboardInsightStatsSchema = z.object({
  totalDocuments: z.number().int().nonnegative(),
  pendingReview: z.number().int().nonnegative(),
  documentTypesCount: z.number().int().nonnegative(),
  correspondentsCount: z.number().int().nonnegative(),
});

export const CorrespondentTypeCountSchema = z.object({
  name: z.string().min(1),
  count: z.number().int().nonnegative(),
});

export const DashboardTopCorrespondentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  documentCount: z.number().int().nonnegative(),
  totalAmount: z.number().nullable(),
  currency: z.string().length(3).nullable(),
  latestDocDate: z.string().nullable(),
  documentTypes: z.array(CorrespondentTypeCountSchema),
});

export const DashboardDeadlineItemSchema = z.object({
  documentId: z.string().uuid(),
  title: z.string().min(1),
  dueDate: z.string(),
  amount: z.number().nullable(),
  currency: z.string().length(3).nullable(),
  correspondentName: z.string().nullable(),
  daysUntilDue: z.number().int(),
  isOverdue: z.boolean(),
});

export const MonthlyActivityPointSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  count: z.number().int().nonnegative(),
});

export const DashboardInsightsResponseSchema = z.object({
  stats: DashboardInsightStatsSchema,
  topCorrespondents: z.array(DashboardTopCorrespondentSchema),
  upcomingDeadlines: z.array(DashboardDeadlineItemSchema),
  overdueItems: z.array(DashboardDeadlineItemSchema),
  recentDocuments: z.array(DocumentSchema),
  monthlyActivity: z.array(MonthlyActivityPointSchema),
});

export const CorrespondentSummaryStatusSchema = z.enum([
  "ready",
  "pending",
  "unavailable",
]);

export const CorrespondentTimelinePointSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  count: z.number().int().nonnegative(),
});

export const CorrespondentInsightsResponseSchema = z.object({
  correspondent: CorrespondentSchema.extend({
    summaryGeneratedAt: z.string().nullable().optional(),
  }),
  summaryStatus: CorrespondentSummaryStatusSchema,
  summary: z.string().nullable(),
  stats: z.object({
    documentCount: z.number().int().nonnegative(),
    totalAmount: z.number().nullable(),
    currency: z.string().length(3).nullable(),
    dateRange: z.object({
      from: z.string().nullable(),
      to: z.string().nullable(),
    }),
    avgConfidence: z.number().min(0).max(1).nullable(),
  }),
  documentTypeBreakdown: z.array(CorrespondentTypeCountSchema),
  timeline: z.array(CorrespondentTimelinePointSchema),
  recentDocuments: z.array(DocumentSchema),
  upcomingDeadlines: z.array(DashboardDeadlineItemSchema),
});

export const DocumentProjectionPointSchema = z.object({
  documentId: z.string().uuid(),
  x: z.number(),
  y: z.number(),
  title: z.string().min(1),
  correspondentName: z.string().nullable(),
  correspondentSlug: z.string().nullable().optional(),
  typeName: z.string().nullable(),
  tags: z.array(z.string()),
  issueDate: z.string().nullable(),
  year: z.number().int().nullable(),
  status: DocumentStatusSchema,
});

export const DocumentProjectionClusterSchema = z.object({
  centroidX: z.number(),
  centroidY: z.number(),
  label: z.string().min(1),
  documentIds: z.array(z.string().uuid()),
});

export const DocumentsProjectionResponseSchema = z.object({
  points: z.array(DocumentProjectionPointSchema),
  clusters: z.array(DocumentProjectionClusterSchema),
});

export const DocumentsTimelineMonthSchema = z.object({
  month: z.number().int().min(1).max(12),
  count: z.number().int().nonnegative(),
  topCorrespondents: z.array(z.string()),
  topTypes: z.array(z.string()),
});

export const DocumentsTimelineYearSchema = z.object({
  year: z.number().int().min(1970).max(2100),
  count: z.number().int().nonnegative(),
  months: z.array(DocumentsTimelineMonthSchema),
});

export const DocumentsTimelineResponseSchema = z.object({
  years: z.array(DocumentsTimelineYearSchema),
});

export const UploadDocumentMetadataSchema = z.object({
  title: z.string().trim().min(1).optional(),
  source: DocumentSourceSchema.default("upload"),
});

export const UpdateDocumentSchema = z.object({
  title: z.string().trim().min(1).optional(),
  dueDate: z.string().nullable().optional(),
  issueDate: z.string().nullable().optional(),
  amount: z.number().nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
  referenceNumber: z.string().nullable().optional(),
  correspondentId: z.string().uuid().nullable().optional(),
  documentTypeId: z.string().uuid().nullable().optional(),
  tagIds: z.array(z.string().uuid()).optional(),
  clearLockedFields: z.array(ManualOverrideFieldSchema).optional(),
  status: DocumentStatusSchema.optional(),
});

export const ListReviewDocumentsRequestSchema = z.object({
  processingStatus: DocumentStatusSchema.optional(),
  reason: ReviewReasonSchema.optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const ResolveReviewRequestSchema = z.object({
  reviewNote: z.string().trim().min(1).max(2_000).nullable().optional(),
});

export const RequeueDocumentProcessingRequestSchema = z.object({
  force: z.boolean().default(true),
});

export const RequeueDocumentProcessingResponseSchema = z.object({
  queued: z.literal(true),
  documentId: z.string().uuid(),
  processingJobId: z.string().uuid(),
});

export const ReprocessDocumentRequestSchema = z.object({
  parseProvider: ParseProviderSchema.optional(),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const SetupOwnerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  displayName: z.string().min(1),
});

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const CreateApiTokenSchema = z.object({
  name: z.string().min(1).max(120),
  expiresAt: z.string().nullable().optional(),
});

export const CurrentUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().min(1),
  isOwner: z.boolean(),
  createdAt: z.string().min(1),
});

export const ApiTokenSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  tokenPrefix: z.string().min(1),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string().min(1),
});

export const CreateApiTokenResponseSchema = z.object({
  id: z.string().uuid(),
  token: z.string().min(1),
  name: z.string().min(1),
  expiresAt: z.string().nullable(),
});

export const SuccessResponseSchema = z.object({
  success: z.literal(true),
});

export const AuthTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
});

export const ProviderConfigSchema = z.object({
  mode: ProcessingModeSchema,
  activeParseProvider: ParseProviderSchema,
  fallbackParseProvider: ParseProviderSchema.nullable().optional(),
  activeEmbeddingProvider: EmbeddingProviderSchema.nullable().optional(),
  openaiModel: z.string().optional(),
  geminiModel: z.string().optional(),
  openaiEmbeddingModel: z.string().optional(),
  geminiEmbeddingModel: z.string().optional(),
  voyageEmbeddingModel: z.string().optional(),
  mistralEmbeddingModel: z.string().optional(),
  hasOpenAiKey: z.boolean().default(false),
  hasGeminiKey: z.boolean().default(false),
  hasVoyageKey: z.boolean().default(false),
  hasGoogleCloudConfig: z.boolean().default(false),
  hasAwsTextractConfig: z.boolean().default(false),
  hasAzureDocumentIntelligenceConfig: z.boolean().default(false),
  hasMistralOcrConfig: z.boolean().default(false),
  hasMistralEmbeddingConfig: z.boolean().default(false),
});

export const HealthResponseSchema = z.object({
  status: z.string(),
  provider: ProviderConfigSchema,
});

export const ParseProviderAvailabilitySchema = z.object({
  id: ParseProviderSchema,
  available: z.boolean(),
});

export const EmbeddingProviderAvailabilitySchema = z.object({
  id: EmbeddingProviderSchema,
  available: z.boolean(),
  model: z.string().nullable(),
});

export const HealthProvidersResponseSchema = z.object({
  activeParseProvider: ParseProviderSchema,
  fallbackParseProvider: ParseProviderSchema.nullable(),
  activeEmbeddingProvider: EmbeddingProviderSchema.nullable(),
  parseProviders: z.array(ParseProviderAvailabilitySchema),
  embeddingProviders: z.array(EmbeddingProviderAvailabilitySchema),
});

export const ProcessingStatusJobSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  queueName: z.string(),
  status: ProcessingJobStatusSchema,
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const ProcessingStatusResponseSchema = z.object({
  queues: z.object({
    processing: z.object({
      depth: z.number().int().nonnegative(),
    }),
    embedding: z.object({
      depth: z.number().int().nonnegative(),
    }),
  }),
  documents: z.object({
    byStatus: z.record(z.string(), z.number().int().nonnegative()),
    pendingReview: z.number().int().nonnegative(),
  }),
  recentJobs: z.array(ProcessingStatusJobSchema),
});

export const QueueDocumentProcessingPayloadSchema = z.object({
  documentId: z.string().uuid(),
  force: z.boolean().default(false),
  processingJobId: z.string().uuid().optional(),
  retryCount: z.number().int().nonnegative().default(0),
  parseProvider: ParseProviderSchema.optional(),
  fallbackParseProvider: ParseProviderSchema.nullable().optional(),
});

export const QueueDocumentEmbeddingPayloadSchema = z.object({
  documentId: z.string().uuid(),
  force: z.boolean().default(false),
  embeddingJobId: z.string().uuid().optional(),
  retryCount: z.number().int().nonnegative().default(0),
  embeddingProvider: EmbeddingProviderSchema.optional(),
  embeddingModel: z.string().optional(),
});

export const ReindexEmbeddingsRequestSchema = z.object({
  documentIds: z.array(z.string().uuid()).optional(),
  filters: SearchDocumentsFiltersSchema.optional(),
  scope: z.enum(["stale", "all"]).default("stale"),
});

export const ReadinessResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  checks: z.object({
    database: z.boolean(),
    objectStorage: z.boolean(),
    queue: z.boolean(),
  }),
});

export const AuditEventSchema = z.object({
  id: z.string().uuid(),
  actorUserId: z.string().uuid().nullable(),
  actorDisplayName: z.string().nullable().optional(),
  actorEmail: z.string().nullable().optional(),
  documentId: z.string().uuid().nullable(),
  eventType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().min(1),
});

export const DocumentHistoryResponseSchema = z.object({
  documentId: z.string().uuid(),
  items: z.array(AuditEventSchema),
});

export const DocumentTextResponseSchema = z.object({
  documentId: z.string().uuid(),
  blocks: z.array(DocumentTextBlockSchema),
});

export const CreateTagSchema = z.object({
  name: z.string().trim().min(1).max(255),
});

export const UpdateTagSchema = z.object({
  name: z.string().trim().min(1).max(255),
});

export const CreateCorrespondentSchema = z.object({
  name: z.string().trim().min(1).max(255),
});

export const UpdateCorrespondentSchema = z.object({
  name: z.string().trim().min(1).max(255),
});

export const CreateDocumentTypeSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(2_000).nullable().optional(),
});

export const UpdateDocumentTypeSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
});

export const MergeTaxonomySchema = z.object({
  targetId: z.string().uuid(),
});

export const DeleteTaxonomyResponseSchema = z.object({
  deleted: z.literal(true),
});

export const AnswerCitationSchema = z.object({
  documentId: z.string().uuid(),
  documentTitle: z.string().min(1),
  chunkIndex: z.number().int().nonnegative(),
  pageFrom: z.number().int().positive().nullable(),
  pageTo: z.number().int().positive().nullable(),
  quote: z.string().min(1),
  score: z.number().nonnegative(),
});

export const AnswerQueryRequestSchema = z.object({
  query: z.string().trim().min(1),
  filters: SearchDocumentsFiltersSchema.optional(),
  maxDocuments: z.number().int().min(1).max(5).default(3),
  maxCitations: z.number().int().min(1).max(8).default(4),
  maxChunkMatches: z.number().int().min(1).max(6).default(4),
});

export const AnswerQueryResponseSchema = z.object({
  status: z.enum(["answered", "insufficient_evidence"]),
  answer: z.string().nullable(),
  reasoning: z.string().nullable().optional(),
  citations: z.array(AnswerCitationSchema),
  results: z.array(SemanticSearchResultSchema),
});

const ArchiveTimestampSchema = z.string().datetime({ offset: true });
const ArchiveDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ArchiveTagSchema = TagSchema.extend({
  createdAt: ArchiveTimestampSchema,
});

export const ArchiveCorrespondentSchema = CorrespondentSchema.extend({
  normalizedName: z.string().min(1),
  createdAt: ArchiveTimestampSchema,
  summary: z.string().nullable().optional(),
  summaryGeneratedAt: ArchiveTimestampSchema.nullable().optional(),
});

export const ArchiveDocumentTypeSchema = DocumentTypeSchema.extend({
  createdAt: ArchiveTimestampSchema,
});

export const ArchiveFileSchema = z.object({
  id: z.string().uuid(),
  checksum: z.string().min(64).max(64),
  storageKey: z.string().min(1),
  originalFilename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: ArchiveTimestampSchema,
  contentBase64: z.string().nullable(),
});

export const ArchiveDocumentSchema = z.object({
  id: z.string().uuid(),
  ownerUserId: z.string().uuid(),
  fileId: z.string().uuid(),
  title: z.string().min(1),
  source: DocumentSourceSchema,
  status: DocumentStatusSchema,
  mimeType: z.string().min(1),
  language: z.string().nullable(),
  fullText: z.string(),
  pageCount: z.number().int().nonnegative(),
  issueDate: ArchiveDateSchema.nullable(),
  dueDate: ArchiveDateSchema.nullable(),
  amount: z.number().nullable(),
  currency: z.string().length(3).nullable(),
  referenceNumber: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  reviewStatus: ReviewStatusSchema,
  reviewReasons: z.array(ReviewReasonSchema),
  reviewedAt: ArchiveTimestampSchema.nullable(),
  reviewNote: z.string().nullable(),
  searchablePdfStorageKey: z.string().nullable(),
  parseProvider: ParseProviderSchema.nullable(),
  chunkCount: z.number().int().nonnegative(),
  embeddingStatus: EmbeddingStatusSchema,
  embeddingProvider: EmbeddingProviderSchema.nullable(),
  embeddingModel: z.string().nullable(),
  lastProcessingError: z.string().nullable(),
  correspondentId: z.string().uuid().nullable(),
  documentTypeId: z.string().uuid().nullable(),
  metadata: DocumentMetadataSchema,
  createdAt: ArchiveTimestampSchema,
  processedAt: ArchiveTimestampSchema.nullable(),
  updatedAt: ArchiveTimestampSchema,
});

export const ArchiveDocumentTagLinkSchema = z.object({
  documentId: z.string().uuid(),
  tagId: z.string().uuid(),
  createdAt: ArchiveTimestampSchema,
});

export const ArchiveDocumentPageSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  pageNumber: z.number().int().positive(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});

export const ArchiveDocumentTextBlockSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  pageNumber: z.number().int().positive(),
  lineIndex: z.number().int().nonnegative(),
  boundingBox: BoundingBoxSchema,
  text: z.string().min(1),
});

export const ArchiveDocumentChunkSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  chunkIndex: z.number().int().nonnegative(),
  heading: z.string().nullable(),
  text: z.string(),
  pageFrom: z.number().int().positive().nullable(),
  pageTo: z.number().int().positive().nullable(),
  strategyVersion: z.string().min(1),
  contentHash: z.string().min(64).max(64),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: ArchiveTimestampSchema,
});

export const ArchiveDocumentChunkEmbeddingSchema = z.object({
  documentId: z.string().uuid(),
  chunkIndex: z.number().int().nonnegative(),
  provider: EmbeddingProviderSchema,
  model: z.string().min(1),
  dimensions: z.number().int().positive(),
  embeddingLiteral: z.string().min(1),
  contentHash: z.string().min(64).max(64),
  createdAt: ArchiveTimestampSchema,
  updatedAt: ArchiveTimestampSchema,
});

export const ArchiveProcessingJobSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  queueName: z.string().min(1),
  status: ProcessingJobStatusSchema,
  attempts: z.number().int().nonnegative(),
  payload: z.record(z.string(), z.unknown()).default({}),
  lastError: z.string().nullable(),
  startedAt: ArchiveTimestampSchema.nullable(),
  finishedAt: ArchiveTimestampSchema.nullable(),
  createdAt: ArchiveTimestampSchema,
  updatedAt: ArchiveTimestampSchema,
});

export const ArchiveAuditEventSchema = z.object({
  id: z.string().uuid(),
  actorUserId: z.string().uuid().nullable(),
  documentId: z.string().uuid().nullable(),
  eventType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  createdAt: ArchiveTimestampSchema,
});

export const ArchiveDerivedObjectSchema = z.object({
  storageKey: z.string().min(1),
  contentBase64: z.string().nullable(),
});

export const ArchiveSnapshotSchema = z.object({
  version: z.literal(1),
  exportedAt: ArchiveTimestampSchema,
  tags: z.array(ArchiveTagSchema),
  correspondents: z.array(ArchiveCorrespondentSchema),
  documentTypes: z.array(ArchiveDocumentTypeSchema),
  files: z.array(ArchiveFileSchema),
  documents: z.array(ArchiveDocumentSchema),
  documentTagLinks: z.array(ArchiveDocumentTagLinkSchema),
  documentPages: z.array(ArchiveDocumentPageSchema),
  documentTextBlocks: z.array(ArchiveDocumentTextBlockSchema),
  documentChunks: z.array(ArchiveDocumentChunkSchema),
  documentChunkEmbeddings: z.array(ArchiveDocumentChunkEmbeddingSchema),
  processingJobs: z.array(ArchiveProcessingJobSchema),
  auditEvents: z.array(ArchiveAuditEventSchema),
  derivedObjects: z.array(ArchiveDerivedObjectSchema),
});

export const ArchiveImportRequestSchema = z.object({
  mode: z.enum(["replace", "merge"]).default("replace"),
  snapshot: ArchiveSnapshotSchema,
});

export const ArchiveImportResultSchema = z.object({
  imported: z.literal(true),
  mode: z.enum(["replace", "merge"]),
  documentCount: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
});

export const WatchFolderScanRequestSchema = z.object({
  dryRun: z.boolean().default(false),
});

export const WatchFolderScanSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  imported: z.number().int().nonnegative(),
  duplicate: z.number().int().nonnegative(),
  unsupported: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  planned: z.number().int().nonnegative(),
});

export const WatchFolderScanHistoryItemSchema = z.object({
  scannedAt: ArchiveTimestampSchema,
  dryRun: z.boolean(),
  imported: z.number().int().nonnegative(),
  duplicate: z.number().int().nonnegative(),
  unsupported: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  planned: z.number().int().nonnegative(),
});

export const WatchFolderScanItemSchema = z.object({
  path: z.string().min(1),
  action: z.enum(["imported", "duplicate", "unsupported", "failed", "planned"]),
  destinationPath: z.string().nullable(),
  documentId: z.string().uuid().nullable(),
  reason: z.string().min(1),
  mimeType: z.string().min(1).nullable(),
  failureCode: z
    .enum(["mime_type_missing", "mime_type_not_allowed", "upload_failed"])
    .nullable(),
  detail: z.string().nullable(),
});

export const WatchFolderScanResponseSchema = z.object({
  configuredPath: z.string().min(1),
  dryRun: z.boolean(),
  summary: WatchFolderScanSummarySchema,
  items: z.array(WatchFolderScanItemSchema),
  history: z.array(WatchFolderScanHistoryItemSchema),
});

export type BoundingBox = z.infer<typeof BoundingBoxSchema>;
export type ParseProvider = z.infer<typeof ParseProviderSchema>;
export type EmbeddingProvider = z.infer<typeof EmbeddingProviderSchema>;
export type ParsedDocumentLine = z.infer<typeof ParsedDocumentLineSchema>;
export type ParsedDocumentBlock = z.infer<typeof ParsedDocumentBlockSchema>;
export type ParsedDocumentTableCell = z.infer<typeof ParsedDocumentTableCellSchema>;
export type ParsedDocumentTable = z.infer<typeof ParsedDocumentTableSchema>;
export type ParsedDocumentKeyValue = z.infer<typeof ParsedDocumentKeyValueSchema>;
export type ParsedDocumentChunkHint = z.infer<typeof ParsedDocumentChunkHintSchema>;
export type ParsedDocumentPage = z.infer<typeof ParsedDocumentPageSchema>;
export type ParsedDocument = z.infer<typeof ParsedDocumentSchema>;
export type DocumentChunk = z.infer<typeof DocumentChunkSchema>;
export type DocumentChunkEmbedding = z.infer<typeof DocumentChunkEmbeddingSchema>;
export type Tag = z.infer<typeof TagSchema>;
export type Correspondent = z.infer<typeof CorrespondentSchema>;
export type DocumentType = z.infer<typeof DocumentTypeSchema>;
export type DocumentTextBlock = z.infer<typeof DocumentTextBlockSchema>;
export type ReviewEvidenceField = z.infer<typeof ReviewEvidenceFieldSchema>;
export type ReviewEvidence = z.infer<typeof ReviewEvidenceSchema>;
export type ManualOverrideField = z.infer<typeof ManualOverrideFieldSchema>;
export type ManualOverrides = z.infer<typeof ManualOverridesSchema>;
export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;
export type EmbeddingStatus = z.infer<typeof EmbeddingStatusSchema>;
export type ReviewReason = z.infer<typeof ReviewReasonSchema>;
export type ProcessingJobStatus = z.infer<typeof ProcessingJobStatusSchema>;
export type ProcessingJobSummary = z.infer<typeof ProcessingJobSummarySchema>;
export type Document = z.infer<typeof DocumentSchema>;
export type SearchDocumentsRequest = z.infer<typeof SearchDocumentsRequestSchema>;
export type SearchDocumentsResponse = z.infer<typeof SearchDocumentsResponseSchema>;
export type SemanticMatchedChunk = z.infer<typeof SemanticMatchedChunkSchema>;
export type SemanticSearchRequest = z.infer<typeof SemanticSearchRequestSchema>;
export type SemanticSearchResult = z.infer<typeof SemanticSearchResultSchema>;
export type SemanticSearchResponse = z.infer<typeof SemanticSearchResponseSchema>;
export type DashboardInsightStats = z.infer<typeof DashboardInsightStatsSchema>;
export type CorrespondentTypeCount = z.infer<typeof CorrespondentTypeCountSchema>;
export type DashboardTopCorrespondent = z.infer<typeof DashboardTopCorrespondentSchema>;
export type DashboardDeadlineItem = z.infer<typeof DashboardDeadlineItemSchema>;
export type MonthlyActivityPoint = z.infer<typeof MonthlyActivityPointSchema>;
export type DashboardInsightsResponse = z.infer<typeof DashboardInsightsResponseSchema>;
export type CorrespondentSummaryStatus = z.infer<typeof CorrespondentSummaryStatusSchema>;
export type CorrespondentTimelinePoint = z.infer<typeof CorrespondentTimelinePointSchema>;
export type CorrespondentInsightsResponse = z.infer<
  typeof CorrespondentInsightsResponseSchema
>;
export type DocumentProjectionPoint = z.infer<typeof DocumentProjectionPointSchema>;
export type DocumentProjectionCluster = z.infer<typeof DocumentProjectionClusterSchema>;
export type DocumentsProjectionResponse = z.infer<typeof DocumentsProjectionResponseSchema>;
export type DocumentsTimelineMonth = z.infer<typeof DocumentsTimelineMonthSchema>;
export type DocumentsTimelineYear = z.infer<typeof DocumentsTimelineYearSchema>;
export type DocumentsTimelineResponse = z.infer<typeof DocumentsTimelineResponseSchema>;
export type UploadDocumentMetadata = z.infer<typeof UploadDocumentMetadataSchema>;
export type UpdateDocumentInput = z.infer<typeof UpdateDocumentSchema>;
export type ListReviewDocumentsRequest = z.infer<typeof ListReviewDocumentsRequestSchema>;
export type ResolveReviewRequest = z.infer<typeof ResolveReviewRequestSchema>;
export type RequeueDocumentProcessingRequest = z.infer<
  typeof RequeueDocumentProcessingRequestSchema
>;
export type RequeueDocumentProcessingResponse = z.infer<
  typeof RequeueDocumentProcessingResponseSchema
>;
export type ReprocessDocumentRequest = z.infer<typeof ReprocessDocumentRequestSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type SetupOwnerInput = z.infer<typeof SetupOwnerSchema>;
export type RefreshInput = z.infer<typeof RefreshSchema>;
export type CreateApiTokenInput = z.infer<typeof CreateApiTokenSchema>;
export type CurrentUser = z.infer<typeof CurrentUserSchema>;
export type ApiToken = z.infer<typeof ApiTokenSchema>;
export type CreateApiTokenResponse = z.infer<typeof CreateApiTokenResponseSchema>;
export type SuccessResponse = z.infer<typeof SuccessResponseSchema>;
export type AuthTokens = z.infer<typeof AuthTokensSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type ParseProviderAvailability = z.infer<typeof ParseProviderAvailabilitySchema>;
export type EmbeddingProviderAvailability = z.infer<
  typeof EmbeddingProviderAvailabilitySchema
>;
export type HealthProvidersResponse = z.infer<typeof HealthProvidersResponseSchema>;
export type ProcessingStatusJob = z.infer<typeof ProcessingStatusJobSchema>;
export type ProcessingStatusResponse = z.infer<typeof ProcessingStatusResponseSchema>;
export type QueueDocumentProcessingPayload = z.infer<
  typeof QueueDocumentProcessingPayloadSchema
>;
export type QueueDocumentEmbeddingPayload = z.infer<
  typeof QueueDocumentEmbeddingPayloadSchema
>;
export type ReindexEmbeddingsRequest = z.infer<typeof ReindexEmbeddingsRequestSchema>;
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type DocumentHistoryResponse = z.infer<typeof DocumentHistoryResponseSchema>;
export type DocumentTextResponse = z.infer<typeof DocumentTextResponseSchema>;
export type CreateTagInput = z.infer<typeof CreateTagSchema>;
export type UpdateTagInput = z.infer<typeof UpdateTagSchema>;
export type CreateCorrespondentInput = z.infer<typeof CreateCorrespondentSchema>;
export type UpdateCorrespondentInput = z.infer<typeof UpdateCorrespondentSchema>;
export type CreateDocumentTypeInput = z.infer<typeof CreateDocumentTypeSchema>;
export type UpdateDocumentTypeInput = z.infer<typeof UpdateDocumentTypeSchema>;
export type MergeTaxonomyInput = z.infer<typeof MergeTaxonomySchema>;
export type DeleteTaxonomyResponse = z.infer<typeof DeleteTaxonomyResponseSchema>;
export type AnswerCitation = z.infer<typeof AnswerCitationSchema>;
export type AnswerQueryRequest = z.infer<typeof AnswerQueryRequestSchema>;
export type AnswerQueryResponse = z.infer<typeof AnswerQueryResponseSchema>;
export type ArchiveTag = z.infer<typeof ArchiveTagSchema>;
export type ArchiveCorrespondent = z.infer<typeof ArchiveCorrespondentSchema>;
export type ArchiveDocumentType = z.infer<typeof ArchiveDocumentTypeSchema>;
export type ArchiveFile = z.infer<typeof ArchiveFileSchema>;
export type ArchiveDocument = z.infer<typeof ArchiveDocumentSchema>;
export type ArchiveDocumentTagLink = z.infer<typeof ArchiveDocumentTagLinkSchema>;
export type ArchiveDocumentPage = z.infer<typeof ArchiveDocumentPageSchema>;
export type ArchiveDocumentTextBlock = z.infer<typeof ArchiveDocumentTextBlockSchema>;
export type ArchiveDocumentChunk = z.infer<typeof ArchiveDocumentChunkSchema>;
export type ArchiveDocumentChunkEmbedding = z.infer<typeof ArchiveDocumentChunkEmbeddingSchema>;
export type ArchiveProcessingJob = z.infer<typeof ArchiveProcessingJobSchema>;
export type ArchiveAuditEvent = z.infer<typeof ArchiveAuditEventSchema>;
export type ArchiveDerivedObject = z.infer<typeof ArchiveDerivedObjectSchema>;
export type ArchiveSnapshot = z.infer<typeof ArchiveSnapshotSchema>;
export type ArchiveImportRequest = z.infer<typeof ArchiveImportRequestSchema>;
export type ArchiveImportResult = z.infer<typeof ArchiveImportResultSchema>;
export type WatchFolderScanRequest = z.infer<typeof WatchFolderScanRequestSchema>;
export type WatchFolderScanSummary = z.infer<typeof WatchFolderScanSummarySchema>;
export type WatchFolderScanHistoryItem = z.infer<typeof WatchFolderScanHistoryItemSchema>;
export type WatchFolderScanItem = z.infer<typeof WatchFolderScanItemSchema>;
export type WatchFolderScanResponse = z.infer<typeof WatchFolderScanResponseSchema>;
