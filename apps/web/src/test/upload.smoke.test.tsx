import { fireEvent, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { apiUrl } from "./api-url";
import { renderAuthenticatedApp } from "./render-app";
import { makeDocument } from "./fixtures";
import { server } from "./msw-server";

// The import screen uploads as soon as files are picked and shows a
// per-file stage row; the watch-folder line hides when unconfigured.
function mockImportBasics() {
  server.use(
    // #91: status comes from a read-only endpoint now, not a dry-run scan.
    http.get(apiUrl("/api/archive/watch-folder"), () =>
      HttpResponse.json({
        configured: false,
        configuredPath: null,
        lastScan: null,
        lastImport: null,
        history: [],
      }),
    ),
    http.get(apiUrl("/api/documents/:id"), () =>
      HttpResponse.json(makeDocument({ status: "pending" })),
    ),
  );
}

describe("upload smoke", () => {
  it("uses the host picker and feeds native files into the shared queue", async () => {
    const originalFetch = globalThis.fetch;
    const uploaded: string[] = [];
    mockImportBasics();
    server.use(
      http.post(apiUrl("/api/documents"), () =>
        HttpResponse.json(
          { id: "11111111-1111-1111-1111-111111111111", duplicateOf: null },
          { status: 201 },
        ),
      ),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      if (typeof input === "string" && input.endsWith("/api/documents")) {
        const file = init?.body instanceof FormData ? init.body.get("file") : null;
        if (file && typeof file !== "string") uploaded.push(file.name);
      }
      return originalFetch(input, init);
    });
    const pickFiles = vi.fn(async () => ({
      files: [
        {
          id: "native-one",
          name: "native-invoice.pdf",
          mimeType: "application/pdf",
          size: 6,
          bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
        },
      ],
      rejected: [],
    }));

    const { user } = renderAuthenticatedApp({
      route: "/upload",
      hostImports: {
        pickFiles,
        takePending: () => ({ files: [], rejected: [] }),
        subscribe: () => () => undefined,
      },
    });

    await user.click(await screen.findByRole("button", { name: /drop files here/i }));
    await waitFor(() => expect(uploaded).toEqual(["native-invoice.pdf"]));
    expect(pickFiles).toHaveBeenCalledOnce();
    expect(screen.getByText("native-invoice.pdf")).toBeInTheDocument();
  });

  it("shows host rejections and consumes warm open-with deliveries exactly once", async () => {
    mockImportBasics();
    let listener: (() => void) | undefined;
    let pending = {
      files: [] as Array<{
        id: string;
        name: string;
        mimeType: string;
        size: number;
        bytes: Uint8Array;
      }>,
      rejected: [] as Array<{ id: string; name: string; message: string }>,
    };
    const takePending = vi.fn(() => {
      const delivery = pending;
      pending = { files: [], rejected: [] };
      return delivery;
    });
    renderAuthenticatedApp({
      route: "/upload",
      hostImports: {
        pickFiles: async () => ({ files: [], rejected: [] }),
        takePending,
        subscribe: (next) => {
          listener = next;
          return () => {
            listener = undefined;
          };
        },
      },
    });
    await screen.findByRole("heading", { name: /import documents/i });

    pending = {
      files: [],
      rejected: [
        {
          id: "rejected-one",
          name: "script.exe",
          message: "Unsupported file type.",
        },
      ],
    };
    listener?.();

    expect(await screen.findByText("script.exe")).toBeInTheDocument();
    expect(screen.getByText("Unsupported file type.")).toBeInTheDocument();
    expect(takePending).toHaveBeenCalledTimes(2);
  });

  it("queues files, sends multipart uploads with auth, and shows a processing row", async () => {
    const originalFetch = globalThis.fetch;
    const fetchCalls: Array<{
      authorization: string | null;
      fileName: string | null;
    }> = [];

    mockImportBasics();
    server.use(
      http.post(apiUrl("/api/documents"), () =>
        HttpResponse.json({ id: "11111111-1111-1111-1111-111111111111" }, { status: 201 }),
      ),
    );

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      if (typeof input === "string" && input.endsWith("/api/documents")) {
        const headers = new Headers(init?.headers);
        const body = init?.body;
        const formData = body instanceof FormData ? body : null;
        const file = formData?.get("file");
        fetchCalls.push({
          authorization: headers.get("authorization"),
          fileName: file instanceof File ? file.name : null,
        });
      }
      return originalFetch(input, init);
    });

    const { container } = renderAuthenticatedApp({ route: "/upload" });

    await screen.findByRole("heading", { name: /import documents/i });

    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();

    fireEvent.change(input as HTMLInputElement, {
      target: {
        files: [new File(["invoice"], "invoice.pdf", { type: "application/pdf" })],
      },
    });

    // upload starts immediately — no separate button
    await waitFor(() => {
      expect(fetchCalls).toHaveLength(1);
    });
    expect(fetchCalls[0]).toEqual({
      authorization: "Bearer access-token",
      fileName: "invoice.pdf",
    });

    // the file gets its own queue row with a stage badge
    expect(await screen.findByText("invoice.pdf")).toBeInTheDocument();
    expect(await screen.findByText("Processing")).toBeInTheDocument();
  });

  it("shows per-file error messages with a Retry when an upload fails", async () => {
    mockImportBasics();
    server.use(
      http.post(apiUrl("/api/documents"), () =>
        HttpResponse.json({ message: ["Unsupported file type"] }, { status: 400 }),
      ),
    );

    const { container } = renderAuthenticatedApp({ route: "/upload" });

    await screen.findByRole("heading", { name: /import documents/i });

    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: {
        files: [new File(["bad"], "bad.pdf", { type: "application/pdf" })],
      },
    });

    expect(await screen.findByText("Unsupported file type")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("shows payload-too-large errors from the API", async () => {
    mockImportBasics();
    server.use(
      http.post(apiUrl("/api/documents"), () =>
        HttpResponse.text("request file too large", { status: 413 }),
      ),
    );

    const { container } = renderAuthenticatedApp({ route: "/upload" });

    await screen.findByRole("heading", { name: /import documents/i });

    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: {
        files: [new File(["large"], "large.pdf", { type: "application/pdf" })],
      },
    });

    expect(await screen.findByText("request file too large")).toBeInTheDocument();
  });

  it("reads watch-folder status without triggering a scan, and shows the path", async () => {
    const scanCalls: string[] = [];
    server.use(
      http.get(apiUrl("/api/documents/:id"), () =>
        HttpResponse.json(makeDocument({ status: "pending" })),
      ),
      // #91: the page must never reach for the scan endpoint, which walks the
      // folder and writes an audit entry.
      http.post(apiUrl("/api/archive/watch-folder/scan"), () => {
        scanCalls.push("scan");
        return HttpResponse.json({});
      }),
      http.get(apiUrl("/api/archive/watch-folder"), () =>
        HttpResponse.json({
          configured: true,
          configuredPath: "/srv/watch",
          lastScan: { scannedAt: "2026-03-22T09:00:00.000Z", imported: 3, dryRun: false },
          lastImport: { scannedAt: "2026-03-22T09:00:00.000Z", imported: 3, dryRun: false },
          history: [
            { scannedAt: "2026-03-22T09:00:00.000Z", imported: 3, dryRun: false },
          ],
        }),
      ),
    );

    renderAuthenticatedApp({ route: "/upload" });

    expect(await screen.findByText("/srv/watch")).toBeInTheDocument();
    expect(scanCalls).toEqual([]);
  });

  it("marks content already in the archive as a duplicate and links to it", async () => {
    mockImportBasics();
    server.use(
      // #92: the upload still creates a document; `duplicateOf` is how the
      // client learns the same bytes were already filed.
      http.post(apiUrl("/api/documents"), () =>
        HttpResponse.json(
          {
            id: "99999999-9999-9999-9999-999999999999",
            duplicateOf: {
              id: "11111111-1111-1111-1111-111111111111",
              title: "March Invoice",
              createdAt: "2026-03-01T09:00:00.000Z",
            },
          },
          { status: 201 },
        ),
      ),
    );

    const { container } = renderAuthenticatedApp({ route: "/upload" });
    await screen.findByRole("heading", { name: /import documents/i });

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [new File(["dup"], "dup.pdf", { type: "application/pdf" })],
      },
    });

    expect(await screen.findByText(/already in/i)).toBeInTheDocument();
    await waitFor(() => {
      const link = container.querySelector(
        'a[href="/documents/11111111-1111-1111-1111-111111111111"]',
      );
      expect(link).not.toBeNull();
    });
  });
});
