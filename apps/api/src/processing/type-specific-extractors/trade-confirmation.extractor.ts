import { getDocumentTypeDefinition } from "../document-intelligence.registry";
import type { TypeSpecificExtractor } from "./types";

const definition = getDocumentTypeDefinition("trade_confirmation");

export const tradeConfirmationExtractor: TypeSpecificExtractor = {
  documentType: "trade_confirmation",
  promptFocus:
    "Extract broker, trade date, settlement date, order or transaction reference, and net transaction amount. Prefer final total or net settlement amount over unit price.",
  extractFields: (input, helpers) => ({
    issueDate: helpers.findDateByLabels(input, definition.issueDateLabels ?? []),
    dueDate: helpers.findDateByLabels(input, definition.dueDateLabels ?? []),
    amount: helpers.findAmount(input),
    currency: helpers.findCurrency(input),
    referenceNumber: helpers.findReferenceNumber(input, definition.referenceNumberLabels ?? []),
    correspondentName: helpers.findCorrespondentCandidate(input),
  }),
  refineFields: (input, fields) => {
    const netAmount = readTradeAmount(input.parsed.text);
    if (!netAmount) {
      return fields;
    }

    return {
      ...fields,
      amount: netAmount.amount,
      currency: netAmount.currency,
    };
  },
};

function readTradeAmount(text: string): { amount: number; currency: string } | null {
  const normalized = text.replace(/\u00a0/g, " ");
  const patterns = [
    /(?:net amount|net settlement|endbetrag|gesamtbetrag|zu lasten|zu gunsten)[:\s]*?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:,\d{2})?)\s*(EUR|€|USD|CHF)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1] && match[2]) {
      return {
        amount: Number(match[1].replace(/\./g, "").replace(",", ".")),
        currency: match[2] === "€" ? "EUR" : match[2].trim().toUpperCase(),
      };
    }
  }

  return null;
}
