import { getDocumentTypeDefinition } from "../document-intelligence.registry";
import type { TypeSpecificExtractor } from "./types";

const definition = getDocumentTypeDefinition("contract");

export const contractExtractor: TypeSpecificExtractor = {
  documentType: "contract",
  promptFocus: "Extract counterparties, contract date, contract reference, and expiration or term end when present.",
  extractFields: (input, helpers) => ({
    issueDate: helpers.findDateByLabels(input, definition.issueDateLabels ?? []),
    expiryDate: helpers.findDateByLabels(input, definition.expiryDateLabels ?? []),
    referenceNumber: helpers.findReferenceNumber(input, definition.referenceNumberLabels ?? []),
    correspondentName: helpers.findCorrespondentCandidate(input),
  }),
};
