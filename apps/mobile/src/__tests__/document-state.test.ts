import { documentRowState, isDocumentProcessing } from "../document-processing";
import { toneForStatus } from "../lib";
import type { ArchiveDocument } from "../lib";

function documentWith(fields: Partial<ArchiveDocument>): ArchiveDocument {
  return { id: "d1", status: "ready", tags: [], ...fields } as ArchiveDocument;
}

/**
 * The row treatment is derived, not stored. Requeueing a failed document leaves
 * `status: "failed"` until a worker picks the job up, so precedence decides
 * whether the row sits there red with a reprocess button — inviting a second
 * job — or says it is queued.
 */
describe("documentRowState", () => {
  it("reports a queued job before a stale failure", () => {
    expect(
      documentRowState(
        documentWith({ status: "failed", latestProcessingJob: { status: "queued" } as never }),
      ),
    ).toBe("queued");
  });

  it("reports a running job before a stale failure", () => {
    expect(
      documentRowState(
        documentWith({ status: "failed", latestProcessingJob: { status: "running" } as never }),
      ),
    ).toBe("processing");
  });

  it("still reports a failure with no active job", () => {
    expect(
      documentRowState(
        documentWith({ status: "failed", latestProcessingJob: { status: "failed" } as never }),
      ),
    ).toBe("failed");
    expect(documentRowState(documentWith({ status: "failed" }))).toBe("failed");
  });

  it("treats a pending document as queued", () => {
    expect(documentRowState(documentWith({ status: "pending" }))).toBe("queued");
  });

  it("reports ready otherwise", () => {
    expect(documentRowState(documentWith({ status: "ready" }))).toBe("ready");
  });

  it("agrees with isDocumentProcessing", () => {
    const queued = documentWith({ status: "pending" });
    expect(isDocumentProcessing(queued)).toBe(true);
    expect(isDocumentProcessing(documentWith({ status: "ready" }))).toBe(false);
  });
});

describe("toneForStatus", () => {
  it("maps each status to the tone the pill uses", () => {
    expect(toneForStatus("ready")).toBe("ok");
    expect(toneForStatus("resolved")).toBe("ok");
    expect(toneForStatus("failed")).toBe("bad");
    expect(toneForStatus("pending")).toBe("warn");
    expect(toneForStatus("processing")).toBe("warn");
    expect(toneForStatus("something else")).toBe("outline");
  });
});
