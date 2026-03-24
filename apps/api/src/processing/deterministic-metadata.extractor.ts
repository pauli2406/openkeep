import { Inject, Injectable } from "@nestjs/common";
import type { ReviewReason } from "@openkeep/types";

import type {
  MetadataExtractionInput,
  MetadataExtractionResult,
  MetadataExtractor,
} from "./provider.types";
import { DocumentTypePolicyService } from "./document-type-policy.service";
import {
  computeConfidence,
  normalizeAmountValue,
  normalizeCurrencyCode,
  parseDateOnly,
} from "./normalization.util";

@Injectable()
export class DeterministicMetadataExtractor implements MetadataExtractor {
  constructor(
    @Inject(DocumentTypePolicyService)
    private readonly documentTypePolicyService: DocumentTypePolicyService,
  ) {}

  async extract(input: MetadataExtractionInput): Promise<MetadataExtractionResult> {
    const text = input.parsed.text;
    const detectedDocumentType = this.detectDocumentType(text, input.title);
    const policy = await this.documentTypePolicyService.getPolicy(detectedDocumentType);
    const documentTypeName = policy.documentTypeName;
    const correspondentName = this.detectCorrespondent(input);
    const issueDate =
      this.findDateByLabels(input, [
        "invoice date",
        "rechnungsdatum",
        "issue date",
        "issued on",
        "datum",
      ]) ?? this.findFirstDate(text);
    const dueDate = this.findDateByLabels(input, [
      "due date",
      "payment due",
      "fällig",
      "faellig",
      "zahlbar bis",
      "due on",
    ]);
    const expiryDate = this.findDateByLabels(input, [
      "expiry date",
      "expiration date",
      "expires on",
      "valid until",
      "gültig bis",
      "gueltig bis",
      "ablaufdatum",
    ]) ?? this.inferExpiryDateFromDuration(input.parsed.text);
    const amount = this.findAmount(input);
    const referenceNumber = this.findReferenceNumber(input);
    const holderName = this.findHolderName(input, documentTypeName);
    const issuingAuthority = this.findIssuingAuthority(input, documentTypeName);
    const tags = this.detectTags(text, documentTypeName, dueDate);
    const penalties: number[] = [];
    const reviewReasons = new Set<ReviewReason>(input.parsed.reviewReasons);
    const extracted = {
      correspondent: Boolean(correspondentName),
      issueDate: Boolean(issueDate),
      dueDate: Boolean(dueDate),
      amount: Boolean(amount?.value),
      currency: Boolean(amount?.currency),
      referenceNumber: Boolean(referenceNumber),
      expiryDate: Boolean(expiryDate),
      holderName: Boolean(holderName),
      issuingAuthority: Boolean(issuingAuthority),
    };
    const reviewEvidence = this.documentTypePolicyService.buildReviewEvidence(policy, extracted);

    if (text.trim().length < 80) {
      penalties.push(0.12);
    }

    if (input.parsed.pages.length === 0) {
      penalties.push(0.2);
    }

    if (reviewEvidence.missingFields.length > 0) {
      reviewReasons.add("missing_key_fields");
      penalties.push(0.18);
    }

    const normalizedConfidence = computeConfidence({
      base: 0.3,
      boosts: [
        correspondentName ? 0.15 : 0,
        issueDate ? 0.1 : 0,
        dueDate ? 0.08 : 0,
        expiryDate ? 0.05 : 0,
        amount ? 0.15 : 0,
        referenceNumber ? 0.05 : 0,
        holderName ? 0.05 : 0,
        issuingAuthority ? 0.05 : 0,
        documentTypeName ? 0.1 : 0,
      ],
      penalties,
    });

    return {
      title: input.title,
      summary: null,
      language: input.parsed.language,
      issueDate,
      dueDate,
      expiryDate,
      amount: amount?.value ?? null,
      currency: amount?.currency ?? null,
      referenceNumber,
      holderName,
      issuingAuthority,
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
          ...reviewEvidence,
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
          !/invoice|rechnung|date|datum|due|fällig|zahlbar|amount|betrag|statement|reference|referenz/i.test(
            line,
          ),
      ) ?? null
    );
  }

  private detectDocumentType(text: string, title: string): string | null {
    const sample = `${title}\n${text}`.toLowerCase();
    const matchers: Array<{ name: string; pattern: RegExp }> = [
      { name: "Giftcard", pattern: /gutschein|gift\s*card|giftcard|voucher|geschenkkarte/ },
      { name: "Manual", pattern: /\bmanual\b|quick start guide|setup instructions|benutzerhandbuch/ },
      { name: "Utility Bill", pattern: /utility|wasser|electricity|strom|gas|trinkwasser|verbrauch|abrechnung/ },
      { name: "Payslip", pattern: /payslip|pay\s*slip|gehaltsabrechnung|lohnabrechnung/ },
      { name: "Receipt", pattern: /receipt|quittung|kassenbon|\bbon\b/ },
      { name: "Statement", pattern: /statement|kontoauszug|account\s+statement/ },
      { name: "Insurance", pattern: /versicherung|insurance/ },
      { name: "Tax Document", pattern: /steuer|tax/ },
      { name: "Warranty", pattern: /warranty|garantie/ },
      { name: "Certificate", pattern: /certificate|zertifikat|bescheinigung|urkunde/ },
      { name: "Medical", pattern: /medical|arzt|krankenhaus|befund|rezept/ },
      { name: "ID", pattern: /personalausweis|identity card|passport|reisepass|führerschein|fuhrerschein|driver'?s license/ },
      { name: "Ticket", pattern: /ticket|boarding pass|fahrkarte|eintrittskarte/ },
      { name: "Travel", pattern: /reise|travel|itinerary/ },
      { name: "Delivery Note", pattern: /lieferschein|delivery note/ },
      {
        name: "Order",
        pattern: /order confirmation|purchase order|\bbestellung\b|bestellbestätigung|bestellbestaetigung/,
      },
      { name: "Contract", pattern: /vertrag|contract/ },
      { name: "Notice", pattern: /notice|mitteilung|bekanntmachung/ },
      { name: "Form", pattern: /formular|form|antrag/ },
      { name: "Legal", pattern: /gericht|court|legal|anwalt|klage/ },
      { name: "Report", pattern: /report|bericht/ },
      { name: "Invoice", pattern: /invoice|rechnung/ },
    ];

    const match = matchers.find((candidate) => candidate.pattern.test(sample));
    if (match) {
      return match.name;
    }

    return sample.trim() ? "Letter" : null;
  }

  private detectTags(text: string, documentTypeName: string | null, dueDate: Date | null) {
    const tags = new Set<string>();

    if (documentTypeName) {
      tags.add(documentTypeName.toLowerCase());
    }

    if (/invoice|rechnung|receipt|statement/i.test(text)) tags.add("finance");
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
      if (/betrag|gesamt|summe|total|amount due|zu zahlen/i.test(field.key)) {
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
    const amountPattern = "\\d{1,3}(?:[.,]\\d{3})*(?:[.,]\\d{2})?";
    const patterns = [
      new RegExp(
        `(?:betrag|gesamt(?:betrag)?|summe|total(?: due)?|amount due|zu zahlen)\\s*[:\\-]?\\s*(?:(€|eur|\\$|usd)\\s*)?(${amountPattern})(?:\\s*(€|eur|\\$|usd))?`,
        "i",
      ),
      new RegExp(`(${amountPattern})\\s*(€|eur|\\$|usd)`, "i"),
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) {
        continue;
      }

      const rawCurrency =
        [match[1], match[2], match[3]].find((candidate) => this.isCurrencyToken(candidate)) ??
        null;
      const rawAmount =
        [match[1], match[2], match[3]].find(
          (candidate) => normalizeAmountValue(candidate) !== null,
        ) ??
        null;
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
      /invoice number|invoice no\.?|reference|referenz|kundennummer|rechnungsnummer|vertragsnummer|policy number|document no\.?|ausweisnummer/i.test(
        field.key,
      ),
    );

    if (structuredField?.value) {
      return structuredField.value.trim();
    }

    const match = input.parsed.text.match(
      /(?:invoice number|invoice no\.?|reference|referenz|kundennummer|rechnungsnummer|vertragsnummer|policy number|document no\.?|ausweisnummer)\s*[:#-]?\s*([A-Z0-9\-\/]+)/i,
    );

    return match?.[1] ?? null;
  }

  private findHolderName(
    input: MetadataExtractionInput,
    documentTypeName: string | null,
  ): string | null {
    const keyValues = input.parsed.keyValues;
    const surname = keyValues.find((field) => /surname|nachname|last name/i.test(field.key))?.value;
    const givenName = keyValues.find((field) => /given name|vorname|first name/i.test(field.key))
      ?.value;
    if (surname && givenName) {
      return `${givenName} ${surname}`.trim();
    }

    const structuredField = keyValues.find((field) =>
      documentTypeName === "ID"
        ? /holder|cardholder|name|inhaber|full name|vollständiger name/i.test(field.key)
        : /holder|cardholder|inhaber/i.test(field.key),
    );
    if (structuredField?.value) {
      return structuredField.value.trim();
    }

    if (documentTypeName !== "ID") {
      return null;
    }

    const match = input.parsed.text.match(
      /(?:holder|name|cardholder|inhaber)\s*[:\-]?\s*([A-ZÄÖÜ][A-ZÄÖÜa-zäöüß' -]{2,80})/i,
    );
    return match?.[1]?.trim() ?? null;
  }

  private findIssuingAuthority(
    input: MetadataExtractionInput,
    documentTypeName: string | null,
  ): string | null {
    const structuredField = input.parsed.keyValues.find((field) =>
      documentTypeName === "ID"
        ? /issuing authority|issued by|authority|ausstellende behörde|ausstellende behorde|behörde|behoerde/i.test(
            field.key,
          )
        : /issuing authority|issued by|ausstellende behörde|ausstellende behorde/i.test(
            field.key,
          ),
    );

    if (structuredField?.value) {
      return structuredField.value.trim();
    }

    if (documentTypeName !== "ID") {
      return null;
    }

    const match = input.parsed.text.match(
      /(?:issuing authority|issued by|authority|ausstellende behörde|ausstellende behorde)\s*[:\-]?\s*([A-ZÄÖÜ][A-ZÄÖÜa-zäöüß' -]{2,80})/i,
    );
    return match?.[1]?.trim() ?? null;
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
      new RegExp(
        `(?:${escaped.join("|")})\\s*[:\\-]?\\s*([0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}|[A-Za-z]+\\s+[0-9]{1,2},\\s+[0-9]{4})`,
        "i",
      ),
    );

    return match ? parseDateOnly(match[1]) : null;
  }

  private findFirstDate(text: string): Date | null {
    const match = text.match(/[0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}/);
    return match ? parseDateOnly(match[0]) : null;
  }

  private isCurrencyToken(value: string | null | undefined): boolean {
    if (!value?.trim()) {
      return false;
    }

    return /^(€|\$|£|eur|usd|gbp|chf)$/i.test(value.trim());
  }

  private inferExpiryDateFromDuration(text: string): Date | null {
    const durationMatch = text.match(
      /(\d{1,2})\s*(?:jahre|jahre?n|years?)\s+(?:gültig|gueltig|valid)/i,
    );
    const monthYearMatch = text.match(/\b(0?[1-9]|1[0-2])[./-](20\d{2})\b/);

    if (!durationMatch || !monthYearMatch) {
      return null;
    }

    const years = Number(durationMatch[1]);
    const month = Number(monthYearMatch[1]);
    const year = Number(monthYearMatch[2]);

    if (!Number.isFinite(years) || !Number.isFinite(month) || !Number.isFinite(year)) {
      return null;
    }

    const expiryYear = year + years;
    return new Date(Date.UTC(expiryYear, month, 0));
  }
}
