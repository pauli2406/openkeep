/**
 * Pieces the inspector tabs share (#114): the edit form and what it means for the
 * server, and the small formatters the panels have in common. All of it is plain
 * data, so the rules are tested without mounting a screen.
 */
import type { DocumentPatch, QaCitation } from "../../api/document";
import type { useI18n } from "../../i18n";
import { parseArchiveDate, type ArchiveDocument, type ManualOverrideField } from "../../lib";

export type Translate = ReturnType<typeof useI18n>["t"];

/** The web's inspector tabs, in the web's order. */
export type TabKey = "fields" | "intelligence" | "qa" | "text" | "history";

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

/** What the two amount spellings mean: a number, nothing, or not a number at all. */
export function parseAmount(value: string): number | null | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  // The decimal keypad types a comma in a German locale. `Number("84,50")` is NaN,
  // which JSON turns into null, which would have cleared the amount on save.
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : "invalid";
}

function sameIds(left: string[], right: string[]) {
  return [...left].sort().join(",") === [...right].sort().join(",");
}

export type EditableField = ManualOverrideField | "title";

/** Every field whose form value differs from the document. */
export function dirtyFields(document: ArchiveDocument, form: MetadataForm): EditableField[] {
  const dirty: EditableField[] = [];
  const text = (field: EditableField, server: string | null | undefined, value: string) => {
    if ((server ?? "") !== value.trim()) {
      dirty.push(field);
    }
  };
  if ((document.title ?? "") !== form.title.trim()) {
    dirty.push("title");
  }
  text("issueDate", document.issueDate, form.issueDate);
  text("dueDate", document.dueDate, form.dueDate);
  text("expiryDate", document.expiryDate, form.expiryDate);
  if (parseAmount(form.amount) !== (document.amount ?? null)) {
    dirty.push("amount");
  }
  text("currency", document.currency, form.currency);
  text("referenceNumber", document.referenceNumber, form.referenceNumber);
  text("holderName", document.holderName, form.holderName);
  text("issuingAuthority", document.issuingAuthority, form.issuingAuthority);
  if ((document.correspondent?.id ?? "") !== form.correspondentId) {
    dirty.push("correspondentId");
  }
  if ((document.documentType?.id ?? "") !== form.documentTypeId) {
    dirty.push("documentTypeId");
  }
  if (!sameIds(document.tags.map((tag) => tag.id), form.tagIds)) {
    dirty.push("tagIds");
  }
  return dirty;
}

/**
 * Only what changed. The server pins every field it receives against the next
 * reprocess, so sending the whole form would have locked all of them.
 */
export function buildDocumentPatch(document: ArchiveDocument, form: MetadataForm): DocumentPatch {
  const patch: DocumentPatch = {};
  for (const field of dirtyFields(document, form)) {
    switch (field) {
      case "title":
        if (form.title.trim()) patch.title = form.title.trim();
        break;
      case "amount": {
        const amount = parseAmount(form.amount);
        if (amount !== "invalid") patch.amount = amount;
        break;
      }
      case "correspondentId":
        patch.correspondentId = form.correspondentId || null;
        break;
      case "documentTypeId":
        patch.documentTypeId = form.documentTypeId || null;
        break;
      case "tagIds":
        patch.tagIds = form.tagIds;
        break;
      default:
        patch[field] = form[field].trim() || null;
    }
  }
  return patch;
}

function isCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export type FormProblem = "title" | "date" | "amount";

/** What stops a save, before the server has to say so. */
export function validateForm(form: MetadataForm): FormProblem | null {
  if (!form.title.trim()) {
    return "title";
  }
  for (const value of [form.issueDate, form.dueDate, form.expiryDate]) {
    if (value.trim() && !isCalendarDate(value.trim())) {
      return "date";
    }
  }
  return parseAmount(form.amount) === "invalid" ? "amount" : null;
}

/**
 * A polled document changes underneath the form. Take the server's value only for
 * a field the user has not touched, so a poll never wipes an edit mid-type.
 * Returns `current` itself when nothing was adopted.
 */
export function mergeServerForm(
  previous: MetadataForm,
  current: MetadataForm,
  server: MetadataForm,
): MetadataForm {
  let next = current;
  for (const key of Object.keys(server) as Array<keyof MetadataForm>) {
    if (key === "tagIds") {
      if (!sameIds(previous.tagIds, server.tagIds) && sameIds(previous.tagIds, current.tagIds)) {
        next = { ...next, tagIds: server.tagIds };
      }
      continue;
    }
    if (previous[key] !== server[key] && previous[key] === current[key]) {
      next = { ...next, [key]: server[key] };
    }
  }
  return next;
}

/** How sure the pipeline is, keyed the way the rows are. */
export function fieldConfidenceMap(
  document: ArchiveDocument,
): Record<string, number | null | undefined> {
  const intelligence = document.metadata?.intelligence;
  const extracted = intelligence?.extraction?.fieldConfidence ?? {};
  return {
    ...extracted,
    title: intelligence?.title?.confidence,
    correspondentId: intelligence?.correspondentResolution?.confidence ?? extracted.correspondentName,
    documentTypeId: intelligence?.routing?.confidence ?? extracted.documentTypeName,
    tagIds: intelligence?.tagging?.confidence,
  };
}

const PARSE_PROVIDER_LABELS: Record<string, string> = {
  "local-ocr": "Local OCR",
  "google-document-ai-enterprise-ocr": "Google Doc AI Enterprise",
  "google-document-ai-gemini-layout-parser": "Google Doc AI Gemini",
  "amazon-textract": "Amazon Textract",
  "azure-ai-document-intelligence": "Azure Document Intelligence",
  "mistral-ocr": "Mistral OCR",
};

export function parseProviderLabel(id: string | null | undefined) {
  if (!id) {
    return "—";
  }
  return PARSE_PROVIDER_LABELS[id] ?? id;
}

const EMBEDDING_PROVIDER_LABELS: Record<string, string> = {
  "local-embeddings": "Local (bge-m3)",
  openai: "OpenAI",
  "gemini-embeddings": "Gemini",
  voyage: "Voyage",
  "mistral-embeddings": "Mistral",
};

export function embeddingLabel(document: ArchiveDocument) {
  const provider = document.embeddingProvider
    ? (EMBEDDING_PROVIDER_LABELS[document.embeddingProvider] ?? document.embeddingProvider)
    : null;
  return [document.embeddingStatus, provider, document.embeddingModel]
    .filter(Boolean)
    .join(" · ");
}

export function formatAgentFieldLabel(field: string) {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatAgentFieldValue(value: unknown) {
  if (value == null) return "-";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(", ");
  return JSON.stringify(value);
}

export function formatDuration(durationMs: number) {
  return durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(2)} s`;
}

/** `19 Mar 2026, 16:02`: a date and time on one line. */
export function formatTimestamp(value: string | null | undefined) {
  const date = parseArchiveDate(value);
  if (!date) {
    return value ?? "-";
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Turns an answer's `[n]` markers into links the markdown can report a tap on.
 * Only a marker with a citation behind it becomes one; `[7]` in an answer with
 * three excerpts stays text rather than a link to nothing.
 */
export function linkQaCitations(answer: string, citations: QaCitation[]) {
  const known = new Set(citations.map((citation, position) => citation.index ?? position + 1));
  return answer.replace(/\[(\d+)\](?!\()/g, (marker, digits: string) =>
    known.has(Number(digits)) ? `[\\[${digits}\\]](citation:${digits})` : marker,
  );
}

/** The citation a `citation:<n>` link points at. */
export function citationForLink(url: string, citations: QaCitation[]) {
  const match = /^citation:(\d+)$/.exec(url);
  if (!match) {
    return null;
  }
  const number = Number(match[1]);
  return (
    citations.find((citation, position) => (citation.index ?? position + 1) === number) ?? null
  );
}

export function formatEventType(eventType: string) {
  return eventType.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** `low_confidence` as a badge: "Low Confidence". */
export function formatReasonCode(reason: string) {
  return reason
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function isOverdue(document: ArchiveDocument) {
  if (!document.dueDate) {
    return false;
  }
  // `dueDate` is date-only, so it has to be read as a calendar date — parsed as
  // UTC midnight, a document due today is already overdue west of Greenwich.
  const due = parseArchiveDate(document.dueDate);
  if (!due) {
    return false;
  }
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return due.getTime() < startOfToday.getTime();
}
