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
  documentTypeId: z.string().uuid().optional(),
  status: DocumentStatusSchema.optional(),
  tags: z.array(z.string().uuid()).optional(),
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

export const WatchFolderScanRequestSchema = z.object({
  dryRun: z.boolean().default(false),
});

export const WatchFolderScanResponseSchema = z.object({
  configuredPath: z.string().min(1),
  importedDocumentIds: z.array(z.string().uuid()),
  skippedFiles: z.array(z.string()),
  errors: z.array(z.string()),
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
export type CreateTagInput = z.infer<typeof CreateTagSchema>;
export type UpdateTagInput = z.infer<typeof UpdateTagSchema>;
export type CreateCorrespondentInput = z.infer<typeof CreateCorrespondentSchema>;
export type UpdateCorrespondentInput = z.infer<typeof UpdateCorrespondentSchema>;
export type CreateDocumentTypeInput = z.infer<typeof CreateDocumentTypeSchema>;
export type UpdateDocumentTypeInput = z.infer<typeof UpdateDocumentTypeSchema>;
export type MergeTaxonomyInput = z.infer<typeof MergeTaxonomySchema>;
export type AnswerCitation = z.infer<typeof AnswerCitationSchema>;
export type AnswerQueryRequest = z.infer<typeof AnswerQueryRequestSchema>;
export type AnswerQueryResponse = z.infer<typeof AnswerQueryResponseSchema>;
export type WatchFolderScanRequest = z.infer<typeof WatchFolderScanRequestSchema>;
export type WatchFolderScanResponse = z.infer<typeof WatchFolderScanResponseSchema>;
