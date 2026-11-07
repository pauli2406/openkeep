/**
 * Saved conversations: the same shape the web client keeps in localStorage under
 * `openkeep.chat-conversations`, plus a few optional fields a phone needs (a
 * structured row opens its document here). Everything in this file is pure; the
 * storage lives in `useConversations`.
 */
import {
  formatCurrency,
  titleForDocument,
  type AnswerCitation,
  type AnswerHistoryTurn,
  type AnswerQueryResponse,
  type ArchiveDocument,
} from "../../lib";

export const CONVERSATIONS_KEY = "openkeep.chat-conversations";
export const MAX_CONVERSATIONS = 20;

export type StructuredRow = {
  title: string;
  date: string | null;
  amount: string | null;
  documentId?: string | null;
  overdue?: boolean;
};

export type Turn = {
  question: string;
  answer: string;
  citations: AnswerCitation[];
  structuredRows: StructuredRow[] | null;
  structuredTitle: string | null;
  /** The total the structured result reports: an amount, or how many items. */
  structuredTotal?: string | null;
  lowConfidence?: boolean;
  /** The server refused for lack of evidence, in words of its own. */
  insufficient?: boolean;
  /**
   * Set when `answer` was not written by the model: a failure's message, or the
   * note standing in for an empty answer. Such a turn is shown but never replayed
   * as something the assistant said.
   */
  source?: "error" | "note";
};

export type Conversation = { id: string; title: string; at: number; turns: Turn[] };

/** `t()` has no interpolation; these strings carry `{name}` style slots. */
export function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (slot, key: string) =>
    key in values ? String(values[key]) : slot,
  );
}

function isTurn(value: unknown): value is Turn {
  const turn = value as Turn | null;
  return (
    typeof turn === "object" &&
    turn !== null &&
    typeof turn.question === "string" &&
    typeof turn.answer === "string" &&
    Array.isArray(turn.citations)
  );
}

/** A damaged entry is dropped rather than left to crash the thread that renders it. */
export function parseConversations(raw: string | null): Conversation[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry): entry is Conversation => {
        const conversation = entry as Conversation | null;
        return (
          typeof conversation === "object" &&
          conversation !== null &&
          typeof conversation.id === "string" &&
          typeof conversation.title === "string" &&
          typeof conversation.at === "number" &&
          Array.isArray(conversation.turns) &&
          conversation.turns.every(isTurn)
        );
      })
      .slice(0, MAX_CONVERSATIONS);
  } catch {
    return [];
  }
}

/**
 * Appends to the conversation the question belongs to, or starts one. `target`
 * is where the question was asked, not what is selected now: switching
 * conversations mid-stream must not move the answer.
 */
export function foldTurn(
  conversations: Conversation[],
  target: string | null,
  turn: Turn,
  { now, newId }: { now: number; newId: string },
): { conversations: Conversation[]; createdId: string | null } {
  if (target && conversations.some((entry) => entry.id === target)) {
    return {
      createdId: null,
      conversations: conversations.map((entry) =>
        entry.id === target ? { ...entry, at: now, turns: [...entry.turns, turn] } : entry,
      ),
    };
  }
  return {
    createdId: newId,
    conversations: [
      { id: newId, title: turn.question, at: now, turns: [turn] },
      ...conversations,
    ].slice(0, MAX_CONVERSATIONS),
  };
}

/** The thread as the server wants it, so follow-up questions resolve there. */
export function historyFromTurns(turns: Turn[]): AnswerHistoryTurn[] {
  return turns
    .filter((turn) => !turn.source)
    .flatMap((turn) => [
      { role: "user" as const, content: turn.question },
      { role: "assistant" as const, content: turn.answer },
    ])
    .filter((turn) => turn.content.trim().length > 0);
}

type StructuredData = NonNullable<AnswerQueryResponse["structuredData"]>;

export function structuredRowsFrom(structured: StructuredData): StructuredRow[] {
  if (structured.kind === "deadline_items") {
    return structured.items.slice(0, 8).map((item) => ({
      title: item.title,
      date: item.dueDate,
      amount: item.amount != null ? formatCurrency(item.amount, item.currency ?? "EUR") : null,
      documentId: item.documentId,
      overdue: item.isOverdue,
    }));
  }
  return (structured.items as ArchiveDocument[]).slice(0, 8).map((document) => ({
    title: titleForDocument(document),
    // The date the result was selected on: "which contracts expire this month"
    // is a question about expiry dates, and an issue date answers a different one.
    date:
      structured.kind === "expiring_contracts"
        ? (document.expiryDate ?? null)
        : (document.dueDate ?? document.issueDate ?? null),
    amount:
      document.amount != null ? formatCurrency(document.amount, document.currency ?? "EUR") : null,
    documentId: document.id,
  }));
}

/**
 * Mixed currencies (and deadlines with no amounts at all) leave `totalAmount`
 * null, which would render as a bare dash. The open count is always there.
 */
export function structuredTotalFrom(structured: StructuredData): string {
  if (structured.kind === "deadline_items") {
    return structured.totalAmount === null
      ? String(structured.totalOpenCount)
      : formatCurrency(structured.totalAmount, structured.currency ?? "EUR");
  }
  return String(structured.totalCount);
}

/** What a finished stream becomes in the thread. */
export function turnFromStream(
  question: string,
  stream: {
    status: string;
    answerText: string;
    answerStatus: "answered" | "insufficient_evidence" | null;
    lowConfidence: boolean;
    citations: AnswerCitation[];
    structuredData: AnswerQueryResponse["structuredData"];
    errorMessage: string | null;
  },
  notes: { error: string; insufficient: string },
): Turn {
  const structured = stream.structuredData ?? null;
  const base = {
    question,
    citations: stream.citations,
    structuredRows: structured ? structuredRowsFrom(structured) : null,
    structuredTitle: structured?.title ?? null,
    structuredTotal: structured ? structuredTotalFrom(structured) : null,
    lowConfidence: stream.lowConfidence,
  };
  if (stream.status === "error") {
    return { ...base, answer: stream.errorMessage ?? notes.error, source: "error" };
  }
  if (!stream.answerText) {
    return { ...base, answer: notes.insufficient, source: "note" };
  }
  return {
    ...base,
    answer: stream.answerText,
    insufficient: stream.answerStatus === "insufficient_evidence",
  };
}

/**
 * Which citation an answer's link means. The marker is exact (`#c2`); the
 * document alone is not, since one document can be cited at several passages.
 */
export function citationForHref(
  href: string,
  citations: AnswerCitation[],
): AnswerCitation | undefined {
  if (!href.startsWith("/documents/")) {
    return undefined;
  }
  const [documentId, marker] = href.slice("/documents/".length).split("#c");
  const index = marker ? Number(marker) : Number.NaN;
  return (
    citations.find((entry) => entry.documentId === documentId && entry.index === index) ??
    citations.find((entry) => entry.documentId === documentId)
  );
}

/** One source button per document instead of one per retrieved chunk. */
export function groupCitationsByDocument(citations: AnswerCitation[]): AnswerCitation[][] {
  const groups = new Map<string, AnswerCitation[]>();
  for (const citation of citations) {
    const group = groups.get(citation.documentId) ?? [];
    group.push(citation);
    groups.set(citation.documentId, group);
  }
  return [...groups.values()];
}

/** Legacy payloads have no `used` flag and count as used. */
export function splitCitations(citations: AnswerCitation[]) {
  return {
    used: citations.filter((citation) => citation.used !== false),
    unused: citations.filter((citation) => citation.used === false),
  };
}

/**
 * Whether the thread should keep following the end. Only scrolling up lets go of
 * it: content growing under the view also leaves the offset short of the end, and
 * reading that as the user moving away would stop the follow on the first big
 * chunk of an answer.
 */
export function nextFollowing(
  following: boolean,
  previousOffset: number,
  event: { offset: number; viewport: number; content: number },
  threshold = 48,
): boolean {
  if (event.content - (event.offset + event.viewport) <= threshold) {
    return true;
  }
  return event.offset < previousOffset ? false : following;
}

export function relativeAgeParts(
  at: number,
  now: number,
): { unit: "now" | "days" | "weeks" | "months"; count: number } {
  const days = Math.round((now - at) / 86_400_000);
  if (days < 1) return { unit: "now", count: 0 };
  if (days < 7) return { unit: "days", count: days };
  if (days < 30) return { unit: "weeks", count: Math.round(days / 7) };
  return { unit: "months", count: Math.round(days / 30) };
}
