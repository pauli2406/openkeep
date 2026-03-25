import { useCallback, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SummaryStreamStatus = "idle" | "streaming" | "done" | "error";

export type SummaryStreamState = {
  status: SummaryStreamStatus;
  summaryText: string;
  provider: string | null;
  model: string | null;
  generatedAt: string | null;
  isCached: boolean;
  errorMessage: string | null;
};

const INITIAL_STATE: SummaryStreamState = {
  status: "idle",
  summaryText: "",
  provider: null,
  model: null,
  generatedAt: null,
  isCached: false,
  errorMessage: null,
};

// ---------------------------------------------------------------------------
// Hook
//
// Streams a summary via POST /api/documents/:id/summarize/stream
//
// SSE events:
//   cached        → { summary, provider, model, generatedAt } (full summary at once)
//   summary-token → { text: string }                          (streaming token)
//   done          → { summary, provider, model, generatedAt }
//   error         → { message: string }
// ---------------------------------------------------------------------------

export function useDocumentSummary(
  streamFetch: (path: string, init?: RequestInit) => Promise<Response>,
  documentId: string,
) {
  const [state, setState] = useState<SummaryStreamState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(
    async (force = false) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({
        status: "streaming",
        summaryText: "",
        provider: null,
        model: null,
        generatedAt: null,
        isCached: false,
        errorMessage: null,
      });

      try {
        const response = await streamFetch(
          `/api/documents/${documentId}/summarize/stream`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ force }),
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

                if (currentEvent === "cached") {
                  setState({
                    status: "done",
                    summaryText: parsed.summary ?? "",
                    provider: parsed.provider ?? null,
                    model: parsed.model ?? null,
                    generatedAt: parsed.generatedAt ?? null,
                    isCached: true,
                    errorMessage: null,
                  });
                } else if (currentEvent === "summary-token") {
                  setState((s) => ({
                    ...s,
                    summaryText: s.summaryText + (parsed.text ?? ""),
                  }));
                } else if (currentEvent === "done") {
                  setState((s) => ({
                    ...s,
                    status: "done",
                    summaryText: parsed.summary ?? s.summaryText,
                    provider: parsed.provider ?? s.provider,
                    model: parsed.model ?? s.model,
                    generatedAt: parsed.generatedAt ?? s.generatedAt,
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

        // Safety fallback
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

  return { ...state, generate, cancel, reset };
}
