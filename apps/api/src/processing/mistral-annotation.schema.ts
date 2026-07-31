import { z } from "zod";

export const ANNOTATION_SCHEMA_VERSION = "v1";

/**
 * Fields requested from Mistral's document annotation. ONE generic schema across
 * all document types: classification happens inside the same OCR call, so a
 * per-type schema cannot be chosen beforehand. The union of the registry's
 * relevant fields keeps the shape closed and provider-enforceable.
 */
export const ANNOTATION_FIELD_NAMES = [
  "issueDate",
  "dueDate",
  "expiryDate",
  "amount",
  "currency",
  "referenceNumber",
  "holderName",
  "issuingAuthority",
  "correspondentName",
] as const;

const nullableString = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };
const nullableScalar = { type: ["string", "number", "null"] };

/**
 * JSON schema sent as `document_annotation_format` on the OCR request. The
 * annotation model sees the document with layout and images, so its
 * classification and field values are often stronger than a text-excerpt chat
 * call — but they remain a hint the pipeline validates and can override.
 */
export const buildDocumentAnnotationSchema = (
  documentTypes: readonly string[],
): Record<string, unknown> => ({
  type: "object",
  properties: {
    documentType: {
      type: ["string", "null"],
      enum: [...documentTypes, null],
      description: "The document type. Use null when uncertain.",
    },
    documentTypeConfidence: {
      ...nullableNumber,
      description: "Confidence for documentType between 0 and 1.",
    },
    title: {
      ...nullableString,
      description: "Concise, neutral archive title for this document.",
    },
    summary: {
      ...nullableString,
      description: "Factual summary in 1-2 sentences, under 240 characters.",
    },
    fields: {
      type: "object",
      description: "Normalized metadata fields; null for values not present in the document.",
      properties: Object.fromEntries(
        ANNOTATION_FIELD_NAMES.map((field) => [field, nullableScalar]),
      ),
      required: [...ANNOTATION_FIELD_NAMES],
      additionalProperties: false,
    },
    fieldConfidence: {
      type: "object",
      description: "Confidence per extracted field between 0 and 1.",
      properties: Object.fromEntries(
        ANNOTATION_FIELD_NAMES.map((field) => [field, nullableNumber]),
      ),
      required: [...ANNOTATION_FIELD_NAMES],
      additionalProperties: false,
    },
  },
  required: [
    "documentType",
    "documentTypeConfidence",
    "title",
    "summary",
    "fields",
    "fieldConfidence",
  ],
  additionalProperties: false,
});

/** Validates the `document_annotation` payload the OCR response carries. */
export const MistralDocumentAnnotationSchema = z
  .object({
    documentType: z.string().nullish(),
    documentTypeConfidence: z.number().min(0).max(1).nullish(),
    title: z.string().nullish(),
    summary: z.string().nullish(),
    fields: z.record(z.string(), z.unknown()).nullish(),
    fieldConfidence: z.record(z.string(), z.number().nullable()).nullish(),
  })
  .passthrough();

export type MistralDocumentAnnotation = z.infer<typeof MistralDocumentAnnotationSchema>;

/**
 * Parses the raw `document_annotation` value (Mistral returns it as a JSON string
 * or an object depending on SDK/API path) into the normalized preExtracted shape.
 * Returns null when the payload is missing or malformed — the pipeline then simply
 * runs without the hint.
 */
export const parseDocumentAnnotation = (
  raw: unknown,
  model: string | null,
): {
  source: "mistral-document-annotation";
  model: string | null;
  schemaVersion: string;
  documentType: string | null;
  documentTypeConfidence: number | null;
  title: string | null;
  summary: string | null;
  fields: Record<string, unknown>;
  fieldConfidence: Record<string, number>;
} | null => {
  let candidate: unknown = raw;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }

  const result = MistralDocumentAnnotationSchema.safeParse(candidate);
  if (!result.success) {
    return null;
  }

  const annotation = result.data;
  const fieldConfidence: Record<string, number> = {};
  for (const [key, value] of Object.entries(annotation.fieldConfidence ?? {})) {
    if (typeof value === "number") {
      fieldConfidence[key] = Math.max(0, Math.min(1, value));
    }
  }

  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(annotation.fields ?? {})) {
    if (value !== null && value !== undefined && value !== "") {
      fields[key] = value;
    }
  }

  return {
    source: "mistral-document-annotation",
    model,
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    documentType: annotation.documentType?.trim().toLowerCase() || null,
    documentTypeConfidence: annotation.documentTypeConfidence ?? null,
    title: annotation.title?.trim() || null,
    summary: annotation.summary?.trim() || null,
    fields,
    fieldConfidence,
  };
};
