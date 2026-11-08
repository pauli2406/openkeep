import {
  citationForHref,
  fill,
  foldTurn,
  groupCitationsByDocument,
  historyFromTurns,
  MAX_CONVERSATIONS,
  nextFollowing,
  parseConversations,
  relativeAgeParts,
  splitCitations,
  structuredRowsFrom,
  structuredTotalFrom,
  turnFromStream,
  type Conversation,
  type Turn,
} from "../components/chat/conversations";
import type { AnswerCitation, AnswerQueryResponse } from "../lib";

function citation(fields: Partial<AnswerCitation> = {}): AnswerCitation {
  return {
    documentId: "d-1",
    documentTitle: "Stromabrechnung",
    chunkIndex: 0,
    quote: "Abschlag",
    pageFrom: 1,
    pageTo: 1,
    index: 1,
    ...fields,
  };
}

function turn(fields: Partial<Turn> = {}): Turn {
  return {
    question: "Q",
    answer: "A",
    citations: [],
    structuredRows: null,
    structuredTitle: null,
    ...fields,
  };
}

const notes = { error: "failed", insufficient: "not enough" };
const streamBase = {
  status: "done",
  answerText: "An answer",
  answerStatus: "answered" as const,
  lowConfidence: false,
  citations: [],
  structuredData: null,
  errorMessage: null,
};

describe("saved conversations", () => {
  it("reads what the web client's shape stores", () => {
    const stored = JSON.stringify([
      { id: "a", title: "Q", at: 1, turns: [turn()] },
    ]);
    expect(parseConversations(stored)).toHaveLength(1);
  });

  it("drops damaged entries instead of handing them to the thread", () => {
    const stored = JSON.stringify([
      { id: "a", title: "Q", at: 1, turns: [{ question: "no answer field" }] },
      { id: "b", title: "Q", at: 1, turns: [turn()] },
      "nonsense",
    ]);
    expect(parseConversations(stored).map((entry) => entry.id)).toEqual(["b"]);
    expect(parseConversations("{not json")).toEqual([]);
    expect(parseConversations(null)).toEqual([]);
  });

  it("keeps twenty, dropping the oldest when a new one starts", () => {
    const existing: Conversation[] = Array.from({ length: MAX_CONVERSATIONS }, (_, index) => ({
      id: `c-${index}`,
      title: "Q",
      at: index,
      turns: [turn()],
    }));
    const { conversations, createdId } = foldTurn(existing, null, turn({ question: "New" }), {
      now: 99,
      newId: "fresh",
    });
    expect(createdId).toBe("fresh");
    expect(conversations).toHaveLength(MAX_CONVERSATIONS);
    expect(conversations[0]).toMatchObject({ id: "fresh", title: "New", at: 99 });
    expect(conversations.some((entry) => entry.id === `c-${MAX_CONVERSATIONS - 1}`)).toBe(false);
  });

  it("appends to the conversation the question was asked in, not a new one", () => {
    const existing: Conversation[] = [
      { id: "a", title: "A", at: 1, turns: [turn()] },
      { id: "b", title: "B", at: 1, turns: [turn()] },
    ];
    const { conversations, createdId } = foldTurn(existing, "b", turn({ question: "More" }), {
      now: 5,
      newId: "unused",
    });
    expect(createdId).toBeNull();
    expect(conversations[0].turns).toHaveLength(1);
    expect(conversations[1].turns.at(-1)?.question).toBe("More");
    expect(conversations[1].at).toBe(5);
  });

  it("starts a new conversation when the one asked in has gone", () => {
    const { createdId } = foldTurn([], "deleted", turn(), { now: 1, newId: "fresh" });
    expect(createdId).toBe("fresh");
  });
});

describe("replaying the thread", () => {
  it("sends questions and answers in order", () => {
    expect(historyFromTurns([turn({ question: "Q1", answer: "A1" })])).toEqual([
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
    ]);
  });

  it("never replays a failure or a local note as something the assistant said", () => {
    const history = historyFromTurns([
      turn({ question: "Failed", answer: "HTTP 500", source: "error" }),
      turn({ question: "Empty", answer: "not enough", source: "note" }),
      turn({ question: "Fine", answer: "Answer" }),
    ]);
    expect(history.map((entry) => entry.content)).toEqual(["Fine", "Answer"]);
  });
});

describe("what a finished stream becomes", () => {
  it("keeps the answer and the refusal flag", () => {
    const result = turnFromStream(
      "Q",
      { ...streamBase, answerStatus: "insufficient_evidence", answerText: "I cannot tell" },
      notes,
    );
    expect(result).toMatchObject({ answer: "I cannot tell", insufficient: true });
    expect(result.source).toBeUndefined();
  });

  it("marks a failure", () => {
    expect(
      turnFromStream("Q", { ...streamBase, status: "error", answerText: "", errorMessage: "HTTP 500" }, notes),
    ).toMatchObject({ answer: "HTTP 500", source: "error" });
    expect(
      turnFromStream("Q", { ...streamBase, status: "error", answerText: "" }, notes).answer,
    ).toBe("failed");
  });

  it("stands a note in for an empty answer", () => {
    expect(turnFromStream("Q", { ...streamBase, answerText: "" }, notes)).toMatchObject({
      answer: "not enough",
      source: "note",
    });
  });
});

describe("structured results", () => {
  const deadlines = {
    kind: "deadline_items",
    title: "Open",
    description: null,
    items: [
      {
        documentId: "d-1",
        title: "Invoice",
        referenceNumber: null,
        dueDate: "2026-03-01",
        amount: 10,
        currency: "EUR",
        correspondentName: null,
        documentTypeName: null,
        taskLabel: "Pay",
        daysUntilDue: -1,
        isOverdue: true,
        taskCompletedAt: null,
      },
    ],
    totalOpenCount: 3,
    totalAmount: null,
    currency: null,
    windowStart: null,
    windowEnd: null,
  } as NonNullable<AnswerQueryResponse["structuredData"]>;

  it("keeps the document, so a row can open it", () => {
    expect(structuredRowsFrom(deadlines)[0]).toMatchObject({
      documentId: "d-1",
      date: "2026-03-01",
      overdue: true,
    });
  });

  it("falls back to the open count when mixed currencies leave no total", () => {
    expect(structuredTotalFrom(deadlines)).toBe("3");
  });

  it("dates expiring contracts by their expiry, not their issue date", () => {
    const rows = structuredRowsFrom({
      kind: "expiring_contracts",
      title: "Expiring",
      description: null,
      totalCount: 1,
      items: [
        { id: "d-2", title: "Lease", issueDate: "2020-01-01", expiryDate: "2026-12-31", dueDate: null, amount: null, currency: null },
      ],
    } as never);
    expect(rows[0].date).toBe("2026-12-31");
    expect(rows[0].amount).toBeNull();
  });
});

describe("citations", () => {
  const citations = [
    citation({ index: 1, chunkIndex: 0 }),
    citation({ index: 2, chunkIndex: 1, pageFrom: 3 }),
    citation({ index: 3, documentId: "d-2", used: false }),
  ];

  it("resolves a marker exactly: one document can be cited at several passages", () => {
    expect(citationForHref("/documents/d-1#c2", citations)?.index).toBe(2);
  });

  it("falls back to the document for a link with no marker", () => {
    expect(citationForHref("/documents/d-2", citations)?.index).toBe(3);
  });

  it("does not treat anything else as a citation", () => {
    expect(citationForHref("https://example.com", citations)).toBeUndefined();
    expect(citationForHref("/documents/unknown#c1", citations)).toBeUndefined();
  });

  it("groups by document", () => {
    expect(groupCitationsByDocument(citations).map((group) => group.length)).toEqual([2, 1]);
  });

  it("counts a citation without the flag as used", () => {
    const { used, unused } = splitCitations(citations);
    expect(used).toHaveLength(2);
    expect(unused.map((entry) => entry.documentId)).toEqual(["d-2"]);
  });
});

describe("following the stream", () => {
  const atEnd = { offset: 600, viewport: 400, content: 1000 };

  it("keeps following when an answer grows under the view", () => {
    expect(nextFollowing(true, 600, { ...atEnd, content: 1600 })).toBe(true);
  });

  it("lets go when the user scrolls up", () => {
    expect(nextFollowing(true, 600, { ...atEnd, offset: 300 })).toBe(false);
  });

  it("picks up again at the end", () => {
    expect(nextFollowing(false, 300, atEnd)).toBe(true);
  });

  it("does not pick up again part-way down", () => {
    expect(nextFollowing(false, 100, { ...atEnd, offset: 300 })).toBe(false);
  });
});

describe("small formats", () => {
  it("fills slots and leaves unknown ones visible", () => {
    expect(fill("{count} of {total}", { count: 2 })).toBe("2 of {total}");
  });

  it("ages a conversation like the web", () => {
    const day = 86_400_000;
    expect(relativeAgeParts(0, day / 4).unit).toBe("now");
    expect(relativeAgeParts(0, 3 * day)).toEqual({ unit: "days", count: 3 });
    expect(relativeAgeParts(0, 14 * day)).toEqual({ unit: "weeks", count: 2 });
    expect(relativeAgeParts(0, 60 * day)).toEqual({ unit: "months", count: 2 });
  });
});
