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

/**
 * Paragraph-level block returned with `include_blocks: true`. The bbox convention
 * varies across Mistral payloads (corner coordinates like images, an object with
 * x/y/width/height, or a flat corner array) — accept all and normalize in the mapper.
 */
export const MistralOcrBlockSchema = z
  .object({
    type: z.string().nullish(),
    text: z.string().nullish(),
    markdown: z.string().nullish(),
    confidence: z.number().nullish(),
    top_left_x: z.number().nullish(),
    top_left_y: z.number().nullish(),
    bottom_right_x: z.number().nullish(),
    bottom_right_y: z.number().nullish(),
    bbox: z
      .union([
        z.array(z.number()),
        z
          .object({
            x: z.number().nullish(),
            y: z.number().nullish(),
            width: z.number().nullish(),
            height: z.number().nullish(),
            top_left_x: z.number().nullish(),
            top_left_y: z.number().nullish(),
            bottom_right_x: z.number().nullish(),
            bottom_right_y: z.number().nullish(),
          })
          .passthrough(),
      ])
      .nullish(),
  })
  .passthrough();

/** Table entry returned with `table_format: "markdown"` (content is a pipe table). */
export const MistralOcrTableSchema = z
  .object({
    id: z.string().nullish(),
    markdown: z.string().nullish(),
    content: z.string().nullish(),
    html: z.string().nullish(),
  })
  .passthrough();

export const MistralOcrPageSchema = z
  .object({
    index: z.number().int().nonnegative(),
    markdown: z.string().default(""),
    dimensions: MistralOcrPageDimensionsSchema.nullish(),
    images: z.array(MistralOcrImageSchema).default([]),
    tables: z.array(MistralOcrTableSchema).nullish(),
    hyperlinks: z.array(z.unknown()).optional(),
    blocks: z.array(MistralOcrBlockSchema).nullish(),
    // `confidence_scores_granularity: "page"` — shape varies (bare number or object).
    confidence_scores: z.unknown().optional(),
    confidence: z.number().nullish(),
    header: z.string().nullish(),
    footer: z.string().nullish(),
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
export type MistralOcrBlock = z.infer<typeof MistralOcrBlockSchema>;
export type MistralOcrTable = z.infer<typeof MistralOcrTableSchema>;
