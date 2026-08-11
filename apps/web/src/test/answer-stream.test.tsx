import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useAnswerStream } from "@/hooks/use-answer-stream";

function sseResponse(body: BodyInit, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
}

function doneEvent(answer: string) {
  return [
    "event: done\r\n",
    `data: ${JSON.stringify({
      status: "answered",
      route: "semantic",
      fullAnswer: answer,
      citations: [],
      structuredData: null,
    })}\r\n\r\n`,
  ].join("");
}

describe("answer streaming", () => {
  it("renders tokens before completion across awkward UTF-8 and SSE chunk boundaries", async () => {
    let streamController:
      | ReadableStreamDefaultController<Uint8Array>
      | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse(body));
    const { result } = renderHook(() => useAnswerStream());

    let request: Promise<void> | undefined;
    act(() => {
      request = result.current.startStream("invoice total");
    });

    const encoder = new TextEncoder();
    const token = encoder.encode(
      'event: answer-token\r\ndata: {"text":"42 €"}\r\n\r\n',
    );
    const euroStart = token.indexOf(0xe2);
    await act(async () => {
      streamController!.enqueue(token.slice(0, euroStart + 1));
      await Promise.resolve();
    });
    expect(result.current.answerText).toBe("");

    await act(async () => {
      streamController!.enqueue(token.slice(euroStart + 1));
    });
    await waitFor(() => expect(result.current.answerText).toBe("42 €"));
    expect(result.current.status).toBe("streaming");

    await act(async () => {
      streamController!.enqueue(encoder.encode(doneEvent("42 € total")));
      streamController!.close();
      await request;
    });
    expect(result.current.status).toBe("done");
    expect(result.current.answerText).toBe("42 € total");
  });

  it("aborts the prior request and ignores it when a second question starts", async () => {
    const signals: AbortSignal[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      const signal = init?.signal as AbortSignal;
      signals.push(signal);
      if (signals.length === 1) {
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      }
      return Promise.resolve(sseResponse(doneEvent("second answer")));
    });
    const { result } = renderHook(() => useAnswerStream());

    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    act(() => {
      first = result.current.startStream("first question");
    });
    await waitFor(() => expect(signals).toHaveLength(1));
    act(() => {
      second = result.current.startStream("second question");
    });

    await act(async () => {
      await Promise.all([first, second]);
    });
    expect(signals[0]?.aborted).toBe(true);
    expect(result.current.status).toBe("done");
    expect(result.current.answerText).toBe("second answer");
  });

  it("aborts an active request when its renderer unmounts", async () => {
    let requestSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      requestSignal = init?.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    });
    const { result, unmount } = renderHook(() => useAnswerStream());
    act(() => {
      void result.current.startStream("still running");
    });
    await waitFor(() => expect(requestSignal).toBeDefined());

    unmount();
    expect(requestSignal?.aborted).toBe(true);
  });

  it.each([
    [
      sseResponse('event: answer-token\ndata: {"text":\n\n'),
      /malformed answer stream/i,
    ],
    [
      sseResponse('event: answer-token\ndata: {"text":"partial"}\n\n'),
      /ended .* unexpectedly/i,
    ],
    [sseResponse("", 401), /authentication expired/i],
    [sseResponse("", 503), /AI provider .* unavailable/i],
  ])(
    "terminates bad streams with a useful error",
    async (response, message) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
      const { result } = renderHook(() => useAnswerStream());

      await act(async () => {
        await result.current.startStream("broken request");
      });
      expect(result.current.status).toBe("error");
      expect(result.current.errorMessage).toMatch(message);
    },
  );
});
