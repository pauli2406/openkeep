import type {
  DocumentChunk,
  ParsedDocument,
  QueueDocumentProcessingPayload,
  ReviewReason,
} from "@openkeep/types";

export interface DocumentParseInput {
  filePath: string;
  mimeType: string;
  filename: string;
  sizeBytes?: number;
}

export interface ChunkingInput {
  documentId: string;
  parsed: ParsedDocument;
}

export interface MetadataExtractionInput {
  documentId: string;
  title: string;
  mimeType: string;
  parsed: ParsedDocument;
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

export interface DocumentParseProvider {
  readonly provider: ParsedDocument["provider"];
  parse(input: DocumentParseInput): Promise<ParsedDocument>;
}

export interface MetadataExtractor {
  extract(input: MetadataExtractionInput): Promise<MetadataExtractionResult>;
}

export interface Chunker {
  chunk(input: ChunkingInput): Promise<Array<Omit<DocumentChunk, "id" | "createdAt">>>;
}

export interface EmbeddingProvider {
  embedChunks(chunks: string[]): Promise<Array<{ chunk: string; embedding: number[] }>>;
}

export interface AnswerProvider {
  answer(question: string, payload: QueueDocumentProcessingPayload): Promise<string>;
}
