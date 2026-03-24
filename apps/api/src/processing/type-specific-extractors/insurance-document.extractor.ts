import { getDocumentTypeDefinition } from "../document-intelligence.registry";
import type { TypeSpecificExtractor } from "./types";

const definition = getDocumentTypeDefinition("insurance_document");

export const insuranceDocumentExtractor: TypeSpecificExtractor = {
  documentType: "insurance_document",
  promptFocus: "Extract insurer identity, issue date, due date, policy reference, expiration, and premium amount if available.",
  extractFields: (input, helpers) => ({
    issueDate: helpers.findDateByLabels(input, definition.issueDateLabels ?? []),
    dueDate: helpers.findDateByLabels(input, definition.dueDateLabels ?? []),
    expiryDate: helpers.findDateByLabels(input, definition.expiryDateLabels ?? []),
    amount: helpers.findAmount(input),
    currency: helpers.findCurrency(input),
    referenceNumber: helpers.findReferenceNumber(input, definition.referenceNumberLabels ?? []),
    correspondentName: helpers.findCorrespondentCandidate(input),
  }),
};
