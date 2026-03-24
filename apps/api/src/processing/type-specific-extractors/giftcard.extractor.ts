import { getDocumentTypeDefinition } from "../document-intelligence.registry";
import type { TypeSpecificExtractor } from "./types";

const definition = getDocumentTypeDefinition("giftcard");

export const giftcardExtractor: TypeSpecificExtractor = {
  documentType: "giftcard",
  promptFocus:
    "Extract issuer, card or voucher reference, current value or balance, currency, and expiry date. Prefer available balance over original face value when both appear.",
  extractFields: (input, helpers) => ({
    issueDate: helpers.findDateByLabels(input, definition.issueDateLabels ?? []),
    expiryDate: helpers.findDateByLabels(input, definition.expiryDateLabels ?? []),
    amount: helpers.findAmount(input),
    currency: helpers.findCurrency(input),
    referenceNumber: helpers.findReferenceNumber(input, definition.referenceNumberLabels ?? []),
    correspondentName: helpers.findCorrespondentCandidate(input),
  }),
  refineFields: (input, fields) => {
    const value = readGiftcardValue(input.parsed.text);
    if (!value) {
      return fields;
    }

    return {
      ...fields,
      amount: value.amount,
      currency: value.currency,
      giftcardValueType: value.kind,
    };
  },
};

function readGiftcardValue(text: string): { amount: number; currency: string; kind: "balance" | "face_value" } | null {
  const normalized = text.replace(/\u00a0/g, " ");
  const patterns: Array<{ regex: RegExp; kind: "balance" | "face_value" }> = [
    {
      regex: /(?:available balance|current balance|restguthaben|guthaben)[:\s]*?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:,\d{2})?)\s*(EUR|€)/i,
      kind: "balance",
    },
    {
      regex: /(?:value|card value|wert|gutscheinwert|gift card value)[:\s]*?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:,\d{2})?)\s*(EUR|€)/i,
      kind: "face_value",
    },
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern.regex);
    if (match?.[1]) {
      return {
        amount: Number(match[1].replace(/\./g, "").replace(",", ".")),
        currency: match[2] === "€" ? "EUR" : match[2].trim().toUpperCase(),
        kind: pattern.kind,
      };
    }
  }

  return null;
}
