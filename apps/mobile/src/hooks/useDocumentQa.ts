import { useCallback, useRef, useState } from "react";
import type { DocumentAskCitation } from "../lib";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QaStreamStatus = "idle" | "streaming" | "done" | "error";

export type QaStreamState = {
  status: QaStreamStatus;
  answerText: string;
  citations: DocumentAskCitation[];
  errorMessage: string | null;
};

const INITIAL_STATE: QaStreamState = {
  status: "idle",
  answerText: "",
  citations: [],
  errorMessage: null,
};

// ---------------------------------------------------------------------------
// Hook
//
// Streams an answer for a per-document question via
// POST /api/documents/:id/ask/stream
//
// SSE events:
//   citations     → { citations: DocumentAskCitation[] }
//   answer-token  → { text: string }
//   done          → { status, answer, citations }
//   error         → { message: string }
// ---------------------------------------------------------------------------

export function useDocumentQa(
  streamFetch: (path: string, init?: RequestInit) => Promise<Response>,
  documentId: string,
) {
  const [state, setState] = useState<QaStreamState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const ask = useCallback(
    async (question: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({
        status: "streaming",
        answerText: "",
        citations: [],
        errorMessage: null,
      });

      try {
        const response = await streamFetch(
          `/api/documents/${documentId}/ask/stream`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question }),
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body – streaming not supported");

        const decoder = new TextDecoder();
        let buffer = "";
        let currentEvent = "";

        const processLines = (lines: string[]) => {
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              const data = line.slice(6);
              try {
                const parsed = JSON.parse(data);

                if (currentEvent === "citations") {
                  setState((s) => ({
                    ...s,
                    citations: parsed.citations ?? [],
                  }));
                } else if (currentEvent === "answer-token") {
                  setState((s) => ({
                    ...s,
                    answerText: s.answerText + (parsed.text ?? ""),
                  }));
                } else if (currentEvent === "done") {
                  setState((s) => ({
                    ...s,
                    status: "done",
                    citations: parsed.citations ?? s.citations,
                    answerText: parsed.answer ?? s.answerText,
                  }));
                } else if (currentEvent === "error") {
                  setState((s) => ({
                    ...s,
                    status: "error",
                    errorMessage: parsed.message ?? "Unknown error",
                  }));
                }
              } catch {
                // skip malformed JSON
              }
              currentEvent = "";
            }
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk =
            typeof value === "string"
              ? value
              : decoder.decode(value, { stream: true });
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          processLines(lines);
        }

        if (buffer.trim().length > 0) {
          processLines(buffer.split("\n"));
        }

        // Safety fallback: force done if stream ended without done event
        setState((s) => {
          if (s.status === "streaming") {
            return { ...s, status: "done" };
          }
          return s;
        });
      } catch (err: unknown) {
        if (
          err instanceof DOMException && err.name === "AbortError"
        ) return;
        if (
          err instanceof Error &&
          (err.name === "AbortError" || err.message.includes("aborted"))
        ) return;

        setState((s) => ({
          ...s,
          status: "error",
          errorMessage: err instanceof Error ? err.message : "Stream failed",
        }));
      }
    },
    [streamFetch, documentId],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState((s) => ({ ...s, status: s.status === "idle" ? "idle" : "done" }));
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  return { ...state, ask, cancel, reset };
}
