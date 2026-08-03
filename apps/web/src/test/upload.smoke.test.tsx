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
    http.post(apiUrl("/api/archive/watch-folder/scan"), () =>
      HttpResponse.json(
        { message: "WATCH_FOLDER_PATH is not configured" },
        { status: 409 },
      ),
    ),
    http.get(apiUrl("/api/documents/:id"), () =>
      HttpResponse.json(makeDocument({ status: "pending" })),
    ),
  );
}

describe("upload smoke", () => {
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
});
