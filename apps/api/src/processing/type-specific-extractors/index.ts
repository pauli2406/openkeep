import type { SupportedDocumentType } from "../document-intelligence.registry";
import { bankStatementExtractor } from "./bank-statement.extractor";
import { contractExtractor } from "./contract.extractor";
import { genericLetterExtractor } from "./generic-letter.extractor";
import { insuranceDocumentExtractor } from "./insurance-document.extractor";
import { invoiceExtractor } from "./invoice.extractor";
import { payslipExtractor } from "./payslip.extractor";
import { receiptExtractor } from "./receipt.extractor";
import { taxDocumentExtractor } from "./tax-document.extractor";
import { utilityBillExtractor } from "./utility-bill.extractor";
import type { TypeSpecificExtractor } from "./types";

const EXTRACTORS: TypeSpecificExtractor[] = [
  invoiceExtractor,
  receiptExtractor,
  contractExtractor,
  taxDocumentExtractor,
  utilityBillExtractor,
  bankStatementExtractor,
  payslipExtractor,
  insuranceDocumentExtractor,
  genericLetterExtractor,
];

export const TYPE_SPECIFIC_EXTRACTORS: Record<SupportedDocumentType, TypeSpecificExtractor> =
  Object.fromEntries(EXTRACTORS.map((extractor) => [extractor.documentType, extractor])) as Record<
    SupportedDocumentType,
    TypeSpecificExtractor
  >;

export function getTypeSpecificExtractor(documentType: SupportedDocumentType): TypeSpecificExtractor {
  return TYPE_SPECIFIC_EXTRACTORS[documentType];
}

export type { DeterministicExtractionHelpers, TypeSpecificExtractor } from "./types";
