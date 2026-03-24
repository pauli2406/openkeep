import type { SupportedDocumentType } from "../document-intelligence.registry";
import { bankStatementExtractor } from "./bank-statement.extractor";
import { contractExtractor } from "./contract.extractor";
import { financialInformationExtractor } from "./financial-information.extractor";
import { genericLetterExtractor } from "./generic-letter.extractor";
import { giftcardExtractor } from "./giftcard.extractor";
import { insuranceDocumentExtractor } from "./insurance-document.extractor";
import { invoiceExtractor } from "./invoice.extractor";
import { legalDocumentExtractor } from "./legal-document.extractor";
import { payslipExtractor } from "./payslip.extractor";
import { portfolioStatementExtractor } from "./portfolio-statement.extractor";
import { receiptExtractor } from "./receipt.extractor";
import { taxDocumentExtractor } from "./tax-document.extractor";
import { taxStatementExtractor } from "./tax-statement.extractor";
import { tradeConfirmationExtractor } from "./trade-confirmation.extractor";
import { utilityBillExtractor } from "./utility-bill.extractor";
import type { TypeSpecificExtractor } from "./types";

const EXTRACTORS: TypeSpecificExtractor[] = [
  invoiceExtractor,
  receiptExtractor,
  contractExtractor,
  giftcardExtractor,
  legalDocumentExtractor,
  taxDocumentExtractor,
  taxStatementExtractor,
  utilityBillExtractor,
  bankStatementExtractor,
  portfolioStatementExtractor,
  tradeConfirmationExtractor,
  financialInformationExtractor,
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
