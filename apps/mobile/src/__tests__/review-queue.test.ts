import {
  buildReviewPatch,
  collectAllPages,
  confidenceTone,
  countReasons,
  fieldAttention,
  fieldsToConfirm,
  filterByReason,
  neighbourOf,
  oldestDays,
  parseAmountInput,
  parseDateInput,
  queuePosition,
  seedForm,
} from "../api/review";
import type { ArchiveDocument, ReviewQueueResponse } from "../lib";
import { isBulkEligible, reviewReasonLabel, reviewReasonWhy } from "../review-reasons";

function doc(fields: Partial<ArchiveDocument> = {}): ArchiveDocument {
  return {
    id: "a",
    title: "Doc",
    createdAt: "2026-03-01T00:00:00.000Z",
    reviewReasons: ["low_confidence"],
    confidence: 0.5,
    correspondent: { id: "c-1", name: "Stadtwerke", slug: "stadtwerke" },
    documentType: null,
    issueDate: "2026-02-27",
    dueDate: null,
    expiryDate: null,
    amount: 84.5,
    referenceNumber: "4711",
    holderName: null,
    issuingAuthority: null,
    metadata: {},
    ...fields,
  } as ArchiveDocument;
}

describe("reading every page of the queue", () => {
  const page = (items: string[], total: number): ReviewQueueResponse => ({
    items: items.map((id) => doc({ id })),
    total,
    page: 1,
    pageSize: 2,
  });

  it("follows total until it has everything", async () => {
    const fetchPage = jest.fn(async (n: number) =>
      n === 1 ? page(["a", "b"], 3) : page(["c"], 3),
    );
    const result = await collectAllPages(fetchPage, 2);
    expect(result.items.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenCalledWith(2, 2);
  });

  it("asks once when one page holds the queue", async () => {
    const fetchPage = jest.fn(async () => page(["a"], 1));
    await collectAllPages(fetchPage, 2);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("fails when the first page fails, and keeps what arrived when a later one does", async () => {
    await expect(
      collectAllPages(async () => {
        throw new Error("down");
      }, 2),
    ).rejects.toThrow("down");

    const result = await collectAllPages(async (n) => {
      if (n === 1) return page(["a", "b"], 5);
      throw new Error("down");
    }, 2);
    expect(result.items.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("the bulk rule", () => {
  it("takes a document at or above the threshold whose reasons are all about confidence", () => {
    for (const reason of [
      "low_confidence",
      "ocr_low_confidence",
      "classification_ambiguous",
      "correspondent_unresolved",
    ]) {
      expect(isBulkEligible({ confidence: 0.8, reviewReasons: [reason] }, 80)).toBe(true);
    }
  });

  it("leaves out anything below the threshold, and a missing score counts as zero", () => {
    expect(isBulkEligible({ confidence: 0.79, reviewReasons: ["low_confidence"] }, 80)).toBe(false);
    expect(isBulkEligible({ confidence: null, reviewReasons: ["low_confidence"] }, 60)).toBe(false);
  });

  it("never files a concrete defect on a high score", () => {
    for (const reason of [
      "processing_failed",
      "ocr_empty",
      "missing_key_fields",
      "unsupported_format",
      "validation_failed",
    ]) {
      expect(isBulkEligible({ confidence: 0.99, reviewReasons: [reason] }, 60)).toBe(false);
      expect(
        isBulkEligible({ confidence: 0.99, reviewReasons: ["low_confidence", reason] }, 60),
      ).toBe(false);
    }
  });

  it("needs a reason at all", () => {
    expect(isBulkEligible({ confidence: 0.99, reviewReasons: [] }, 60)).toBe(false);
    expect(isBulkEligible({ confidence: 0.99 }, 60)).toBe(false);
  });
});

describe("walking the queue", () => {
  const queue = [doc({ id: "a" }), doc({ id: "b" }), doc({ id: "c" })];

  it("moves on to the next document, or back from the last", () => {
    expect(neighbourOf(queue, "a")?.id).toBe("b");
    expect(neighbourOf(queue, "c")?.id).toBe("b");
    expect(neighbourOf([queue[0]], "a")).toBeNull();
  });

  it("remembers what was filed in the position", () => {
    expect(queuePosition(3, 0, 0)).toEqual({ position: 1, total: 3, ratio: 1 / 3 });
    // Two filed, three left, looking at the first of those.
    expect(queuePosition(3, 0, 2)).toMatchObject({ position: 3, total: 5 });
  });

  it("counts and filters by reason", () => {
    const items = [
      doc({ id: "a", reviewReasons: ["low_confidence", "ocr_empty"] }),
      doc({ id: "b", reviewReasons: ["low_confidence"] }),
    ];
    expect([...countReasons(items).entries()]).toEqual([
      ["low_confidence", 2],
      ["ocr_empty", 1],
    ]);
    expect(filterByReason(items, "ocr_empty").map((item) => item.id)).toEqual(["a"]);
    expect(filterByReason(items, "all")).toBe(items);
  });

  it("grades a score the way the web does", () => {
    expect(confidenceTone(49)).toBe("bad");
    expect(confidenceTone(50)).toBe("warn");
    expect(confidenceTone(80)).toBe("ok");
  });

  it("ages the queue by its oldest document", () => {
    const now = new Date("2026-03-10T00:00:00.000Z").getTime();
    expect(
      oldestDays(
        [doc({ createdAt: "2026-03-08T00:00:00.000Z" }), doc({ createdAt: "2026-03-01T00:00:00.000Z" })],
        now,
      ),
    ).toBe(9);
    expect(oldestDays([], now)).toBe(0);
  });
});

describe("what a phone keyboard types", () => {
  it.each([
    ["84.50", 84.5],
    ["84,50", 84.5],
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["1.234.567", 1234567],
    ["-412", -412],
    [" 12 ", 12],
  ])("reads the amount %s", (input, expected) => {
    expect(parseAmountInput(input)).toBe(expected);
  });

  it.each(["abc", "", "-", ".", "12a"])("refuses the amount %j", (input) => {
    expect(parseAmountInput(input)).toBeNull();
  });

  it.each([
    ["2026-03-18", "2026-03-18"],
    ["2026-3-8", "2026-03-08"],
    ["18.03.2026", "2026-03-18"],
    ["8.3.26", "2026-03-08"],
  ])("reads the date %s", (input, expected) => {
    expect(parseDateInput(input)).toBe(expected);
  });

  it.each(["31.02.2026", "2026-13-01", "morgen", "18/03/2026", ""])(
    "refuses the date %j",
    (input) => {
      expect(parseDateInput(input)).toBeNull();
    },
  );
});

describe("the PATCH body", () => {
  it("is empty when nothing changed, so a confirm locks nothing", () => {
    const document = doc();
    expect(buildReviewPatch(document, seedForm(document))).toEqual({
      ok: true,
      body: {},
      changed: false,
    });
  });

  it("does not see a difference in how the same value is written", () => {
    const document = doc();
    const result = buildReviewPatch(document, {
      ...seedForm(document),
      amount: "84,50",
      issueDate: "27.02.2026",
    });
    expect(result).toEqual({ ok: true, body: {}, changed: false });
  });

  it("carries only what changed, in the API's shape", () => {
    const document = doc();
    const result = buildReviewPatch(document, {
      ...seedForm(document),
      amount: "99,90",
      dueDate: "01.04.2026",
      referenceNumber: "",
      documentTypeId: "t-1",
      correspondentId: "",
    });
    expect(result).toEqual({
      ok: true,
      changed: true,
      body: {
        amount: 99.9,
        dueDate: "2026-04-01",
        referenceNumber: null,
        documentTypeId: "t-1",
        correspondentId: null,
      },
    });
  });

  it("names the fields it cannot send rather than sending them", () => {
    const document = doc();
    expect(
      buildReviewPatch(document, { ...seedForm(document), amount: "abc", dueDate: "31.02.2026" }),
    ).toEqual({ ok: false, invalid: ["dueDate", "amount"] });
  });
});

describe("the fields to confirm", () => {
  it("are the six, plus any the document was judged against", () => {
    expect(fieldsToConfirm(doc())).toEqual([
      "correspondentId",
      "documentTypeId",
      "issueDate",
      "dueDate",
      "amount",
      "referenceNumber",
    ]);
    expect(
      fieldsToConfirm(
        doc({
          metadata: {
            reviewEvidence: {
              requiredFields: ["expiryDate"],
              missingFields: ["holderName"],
            },
          },
        } as unknown as Partial<ArchiveDocument>),
      ),
    ).toEqual(expect.arrayContaining(["expiryDate", "holderName"]));
  });

  it("ask for attention when empty, or when that field's own score is low", () => {
    const document = doc({
      metadata: {
        intelligence: { extraction: { fieldConfidence: { amount: 0.58, correspondentName: 0.5 } } },
      },
    } as unknown as Partial<ArchiveDocument>);
    expect(fieldAttention(document, "dueDate", "")).toBe("missing");
    expect(fieldAttention(document, "amount", "84.5")).toBe("low");
    expect(fieldAttention(document, "correspondentId", "c-1")).toBe("low");
    // No entry for this field: the document's overall score says nothing about it.
    expect(fieldAttention(document, "issueDate", "2026-02-27")).toBeNull();
  });
});

describe("reasons in words", () => {
  const t = ((key: string) => key) as never;

  it("has a label and an explanation for every reason the API sends", () => {
    for (const reason of [
      "low_confidence",
      "processing_failed",
      "ocr_empty",
      "ocr_low_confidence",
      "missing_key_fields",
      "unsupported_format",
      "classification_ambiguous",
      "correspondent_unresolved",
      "validation_failed",
    ]) {
      expect(reviewReasonLabel(reason, t)).toBe(`review.reasonLabel.${reason}`);
      expect(reviewReasonWhy(reason, t)).toBe(`review.why.${reason}`);
    }
  });

  it("falls back to readable words for one it does not know", () => {
    expect(reviewReasonLabel("brand_new_reason", t)).toBe("brand new reason");
    expect(reviewReasonWhy("brand_new_reason", t)).toBeNull();
  });
});
