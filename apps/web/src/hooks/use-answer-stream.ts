import { useCallback, useRef, useState } from "react";
import type { AnswerCitation, SemanticSearchResult } from "@openkeep/types";
import { authFetch } from "@/lib/api";

// ---------------------------------------------------------------------------
// Inline citation linking
// ---------------------------------------------------------------------------

/**
 * Matches LLM-generated inline citations like:
 *   [Document: "Title", Page: 2]
 *   [Document: "Title", Page: 2; Document: "Title2", Page: 3]
 *
 * Replaces them with compact numbered superscript-style markdown links
 * pointing to /documents/{id}. Uses fuzzy title matching so minor LLM
 * paraphrasing or truncation still resolves to the correct document.
 * Falls back to search results when a document isn't in the citations.
 */
export function linkifyCitations(
  text: string,
  citations: AnswerCitation[],
  searchResults: SemanticSearchResult[],
): string {
  if (citations.length === 0 && searchResults.length === 0) return text;

  // Unified lookup entries: { documentId, title }
  type DocRef = { documentId: string; title: string };
  const allDocs: DocRef[] = [];

  // Citations first (preferred — they have page info)
  for (const cit of citations) {
    allDocs.push({ documentId: cit.documentId, title: cit.documentTitle });
  }
  // Search results as fallback
  for (const sr of searchResults) {
    if (!allDocs.some((d) => d.documentId === sr.document.id)) {
      allDocs.push({ documentId: sr.document.id, title: sr.document.title });
    }
  }

  /**
   * Find the best-matching document for a title the LLM produced.
   * Tries (in order): exact match, substring match, token-overlap match.
   */
  function findDoc(title: string): DocRef | undefined {
    const lower = title.toLowerCase();

    // 1. Exact match
    const exact = allDocs.find((d) => d.title.toLowerCase() === lower);
    if (exact) return exact;

    // 2. Substring (handles .pdf suffix, truncation, etc.)
    const substring = allDocs.find((d) => {
      const dt = d.title.toLowerCase();
      return dt.includes(lower) || lower.includes(dt);
    });
    if (substring) return substring;

    // 3. Token overlap — pick the best match above 50%
    const titleTokens = new Set(
      lower
        .replace(/[^a-z0-9äöüß]+/gi, " ")
        .split(/\s+/)
        .filter(Boolean),
    );
    if (titleTokens.size === 0) return undefined;

    let best: DocRef | undefined;
    let bestScore = 0;
    for (const doc of allDocs) {
      const docTokens = new Set(
        doc.title
          .toLowerCase()
          .replace(/[^a-z0-9äöüß]+/gi, " ")
          .split(/\s+/)
          .filter(Boolean),
      );
      let overlap = 0;
      for (const t of titleTokens) {
        if (docTokens.has(t)) overlap++;
      }
      const score = overlap / Math.max(titleTokens.size, docTokens.size);
      if (score > bestScore) {
        bestScore = score;
        best = doc;
      }
    }

    return bestScore >= 0.5 ? best : undefined;
  }

  // Track which document IDs have been assigned a number (for superscript labels)
  const docNumbers = new Map<string, number>();
  let nextNumber = 1;

  const getNumber = (docId: string): number => {
    const existing = docNumbers.get(docId);
    if (existing !== undefined) return existing;
    const n = nextNumber++;
    docNumbers.set(docId, n);
    return n;
  };

  // Match the full [...] citation block (may contain multiple ; separated refs)
  const citationBlockRe =
    /\[(?:Document:\s*"[^"]*"(?:,\s*Page:\s*\d+)?(?:;\s*)?)+\]/g;

  // Match individual refs inside a block
  const singleRefRe = /Document:\s*"([^"]*)"(?:,\s*Page:\s*(\d+))?/g;

  return text.replace(citationBlockRe, (block) => {
    const parts: string[] = [];

    let m: RegExpExecArray | null;
    singleRefRe.lastIndex = 0;
    while ((m = singleRefRe.exec(block)) !== null) {
      const title = m[1]!;
      const page = m[2] ? parseInt(m[2], 10) : null;

      const doc = findDoc(title);

      if (doc) {
        const num = getNumber(doc.documentId);
        const pageLabel = page ? `, p.${page}` : "";
        parts.push(`[\\[${num}${pageLabel}\\]](/documents/${doc.documentId})`);
      } else {
        // No matching document found – keep the raw reference text
        parts.push(`[Document: "${title}"${page ? `, Page: ${page}` : ""}]`);
      }
    }

    return parts.length > 0 ? parts.join(" ") : block;
  });
}

// ---------------------------------------------------------------------------
// SSE stream hook for AI answers
// ---------------------------------------------------------------------------

export type StreamState = {
  status: "idle" | "searching" | "streaming" | "done" | "error";
  answerText: string;
  citations: AnswerCitation[];
  searchResults: SemanticSearchResult[];
  errorMessage: string | null;
};

export function useAnswerStream() {
  const [state, setState] = useState<StreamState>({
    status: "idle",
    answerText: "",
    citations: [],
    searchResults: [],
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
      answerText: "",
      citations: [],
      searchResults: [],
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
              } else if (currentEvent === "done") {
                setState((s) => ({
                  ...s,
                  status: "done",
                  citations: parsed.citations ?? s.citations,
                  answerText: parsed.fullAnswer ?? s.answerText,
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

        buffer += decoder.decode(value, { stream: true });
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
      answerText: "",
      citations: [],
      searchResults: [],
      errorMessage: null,
    });
  }, []);

  return { ...state, startStream, cancel, reset };
}
