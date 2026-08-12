import { useCallback, useRef, useState } from "react";
import type { AnswerCitation, AnswerHistoryTurn, AnswerQueryResponse } from "../lib";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StreamStatus = "idle" | "searching" | "streaming" | "done" | "error";

export type StreamState = {
  status: StreamStatus;
  /** Semantic outcome from the server's `done` event (a refusal streams text). */
  answerStatus: "answered" | "insufficient_evidence" | null;
  lowConfidence: boolean;
  route: AnswerQueryResponse["route"] | null;
  answerText: string;
  citations: AnswerCitation[];
  searchResults: Array<{
    document: { id: string; title: string };
    score: number;
  }>;
  structuredData: AnswerQueryResponse["structuredData"];
  /** Label of the tool the agent is currently running, for a progress line. */
  toolStatus: string | null;
  errorMessage: string | null;
};

const INITIAL_STATE: StreamState = {
  status: "idle",
  answerStatus: null,
  lowConfidence: false,
  route: null,
  answerText: "",
  citations: [],
  searchResults: [],
  structuredData: null,
  toolStatus: null,
  errorMessage: null,
};

// ---------------------------------------------------------------------------
// Hook
//
// Requires `streamFetch` from the auth context – this must use Expo's native
// fetch (`expo/fetch`) so that `response.body` provides a `ReadableStream`.
// The default RN global fetch (whatwg-fetch) does NOT support streaming.
// ---------------------------------------------------------------------------

export function useAnswerStream(
  streamFetch: (path: string, init?: RequestInit) => Promise<Response>,
) {
  const [state, setState] = useState<StreamState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const startStream = useCallback(
    async (query: string, history?: AnswerHistoryTurn[]) => {
      // Abort any previous stream
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ ...INITIAL_STATE, status: "searching" });

      try {
        const response = await streamFetch("/api/search/answer/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            // Last turns of the visible thread so follow-ups resolve server-side.
            ...(history && history.length > 0 ? { history: history.slice(-6) } : {}),
            maxDocuments: 5,
            maxCitations: 6,
            maxChunkMatches: 6,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body – streaming not supported");

        const decoder = new TextDecoder();
        let buffer = "";

        // Persistent across processLines calls — event: and data: may arrive
        // in different network chunks, so we need to carry the current event
        // type between calls.
        let currentEvent = "";

        // Helper: process a batch of SSE lines
        const processLines = (lines: string[]) => {
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              const data = line.slice(6);
              try {
                const parsed = JSON.parse(data);

                if (currentEvent === "search-results") {
                  setState((s) => ({
                    ...s,
                    status: "streaming",
                    searchResults: parsed.results ?? [],
                  }));
                } else if (currentEvent === "answer-token") {
                  setState((s) => ({
                    ...s,
                    status: "streaming",
                    answerText: s.answerText + (parsed.text ?? ""),
                  }));
                } else if (currentEvent === "tool-status") {
                  setState((s) => ({
                    ...s,
                    status: "streaming",
                    toolStatus: parsed.status === "started" ? (parsed.label ?? null) : null,
                  }));
                } else if (currentEvent === "done") {
                  setState((s) => ({
                    ...s,
                    status: "done",
                    answerStatus: parsed.status ?? s.answerStatus,
                    lowConfidence: parsed.lowConfidence ?? s.lowConfidence,
                    route: parsed.route ?? s.route,
                    citations: parsed.citations ?? s.citations,
                    answerText: parsed.fullAnswer ?? s.answerText,
                    structuredData: parsed.structuredData ?? s.structuredData,
                    toolStatus: null,
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

          // Expo's native fetch may yield strings or Uint8Array
          const chunk =
            typeof value === "string" ? value : decoder.decode(value, { stream: true });

          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          processLines(lines);
        }

        // Process any remaining data left in the buffer after the stream ends
        if (buffer.trim().length > 0) {
          const remainingLines = buffer.split("\n");
          processLines(remainingLines);
        }

        // Safety: if the stream ended but we never received a `done` event,
        // force the status to "done" so the UI stops showing the loading state
        setState((s) => {
          if (s.status === "streaming" || s.status === "searching") {
            return { ...s, status: "done" };
          }
          return s;
        });
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Also catch Expo's abort error which may differ
        if (
          err instanceof Error &&
          (err.name === "AbortError" || err.message.includes("aborted"))
        ) {
          return;
        }
        setState((s) => ({
          ...s,
          status: "error",
          errorMessage: err instanceof Error ? err.message : "Stream failed",
        }));
      }
    },
    [streamFetch],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState((s) => ({ ...s, status: s.status === "idle" ? "idle" : "done" }));
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  return { ...state, startStream, cancel, reset };
}
