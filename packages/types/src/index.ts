import { z } from "zod";

export const processingModes = ["local-only", "hybrid", "cloud-assisted"] as const;
export const documentSources = ["upload", "watch-folder", "email", "api"] as const;
export const documentStatuses = ["pending", "processing", "ready", "failed"] as const;
export const reviewStatuses = ["not_required", "pending", "resolved"] as const;
export const reviewReasons = [
  "low_confidence",
  "processing_failed",
  "ocr_empty",
  "missing_key_fields",
  "unsupported_format",
] as const;
export const processingJobStatuses = ["queued", "running", "completed", "failed"] as const;

export const ProcessingModeSchema = z.enum(processingModes);
export const DocumentSourceSchema = z.enum(documentSources);
export const DocumentStatusSchema = z.enum(documentStatuses);
export const ReviewStatusSchema = z.enum(reviewStatuses);
export const ReviewReasonSchema = z.enum(reviewReasons);
export const ProcessingJobStatusSchema = z.enum(processingJobStatuses);

export const BoundingBoxSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
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

export const DocumentMetadataSchema = z
  .object({
    extractionStrategy: z.string().optional(),
    normalizationStrategy: z.string().optional(),
    documentTypeName: z.string().nullable().optional(),
    detectedKeywords: z.array(z.string()).optional(),
    pageCount: z.number().int().nonnegative().optional(),
    searchablePdfGenerated: z.boolean().optional(),
    reviewReasons: z.array(ReviewReasonSchema).optional(),
    reviewEvidence: ReviewEvidenceSchema.optional(),
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
  lastProcessingError: z.string().nullable(),
  latestProcessingJob: ProcessingJobSummarySchema.nullable(),
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
  openaiModel: z.string().optional(),
  geminiModel: z.string().optional(),
  hasOpenAiKey: z.boolean().default(false),
  hasGeminiKey: z.boolean().default(false),
});

export const QueueDocumentProcessingPayloadSchema = z.object({
  documentId: z.string().uuid(),
  force: z.boolean().default(false),
  processingJobId: z.string().uuid().optional(),
  retryCount: z.number().int().nonnegative().default(0),
});

export const ReadinessResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  checks: z.object({
    database: z.boolean(),
    objectStorage: z.boolean(),
    queue: z.boolean(),
  }),
});

export type BoundingBox = z.infer<typeof BoundingBoxSchema>;
export type Tag = z.infer<typeof TagSchema>;
export type Correspondent = z.infer<typeof CorrespondentSchema>;
export type DocumentType = z.infer<typeof DocumentTypeSchema>;
export type DocumentTextBlock = z.infer<typeof DocumentTextBlockSchema>;
export type ReviewEvidenceField = z.infer<typeof ReviewEvidenceFieldSchema>;
export type ReviewEvidence = z.infer<typeof ReviewEvidenceSchema>;
export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;
export type ReviewReason = z.infer<typeof ReviewReasonSchema>;
export type ProcessingJobStatus = z.infer<typeof ProcessingJobStatusSchema>;
export type ProcessingJobSummary = z.infer<typeof ProcessingJobSummarySchema>;
export type Document = z.infer<typeof DocumentSchema>;
export type SearchDocumentsRequest = z.infer<typeof SearchDocumentsRequestSchema>;
export type SearchDocumentsResponse = z.infer<typeof SearchDocumentsResponseSchema>;
export type UploadDocumentMetadata = z.infer<typeof UploadDocumentMetadataSchema>;
export type UpdateDocumentInput = z.infer<typeof UpdateDocumentSchema>;
export type ListReviewDocumentsRequest = z.infer<typeof ListReviewDocumentsRequestSchema>;
export type ResolveReviewRequest = z.infer<typeof ResolveReviewRequestSchema>;
export type RequeueDocumentProcessingRequest = z.infer<
  typeof RequeueDocumentProcessingRequestSchema
>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type SetupOwnerInput = z.infer<typeof SetupOwnerSchema>;
export type RefreshInput = z.infer<typeof RefreshSchema>;
export type CreateApiTokenInput = z.infer<typeof CreateApiTokenSchema>;
export type AuthTokens = z.infer<typeof AuthTokensSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type QueueDocumentProcessingPayload = z.infer<
  typeof QueueDocumentProcessingPayloadSchema
>;
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
