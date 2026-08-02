/** A markdown pipe-table row (data or separator), as emitted by Mistral OCR. */
export const isMarkdownTableRow = (line: string): boolean =>
  line.startsWith("|") && line.endsWith("|");
