import { getDocumentTypeDefinition } from "../document-intelligence.registry";
import type { TypeSpecificExtractor } from "./types";

const definition = getDocumentTypeDefinition("legal_document");

export const legalDocumentExtractor: TypeSpecificExtractor = {
  documentType: "legal_document",
  promptFocus:
    "Extract sender, case or file reference, issue date, legal deadline or hearing date, and any payable amount when explicitly stated.",
  extractFields: (input, helpers) => ({
    issueDate: helpers.findDateByLabels(input, definition.issueDateLabels ?? []),
    dueDate: helpers.findDateByLabels(input, definition.dueDateLabels ?? []),
    amount: helpers.findAmount(input),
    currency: helpers.findCurrency(input),
    referenceNumber: helpers.findReferenceNumber(input, definition.referenceNumberLabels ?? []),
    correspondentName: helpers.findCorrespondentCandidate(input),
  }),
};
