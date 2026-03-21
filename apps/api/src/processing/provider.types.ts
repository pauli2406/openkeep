import type {
  BoundingBox,
  QueueDocumentProcessingPayload,
  ReviewReason,
} from "@openkeep/types";

export interface OcrLine {
  lineIndex: number;
  text: string;
  boundingBox: BoundingBox;
}

export interface OcrPage {
  pageNumber: number;
  width: number | null;
  height: number | null;
  lines: OcrLine[];
}

export interface OcrInput {
  filePath: string;
  mimeType: string;
  filename: string;
}

export interface OcrResult {
  text: string;
  language: string | null;
  pages: OcrPage[];
  searchablePdfPath?: string;
  reviewReasons: ReviewReason[];
  normalizationStrategy: string;
  temporaryPaths?: string[];
}

export interface MetadataExtractionInput {
  documentId: string;
  title: string;
  mimeType: string;
  ocr: OcrResult;
}

export interface MetadataExtractionResult {
  language: string | null;
  issueDate: Date | null;
  dueDate: Date | null;
  amount: number | null;
  currency: string | null;
  referenceNumber: string | null;
  correspondentName: string | null;
  documentTypeName: string | null;
  tags: string[];
  confidence: number;
  reviewReasons: ReviewReason[];
  metadata: Record<string, unknown>;
}

export interface OcrProvider {
  extract(input: OcrInput): Promise<OcrResult>;
}

export interface MetadataExtractor {
  extract(input: MetadataExtractionInput): Promise<MetadataExtractionResult>;
}

export interface EmbeddingProvider {
  embedChunks(chunks: string[]): Promise<Array<{ chunk: string; embedding: number[] }>>;
}

export interface AnswerProvider {
  answer(question: string, payload: QueueDocumentProcessingPayload): Promise<string>;
}
