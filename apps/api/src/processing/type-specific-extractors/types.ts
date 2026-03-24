import type { MetadataExtractionInput } from "../provider.types";
import type { SupportedDocumentType } from "../document-intelligence.registry";

export interface DeterministicExtractionHelpers {
  findDateByLabels: (input: MetadataExtractionInput, labels: string[]) => string | null;
  findAmount: (input: MetadataExtractionInput) => string | null;
  findCurrency: (input: MetadataExtractionInput) => string | null;
  findReferenceNumber: (input: MetadataExtractionInput, labels: string[]) => string | null;
  findValueByLabels: (input: MetadataExtractionInput, labels: string[]) => string | null;
  findCorrespondentCandidate: (input: MetadataExtractionInput) => string | null;
}

export interface TypeSpecificExtractor {
  documentType: SupportedDocumentType;
  promptFocus: string;
  extractFields: (
    input: MetadataExtractionInput,
    helpers: DeterministicExtractionHelpers,
  ) => Record<string, unknown>;
}
