import type { ReviewEvidenceField } from "@openkeep/types";

export type SupportedDocumentType =
  | "invoice"
  | "receipt"
  | "contract"
  | "giftcard"
  | "legal_document"
  | "tax_document"
  | "tax_statement"
  | "utility_bill"
  | "bank_statement"
  | "portfolio_statement"
  | "trade_confirmation"
  | "financial_information"
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
  giftcard: {
    canonicalName: "Giftcard",
    aliases: ["giftcard", "gift card", "voucher", "gutschein", "geschenkkarte"],
    summary: "Gift card or voucher with stored value or balance.",
    requiredFields: ["correspondent", "amount", "currency"],
    relevantFields: ["correspondentName", "issueDate", "expiryDate", "amount", "currency", "referenceNumber"],
    issueDateLabels: ["issue date", "purchase date", "kaufdatum", "datum"],
    expiryDateLabels: ["valid until", "gültig bis", "gueltig bis", "expires", "expiry"],
    referenceNumberLabels: ["card number", "gift card number", "voucher code", "gutscheincode", "reference"],
  },
  legal_document: {
    canonicalName: "Legal",
    aliases: ["legal", "court", "lawyer", "anwalt", "gericht", "aktenzeichen"],
    summary: "Legal correspondence, filing, or court-related notice.",
    requiredFields: ["correspondent", "issueDate", "referenceNumber"],
    relevantFields: ["correspondentName", "issueDate", "dueDate", "referenceNumber", "amount", "currency"],
    issueDateLabels: ["date", "datum", "dated", "issue date"],
    dueDateLabels: ["deadline", "frist", "response due", "hearing date", "termin"],
    referenceNumberLabels: ["reference", "referenz", "aktenzeichen", "case number", "file number"],
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
  tax_statement: {
    canonicalName: "Tax Statement",
    aliases: ["tax statement", "steuerbescheinigung", "jahressteuerbescheinigung", "withholding tax"],
    summary: "Financial tax certificate or annual tax statement.",
    requiredFields: ["correspondent", "issueDate", "amount", "currency", "referenceNumber"],
    relevantFields: ["correspondentName", "issueDate", "amount", "currency", "referenceNumber"],
    issueDateLabels: ["date", "datum", "statement date", "bescheinigungsdatum"],
    referenceNumberLabels: ["account number", "depot number", "depotnummer", "steuer-id", "reference"],
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
  portfolio_statement: {
    canonicalName: "Portfolio Statement",
    aliases: ["portfolio statement", "depotauszug", "depotuebersicht", "depotübersicht", "portfolio valuation"],
    summary: "Portfolio or depot statement with total holdings value.",
    requiredFields: ["correspondent", "issueDate", "amount", "currency", "referenceNumber"],
    relevantFields: ["correspondentName", "issueDate", "amount", "currency", "referenceNumber"],
    issueDateLabels: ["statement date", "report date", "valuation date", "datum"],
    referenceNumberLabels: ["depot number", "depotnummer", "account number", "iban", "reference"],
  },
  trade_confirmation: {
    canonicalName: "Trade Confirmation",
    aliases: ["trade confirmation", "wertpapierabrechnung", "kaufabrechnung", "verkaufsabrechnung", "transaction statement"],
    summary: "Buy or sell transaction confirmation for securities.",
    requiredFields: ["correspondent", "issueDate", "amount", "currency", "referenceNumber"],
    relevantFields: ["correspondentName", "issueDate", "dueDate", "amount", "currency", "referenceNumber"],
    issueDateLabels: ["trade date", "transaction date", "order date", "datum"],
    dueDateLabels: ["settlement date", "valuta", "settlement"],
    referenceNumberLabels: ["order number", "transaction id", "abrechnungsnummer", "reference"],
  },
  financial_information: {
    canonicalName: "Financial Information",
    aliases: ["financial information", "investor information", "market update", "fondsinformation"],
    summary: "Financial institution notice or informational update.",
    requiredFields: ["correspondent", "issueDate"],
    relevantFields: ["correspondentName", "issueDate", "referenceNumber", "amount", "currency"],
    issueDateLabels: ["date", "datum", "report date", "issue date"],
    referenceNumberLabels: ["reference", "referenz", "account number", "depot number"],
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
  { type: "giftcard", patterns: [/gutschein/i, /gift\s*card/i, /giftcard/i, /voucher/i, /geschenkkarte/i] },
  { type: "legal_document", patterns: [/gericht/i, /court/i, /legal/i, /anwalt/i, /klage/i, /aktenzeichen/i] },
  {
    type: "portfolio_statement",
    patterns: [/portfolio statement/i, /depotauszug/i, /depotwert/i, /portfolio valuation/i, /depotübersicht/i, /depotuebersicht/i],
  },
  {
    type: "trade_confirmation",
    patterns: [/trade confirmation/i, /wertpapierabrechnung/i, /kaufabrechnung/i, /verkaufsabrechnung/i, /transaction statement/i],
  },
  {
    type: "tax_statement",
    patterns: [/steuerbescheinigung/i, /jahressteuerbescheinigung/i, /tax statement/i, /withholding tax/i, /capital gains tax/i],
  },
  {
    type: "financial_information",
    patterns: [/financial information/i, /investor information/i, /market update/i, /fondsinformation/i],
  },
  { type: "tax_document", patterns: [/steuerbescheid/i, /finanzamt/i, /tax office/i] },
  { type: "utility_bill", patterns: [/utility/i, /strom/i, /wasser/i, /gas/i, /verbrauch/i] },
  { type: "bank_statement", patterns: [/kontoauszug/i, /bank statement/i, /account statement/i, /credit card statement/i] },
  { type: "payslip", patterns: [/payslip/i, /gehaltsabrechnung/i, /lohnabrechnung/i] },
  { type: "insurance_document", patterns: [/insurance/i, /versicherung/i, /policy/i] },
];

export function getDocumentTypeDefinition(documentType: SupportedDocumentType): DocumentTypeDefinition {
  return DOCUMENT_TYPE_DEFINITIONS[documentType];
}

export function getRelevantFieldNames(documentType: SupportedDocumentType): string[] {
  return DOCUMENT_TYPE_DEFINITIONS[documentType].relevantFields;
}
