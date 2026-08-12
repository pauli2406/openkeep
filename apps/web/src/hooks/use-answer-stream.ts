import { useCallback, useEffect, useRef, useState } from "react";
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
      kind: "pending_review_documents" | "expiring_contracts" | "document_table";
      title: string;
      description: string | null;
      items: Document[];
      totalCount: number;
      windowStart?: string | null;
      windowEnd?: string | null;
    };

export type AnswerHistoryTurn = { role: "user" | "assistant"; content: string };
import { linkifyAnswerCitations } from "@openkeep/sdk";

import { authFetch } from "@/lib/api";
import { consumeJsonSseResponse, isAbortError } from "@/lib/sse-stream";

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
  /** Label of the tool the agent is currently running, for a progress line. */
  toolStatus: string | null;
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
    toolStatus: null,
    errorMessage: null,
  });

  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);

  useEffect(
    () => () => {
      generationRef.current += 1;
      abortRef.current?.abort();
    },
    [],
  );

  const startStream = useCallback(async (query: string, history?: AnswerHistoryTurn[]) => {
    // Abort any previous stream
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const update = (updater: (state: StreamState) => StreamState) => {
      if (generation === generationRef.current) setState(updater);
    };

    setState({
      status: "searching",
      answerStatus: null,
      lowConfidence: false,
      route: null,
      answerText: "",
      citations: [],
      searchResults: [],
      structuredData: null,
      toolStatus: null,
      errorMessage: null,
    });

    try {
      const response = await authFetch("/api/search/answer/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          // Last turns of the visible thread; lets the agent resolve follow-ups
          // ("and what about the second one?"). Capped server-side at 12.
          ...(history && history.length > 0 ? { history: history.slice(-6) } : {}),
          maxDocuments: 5,
          maxCitations: 6,
          maxChunkMatches: 6,
        }),
        signal: controller.signal,
      });

      let terminalEvent = false;
      await consumeJsonSseResponse(response, (event, parsed) => {
        if (generation !== generationRef.current) return "stop";
        if (event === "search-results") {
          update((s) => ({
              ...s,
              status: "streaming",
              searchResults: Array.isArray(parsed.results)
                ? (parsed.results as SemanticSearchResult[])
                : [],
          }));
        } else if (event === "answer-token") {
          update((s) => ({
              ...s,
              status: "streaming",
              answerText: s.answerText + (typeof parsed.text === "string" ? parsed.text : ""),
          }));
        } else if (event === "tool-status") {
          update((s) => ({
              ...s,
              status: "streaming",
              toolStatus:
                parsed.status === "started" && typeof parsed.label === "string"
                  ? parsed.label
                  : null,
          }));
        } else if (event === "done") {
          terminalEvent = true;
          update((s) => ({
              ...s,
              status: "done",
              answerStatus:
                parsed.status === "answered" || parsed.status === "insufficient_evidence"
                  ? parsed.status
                  : s.answerStatus,
              lowConfidence:
                typeof parsed.lowConfidence === "boolean"
                  ? parsed.lowConfidence
                  : s.lowConfidence,
              route:
                parsed.route === "semantic" || parsed.route === "structured" || parsed.route === "hybrid"
                  ? parsed.route
                  : s.route,
              citations: Array.isArray(parsed.citations)
                ? (parsed.citations as AnswerCitation[])
                : s.citations,
              answerText: typeof parsed.fullAnswer === "string" ? parsed.fullAnswer : s.answerText,
              structuredData:
                parsed.structuredData && typeof parsed.structuredData === "object"
                  ? (parsed.structuredData as AnswerStructuredData)
                  : s.structuredData,
              toolStatus: null,
          }));
          return "stop";
        } else if (event === "error") {
          terminalEvent = true;
          update((s) => ({
              ...s,
              status: "error",
              errorMessage:
                typeof parsed.message === "string"
                  ? parsed.message
                  : "The archive could not complete the answer.",
          }));
          return "stop";
        }
      });

      if (!terminalEvent && generation === generationRef.current) {
        update((s) => ({
          ...s,
          status: "error",
          errorMessage: "The archive ended the answer stream unexpectedly.",
        }));
      }
    } catch (err: unknown) {
      if (isAbortError(err, controller.signal) || generation !== generationRef.current) return;
      update((s) => ({
        ...s,
        status: "error",
        errorMessage: err instanceof Error ? err.message : "Stream failed",
      }));
    }
  }, []);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    setState((s) => ({ ...s, status: s.status === "idle" ? "idle" : "done" }));
  }, []);

  const reset = useCallback(() => {
    generationRef.current += 1;
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
      toolStatus: null,
      errorMessage: null,
    });
  }, []);

  return { ...state, startStream, cancel, reset };
}
