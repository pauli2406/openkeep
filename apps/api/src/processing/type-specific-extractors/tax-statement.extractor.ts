import { getDocumentTypeDefinition } from "../document-intelligence.registry";
import type { TypeSpecificExtractor } from "./types";

const definition = getDocumentTypeDefinition("tax_statement");

export const taxStatementExtractor: TypeSpecificExtractor = {
  documentType: "tax_statement",
  promptFocus:
    "Extract institution, statement date, account or depot reference, and tax amount. Prefer withheld tax, capital gains tax, or annual tax certificate totals over unrelated balances.",
  extractFields: (input, helpers) => ({
    issueDate: helpers.findDateByLabels(input, definition.issueDateLabels ?? []),
    amount: helpers.findAmount(input),
    currency: helpers.findCurrency(input),
    referenceNumber: helpers.findReferenceNumber(input, definition.referenceNumberLabels ?? []),
    correspondentName: helpers.findCorrespondentCandidate(input),
  }),
  refineFields: (input, fields) => {
    const taxAmount = readTaxAmount(input.parsed.text);
    if (!taxAmount) {
      return fields;
    }

    return {
      ...fields,
      amount: taxAmount.amount,
      currency: taxAmount.currency,
    };
  },
};

function readTaxAmount(text: string): { amount: number; currency: string } | null {
  const normalized = text.replace(/\u00a0/g, " ");
  const patterns = [
    /(?:withholding tax|capital gains tax|kapitalertragsteuer|einbehaltene steuer|steuerbetrag)[:\s]*?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:,\d{2})?)\s*(EUR|€|USD|CHF)/i,
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
