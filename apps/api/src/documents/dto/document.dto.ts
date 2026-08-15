import {
  AnswerQueryRequestSchema,
  AnswerQueryResponseSchema,
  SearchDocumentsFiltersSchema,
  BatchReprocessDocumentsRequestSchema,
  BatchReprocessDocumentsResponseSchema,
  DocumentAskRequestSchema,
  DocumentSchema,
  DocumentStatusSchema,
  DocumentHistoryResponseSchema,
  DocumentTextResponseSchema,
  ListReviewDocumentsRequestSchema,
  ReindexEmbeddingsRequestSchema,
  ReprocessDocumentRequestSchema,
  RequeueDocumentProcessingRequestSchema,
  RequeueDocumentProcessingResponseSchema,
  ResolveReviewRequestSchema,
  SaveDocumentQaEntryRequestSchema,
  ReviewReasonSchema,
  SearchDocumentsResponseSchema,
  SemanticSearchResponseSchema,
  SemanticSearchRequestSchema,
  SearchDocumentsRequestSchema,
  UpdateDocumentSchema,
  BulkTagDocumentsRequestSchema,
  BulkSetDocumentTypeRequestSchema,
} from "@openkeep/types";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const CsvUuidArraySchema = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return undefined;
}, z.array(z.string().uuid()).optional());

const CsvStatusArraySchema = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return undefined;
}, z.array(DocumentStatusSchema).optional());

const SearchDocumentsQuerySchema = z.object({
  query: z.string().trim().optional(),
  year: z.coerce.number().int().min(1970).max(2100).optional(),
  dateFrom: SearchDocumentsFiltersSchema.shape.dateFrom,
  dateTo: SearchDocumentsFiltersSchema.shape.dateTo,
  correspondentId: z.string().uuid().optional(),
  correspondentIds: CsvUuidArraySchema,
  documentTypeId: z.string().uuid().optional(),
  documentTypeIds: CsvUuidArraySchema,
  status: DocumentStatusSchema.optional(),
  statuses: CsvStatusArraySchema,
  tags: CsvUuidArraySchema,
  categoryIds: CsvUuidArraySchema,
  uncategorized: z
    .preprocess((value) => {
      if (typeof value === "string") return ["1", "true", "yes"].includes(value.toLowerCase());
      return value;
    }, z.boolean())
    .optional(),
  amountMin: z.coerce.number().optional(),
  amountMax: z.coerce.number().optional(),
  sort: SearchDocumentsRequestSchema.shape.sort.default("createdAt"),
  direction: SearchDocumentsRequestSchema.shape.direction.default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const ReviewDocumentsQuerySchema = z.object({
  processingStatus: DocumentStatusSchema.optional(),
  reason: ReviewReasonSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export class UpdateDocumentDto extends createZodDto(UpdateDocumentSchema) {}
export class BulkTagDocumentsDto extends createZodDto(BulkTagDocumentsRequestSchema) {}
export class BulkSetDocumentTypeDto extends createZodDto(BulkSetDocumentTypeRequestSchema) {}
export class SearchDocumentsQueryDto extends createZodDto(SearchDocumentsQuerySchema) {}
export class ReviewDocumentsQueryDto extends createZodDto(ReviewDocumentsQuerySchema) {}
export class SearchDocumentsResponseDto extends createZodDto(SearchDocumentsResponseSchema) {}
export class DocumentResponseDto extends createZodDto(DocumentSchema) {}
export class DocumentTextResponseDto extends createZodDto(DocumentTextResponseSchema) {}
export class DocumentHistoryResponseDto extends createZodDto(DocumentHistoryResponseSchema) {}
export class ResolveReviewDto extends createZodDto(ResolveReviewRequestSchema) {}
export class SaveDocumentQaEntryDto extends createZodDto(SaveDocumentQaEntryRequestSchema) {}
export class RequeueDocumentProcessingDto extends createZodDto(
  RequeueDocumentProcessingRequestSchema,
) {}
export class RequeueDocumentProcessingResponseDto extends createZodDto(
  RequeueDocumentProcessingResponseSchema,
) {}
export class ReprocessDocumentDto extends createZodDto(ReprocessDocumentRequestSchema) {}
export class BatchReprocessDocumentsDto extends createZodDto(
  BatchReprocessDocumentsRequestSchema,
) {}
export class BatchReprocessDocumentsResponseDto extends createZodDto(
  BatchReprocessDocumentsResponseSchema,
) {}
export class AnswerQueryDto extends createZodDto(AnswerQueryRequestSchema) {}
export class AnswerQueryResponseDto extends createZodDto(AnswerQueryResponseSchema) {}
export class SemanticSearchDto extends createZodDto(SemanticSearchRequestSchema) {}
export class SemanticSearchResponseDto extends createZodDto(SemanticSearchResponseSchema) {}
export class ReindexEmbeddingsDto extends createZodDto(ReindexEmbeddingsRequestSchema) {}
export class DocumentAskDto extends createZodDto(DocumentAskRequestSchema) {}
