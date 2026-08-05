/**
 * Review reasons, in words (#111).
 *
 * `reviewReasons` arrives as backend enum values and used to be rendered with
 * `reason.replace(/_/g, " ")`, which put "low confidence" and "ocr empty" in
 * front of the user in both locales. TODO.md tracked that as a defect.
 */
import type { ReviewReason } from "./lib";
import type { useI18n } from "./i18n";

const REASON_KEYS: Record<ReviewReason, string> = {
  low_confidence: "review.reason.low_confidence",
  processing_failed: "review.reason.processing_failed",
  ocr_empty: "review.reason.ocr_empty",
  missing_key_fields: "review.reason.missing_key_fields",
  unsupported_format: "review.reason.unsupported_format",
  classification_ambiguous: "review.reason.classification_ambiguous",
  correspondent_unresolved: "review.reason.correspondent_unresolved",
  validation_failed: "review.reason.validation_failed",
};

export function reviewReasonLabel(
  reason: ReviewReason | string,
  t: ReturnType<typeof useI18n>["t"],
) {
  const key = REASON_KEYS[reason as ReviewReason];
  return key ? t(key as never) : String(reason).replace(/_/g, " ");
}
