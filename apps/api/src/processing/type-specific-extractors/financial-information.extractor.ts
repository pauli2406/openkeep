import { getDocumentTypeDefinition } from "../document-intelligence.registry";
import type { TypeSpecificExtractor } from "./types";

const definition = getDocumentTypeDefinition("financial_information");

export const financialInformationExtractor: TypeSpecificExtractor = {
  documentType: "financial_information",
  promptFocus:
    "Extract institution, issue date, and any visible customer, account, or document reference. Only extract an amount when the notice clearly centers on a single important amount.",
  extractFields: (input, helpers) => ({
    issueDate: helpers.findDateByLabels(input, definition.issueDateLabels ?? []),
    amount: helpers.findAmount(input),
    currency: helpers.findCurrency(input),
    referenceNumber: helpers.findReferenceNumber(input, definition.referenceNumberLabels ?? []),
    correspondentName: helpers.findCorrespondentCandidate(input),
  }),
};
