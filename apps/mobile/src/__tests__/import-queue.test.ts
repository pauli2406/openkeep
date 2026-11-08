import {
  applyPatch,
  canClearFinished,
  classifyFile,
  clearFinished,
  createItem,
  formatFileSize,
  IMPORT_MAX_BYTES,
  isInFlight,
  isRetryable,
  mimeTypeFor,
  outcomeOfUpload,
  patchFromDocument,
  pickedUpToday,
  processItem,
  queueCounts,
  runBounded,
  stageProgress,
  type AuthFetch,
  type ImportDeps,
} from "../api/import";

const messages = { failed: "Failed", embeddingFailed: "Indexing failed" };

function respond(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function deps(authFetch: AuthFetch, buildPdf = jest.fn(async () => "file:///scan.pdf")): ImportDeps {
  return { authFetch, buildPdf, failedMessage: "Upload failed." };
}

const file = { uri: "file:///a.pdf", name: "a.pdf", mimeType: "application/pdf", size: 10 };

describe("what may be uploaded", () => {
  it("goes by the type or the extension", () => {
    expect(classifyFile(file)).toBe("ok");
    expect(classifyFile({ uri: "x", name: "SCAN.JPEG", mimeType: null })).toBe("ok");
    expect(classifyFile({ uri: "x", name: "noext", mimeType: "image/heic" })).toBe("ok");
    expect(classifyFile({ uri: "x", name: "notes.docx", mimeType: "application/msword" })).toBe(
      "unsupported",
    );
  });

  it("stops at the limit", () => {
    expect(classifyFile({ ...file, size: IMPORT_MAX_BYTES })).toBe("ok");
    expect(classifyFile({ ...file, size: IMPORT_MAX_BYTES + 1 })).toBe("oversized");
    expect(classifyFile({ ...file, size: null })).toBe("ok");
  });

  it("declares a type even when the picker gave none", () => {
    expect(mimeTypeFor({ uri: "x", name: "a.tif" })).toBe("image/tiff");
    expect(mimeTypeFor({ uri: "x", name: "a", mimeType: "image/png" })).toBe("image/png");
    expect(mimeTypeFor({ uri: "x", name: "a" })).toBe("application/octet-stream");
  });

  it("states sizes the way the web does", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("an upload's outcome", () => {
  it("flags a duplicate and points at the original (#284)", () => {
    expect(
      outcomeOfUpload({ id: "new", duplicateOf: { id: "old", title: "Original" } }),
    ).toEqual({ stage: "duplicate", documentId: "new", duplicateOfId: "old" });
  });

  it("carries on into the pipeline otherwise", () => {
    expect(outcomeOfUpload({ id: "new", duplicateOf: null })).toEqual({
      stage: "ocr",
      documentId: "new",
    });
  });
});

describe("one attempt at a row", () => {
  it("posts the file with its title and reads the response", async () => {
    const authFetch = jest.fn(async () =>
      respond(201, { id: "doc-1", duplicateOf: null }),
    ) as unknown as jest.MockedFunction<AuthFetch>;
    const item = createItem({
      name: "a.pdf",
      title: "  Mein Vertrag ",
      source: { kind: "file", file },
    });

    const patch = await processItem(item, deps(authFetch));

    expect(patch).toMatchObject({ stage: "ocr", documentId: "doc-1" });
    const [path, init] = authFetch.mock.calls[0];
    expect(path).toBe("/api/documents");
    expect(init?.method).toBe("POST");
    const form = init?.body as unknown as FormData;
    expect(form.getAll("title")).toEqual(["Mein Vertrag"]);
  });

  it("sends no title field when none was given, so the server detects one", async () => {
    const authFetch = jest.fn(async () =>
      respond(201, { id: "doc-1", duplicateOf: null }),
    ) as unknown as jest.MockedFunction<AuthFetch>;
    await processItem(createItem({ name: "a.pdf", source: { kind: "file", file } }), deps(authFetch));
    const form = authFetch.mock.calls[0][1]?.body as unknown as FormData;
    expect(form.getAll("title")).toEqual([]);
  });

  it("turns a server refusal into the row's message", async () => {
    const authFetch: AuthFetch = async () => respond(413, { message: "Too large" });
    const patch = await processItem(
      createItem({ name: "a.pdf", source: { kind: "file", file } }),
      deps(authFetch),
    );
    expect(patch).toMatchObject({ stage: "failed", errorMessage: "Too large" });
  });

  it("builds draft pages into one PDF, once, even when the upload fails", async () => {
    const buildPdf = jest.fn(async () => "file:///scan.pdf");
    const authFetch: AuthFetch = async () => respond(500, { message: "down" });
    const item = createItem({
      name: "scan.pdf",
      source: { kind: "pages", uris: ["p1.jpg", "p2.jpg"] },
    });

    const first = await processItem(item, deps(authFetch, buildPdf));
    expect(buildPdf).toHaveBeenCalledWith(["p1.jpg", "p2.jpg"]);
    expect(first.stage).toBe("failed");
    expect(first.source).toEqual({
      kind: "file",
      file: { uri: "file:///scan.pdf", name: "scan.pdf", mimeType: "application/pdf" },
    });

    await processItem({ ...item, ...first }, deps(authFetch, buildPdf));
    expect(buildPdf).toHaveBeenCalledTimes(1);
  });

  it("fails the row when the PDF cannot be built", async () => {
    const authFetch = jest.fn() as unknown as AuthFetch;
    const patch = await processItem(
      createItem({ name: "scan.pdf", source: { kind: "pages", uris: ["p1.jpg"] } }),
      deps(authFetch, jest.fn(async () => {
        throw new Error("No space left");
      })),
    );
    expect(patch).toMatchObject({ stage: "failed", errorMessage: "No space left" });
    expect(authFetch).not.toHaveBeenCalled();
  });

  it("reprocesses rather than re-uploads once the document exists", async () => {
    const authFetch = jest.fn(async () => respond(201, {})) as unknown as jest.MockedFunction<AuthFetch>;
    const item = createItem({
      name: "a.pdf",
      source: { kind: "file", file },
      documentId: "doc-1",
      stage: "failed",
    });

    const patch = await processItem(item, deps(authFetch));

    expect(patch).toEqual({ stage: "ocr", errorMessage: undefined });
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(authFetch.mock.calls[0][0]).toBe("/api/documents/doc-1/reprocess");
    expect(authFetch.mock.calls[0][1]?.method).toBe("POST");
  });
});

describe("following a document", () => {
  const ready = { status: "ready", embeddingStatus: "ready", reviewStatus: "not_required" };

  it("reads the pipeline from status and job", () => {
    expect(patchFromDocument({ status: "pending" }, messages)).toBeNull();
    expect(patchFromDocument({ status: "processing" }, messages)).toEqual({ stage: "extract" });
    expect(
      patchFromDocument({ status: "pending", latestProcessingJob: { status: "running" } }, messages),
    ).toEqual({ stage: "extract" });
    expect(patchFromDocument({ ...ready, embeddingStatus: "indexing" }, messages)?.stage).toBe(
      "embed",
    );
    expect(patchFromDocument({ ...ready, embeddingStatus: "queued" }, messages)?.stage).toBe("embed");
  });

  it("reports what became of a finished document", () => {
    expect(
      patchFromDocument(
        {
          ...ready,
          reviewStatus: "pending",
          documentType: { name: "Invoice" },
          metadata: { pageCount: 3 },
        },
        messages,
      ),
    ).toEqual({
      stage: "done",
      errorMessage: undefined,
      typeName: "Invoice",
      needsReview: true,
      pageCount: 3,
    });
  });

  it("calls an embedding failure a failure", () => {
    expect(patchFromDocument({ ...ready, embeddingStatus: "failed" }, messages)).toMatchObject({
      stage: "failed",
      errorMessage: "Indexing failed",
    });
  });

  it("carries the server's error for a failed document", () => {
    expect(
      patchFromDocument({ status: "failed", lastProcessingError: "OCR crashed" }, messages),
    ).toMatchObject({ stage: "failed", errorMessage: "OCR crashed" });
    expect(patchFromDocument({ status: "failed" }, messages)).toMatchObject({
      errorMessage: "Failed",
    });
  });

  /**
   * Reprocessing queues a job while the row still says `failed` until the worker
   * picks it up. Reading the status first would put a retried row straight back.
   */
  it("does not flip a retried row back to failed while its job is queued", () => {
    expect(
      patchFromDocument({ status: "failed", latestProcessingJob: { status: "queued" } }, messages),
    ).toEqual({ stage: "ocr" });
  });
});

describe("the queue", () => {
  const source = { kind: "file" as const, file };
  const queue = [
    createItem({ name: "uploading", source }),
    createItem({ name: "processing", source, documentId: "1", stage: "extract" }),
    createItem({ name: "done", source, documentId: "2", stage: "done" }),
    createItem({ name: "duplicate", source, documentId: "3", stage: "duplicate" }),
    createItem({ name: "failed", source, stage: "failed" }),
    createItem({ name: "refused", source: null, stage: "failed" }),
  ];

  it("counts its rows", () => {
    expect(queueCounts(queue)).toEqual({ processing: 2, done: 1, duplicate: 1, failed: 2 });
  });

  it("polls only what has a document and is not finished", () => {
    expect(queue.filter(isInFlight).map((item) => item.name)).toEqual(["processing"]);
  });

  it("clears what is dealt with, and keeps a failure that a retry could still fix", () => {
    expect(clearFinished(queue).map((item) => item.name)).toEqual([
      "uploading",
      "processing",
      "failed",
    ]);
    expect(canClearFinished(queue)).toBe(true);
    expect(canClearFinished(clearFinished(queue))).toBe(false);
  });

  it("offers no retry for a file refused up front", () => {
    expect(queue.filter(isRetryable).map((item) => item.name)).toEqual(["failed"]);
  });

  it("patches one row by id", () => {
    const next = applyPatch(queue, queue[0].id, { stage: "ocr" });
    expect(next[0].stage).toBe("ocr");
    expect(next[1]).toBe(queue[1]);
  });

  it("places each stage in the middle of its quarter", () => {
    expect(stageProgress("upload")).toBe(0.125);
    expect(stageProgress("embed")).toBe(0.875);
  });

  it("gives every row a distinct id", () => {
    expect(new Set(queue.map((item) => item.id)).size).toBe(queue.length);
  });
});

describe("bounded concurrency", () => {
  it("never runs more than the limit at once, and runs them all", async () => {
    let running = 0;
    let peak = 0;
    const seen: number[] = [];
    await runBounded(
      [1, 2, 3, 4, 5, 6, 7],
      3,
      () => false,
      async (item) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        seen.push(item);
        running -= 1;
      },
    );
    expect(peak).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("takes nothing new once told to stop", async () => {
    let stop = false;
    const seen: number[] = [];
    await runBounded(
      [1, 2, 3],
      1,
      () => stop,
      async (item) => {
        seen.push(item);
        stop = true;
      },
    );
    expect(seen).toEqual([1]);
  });
});

describe("the watch folder", () => {
  it("adds up today's real imports only", () => {
    const now = new Date(2026, 2, 20, 12);
    expect(
      pickedUpToday(
        {
          configured: true,
          configuredPath: "/srv/watch",
          lastImport: null,
          history: [
            { scannedAt: new Date(2026, 2, 20, 8).toISOString(), imported: 2, dryRun: false },
            { scannedAt: new Date(2026, 2, 20, 9).toISOString(), imported: 5, dryRun: true },
            { scannedAt: new Date(2026, 2, 19, 9).toISOString(), imported: 7, dryRun: false },
          ],
        },
        now,
      ),
    ).toBe(2);
  });
});
