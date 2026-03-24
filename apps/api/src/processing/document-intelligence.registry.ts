import type { ReviewEvidenceField } from "@openkeep/types";

export type SupportedDocumentType =
  | "invoice"
  | "receipt"
  | "contract"
  | "tax_document"
  | "utility_bill"
  | "bank_statement"
  | "payslip"
  | "insurance_document"
  | "generic_letter";

export interface DocumentTypeDefinition {
  canonicalName: string;
  aliases: string[];
  summary: string;
  requiredFields: ReviewEvidenceField[];
  relevantFields: string[];
  issueDateLabels?: string[];
  dueDateLabels?: string[];
  expiryDateLabels?: string[];
  referenceNumberLabels?: string[];
  holderNameLabels?: string[];
  issuingAuthorityLabels?: string[];
}

export const DOCUMENT_TYPE_DEFINITIONS: Record<SupportedDocumentType, DocumentTypeDefinition> = {
  invoice: {
    canonicalName: "Invoice",
    aliases: ["invoice", "rechnung", "bill"],
    summary: "Supplier invoice with payment details.",
    requiredFields: [
      "correspondent",
      "issueDate",
      "dueDate",
      "amount",
      "currency",
      "referenceNumber",
    ],
    relevantFields: ["correspondentName", "issueDate", "dueDate", "amount", "currency", "referenceNumber"],
    issueDateLabels: ["invoice date", "rechnungsdatum", "issue date", "issued on", "datum"],
    dueDateLabels: ["due date", "payment due", "zahlbar bis", "fällig", "faellig", "due on"],
    referenceNumberLabels: ["invoice number", "invoice no", "rechnungsnummer", "reference", "referenz"],
  },
  receipt: {
    canonicalName: "Receipt",
    aliases: ["receipt", "quittung", "kassenbon", "bon"],
    summary: "Point-of-sale receipt or proof of purchase.",
    requiredFields: ["correspondent", "issueDate", "amount", "currency"],
    relevantFields: ["correspondentName", "issueDate", "amount", "currency", "referenceNumber"],
    issueDateLabels: ["date", "datum", "purchase date", "issued on"],
    referenceNumberLabels: ["receipt number", "transaction id", "reference", "ref"],
  },
  contract: {
    canonicalName: "Contract",
    aliases: ["contract", "vertrag", "agreement"],
    summary: "Agreement with parties, date, and reference identifiers.",
    requiredFields: ["correspondent", "issueDate", "referenceNumber"],
    relevantFields: ["correspondentName", "issueDate", "referenceNumber", "expiryDate"],
    issueDateLabels: ["contract date", "effective date", "datum", "dated"],
    expiryDateLabels: ["expiry date", "end date", "valid until", "laufzeit bis"],
    referenceNumberLabels: ["contract number", "vertragsnummer", "reference", "agreement no"],
  },
  tax_document: {
    canonicalName: "Tax Document",
    aliases: ["tax", "steuer", "steuerbescheid", "tax document"],
    summary: "Tax office document, notice, or declaration.",
    requiredFields: ["correspondent", "issueDate", "dueDate", "referenceNumber"],
    relevantFields: ["correspondentName", "issueDate", "dueDate", "referenceNumber", "amount", "currency"],
    issueDateLabels: ["datum", "date", "issued on", "bescheiddatum"],
    dueDateLabels: ["due date", "payment due", "fällig", "zahlbar bis"],
    referenceNumberLabels: ["steuer nummer", "tax id", "aktenzeichen", "reference"],
  },
  utility_bill: {
    canonicalName: "Utility Bill",
    aliases: ["utility", "strom", "wasser", "gas", "abrechnung"],
    summary: "Utility provider statement with usage and billing information.",
    requiredFields: [
      "correspondent",
      "issueDate",
      "dueDate",
      "amount",
      "currency",
      "referenceNumber",
    ],
    relevantFields: ["correspondentName", "issueDate", "dueDate", "amount", "currency", "referenceNumber"],
    issueDateLabels: ["invoice date", "datum", "billing date", "issue date"],
    dueDateLabels: ["due date", "zahlbar bis", "fällig", "payment due"],
    referenceNumberLabels: ["customer number", "kundennummer", "reference", "account number"],
  },
  bank_statement: {
    canonicalName: "Statement",
    aliases: ["statement", "kontoauszug", "bank statement", "account statement"],
    summary: "Bank or card account statement.",
    requiredFields: ["correspondent", "issueDate", "amount", "currency", "referenceNumber"],
    relevantFields: ["correspondentName", "issueDate", "amount", "currency", "referenceNumber"],
    issueDateLabels: ["statement date", "date", "period"],
    referenceNumberLabels: ["account number", "iban", "statement number", "reference"],
  },
  payslip: {
    canonicalName: "Payslip",
    aliases: ["payslip", "gehaltsabrechnung", "lohnabrechnung"],
    summary: "Payroll statement with salary and deductions.",
    requiredFields: ["correspondent", "issueDate", "amount", "currency"],
    relevantFields: ["correspondentName", "issueDate", "amount", "currency", "referenceNumber"],
    issueDateLabels: ["pay date", "abrechnungsdatum", "date", "period"],
    referenceNumberLabels: ["employee id", "personnel number", "reference"],
  },
  insurance_document: {
    canonicalName: "Insurance",
    aliases: ["insurance", "versicherung", "policy"],
    summary: "Insurance-related letter, policy, or statement.",
    requiredFields: ["correspondent", "issueDate", "dueDate", "referenceNumber"],
    relevantFields: ["correspondentName", "issueDate", "dueDate", "referenceNumber", "expiryDate", "amount", "currency"],
    issueDateLabels: ["issue date", "datum", "policy date", "issued on"],
    dueDateLabels: ["due date", "payment due", "fällig", "zahlbar bis"],
    expiryDateLabels: ["expiry date", "expiration date", "valid until", "ablaufdatum"],
    referenceNumberLabels: ["policy number", "vertragsnummer", "reference", "document no"],
  },
  generic_letter: {
    canonicalName: "Letter",
    aliases: ["letter", "brief", "notice", "generic"],
    summary: "Generic correspondence or notification.",
    requiredFields: ["correspondent", "issueDate"],
    relevantFields: ["correspondentName", "issueDate", "referenceNumber"],
    issueDateLabels: ["date", "datum", "dated"],
    referenceNumberLabels: ["reference", "referenz", "subject number"],
  },
};

export const TYPE_KEYWORDS: Array<{ type: SupportedDocumentType; patterns: RegExp[] }> = [
  { type: "invoice", patterns: [/invoice/i, /rechnung/i] },
  { type: "receipt", patterns: [/receipt/i, /quittung/i, /kassenbon/i, /\bbon\b/i] },
  { type: "contract", patterns: [/contract/i, /vertrag/i, /agreement/i] },
  { type: "tax_document", patterns: [/steuer/i, /tax/i, /finanzamt/i] },
  { type: "utility_bill", patterns: [/utility/i, /strom/i, /wasser/i, /gas/i, /verbrauch/i] },
  { type: "bank_statement", patterns: [/kontoauszug/i, /bank statement/i, /account statement/i] },
  { type: "payslip", patterns: [/payslip/i, /gehaltsabrechnung/i, /lohnabrechnung/i] },
  { type: "insurance_document", patterns: [/insurance/i, /versicherung/i, /policy/i] },
];

export function getDocumentTypeDefinition(documentType: SupportedDocumentType): DocumentTypeDefinition {
  return DOCUMENT_TYPE_DEFINITIONS[documentType];
}

export function getRelevantFieldNames(documentType: SupportedDocumentType): string[] {
  return DOCUMENT_TYPE_DEFINITIONS[documentType].relevantFields;
}
