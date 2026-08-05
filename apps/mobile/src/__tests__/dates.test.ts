import { formatShortDate, parseArchiveDate } from "../lib";
import { isOverdue } from "../screens/document-detail/shared";
import type { ArchiveDocument } from "../lib";

/**
 * The suite runs in `America/Los_Angeles` (see `jest.config.js`), so a date-only
 * value parsed the naive way lands on the previous day. That is the regression
 * these tests exist for: a document due today read as overdue, and its row
 * showed yesterday's date.
 */
describe("date-only values", () => {
  it("is a zone where naive parsing is wrong", () => {
    // Not an assertion about our code — a guard that the test would notice.
    expect(new Date("2026-08-05").getDate()).toBe(4);
  });

  it("parses YYYY-MM-DD as a local calendar date", () => {
    const parsed = parseArchiveDate("2026-08-05");
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(7);
    expect(parsed?.getDate()).toBe(5);
  });

  it("still parses a full timestamp", () => {
    expect(parseArchiveDate("2026-08-05T12:00:00.000Z")?.getUTCHours()).toBe(12);
  });

  it("returns null for nothing and for nonsense", () => {
    expect(parseArchiveDate(null)).toBeNull();
    expect(parseArchiveDate("")).toBeNull();
    expect(parseArchiveDate("not a date")).toBeNull();
  });

  it("formats the day the value names", () => {
    expect(formatShortDate("2026-08-05")).toBe("05.08.");
    expect(formatShortDate(null)).toBe("-");
  });
});

function documentWith(fields: Partial<ArchiveDocument>): ArchiveDocument {
  return { id: "d1", tags: [], ...fields } as ArchiveDocument;
}

describe("isOverdue", () => {
  // Fake timers, not a `Date.now` stub: `isOverdue` builds today with
  // `new Date()`, which reads the clock directly.
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 5, 9, 0, 0));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it("is false on the due date itself", () => {
    expect(isOverdue(documentWith({ dueDate: "2026-08-05" }))).toBe(false);
  });

  it("is true the day after", () => {
    expect(isOverdue(documentWith({ dueDate: "2026-08-04" }))).toBe(true);
  });

  it("is false without a due date", () => {
    expect(isOverdue(documentWith({ dueDate: null }))).toBe(false);
  });
});
