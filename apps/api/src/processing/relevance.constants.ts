import type { AppLanguage } from "@openkeep/types";

/**
 * Central relevance thresholds for RAG answering. Cosine-similarity distributions
 * differ per embedding provider/model, so the answer threshold is env-overridable
 * (ANSWER_MIN_CHUNK_SCORE) — these are the defaults and the fixed companions.
 */
export const DEFAULT_ANSWER_MIN_CHUNK_SCORE = 0.4;

/**
 * When nothing passes the threshold but the best chunk is within this margin below
 * it, answer from the top few chunks and mark the answer as low confidence instead
 * of refusing outright.
 */
export const LOW_CONFIDENCE_MARGIN = 0.1;
export const LOW_CONFIDENCE_TOP_N = 3;

/** Minimum score for a chunk to be surfaced as a citation. */
export const CITATION_MIN_SCORE = 0.4;

/**
 * Per-document Q&A: when the whole document fits this budget (precedent: the
 * summary path truncates at 12k chars), retrieval is skipped and the model sees
 * ALL chunks with page labels — a retrieval miss cannot hide the answer in a
 * short letter/invoice. Larger documents keep vector top-k retrieval.
 */
export const DOCUMENT_QA_FULL_TEXT_MAX_CHARS = 12_000;

/**
 * Per-chunk serialization overhead in the prompt: the `[Excerpt n, Page x,
 * Section: …]` label plus the `\n\n---\n\n` separator. Many short chunks (or long
 * headings) would otherwise pass a raw text-length check while the assembled
 * prompt is far larger.
 */
export const DOCUMENT_QA_CHUNK_OVERHEAD_CHARS = 80;
/** Hard cap on chunk count for full-text mode, independent of total length. */
export const DOCUMENT_QA_FULL_TEXT_MAX_CHUNKS = 60;

export const shouldUseFullDocumentContext = (
  totalChars: number,
  chunkCount: number,
  headingChars = 0,
): boolean => {
  if (chunkCount === 0 || chunkCount > DOCUMENT_QA_FULL_TEXT_MAX_CHUNKS) {
    return false;
  }

  const serializedChars =
    totalChars + headingChars + chunkCount * DOCUMENT_QA_CHUNK_OVERHEAD_CHARS;
  return serializedChars <= DOCUMENT_QA_FULL_TEXT_MAX_CHARS;
};

/** Number of prior Q&A pairs replayed into the per-document chat prompt. */
export const DOCUMENT_QA_HISTORY_TURNS = 4;

export const buildInsufficientEvidenceMessage = (
  language?: AppLanguage | null,
): string =>
  language === "de"
    ? "Ich konnte in deinen Dokumenten keine ausreichenden Belege finden, um diese Frage zu beantworten."
    : "I couldn't find sufficient evidence in your documents to answer this question.";
