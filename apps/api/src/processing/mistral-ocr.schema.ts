import { z } from "zod";

/**
 * Schema of the real Mistral OCR API response (`POST /v1/ocr`).
 * See https://docs.mistral.ai/studio-api/document-processing/basic_ocr — pages carry
 * `markdown` plus `dimensions`; there are no per-line boxes and no top-level `text`.
 * Kept deliberately permissive (passthrough) so additive API changes do not break parsing.
 */
export const MistralOcrPageDimensionsSchema = z
  .object({
    dpi: z.number().nullish(),
    height: z.number().nullish(),
    width: z.number().nullish(),
  })
  .partial()
  .passthrough();

export const MistralOcrImageSchema = z
  .object({
    id: z.string().optional(),
    top_left_x: z.number().nullish(),
    top_left_y: z.number().nullish(),
    bottom_right_x: z.number().nullish(),
    bottom_right_y: z.number().nullish(),
    image_base64: z.string().nullish(),
  })
  .passthrough();

export const MistralOcrPageSchema = z
  .object({
    index: z.number().int().nonnegative(),
    markdown: z.string().default(""),
    dimensions: MistralOcrPageDimensionsSchema.nullish(),
    images: z.array(MistralOcrImageSchema).default([]),
    tables: z.array(z.unknown()).optional(),
    hyperlinks: z.array(z.unknown()).optional(),
    blocks: z.array(z.unknown()).optional(),
    confidence_scores: z.unknown().optional(),
  })
  .passthrough();

export const MistralOcrUsageSchema = z
  .object({
    pages_processed: z.number().int().nonnegative().nullish(),
    doc_size_bytes: z.number().int().nonnegative().nullish(),
  })
  .partial()
  .passthrough();

export const MistralOcrResponseSchema = z
  .object({
    model: z.string().optional(),
    pages: z.array(MistralOcrPageSchema).default([]),
    usage_info: MistralOcrUsageSchema.nullish(),
    document_annotation: z.unknown().optional(),
  })
  .passthrough();

export type MistralOcrResponse = z.infer<typeof MistralOcrResponseSchema>;
export type MistralOcrPage = z.infer<typeof MistralOcrPageSchema>;
