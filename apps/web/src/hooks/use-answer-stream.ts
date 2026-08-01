import { useCallback, useRef, useState } from "react";
import type {
  AnswerCitation,
  Document,
  DashboardDeadlineItem,
  SemanticSearchResult,
} from "@openkeep/types";

type AnswerRoute = "semantic" | "structured" | "hybrid";
type AnswerStructuredData =
  | {
      kind: "deadline_items";
      title: string;
      description: string | null;
      items: DashboardDeadlineItem[];
      totalOpenCount: number;
      totalAmount: number | null;
      currency: string | null;
      windowStart: string | null;
      windowEnd: string | null;
    }
  | {
      kind: "pending_review_documents" | "expiring_contracts";
      title: string;
      description: string | null;
      items: Document[];
      totalCount: number;
      windowStart?: string | null;
      windowEnd?: string | null;
    };
import { createSseParser, linkifyAnswerCitations } from "@openkeep/sdk";

import { authFetch } from "@/lib/api";

// ---------------------------------------------------------------------------
// Inline citation linking
// ---------------------------------------------------------------------------

/**
 * Rewrites inline citation markers into /documents/{id} links. The model cites
 * by excerpt number ([1], [2][4]) which resolves EXACTLY against the citation
 * payload's index — the previous fuzzy title matching could link the wrong
 * document. The legacy [Document: "Title", Page: N] format is still rendered
 * for one release via the shared SDK helper.
 */
export function linkifyCitations(
  text: string,
  citations: AnswerCitation[],
  _searchResults: SemanticSearchResult[],
): string {
  if (citations.length === 0) return text;
  return linkifyAnswerCitations(text, citations, (documentId) => `/documents/${documentId}`);
}

// ---------------------------------------------------------------------------
// SSE stream hook for AI answers
// ---------------------------------------------------------------------------

export type StreamState = {
  status: "idle" | "searching" | "streaming" | "done" | "error";
  /**
   * Semantic outcome from the server's `done` event, independent of the transport
   * status above. A refusal streams real text, so answerText alone cannot tell an
   * answer apart from an "insufficient evidence" response.
   */
  answerStatus: "answered" | "insufficient_evidence" | null;
  lowConfidence: boolean;
  route: AnswerRoute | null;
  answerText: string;
  citations: AnswerCitation[];
  searchResults: SemanticSearchResult[];
  structuredData: AnswerStructuredData | null;
  /** True when the answer was generated from sub-threshold (near-miss) evidence. */
  lowConfidence: boolean;
  errorMessage: string | null;
};

export function useAnswerStream() {
  const [state, setState] = useState<StreamState>({
    status: "idle",
    answerStatus: null,
    lowConfidence: false,
    route: null,
    answerText: "",
    citations: [],
    searchResults: [],
    structuredData: null,
    lowConfidence: false,
    errorMessage: null,
  });

  const abortRef = useRef<AbortController | null>(null);

  const startStream = useCallback(async (query: string) => {
    // Abort any previous stream
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({
      status: "searching",
      answerStatus: null,
      lowConfidence: false,
      route: null,
      answerText: "",
      citations: [],
      searchResults: [],
      structuredData: null,
      lowConfidence: false,
      errorMessage: null,
    });

    try {
      const response = await authFetch("/api/search/answer/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
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
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      const parser = createSseParser((event, data) => {
        try {
          const parsed = JSON.parse(data);

          if (event === "search-results") {
            setState((s) => ({
              ...s,
              status: "streaming",
              searchResults: parsed.results ?? [],
            }));
          } else if (event === "answer-token") {
            setState((s) => ({
              ...s,
              status: "streaming",
              answerText: s.answerText + (parsed.text ?? ""),
            }));
          } else if (event === "done") {
            setState((s) => ({
              ...s,
              status: "done",
              answerStatus: parsed.status ?? s.answerStatus,
              lowConfidence: parsed.lowConfidence ?? s.lowConfidence,
              route: parsed.route ?? s.route,
              citations: parsed.citations ?? s.citations,
              answerText: parsed.fullAnswer ?? s.answerText,
              structuredData: parsed.structuredData ?? s.structuredData,
              lowConfidence: parsed.lowConfidence ?? false,
            }));
          } else if (event === "error") {
            setState((s) => ({
              ...s,
              status: "error",
              errorMessage: parsed.message ?? "Unknown error",
            }));
          }
        } catch {
          // skip malformed JSON
        }
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.flush();

      // Safety: if the stream ended but we never received a `done` event,
      // force the status to "done" so the UI stops showing the loading state
      setState((s) =>
        s.status === "streaming" || s.status === "searching"
          ? { ...s, status: "done" }
          : s,
      );
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setState((s) => ({
        ...s,
        status: "error",
        errorMessage: err instanceof Error ? err.message : "Stream failed",
      }));
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState((s) => ({ ...s, status: s.status === "idle" ? "idle" : "done" }));
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState({
      status: "idle",
      answerStatus: null,
      lowConfidence: false,
      route: null,
      answerText: "",
      citations: [],
      searchResults: [],
      structuredData: null,
      lowConfidence: false,
      errorMessage: null,
    });
  }, []);

  return { ...state, startStream, cancel, reset };
}
