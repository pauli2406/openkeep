import { getDocumentTypeDefinition } from "../document-intelligence.registry";
import type { TypeSpecificExtractor } from "./types";

const definition = getDocumentTypeDefinition("insurance_document");

export const insuranceDocumentExtractor: TypeSpecificExtractor = {
  documentType: "insurance_document",
  promptFocus:
    "Extract insurer identity, issue date, due date, policy reference, expiration, and the current monthly or yearly premium only when the document explicitly states an active premium. Do not treat yearly totals, tax certificates, employer subsidy certificates, or aggregate payments as the current premium.",
  extractFields: (input, helpers) => ({
    issueDate: helpers.findDateByLabels(input, definition.issueDateLabels ?? []),
    dueDate: helpers.findDateByLabels(input, definition.dueDateLabels ?? []),
    expiryDate: helpers.findDateByLabels(input, definition.expiryDateLabels ?? []),
    amount: helpers.findAmount(input),
    currency: helpers.findCurrency(input),
    referenceNumber: helpers.findReferenceNumber(input, definition.referenceNumberLabels ?? []),
    correspondentName: helpers.findCorrespondentCandidate(input),
  }),
  refineFields: (input, fields) => {
    const text = input.parsed.text;
    const premium = readInsurancePremiumFromText(text);
    const containsOnlyTotals = containsInsuranceTotalsWithoutActivePremium(text);

    if (premium) {
      return {
        ...fields,
        amount: premium.amount,
        currency: premium.currency,
        premiumAmount: premium.amount,
        premiumCurrency: premium.currency,
        premiumPeriod: premium.period,
      };
    }

    if (containsOnlyTotals) {
      return {
        ...fields,
        amount: null,
        currency: null,
      };
    }

    return fields;
  },
};

function readInsurancePremiumFromText(
  text: string,
): { amount: number; currency: string; period: "monthly" | "yearly" } | null {
  const normalized = text.replace(/\u00a0/g, " ");

  const explicitPatterns: Array<{ regex: RegExp; period: "monthly" | "yearly" }> = [
    {
      regex:
        /(?:gesamtmonatsbeitrag|monatsbeitrag(?:\s+f(?:ü|ue)r\s+den\s+gesamten\s+vertrag)?|ihr neuer beitrag ab [^\n]*|neuer beitrag ab [^\n]*).*?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:,\d{2})?)\s*(EUR|€)/i,
      period: "monthly",
    },
    {
      regex:
        /(?:monatliche(?:n)?\s+beitr(?:a|ä)ge|monatlicher\s+beitrag|h(?:ö|oe)he der monatlichen beitr(?:a|ä)ge).*?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:,\d{2})?)\s*(EUR|€)/i,
      period: "monthly",
    },
    {
      regex:
        /(?:jahresbeitrag|gesamtjahresbeitrag|j(?:ä|ae)hrlicher\s+beitrag|yearly premium|annual premium).*?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:,\d{2})?)\s*(EUR|€)/i,
      period: "yearly",
    },
  ];

  for (const pattern of explicitPatterns) {
    const match = normalized.match(pattern.regex);
    if (match?.[1]) {
      return {
        amount: parseEuroAmount(match[1]),
        currency: normalizeCurrency(match[2]),
        period: pattern.period,
      };
    }
  }

  const lineBasedMonthly = normalized.match(
    /(?:gesamtmonatsbeitrag\s+ab\s+\d{2}\.\d{2}\.\d{2,4}|monatsbeitrag\s+f(?:ü|ue)r\s+den\s+gesamten\s+vertrag\s+ab\s+\d{2}\.\d{2}\.\d{2,4})[^\n]*?((?:\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:,\d{2})?))(?:\s*(EUR|€))?/i,
  );
  if (lineBasedMonthly?.[1]) {
    return {
      amount: parseEuroAmount(lineBasedMonthly[1]),
      currency: normalizeCurrency(lineBasedMonthly[2] ?? "EUR"),
      period: "monthly",
    };
  }

  return null;
}

function containsInsuranceTotalsWithoutActivePremium(text: string): boolean {
  const normalized = text.toLowerCase();
  const hasTotalSignals = /(gesamtbeitrag in\s+20\d{2}|arbeitgeberzuschuss|vorsorgebeitrag|steuer|elstam)/i.test(normalized);
  const hasActivePremiumSignals = /(gesamtmonatsbeitrag|monatsbeitrag f(?:ü|ue)r den gesamten vertrag|ihr neuer beitrag ab|neuer beitrag ab)/i.test(
    normalized,
  );
  return hasTotalSignals && !hasActivePremiumSignals;
}

function parseEuroAmount(value: string): number {
  return Number(value.replace(/\./g, "").replace(",", "."));
}

function normalizeCurrency(value: string): string {
  return value.trim() === "€" ? "EUR" : value.trim().toUpperCase();
}
