/**
 * Usage-based citation filtering: the model cites excerpts inline as [n], so
 * after a stream completes the full answer tells us which of the prompted
 * excerpts were actually used. Citations returned to clients carry that as a
 * `used` flag — the UI renders used sources prominently and collapses the
 * rest, instead of presenting every retrieved chunk as a source.
 */

/** 1-3 digits: excerpt numbering never exceeds double digits in practice. */
const CITATION_MARKER_PATTERN = /\[(\d{1,3})\]/g;

export function extractCitedIndices(answer: string | null | undefined): Set<number> {
  const indices = new Set<number>();
  if (!answer) {
    return indices;
  }
  for (const match of answer.matchAll(CITATION_MARKER_PATTERN)) {
    const value = Number(match[1]);
    // Excerpt numbering is 1-based; [0] is array-index prose, not a citation.
    if (value >= 1) {
      indices.add(value);
    }
  }
  return indices;
}

export function annotateCitationUsage<T extends { index?: number }>(
  citations: T[],
  answer: string | null | undefined,
): Array<T & { used: boolean }> {
  const cited = extractCitedIndices(answer);
  return citations.map((citation) => ({
    ...citation,
    used: citation.index !== undefined && cited.has(citation.index),
  }));
}

/**
 * Annotates usage and caps the payload: used citations always survive
 * (dropping one would leave its [n] marker unresolvable); unused ones fill up
 * to `maxCitations` total as collapsed "further matches" material.
 */
export function finalizeCitations<T extends { index?: number }>(
  citations: T[],
  answer: string | null | undefined,
  maxCitations: number,
): Array<T & { used: boolean }> {
  const annotated = annotateCitationUsage(citations, answer);
  const used = annotated.filter((citation) => citation.used);
  const unused = annotated.filter((citation) => !citation.used);
  const unusedBudget = Math.max(0, maxCitations - used.length);
  const kept = [...used, ...unused.slice(0, unusedBudget)];
  // Preserve excerpt order so numbering stays monotonic in the UI.
  return kept.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

/**
 * Sentence-boundary-aware quote truncation. No ellipsis is appended: clients
 * match the quote verbatim against document text to jump to the passage.
 */
export function buildCitationQuote(text: string, maxLength = 280): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const window = normalized.slice(0, maxLength);
  const sentenceEnd = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
  );
  if (sentenceEnd > maxLength * 0.5) {
    return window.slice(0, sentenceEnd + 1);
  }

  const wordEnd = window.lastIndexOf(" ");
  return (wordEnd > maxLength * 0.5 ? window.slice(0, wordEnd) : window).trimEnd();
}
