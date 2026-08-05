/**
 * Pieces the four document-detail tabs share (#114).
 *
 * The screen used to be one 69 KB file. It is now a route plus four tab
 * modules, and this is the only thing between them.
 */
import type { useI18n } from "../../i18n";
import type { ArchiveDocument } from "../../lib";

export type Translate = ReturnType<typeof useI18n>["t"];

export type TabKey = "document" | "details" | "questions" | "history";

export type MetadataForm = {
  title: string;
  issueDate: string;
  dueDate: string;
  expiryDate: string;
  amount: string;
  currency: string;
  referenceNumber: string;
  holderName: string;
  issuingAuthority: string;
  correspondentId: string;
  documentTypeId: string;
  tagIds: string[];
};

export function formToState(document: ArchiveDocument): MetadataForm {
  return {
    title: document.title ?? "",
    issueDate: document.issueDate ?? "",
    dueDate: document.dueDate ?? "",
    expiryDate: document.expiryDate ?? "",
    amount: document.amount?.toString() ?? "",
    currency: document.currency ?? "",
    referenceNumber: document.referenceNumber ?? "",
    holderName: document.holderName ?? "",
    issuingAuthority: document.issuingAuthority ?? "",
    correspondentId: document.correspondent?.id ?? "",
    documentTypeId: document.documentType?.id ?? "",
    tagIds: document.tags.map((tag) => tag.id),
  };
}

export function isSameForm(left: MetadataForm, right: MetadataForm) {
  return (
    left.title === right.title &&
    left.issueDate === right.issueDate &&
    left.dueDate === right.dueDate &&
    left.expiryDate === right.expiryDate &&
    left.amount === right.amount &&
    left.currency === right.currency &&
    left.referenceNumber === right.referenceNumber &&
    left.holderName === right.holderName &&
    left.issuingAuthority === right.issuingAuthority &&
    left.correspondentId === right.correspondentId &&
    left.documentTypeId === right.documentTypeId &&
    left.tagIds.length === right.tagIds.length &&
    left.tagIds.every((id, index) => id === right.tagIds[index])
  );
}

export function formatDocumentStatus(t: Translate, status: string) {
  switch (status) {
    case "pending":
      return t("documentDetail.status.pending");
    case "processing":
      return t("documentDetail.status.processing");
    case "ready":
      return t("documentDetail.status.ready");
    case "failed":
      return t("documentDetail.status.failed");
    default:
      return status;
  }
}

export function formatReviewStatus(t: Translate, status: string) {
  switch (status) {
    case "pending":
      return t("documentDetail.reviewStatus.pending");
    case "resolved":
      return t("documentDetail.reviewStatus.resolved");
    default:
      return status;
  }
}

export function formatEventType(eventType: string) {
  return eventType.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Anything below this counts as uncertain and earns a badge on its row. */
export const CONFIDENCE_THRESHOLD = 0.8;

/**
 * Per-field confidence, when the pipeline recorded it.
 * `metadata.intelligence.extraction.fieldConfidence` is keyed by field name;
 * the document-level `confidence` is not a substitute, so a field without an
 * entry simply gets no badge.
 */
export function fieldConfidence(document: ArchiveDocument, field: string): number | null {
  const recorded = document.metadata?.intelligence?.extraction?.fieldConfidence?.[field];
  return typeof recorded === "number" ? recorded : null;
}

export function isOverdue(document: ArchiveDocument) {
  if (!document.dueDate) {
    return false;
  }
  const due = new Date(document.dueDate);
  if (Number.isNaN(due.getTime())) {
    return false;
  }
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return due.getTime() < startOfToday.getTime();
}
