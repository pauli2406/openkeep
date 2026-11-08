import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentAskCitation } from "../lib";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** `loading` until the first event arrives, so the two read as different steps. */
export type QaStreamStatus = "idle" | "loading" | "streaming" | "error";

export type QaStreamState = {
  status: QaStreamStatus;
  /** The turn in flight, and the failed one until it is retried. */
  question: string | null;
  answerText: string;
  citations: DocumentAskCitation[];
  errorMessage: string | null;
};

const INITIAL_STATE: QaStreamState = {
  status: "idle",
  question: null,
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
//   done          → { status, answer, citations, historyEntryId }
//   error         → { message: string }
// ---------------------------------------------------------------------------

export type QaAnsweredTurn = {
  question: string;
  answer: string;
  citations: DocumentAskCitation[];
  /** The persisted entry, when the server reported one. */
  historyEntryId: string | null;
  status: "answered" | "insufficient_evidence";
};

export function useDocumentQa(
  streamFetch: (path: string, init?: RequestInit) => Promise<Response>,
  documentId: string,
  /**
   * A finished turn leaves this hook for the persisted history, so the thread
   * only ever shows one copy of it. The server has already saved the entry by
   * the time the `done` event arrives.
   */
  onAnswered?: (turn: QaAnsweredTurn) => void,
) {
  const [state, setState] = useState<QaStreamState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);
  const onAnsweredRef = useRef(onAnswered);
  onAnsweredRef.current = onAnswered;

  // Leaving the screen ends the stream: nobody is reading it any more.
  useEffect(() => () => abortRef.current?.abort(), []);

  const ask = useCallback(
    async (question: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({
        status: "loading",
        question,
        answerText: "",
        citations: [],
        errorMessage: null,
      });

      // Mirrors what `setState` accumulates, because the turn is reported outside it.
      let answer = "";
      let citations: DocumentAskCitation[] = [];
      let finished = false;

      const finish = (
        historyEntryId: string | null,
        status: QaAnsweredTurn["status"],
      ) => {
        finished = true;
        onAnsweredRef.current?.({ question, answer, citations, historyEntryId, status });
        setState(INITIAL_STATE);
      };

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
                  citations = parsed.citations ?? [];
                  setState((s) => ({ ...s, status: "streaming", citations }));
                } else if (currentEvent === "answer-token") {
                  answer += parsed.text ?? "";
                  setState((s) => ({ ...s, status: "streaming", answerText: answer }));
                } else if (currentEvent === "done") {
                  answer = parsed.answer ?? answer;
                  citations = parsed.citations ?? citations;
                  finish(
                    typeof parsed.historyEntryId === "string" ? parsed.historyEntryId : null,
                    parsed.status === "insufficient_evidence"
                      ? "insufficient_evidence"
                      : "answered",
                  );
                } else if (currentEvent === "error") {
                  finished = true;
                  setState((s) => ({
                    ...s,
                    status: "error",
                    errorMessage: parsed.message ?? null,
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

        // The stream ended without a `done` event. What arrived is still an answer;
        // nothing at all is a failure, and the screen says so in its own words.
        if (!finished) {
          if (answer) {
            finish(null, "answered");
          } else {
            setState((s) => ({ ...s, status: "error", errorMessage: null }));
          }
        }
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
          errorMessage: err instanceof Error ? err.message : null,
        }));
      }
    },
    [streamFetch, documentId],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  return { ...state, ask, reset };
}
