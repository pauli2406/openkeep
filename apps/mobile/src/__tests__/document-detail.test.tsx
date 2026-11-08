import { act, renderHook, waitFor } from "@testing-library/react-native";
import { downloadDocumentToFile, downloadFilename } from "../api/document";
import { useDocumentQa, type QaAnsweredTurn } from "../hooks/useDocumentQa";
import type { ArchiveDocument } from "../lib";
import {
  buildDocumentPatch,
  citationForLink,
  dirtyFields,
  formToState,
  linkQaCitations,
  mergeServerForm,
  parseAmount,
  validateForm,
} from "../screens/document-detail/shared";

const mockSave = jest.fn(async (_response: Response, filename: string) => `file:///cache/${filename}`);

jest.mock("../lib", () => ({
  ...jest.requireActual("../lib"),
  saveDownloadToFile: (response: Response, filename: string) => mockSave(response, filename),
}));

function archiveDocument(overrides: Partial<ArchiveDocument> = {}): ArchiveDocument {
  return {
    id: "d-1",
    title: "Stromabrechnung 2026",
    mimeType: "application/pdf",
    issueDate: "2026-03-14",
    dueDate: null,
    expiryDate: null,
    amount: 84.5,
    currency: "EUR",
    referenceNumber: null,
    holderName: null,
    issuingAuthority: null,
    correspondent: { id: "c-1", name: "Stadtwerke", slug: "stadtwerke" },
    documentType: null,
    tags: [{ id: "t-1", name: "Home", slug: "home" }],
    ...overrides,
  } as ArchiveDocument;
}

describe("downloadFilename", () => {
  it("derives the name from the title and the MIME type", () => {
    expect(downloadFilename("Stromabrechnung 2026", "application/pdf")).toBe(
      "Stromabrechnung 2026.pdf",
    );
    expect(downloadFilename("Scan", "image/jpeg")).toBe("Scan.jpg");
    expect(
      downloadFilename(
        "Vertrag",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe("Vertrag.docx");
  });

  it("does not double an extension the title already has, in any spelling", () => {
    expect(downloadFilename("rechnung.PDF", "application/pdf")).toBe("rechnung.pdf");
    expect(downloadFilename("scan.jpeg", "image/jpeg")).toBe("scan.jpg");
    expect(downloadFilename("scan.tif", "image/tiff")).toBe("scan.tiff");
  });

  it("keeps a dot that is not an extension", () => {
    expect(downloadFilename("Rechnung 3.2026", "application/pdf")).toBe("Rechnung 3.2026.pdf");
  });

  it("names a searchable copy as a PDF whatever the original was", () => {
    expect(downloadFilename("Scan", "image/png", "searchable")).toBe("Scan.pdf");
  });

  it("removes what a file system would refuse", () => {
    expect(downloadFilename('a/b\\c:d*e?f"g<h>i|j', "text/plain")).toBe("a b c d e f g h i j.txt");
    expect(downloadFilename("../../etc/passwd", "text/plain")).toBe("etc passwd.txt");
    expect(downloadFilename("...versteckt", "text/plain")).toBe("versteckt.txt");
  });

  it("falls back when the title leaves nothing", () => {
    expect(downloadFilename("", "application/pdf")).toBe("document.pdf");
    expect(downloadFilename(null, "application/pdf")).toBe("document.pdf");
    expect(downloadFilename("///", "application/pdf")).toBe("document.pdf");
  });

  it("trusts a title with an extension when the MIME type is unknown", () => {
    expect(downloadFilename("archiv.7z", "application/x-7z-compressed")).toBe("archiv.7z");
    expect(downloadFilename("archiv", "application/x-7z-compressed")).toBe("archiv.bin");
  });

  it("stays under the file system's byte limit, counting umlauts as two", () => {
    const name = downloadFilename("ü".repeat(300), "application/pdf");
    expect(name.endsWith(".pdf")).toBe(true);
    expect(Buffer.byteLength(name, "utf8")).toBeLessThanOrEqual(204);
  });
});

describe("downloadDocumentToFile", () => {
  beforeEach(() => mockSave.mockClear());

  const ok = { ok: true, status: 200 } as Response;

  it("asks for the variant and writes under an encoded name, so a space survives a file URI", async () => {
    const authFetch = jest.fn(async () => ok);
    const uri = await downloadDocumentToFile(authFetch, archiveDocument(), "searchable");
    expect(authFetch).toHaveBeenCalledWith("/api/documents/d-1/download/searchable");
    expect(uri).toBe("file:///cache/Stromabrechnung%202026.pdf");
  });

  it("surfaces a failed download rather than writing it to disk", async () => {
    const authFetch = jest.fn(
      async () =>
        ({ ok: false, status: 500, text: async () => '{"message":"Nope"}' }) as Response,
    );
    await expect(downloadDocumentToFile(authFetch, archiveDocument(), "original")).rejects.toThrow(
      "Nope",
    );
    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe("the edit form", () => {
  const document = archiveDocument();
  const form = formToState(document);

  it("is clean when it matches the document", () => {
    expect(dirtyFields(document, form)).toEqual([]);
    expect(buildDocumentPatch(document, form)).toEqual({});
  });

  it("sends only what changed, because the server locks every field it receives", () => {
    expect(buildDocumentPatch(document, { ...form, dueDate: "2026-04-01" })).toEqual({
      dueDate: "2026-04-01",
    });
  });

  it("clears a field with null", () => {
    expect(buildDocumentPatch(document, { ...form, issueDate: "", correspondentId: "" })).toEqual({
      issueDate: null,
      correspondentId: null,
    });
  });

  it("can remove the last tag", () => {
    expect(buildDocumentPatch(document, { ...form, tagIds: [] })).toEqual({ tagIds: [] });
  });

  it("ignores the order of tags", () => {
    const tagged = archiveDocument({
      tags: [
        { id: "a", name: "A", slug: "a" },
        { id: "b", name: "B", slug: "b" },
      ],
    });
    expect(dirtyFields(tagged, { ...formToState(tagged), tagIds: ["b", "a"] })).toEqual([]);
  });

  it("reads a German decimal comma as the same amount, not as a change or a clear", () => {
    expect(parseAmount("84,5")).toBe(84.5);
    expect(dirtyFields(document, { ...form, amount: "84,5" })).toEqual([]);
    expect(buildDocumentPatch(document, { ...form, amount: "90,25" })).toEqual({ amount: 90.25 });
  });

  it("clears the amount only when it is actually empty", () => {
    expect(parseAmount("  ")).toBeNull();
    expect(parseAmount("abc")).toBe("invalid");
    expect(buildDocumentPatch(document, { ...form, amount: "abc" })).toEqual({});
  });

  it("refuses a bad date, a bad amount and a blank title before the server has to", () => {
    expect(validateForm(form)).toBeNull();
    expect(validateForm({ ...form, title: "  " })).toBe("title");
    expect(validateForm({ ...form, dueDate: "18.03.2026" })).toBe("date");
    expect(validateForm({ ...form, dueDate: "2026-02-31" })).toBe("date");
    expect(validateForm({ ...form, amount: "12x" })).toBe("amount");
    expect(validateForm({ ...form, dueDate: "" })).toBeNull();
  });
});

describe("a poll under an open form", () => {
  const previous = formToState(archiveDocument());

  it("adopts a value the user has not touched", () => {
    const server = { ...previous, issueDate: "2026-01-01" };
    expect(mergeServerForm(previous, previous, server).issueDate).toBe("2026-01-01");
  });

  it("keeps an edit when the server changes the same field", () => {
    const current = { ...previous, issueDate: "2026-02-02" };
    const server = { ...previous, issueDate: "2026-01-01" };
    expect(mergeServerForm(previous, current, server).issueDate).toBe("2026-02-02");
  });

  it("keeps edited tags, and follows the server's when untouched", () => {
    const server = { ...previous, tagIds: ["t-2"] };
    expect(mergeServerForm(previous, { ...previous, tagIds: ["t-9"] }, server).tagIds).toEqual([
      "t-9",
    ]);
    expect(mergeServerForm(previous, previous, server).tagIds).toEqual(["t-2"]);
  });

  it("returns the same object when nothing changed, so a poll does not re-render the form", () => {
    expect(mergeServerForm(previous, previous, { ...previous })).toBe(previous);
  });
});

describe("citation markers", () => {
  const citations = [
    { chunkIndex: 0, pageFrom: 2, pageTo: 2, quote: "first", score: 1, index: 1 },
    { chunkIndex: 1, pageFrom: 3, pageTo: 3, quote: "second", score: 1, index: 2 },
  ];

  it("links markers that have a citation behind them, and leaves the rest as text", () => {
    expect(linkQaCitations("A [1] and [7].", citations)).toBe(
      "A [\\[1\\]](citation:1) and [7].",
    );
  });

  it("links adjacent markers separately", () => {
    expect(linkQaCitations("A [1][2]", citations)).toBe(
      "A [\\[1\\]](citation:1)[\\[2\\]](citation:2)",
    );
  });

  it("leaves a real markdown link alone", () => {
    expect(linkQaCitations("See [1](https://example.com)", citations)).toBe(
      "See [1](https://example.com)",
    );
  });

  it("numbers a legacy citation by its position", () => {
    const legacy = [{ chunkIndex: 0, pageFrom: 1, pageTo: 1, quote: "old", score: 1 }];
    expect(linkQaCitations("[1]", legacy)).toBe("[\\[1\\]](citation:1)");
    expect(citationForLink("citation:1", legacy)).toBe(legacy[0]);
  });

  it("resolves a link back to its citation, and nothing else", () => {
    expect(citationForLink("citation:2", citations)).toBe(citations[1]);
    expect(citationForLink("citation:9", citations)).toBeNull();
    expect(citationForLink("https://example.com", citations)).toBeNull();
  });
});

describe("useDocumentQa", () => {
  function streamOf(...chunks: string[]) {
    let index = 0;
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () =>
            index < chunks.length
              ? { done: false, value: chunks[index++] }
              : { done: true, value: undefined },
        }),
      },
    } as unknown as Response;
  }

  const event = (name: string, data: object) =>
    `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

  it("hands a finished turn over and clears, so the thread shows one copy of it", async () => {
    const answered: QaAnsweredTurn[] = [];
    const citation = { chunkIndex: 0, pageFrom: 1, pageTo: 1, quote: "q", score: 1 };
    const fetcher = jest.fn(async () =>
      streamOf(
        event("citations", { citations: [citation] }),
        event("answer-token", { text: "Hallo" }),
        event("done", {
          status: "answered",
          answer: "Hallo Welt",
          citations: [citation],
          historyEntryId: "entry-1",
        }),
      ),
    );
    const { result } = await renderHook(() =>
      useDocumentQa(fetcher, "d-1", (turn) => answered.push(turn)),
    );

    await act(async () => {
      await result.current.ask("Was?");
    });

    expect(answered).toEqual([
      {
        question: "Was?",
        answer: "Hallo Welt",
        citations: [citation],
        historyEntryId: "entry-1",
        status: "answered",
      },
    ]);
    expect(result.current.status).toBe("idle");
    expect(result.current.question).toBeNull();
    expect(result.current.answerText).toBe("");
  });

  it("keeps what arrived when the stream ends without a done event", async () => {
    const answered: QaAnsweredTurn[] = [];
    const fetcher = jest.fn(async () => streamOf(event("answer-token", { text: "Teil" })));
    const { result } = await renderHook(() =>
      useDocumentQa(fetcher, "d-1", (turn) => answered.push(turn)),
    );

    await act(async () => {
      await result.current.ask("Was?");
    });

    expect(answered.map((turn) => turn.answer)).toEqual(["Teil"]);
    expect(result.current.status).toBe("idle");
  });

  it("leaves a failed question in place to retry when nothing arrived", async () => {
    const answered: QaAnsweredTurn[] = [];
    const fetcher = jest.fn(async () => streamOf());
    const { result } = await renderHook(() =>
      useDocumentQa(fetcher, "d-1", (turn) => answered.push(turn)),
    );

    await act(async () => {
      await result.current.ask("Was?");
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.question).toBe("Was?");
    expect(answered).toEqual([]);
  });

  it("reports the server's error rather than an answer", async () => {
    const answered: QaAnsweredTurn[] = [];
    const fetcher = jest.fn(async () => streamOf(event("error", { message: "Provider down" })));
    const { result } = await renderHook(() =>
      useDocumentQa(fetcher, "d-1", (turn) => answered.push(turn)),
    );

    await act(async () => {
      await result.current.ask("Was?");
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toBe("Provider down");
    expect(answered).toEqual([]);
  });
});
