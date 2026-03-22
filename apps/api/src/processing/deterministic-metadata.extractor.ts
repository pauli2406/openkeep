import { Injectable } from "@nestjs/common";
import type { ReviewEvidenceField, ReviewReason } from "@openkeep/types";

import type {
  MetadataExtractionInput,
  MetadataExtractionResult,
  MetadataExtractor,
} from "./provider.types";
import {
  computeConfidence,
  normalizeAmountValue,
  normalizeCurrencyCode,
  parseDateOnly,
} from "./normalization.util";

@Injectable()
export class DeterministicMetadataExtractor implements MetadataExtractor {
  async extract(input: MetadataExtractionInput): Promise<MetadataExtractionResult> {
    const text = input.parsed.text;
    const documentTypeName = this.detectDocumentType(text);
    const correspondentName = this.detectCorrespondent(input);
    const issueDate =
      this.findDateByLabels(input, ["invoice date", "rechnungsdatum", "datum"]) ??
      this.findFirstDate(text);
    const dueDate = this.findDateByLabels(input, [
      "due date",
      "payment due",
      "fällig",
      "faellig",
      "zahlbar bis",
    ]);
    const amount = this.findAmount(input);
    const referenceNumber = this.findReferenceNumber(input);
    const tags = this.detectTags(text, documentTypeName, dueDate);
    const penalties: number[] = [];
    const reviewReasons = new Set<ReviewReason>(input.parsed.reviewReasons);
    const isInvoice = documentTypeName === "Invoice";
    const requiredFields: ReviewEvidenceField[] = isInvoice
      ? ["correspondent", "issueDate", "amount", "currency"]
      : [];
    const extracted = {
      correspondent: Boolean(correspondentName),
      issueDate: Boolean(issueDate),
      amount: Boolean(amount?.value),
      currency: Boolean(amount?.currency),
    };
    const missingFields = requiredFields.filter((field) => !extracted[field]);

    if (text.trim().length < 80) {
      penalties.push(0.12);
    }

    if (input.parsed.pages.length === 0) {
      penalties.push(0.2);
    }

    if (missingFields.length > 0) {
      reviewReasons.add("missing_key_fields");
      penalties.push(0.18);
    }

    const normalizedConfidence = computeConfidence({
      base: 0.3,
      boosts: [
        correspondentName ? 0.15 : 0,
        issueDate ? 0.1 : 0,
        dueDate ? 0.12 : 0,
        amount ? 0.15 : 0,
        referenceNumber ? 0.05 : 0,
        documentTypeName ? 0.1 : 0,
      ],
      penalties,
    });

    return {
      language: input.parsed.language,
      issueDate,
      dueDate,
      amount: amount?.value ?? null,
      currency: amount?.currency ?? null,
      referenceNumber,
      correspondentName,
      documentTypeName,
      tags,
      confidence: normalizedConfidence,
      reviewReasons: [...reviewReasons],
      metadata: {
        extractionStrategy: "deterministic",
        documentTypeName,
        detectedKeywords: tags,
        normalizationStrategy: input.parsed.parseStrategy,
        reviewEvidence: {
          documentClass: isInvoice ? "invoice" : "generic",
          requiredFields,
          missingFields,
          extracted,
          activeReasons: [...reviewReasons],
          confidence: normalizedConfidence,
        },
      },
    };
  }

  private detectCorrespondent(input: MetadataExtractionInput): string | null {
    const lines = input.parsed.pages
      .flatMap((page) => page.lines)
      .map((line) => line.text.trim())
      .filter(Boolean)
      .slice(0, 8);

    return (
      lines.find(
        (line) =>
          line.length > 2 &&
          !/invoice|rechnung|date|datum|due|fällig|zahlbar|amount|betrag/i.test(line),
      ) ?? null
    );
  }

  private detectDocumentType(text: string): string | null {
    if (/invoice|rechnung/i.test(text)) {
      return "Invoice";
    }
    if (/vertrag|contract/i.test(text)) {
      return "Contract";
    }
    if (/versicherung|insurance/i.test(text)) {
      return "Insurance";
    }
    if (/steuer|tax/i.test(text)) {
      return "Tax";
    }

    return text.trim() ? "Letter" : null;
  }

  private detectTags(text: string, documentTypeName: string | null, dueDate: Date | null) {
    const tags = new Set<string>();

    if (documentTypeName) {
      tags.add(documentTypeName.toLowerCase());
    }

    if (/invoice|rechnung/i.test(text)) tags.add("finance");
    if (/vertrag|contract/i.test(text)) tags.add("agreement");
    if (/versicherung|insurance/i.test(text)) tags.add("insurance");
    if (/steuer|tax/i.test(text)) tags.add("tax");
    if (dueDate) tags.add("deadline");
    if (/mahnung|reminder/i.test(text)) tags.add("urgent");

    return [...tags];
  }

  private findAmount(
    input: MetadataExtractionInput,
  ): { value: number; currency: string | null } | null {
    for (const field of input.parsed.keyValues) {
      if (/betrag|gesamt|summe|total|amount due/i.test(field.key)) {
        const value = normalizeAmountValue(field.value);
        const currency = normalizeCurrencyCode(field.value);
        if (value !== null) {
          return {
            value,
            currency: currency ?? null,
          };
        }
      }
    }

    const text = input.parsed.text;
    const patterns = [
      /(?:betrag|gesamt(?:betrag)?|summe|total(?: due)?|amount due)\s*[:\-]?\s*(€|eur|\$|usd)?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
      /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))\s*(€|eur|\$|usd)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) {
        continue;
      }

      const rawCurrency =
        (match[1] && /[€$a-z]/i.test(match[1]) ? match[1] : match[2]) ?? null;
      const rawAmount = match[2] ?? match[1];
      const value = normalizeAmountValue(rawAmount);
      const currency = normalizeCurrencyCode(rawCurrency);

      if (value === null) {
        continue;
      }

      return {
        value,
        currency: currency ?? null,
      };
    }

    return null;
  }

  private findReferenceNumber(input: MetadataExtractionInput): string | null {
    const structuredField = input.parsed.keyValues.find((field) =>
      /invoice number|invoice no\.?|reference|referenz|kundennummer|rechnungsnummer/i.test(
        field.key,
      ),
    );

    if (structuredField?.value) {
      return structuredField.value.trim();
    }

    const match = input.parsed.text.match(
      /(?:invoice number|invoice no\.?|reference|referenz|kundennummer|rechnungsnummer)\s*[:#-]?\s*([A-Z0-9\-\/]+)/i,
    );

    return match?.[1] ?? null;
  }

  private findDateByLabels(input: MetadataExtractionInput, labels: string[]): Date | null {
    const structuredField = input.parsed.keyValues.find((field) =>
      labels.some((label) => field.key.toLowerCase().includes(label.toLowerCase())),
    );
    if (structuredField?.value) {
      const parsedDate = parseDateOnly(structuredField.value);
      if (parsedDate) {
        return parsedDate;
      }
    }

    const text = input.parsed.text;
    const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const match = text.match(
      new RegExp(`(?:${escaped.join("|")})\\s*[:\\-]?\\s*([0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}|[A-Za-z]+\\s+[0-9]{1,2},\\s+[0-9]{4})`, "i"),
    );

    return match ? parseDateOnly(match[1]) : null;
  }

  private findFirstDate(text: string): Date | null {
    const match = text.match(/[0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}/);
    return match ? parseDateOnly(match[0]) : null;
  }
}
