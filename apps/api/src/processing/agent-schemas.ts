import { z } from "zod";

/**
 * Response validators + JSON-schema builders for the agentic pipeline's LLM calls.
 * The JSON schemas are sent as `response_format: json_schema` (Mistral/OpenAI) so the
 * provider enforces the shape; the Zod schemas validate what actually came back and
 * replace the previous unchecked `Record<string, unknown>` casts.
 *
 * All builders emit strict-compatible schemas: every property is required (nullable
 * where optional in spirit) and `additionalProperties: false` — OpenAI's strict mode
 * accepts nothing else.
 */

export const RoutingResponseSchema = z.object({
  documentType: z.string(),
  subtype: z.string().nullish(),
  confidence: z.number().min(0).max(1),
  reasoningHints: z.array(z.string()).nullish(),
});
export type RoutingResponse = z.infer<typeof RoutingResponseSchema>;

export const TitleSummaryResponseSchema = z.object({
  title: z.string().nullish(),
  titleConfidence: z.number().min(0).max(1).nullish(),
  summary: z.string().nullish(),
  summaryConfidence: z.number().min(0).max(1).nullish(),
});
export type TitleSummaryResponse = z.infer<typeof TitleSummaryResponseSchema>;

/**
 * Field values must be scalars. Providers without schema enforcement (Gemini runs
 * in plain JSON mode) can answer with objects like `{ value: 89, currency: "EUR" }`;
 * merging that would replace a valid deterministic number and normalization would
 * then drop it entirely, so such responses are rejected here instead.
 */
const ExtractionFieldValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const TypedExtractionResponseSchema = z.object({
  fields: z.record(z.string(), ExtractionFieldValueSchema),
  // The strict request schema REQUIRES a fieldConfidence entry per relevant field
  // and permits null for unknown values — the validator must accept those null
  // placeholders or every partially populated response falls back to deterministic.
  fieldConfidence: z.record(z.string(), z.number().nullable()).nullish(),
});
export type TypedExtractionResponse = z.infer<typeof TypedExtractionResponseSchema>;

export const TaggingResponseSchema = z.object({
  tags: z.array(z.string()),
  confidence: z.number().min(0).max(1).nullish(),
});
export type TaggingResponse = z.infer<typeof TaggingResponseSchema>;

const nullableString = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"], minimum: 0, maximum: 1 };
const nullableScalar = { type: ["string", "number", "null"] };

export const buildRoutingJsonSchema = (documentTypes: readonly string[]) => ({
  name: "document_routing",
  schema: {
    type: "object",
    properties: {
      documentType: { type: "string", enum: [...documentTypes] },
      subtype: nullableString,
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reasoningHints: { type: "array", items: { type: "string" } },
    },
    required: ["documentType", "subtype", "confidence", "reasoningHints"],
    additionalProperties: false,
  },
});

export const buildTitleSummaryJsonSchema = () => ({
  name: "title_summary",
  schema: {
    type: "object",
    properties: {
      title: nullableString,
      titleConfidence: nullableNumber,
      summary: nullableString,
      summaryConfidence: nullableNumber,
    },
    required: ["title", "titleConfidence", "summary", "summaryConfidence"],
    additionalProperties: false,
  },
});

/**
 * Per-type extraction schema generated from the registry's relevant fields: each
 * field is a required nullable scalar, so the closed shape stays strict-compatible
 * while unknown values remain expressible as null.
 */
export const buildTypedExtractionJsonSchema = (relevantFields: readonly string[]) => ({
  name: "typed_extraction",
  schema: {
    type: "object",
    properties: {
      fields: {
        type: "object",
        properties: Object.fromEntries(relevantFields.map((field) => [field, nullableScalar])),
        required: [...relevantFields],
        additionalProperties: false,
      },
      fieldConfidence: {
        type: "object",
        properties: Object.fromEntries(relevantFields.map((field) => [field, nullableNumber])),
        required: [...relevantFields],
        additionalProperties: false,
      },
    },
    required: ["fields", "fieldConfidence"],
    additionalProperties: false,
  },
});

export const buildTaggingJsonSchema = () => ({
  name: "document_tags",
  schema: {
    type: "object",
    properties: {
      tags: { type: "array", items: { type: "string" } },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["tags", "confidence"],
    additionalProperties: false,
  },
});
