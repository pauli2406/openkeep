import type { AnswerCitation } from "@openkeep/types";

/**
 * Rewrites the model's inline citation markers into markdown links.
 *
 * Primary format: numbered markers ([1], [2][4]) resolved EXACTLY against the
 * citation payload's `index` field — no guessing possible. The legacy
 * [Document: "Title", Page: N] format stays supported for one release as a
 * fallback renderer (old fuzzy token-overlap matching could link the WRONG
 * document; the legacy path now only accepts exact or substring title matches).
 */
export const linkifyAnswerCitations = (
  text: string,
  citations: AnswerCitation[],
  buildHref: (documentId: string) => string,
): string => {
  const byIndex = new Map<number, AnswerCitation>();
  for (const citation of citations) {
    if (typeof citation.index === "number" && !byIndex.has(citation.index)) {
      byIndex.set(citation.index, citation);
    }
  }

  let result = text.replace(/\[(\d{1,2})\]/g, (marker, digits: string) => {
    const citation = byIndex.get(Number(digits));
    if (!citation) {
      return marker;
    }
    const pageSuffix = citation.pageFrom ? `, p.${citation.pageFrom}` : "";
    return `[[${digits}${pageSuffix}]](${buildHref(citation.documentId)})`;
  });

  // Legacy inline format fallback (exact/substring title match only).
  result = result.replace(
    /\[Document:\s*"([^"]+)"(?:,\s*Page:\s*(\d+))?\]/g,
    (marker, title: string, page: string | undefined) => {
      const normalizedTitle = title.trim().toLowerCase();
      const citation =
        citations.find((c) => c.documentTitle.trim().toLowerCase() === normalizedTitle) ??
        citations.find((c) =>
          c.documentTitle.trim().toLowerCase().includes(normalizedTitle),
        );
      if (!citation) {
        return marker;
      }
      const pageSuffix = page ? `, p.${page}` : "";
      const ordinal = citation.index ?? citations.indexOf(citation) + 1;
      return `[[${ordinal}${pageSuffix}]](${buildHref(citation.documentId)})`;
    },
  );

  return result;
};
