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
 * provider already normalized into `ParsedDocumentTable` cells. Joined on a control
 * character so cell boundaries cannot be forged by the cell text itself.
 */
export const buildTableRowSignature = (cells: string[]): string =>
  cells.map((cell) => cell.trim().toLowerCase()).join("\u0001");

/** Escapes a cell so a pipe inside its text cannot open another column. */
export const escapeMarkdownTableCell = (text: string): string => text.replace(/\|/g, "\\|");
