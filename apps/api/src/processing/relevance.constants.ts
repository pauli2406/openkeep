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

export const buildInsufficientEvidenceMessage = (
  language?: AppLanguage | null,
): string =>
  language === "de"
    ? "Ich konnte in deinen Dokumenten keine ausreichenden Belege finden, um diese Frage zu beantworten."
    : "I couldn't find sufficient evidence in your documents to answer this question.";
