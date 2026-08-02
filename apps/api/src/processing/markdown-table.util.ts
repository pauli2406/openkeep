/** A markdown pipe-table row (data or separator), as emitted by Mistral OCR. */
export const isMarkdownTableRow = (line: string): boolean =>
  line.startsWith("|") && line.endsWith("|");

/**
 * Splits a pipe row into cell texts. Only UNESCAPED pipes separate columns: a cell
 * like `A \| B` is one column, not two, and the escape character does not survive
 * into the cell text.
 */
export const splitMarkdownTableRow = (line: string): string[] =>
  line
    .trim()
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, "|").trim());

/** True for the `|---|---|` row that separates a markdown header from its body. */
export const isMarkdownTableSeparatorRow = (cells: string[]): boolean =>
  cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));

/**
 * Comparable signature of a table row, used to recognize the markdown rows a parse
 * provider already normalized into `ParsedDocumentTable` cells. Serialized rather
 * than joined on a separator so cell boundaries cannot be forged by cell text.
 *
 * Trailing empty cells are ignored: a ragged table (a two-cell header above
 * three-cell body rows) is padded to the widest row in the normalized model, while
 * the source line still carries only its original cells.
 */
export const buildTableRowSignature = (cells: string[]): string => {
  const normalized = cells.map((cell) => cell.trim().toLowerCase());
  while (normalized.length > 0 && normalized[normalized.length - 1] === "") {
    normalized.pop();
  }
  return JSON.stringify(normalized);
};

/** Escapes a cell so a pipe inside its text cannot open another column. */
export const escapeMarkdownTableCell = (text: string): string => text.replace(/\|/g, "\\|");
