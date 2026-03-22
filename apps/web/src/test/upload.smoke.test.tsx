import { fireEvent, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { apiUrl } from "./api-url";
import { renderAuthenticatedApp } from "./render-app";
import { server } from "./msw-server";

describe("upload smoke", () => {
  it("queues files, sends multipart uploads with auth, and shows success state", async () => {
    const originalFetch = globalThis.fetch;
    const fetchCalls: Array<{
      authorization: string | null;
      title: string | null;
      fileName: string | null;
    }> = [];

    server.use(
      http.post(apiUrl("/api/documents"), () =>
        HttpResponse.json(
          { id: "uploaded-document-id" },
          { status: 201 },
        ),
      ),
    );

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      if (typeof input === "string" && input === "/api/documents") {
        const headers = new Headers(init?.headers);
        const body = init?.body;
        const formData = body instanceof FormData ? body : null;
        const file = formData?.get("file");

        fetchCalls.push({
          authorization: headers.get("authorization"),
          title: typeof formData?.get("title") === "string"
            ? (formData.get("title") as string)
            : null,
          fileName: file instanceof File ? file.name : null,
        });
      }

      return originalFetch(input, init);
    });

    const { container, user } = renderAuthenticatedApp({
      route: "/upload",
    });

    await screen.findByRole("heading", { name: /upload documents/i });

    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();

    fireEvent.change(input as HTMLInputElement, {
      target: {
        files: [new File(["invoice"], "invoice.pdf", { type: "application/pdf" })],
      },
    });

    await user.type(
      screen.getByLabelText(/title override \(optional\)/i),
      "Custom Invoice",
    );
    await user.click(screen.getByRole("button", { name: /upload 1 file/i }));

    await waitFor(() => {
      expect(fetchCalls).toHaveLength(1);
    });

    expect(await screen.findByText("Upload complete")).toBeInTheDocument();

    expect(fetchCalls[0]).toEqual({
      authorization: "Bearer access-token",
      title: "Custom Invoice",
      fileName: "invoice.pdf",
    });
  });

  it("shows per-file error messages when an upload fails", async () => {
    server.use(
      http.post(apiUrl("/api/documents"), () =>
        HttpResponse.json(
          { message: ["Unsupported file type"] },
          { status: 400 },
        ),
      ),
    );

    const { container, user } = renderAuthenticatedApp({
      route: "/upload",
    });

    await screen.findByRole("heading", { name: /upload documents/i });

    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();

    fireEvent.change(input as HTMLInputElement, {
      target: {
        files: [new File(["bad"], "bad.pdf", { type: "application/pdf" })],
      },
    });
    await user.click(screen.getByRole("button", { name: /upload 1 file/i }));

    expect(await screen.findByText("Unsupported file type")).toBeInTheDocument();
  });
});
