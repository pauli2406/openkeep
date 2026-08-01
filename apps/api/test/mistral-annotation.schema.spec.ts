import { describe, expect, it } from "vitest";

import {
  ANNOTATION_FIELD_NAMES,
  buildDocumentAnnotationSchema,
  parseDocumentAnnotation,
} from "../src/processing/mistral-annotation.schema";

describe("buildDocumentAnnotationSchema", () => {
  it("builds one closed generic schema with the document type enum", () => {
    const schema = buildDocumentAnnotationSchema(["invoice", "receipt", "generic_letter"]);

    expect(schema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    const properties = schema.properties as Record<string, any>;
    expect(properties.documentType.enum).toEqual(["invoice", "receipt", "generic_letter", null]);
    expect(Object.keys(properties.fields.properties)).toEqual([...ANNOTATION_FIELD_NAMES]);
    expect(properties.fields.required).toEqual([...ANNOTATION_FIELD_NAMES]);
    expect(properties.fields.additionalProperties).toBe(false);
  });
});

describe("parseDocumentAnnotation", () => {
  it("parses an annotation object into the preExtracted shape", () => {
    const result = parseDocumentAnnotation(
      {
        documentType: "Invoice",
        documentTypeConfidence: 0.92,
        title: " Stromrechnung Mai 2026 ",
        summary: "Rechnung der Stadtwerke über 89 EUR.",
        fields: {
          amount: "89,00",
          currency: "EUR",
          issueDate: null,
          referenceNumber: "",
        },
        fieldConfidence: { amount: 0.9, currency: 1.4, issueDate: null },
      },
      "mistral-ocr-latest",
    );

    expect(result).toMatchObject({
      source: "mistral-document-annotation",
      model: "mistral-ocr-latest",
      documentType: "invoice",
      documentTypeConfidence: 0.92,
      title: "Stromrechnung Mai 2026",
    });
    // Empty/null values are dropped, confidences clamped to [0, 1].
    expect(result?.fields).toEqual({ amount: "89,00", currency: "EUR" });
    expect(result?.fieldConfidence).toEqual({ amount: 0.9, currency: 1 });
  });

  it("parses JSON-string payloads and rejects malformed ones", () => {
    const fromString = parseDocumentAnnotation(
      JSON.stringify({ documentType: "receipt", fields: {} }),
      null,
    );
    expect(fromString?.documentType).toBe("receipt");

    expect(parseDocumentAnnotation("not json", null)).toBeNull();
    expect(parseDocumentAnnotation({ documentTypeConfidence: "high" }, null)).toBeNull();
  });
});
