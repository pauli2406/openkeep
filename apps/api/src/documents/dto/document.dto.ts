import {
  DocumentSchema,
  DocumentStatusSchema,
  ListReviewDocumentsRequestSchema,
  ReindexEmbeddingsRequestSchema,
  ReprocessDocumentRequestSchema,
  RequeueDocumentProcessingRequestSchema,
  RequeueDocumentProcessingResponseSchema,
  ResolveReviewRequestSchema,
  ReviewReasonSchema,
  SearchDocumentsResponseSchema,
  SemanticSearchRequestSchema,
  SearchDocumentsRequestSchema,
  UpdateDocumentSchema,
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

const SearchDocumentsQuerySchema = z.object({
  query: z.string().trim().optional(),
  year: z.coerce.number().int().min(1970).max(2100).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  correspondentId: z.string().uuid().optional(),
  documentTypeId: z.string().uuid().optional(),
  status: DocumentStatusSchema.optional(),
  tags: CsvUuidArraySchema,
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
export class SearchDocumentsQueryDto extends createZodDto(SearchDocumentsQuerySchema) {}
export class ReviewDocumentsQueryDto extends createZodDto(ReviewDocumentsQuerySchema) {}
export class SearchDocumentsResponseDto extends createZodDto(SearchDocumentsResponseSchema) {}
export class DocumentResponseDto extends createZodDto(DocumentSchema) {}
export class ResolveReviewDto extends createZodDto(ResolveReviewRequestSchema) {}
export class RequeueDocumentProcessingDto extends createZodDto(
  RequeueDocumentProcessingRequestSchema,
) {}
export class RequeueDocumentProcessingResponseDto extends createZodDto(
  RequeueDocumentProcessingResponseSchema,
) {}
export class ReprocessDocumentDto extends createZodDto(ReprocessDocumentRequestSchema) {}
export class SemanticSearchDto extends createZodDto(SemanticSearchRequestSchema) {}
export class ReindexEmbeddingsDto extends createZodDto(ReindexEmbeddingsRequestSchema) {}
