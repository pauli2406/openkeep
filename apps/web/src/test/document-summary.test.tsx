import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentSummarySection } from "@/components/document-detail/summary-section";
import { I18nProvider } from "@/lib/i18n";

describe("document summary streaming", () => {
  it("shows incremental summary chunks and terminal provider metadata", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, {
        headers: { "content-type": "text/event-stream" },
      }),
    );
    render(
      <I18nProvider language="en">
        <DocumentSummarySection documentId="11111111-1111-4111-8111-111111111111" />
      </I18nProvider>,
    );
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledOnce());

    await act(async () => {
      controller!.enqueue(
        new TextEncoder().encode(
          'event: summary-token\ndata: {"text":"Invoice "}\n\n',
        ),
      );
    });
    expect(await screen.findByText("Invoice")).toBeInTheDocument();

    await act(async () => {
      controller!.enqueue(
        new TextEncoder().encode(
          [
            "event: done\n",
            'data: {"summary":"Invoice due Friday.","provider":"openai","model":"gpt-test"}\n\n',
          ].join(""),
        ),
      );
      controller!.close();
    });
    expect(await screen.findByText("Invoice due Friday.")).toBeInTheDocument();
    expect(screen.getByText("Provider: openai / gpt-test")).toBeInTheDocument();
  });

  it("aborts summary generation when the document view unmounts", async () => {
    let signal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    });
    const { unmount } = render(
      <I18nProvider language="en">
        <DocumentSummarySection documentId="11111111-1111-4111-8111-111111111111" />
      </I18nProvider>,
    );
    await waitFor(() => expect(signal).toBeDefined());

    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
