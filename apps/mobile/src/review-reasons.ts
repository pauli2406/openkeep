/**
 * Review reasons, in words (#111).
 *
 * `reviewReasons` arrives as backend enum values and used to be rendered with
 * `reason.replace(/_/g, " ")`, which put "low confidence" and "ocr empty" in
 * front of the user in both locales. TODO.md tracked that as a defect.
 *
 * The labels and the one-line explanations are the web client's, word for word.
 */
import type { ReviewReason } from "./lib";
import type { TranslationKey, useI18n } from "./i18n";

type Translate = ReturnType<typeof useI18n>["t"];

const REASON_COPY: Record<string, { label: TranslationKey; why: TranslationKey }> = {
  low_confidence: {
    label: "review.reasonLabel.low_confidence",
    why: "review.why.low_confidence",
  },
  processing_failed: {
    label: "review.reasonLabel.processing_failed",
    why: "review.why.processing_failed",
  },
  ocr_empty: {
    label: "review.reasonLabel.ocr_empty",
    why: "review.why.ocr_empty",
  },
  // Not in the mobile `ReviewReason` union yet, but the API sends it.
  ocr_low_confidence: {
    label: "review.reasonLabel.ocr_low_confidence",
    why: "review.why.ocr_low_confidence",
  },
  missing_key_fields: {
    label: "review.reasonLabel.missing_key_fields",
    why: "review.why.missing_key_fields",
  },
  unsupported_format: {
    label: "review.reasonLabel.unsupported_format",
    why: "review.why.unsupported_format",
  },
  classification_ambiguous: {
    label: "review.reasonLabel.classification_ambiguous",
    why: "review.why.classification_ambiguous",
  },
  correspondent_unresolved: {
    label: "review.reasonLabel.correspondent_unresolved",
    why: "review.why.correspondent_unresolved",
  },
  validation_failed: {
    label: "review.reasonLabel.validation_failed",
    why: "review.why.validation_failed",
  },
};

export function reviewReasonLabel(reason: ReviewReason | string, t: Translate) {
  const copy = REASON_COPY[reason];
  return copy ? t(copy.label) : String(reason).replace(/_/g, " ");
}

/** Why a document with this reason needs a person; `null` for an unknown reason. */
export function reviewReasonWhy(reason: ReviewReason | string, t: Translate) {
  const copy = REASON_COPY[reason];
  return copy ? t(copy.why) : null;
}

/**
 * Reasons a confidence score actually speaks to. The others describe a concrete
 * defect — OCR produced nothing, a required field is absent, the format is
 * unsupported, processing or validation failed — and a document can carry one of
 * those while still scoring high overall. Bulk-confirming on confidence alone
 * would mark those resolved without anyone looking. Same list as the web client.
 */
const CONFIDENCE_ONLY_REASONS = new Set<string>([
  "low_confidence",
  "ocr_low_confidence",
  "classification_ambiguous",
  "correspondent_unresolved",
]);

export function isConfidenceOnlyReason(reason: string) {
  return CONFIDENCE_ONLY_REASONS.has(reason);
}

/**
 * May this document be confirmed in bulk? At or above the threshold (a percentage),
 * with at least one reason, and every reason one the score speaks to. A document
 * with no recorded confidence counts as zero.
 */
export function isBulkEligible(
  item: { confidence: number | null; reviewReasons?: string[] | null },
  threshold: number,
) {
  if ((item.confidence ?? 0) * 100 < threshold) {
    return false;
  }
  const reasons = item.reviewReasons ?? [];
  return reasons.length > 0 && reasons.every(isConfidenceOnlyReason);
}
