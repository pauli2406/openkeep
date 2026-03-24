import type {
  AnswerCitation,
  AnswerQueryResponse,
  DocumentChunk,
  EmbeddingProvider as EmbeddingProviderId,
  ParsedDocument,
  QueueDocumentEmbeddingPayload,
  ReviewReason,
  SemanticSearchResult,
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

export interface ChunkRecordInput {
  heading: string | null;
  text: string;
  pageFrom: number | null;
  pageTo: number | null;
  strategyVersion: string;
  metadata: Record<string, unknown>;
}

export interface MetadataExtractionInput {
  documentId: string;
  title: string;
  mimeType: string;
  parsed: ParsedDocument;
}

export interface MetadataExtractionResult {
  title: string | null;
  summary: string | null;
  language: string | null;
  issueDate: Date | null;
  dueDate: Date | null;
  expiryDate: Date | null;
  amount: number | null;
  currency: string | null;
  referenceNumber: string | null;
  holderName: string | null;
  issuingAuthority: string | null;
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

export interface EmbeddingRequest {
  texts: string[];
  inputType: "document" | "query";
}

export interface EmbeddingResponse {
  provider: EmbeddingProviderId;
  model: string;
  dimensions: number;
  embeddings: number[][];
}

export interface EmbeddingProvider {
  readonly provider: EmbeddingProviderId;
  isConfigured(): boolean;
  getModel(): string | null;
  embed(input: EmbeddingRequest): Promise<EmbeddingResponse>;
}

export interface AnswerProvider {
  answer(input: {
    question: string;
    results: SemanticSearchResult[];
    maxCitations: number;
  }): Promise<{
    status: AnswerQueryResponse["status"];
    answer: string | null;
    reasoning: string | null;
    citations: AnswerCitation[];
  }>;
}

export interface EmbeddingJobInput extends QueueDocumentEmbeddingPayload {}
