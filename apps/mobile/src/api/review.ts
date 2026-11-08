/**
 * The review queue: its endpoints, and the rules the screen walks it by. Pure
 * where it can be, so the arithmetic is testable without mounting a screen.
 */
import { responseToMessage, type ArchiveDocument, type ReviewQueueResponse } from "../lib";

export type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>;

export const REVIEW_PAGE_SIZE = 100;

/** The thresholds the bulk action offers, as the web client does. */
export const BULK_THRESHOLDS = [60, 70, 80, 90] as const;
export const DEFAULT_BULK_THRESHOLD = 80;

// ---------------------------------------------------------------------------
// Reading the queue
// ---------------------------------------------------------------------------

/**
 * Follows `total` and collects every page: the screen walks the whole queue with
 * no pagination control, so anything past the first page would be unreachable.
 * A first page that fails is an error; a later one keeps what has arrived.
 */
export async function collectAllPages(
  fetchPage: (page: number, pageSize: number) => Promise<ReviewQueueResponse>,
  pageSize = REVIEW_PAGE_SIZE,
): Promise<ReviewQueueResponse> {
  const first = await fetchPage(1, pageSize);
  const items = [...first.items];
  const pages = Math.ceil((first.total ?? items.length) / pageSize);
  for (let page = 2; page <= pages; page += 1) {
    try {
      const next = await fetchPage(page, pageSize);
      items.push(...next.items);
    } catch {
      break;
    }
  }
  return { ...first, items };
}

export function fetchReviewQueue(authFetch: AuthFetch, errorMessage: string) {
  return collectAllPages(async (page, pageSize) => {
    const response = await authFetch(`/api/documents/review?page=${page}&pageSize=${pageSize}`);
    if (!response.ok) {
      throw new Error(errorMessage);
    }
    return (await response.json()) as ReviewQueueResponse;
  });
}

/** How often each reason occurs, in the order the queue first mentions it. */
export function countReasons(items: ArchiveDocument[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const reason of item.reviewReasons ?? []) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return counts;
}

export function filterByReason(items: ArchiveDocument[], reason: string | "all") {
  return reason === "all"
    ? items
    : items.filter((item) => (item.reviewReasons as string[] | undefined)?.includes(reason));
}

/**
 * Where to go from a document that is leaving the walk: the next one, or the one
 * before it at the end of the queue. `null` when it was the only one.
 */
export function neighbourOf(queue: ArchiveDocument[], id: string): ArchiveDocument | null {
  const index = queue.findIndex((item) => item.id === id);
  return queue[index + 1] ?? queue[index - 1] ?? null;
}

/** Confirmed documents leave the queue, so "3 of 12" has to remember them. */
export function queuePosition(queueLength: number, selectedIndex: number, filedCount: number) {
  const total = queueLength + filedCount;
  const position = filedCount + selectedIndex + 1;
  return { position, total, ratio: total > 0 ? position / total : 0 };
}

/** Below 50% the score itself is the warning. */
export function confidenceTone(percent: number): "bad" | "warn" | "ok" {
  if (percent < 50) {
    return "bad";
  }
  return percent < 80 ? "warn" : "ok";
}

/** Whole days since the oldest document in the queue arrived. */
export function oldestDays(items: ArchiveDocument[], now = Date.now()) {
  return items.reduce((oldest, item) => {
    const created = new Date(item.createdAt).getTime();
    if (Number.isNaN(created)) {
      return oldest;
    }
    return Math.max(oldest, Math.round((now - created) / 86_400_000));
  }, 0);
}

// ---------------------------------------------------------------------------
// The fields to confirm
// ---------------------------------------------------------------------------

export type ReviewFieldKey =
  | "correspondentId"
  | "documentTypeId"
  | "issueDate"
  | "dueDate"
  | "amount"
  | "referenceNumber"
  | "expiryDate"
  | "holderName"
  | "issuingAuthority";

export type ReviewFieldKind = "select" | "date" | "amount" | "text";

/** The six the web client always asks about. */
const CORE_FIELDS: ReviewFieldKey[] = [
  "correspondentId",
  "documentTypeId",
  "issueDate",
  "dueDate",
  "amount",
  "referenceNumber",
];

/** Only asked about when the backend judged this document against them. */
const EVIDENCE_FIELDS: ReviewFieldKey[] = ["expiryDate", "holderName", "issuingAuthority"];

export function fieldKind(key: ReviewFieldKey): ReviewFieldKind {
  switch (key) {
    case "correspondentId":
    case "documentTypeId":
      return "select";
    case "issueDate":
    case "dueDate":
    case "expiryDate":
      return "date";
    case "amount":
      return "amount";
    default:
      return "text";
  }
}

/**
 * A passport's expiry date is what makes it reviewable, so a field the document
 * was judged against stays on the form even though it is not one of the six.
 */
export function fieldsToConfirm(document: ArchiveDocument): ReviewFieldKey[] {
  const evidence = document.metadata?.reviewEvidence;
  const named = new Set<string>([
    ...(evidence?.requiredFields ?? []),
    ...(evidence?.missingFields ?? []),
  ]);
  return [...CORE_FIELDS, ...EVIDENCE_FIELDS.filter((key) => named.has(key))];
}

export type ReviewForm = Record<ReviewFieldKey, string>;

/** Empty is "no value", for the selects too. */
export function seedForm(document: ArchiveDocument): ReviewForm {
  return {
    correspondentId: document.correspondent?.id ?? "",
    documentTypeId: document.documentType?.id ?? "",
    issueDate: document.issueDate ?? "",
    dueDate: document.dueDate ?? "",
    amount: document.amount === null || document.amount === undefined ? "" : String(document.amount),
    referenceNumber: document.referenceNumber ?? "",
    expiryDate: document.expiryDate ?? "",
    holderName: document.holderName ?? "",
    issuingAuthority: document.issuingAuthority ?? "",
  };
}

/**
 * Amber when the value is missing or its extraction confidence is low. Per field
 * only: the document-level score is not a substitute, and a field without an entry
 * counts as fine.
 */
export function fieldAttention(
  document: ArchiveDocument,
  key: ReviewFieldKey,
  value: string,
): "missing" | "low" | null {
  if (!value.trim()) {
    return "missing";
  }
  const confidences = document.metadata?.intelligence?.extraction?.fieldConfidence;
  // The extractor reports `correspondentName`; older records say `correspondent`.
  const base = key.replace(/Id$/, "");
  const confidence = confidences?.[base] ?? confidences?.[`${base}Name`];
  return typeof confidence === "number" && confidence < 0.7 ? "low" : null;
}

/**
 * A phone offers `,` on a German keyboard and `.` on an English one, and neither
 * is an error. The last separator is the decimal one when both appear; a lone
 * comma is always decimal. Returns `null` for what is not a number.
 */
export function parseAmountInput(value: string): number | null {
  const trimmed = value.trim().replace(/\s/g, "");
  if (!/^-?[\d.,]*\d[\d.,]*$/.test(trimmed)) {
    return null;
  }
  const lastComma = trimmed.lastIndexOf(",");
  const lastDot = trimmed.lastIndexOf(".");
  const decimal = Math.max(lastComma, lastDot);
  const separators = (trimmed.match(/[.,]/g) ?? []).length;
  let normalized: string;
  if (lastComma !== -1 && lastDot !== -1) {
    normalized = `${trimmed.slice(0, decimal).replace(/[.,]/g, "")}.${trimmed.slice(decimal + 1)}`;
  } else if (separators > 1) {
    // `1.234.567` is grouping, however it is punctuated.
    normalized = trimmed.replace(/[.,]/g, "");
  } else {
    normalized = trimmed.replace(",", ".");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `YYYY-MM-DD`, or the day-first form a German invoice prints, so copying a value
 * off the page works. Returns the ISO form, or `null` for a date that does not
 * exist: the API would accept the string and store nonsense.
 */
export function parseDateInput(value: string): string | null {
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  const dayFirst = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(trimmed);
  let year: number;
  let month: number;
  let day: number;
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (dayFirst) {
    year = Number(dayFirst[3]);
    year = dayFirst[3].length === 2 ? 2000 + year : year;
    [month, day] = [Number(dayFirst[2]), Number(dayFirst[1])];
  } else {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

export type ReviewPatchResult =
  | { ok: true; body: Record<string, unknown>; changed: boolean }
  | { ok: false; invalid: ReviewFieldKey[] };

/**
 * The PATCH body for a confirmed form: only what actually changed, because the API
 * records every field it is sent as a manual override that later reprocessing must
 * not touch. Sending the whole form would lock values nobody looked at.
 */
export function buildReviewPatch(document: ArchiveDocument, form: ReviewForm): ReviewPatchResult {
  const body: Record<string, unknown> = {};
  const invalid: ReviewFieldKey[] = [];
  const seed = seedForm(document);

  for (const key of Object.keys(form) as ReviewFieldKey[]) {
    const value = form[key].trim();
    if (value === seed[key]) {
      continue;
    }
    switch (fieldKind(key)) {
      case "date": {
        const parsed = value ? parseDateInput(value) : null;
        if (value && !parsed) {
          invalid.push(key);
        } else if (parsed !== (document[key as "issueDate"] ?? null)) {
          body[key] = parsed;
        }
        break;
      }
      case "amount": {
        const parsed = value ? parseAmountInput(value) : null;
        if (value && parsed === null) {
          invalid.push(key);
        } else if (parsed !== (document.amount ?? null)) {
          body[key] = parsed;
        }
        break;
      }
      default:
        body[key] = value || null;
    }
  }

  return invalid.length > 0
    ? { ok: false, invalid }
    : { ok: true, body, changed: Object.keys(body).length > 0 };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

async function post(authFetch: AuthFetch, path: string, body: unknown) {
  const response = await authFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await responseToMessage(response));
  }
}

export function resolveReview(authFetch: AuthFetch, documentId: string) {
  return post(authFetch, `/api/documents/${documentId}/review/resolve`, {});
}

/**
 * The web client's "Reprocess": clears the review state and queues a forced
 * processing job, so the document leaves this queue until the worker has been
 * through it again.
 */
export function requeueReview(authFetch: AuthFetch, documentId: string) {
  return post(authFetch, `/api/documents/${documentId}/review/requeue`, { force: true });
}

export async function patchDocument(
  authFetch: AuthFetch,
  documentId: string,
  body: Record<string, unknown>,
) {
  const response = await authFetch(`/api/documents/${documentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await responseToMessage(response));
  }
}
