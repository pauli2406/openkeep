/**
 * The omnibar's rows and the citation preview's text, as data, so the groups and
 * the `>` command mode can be tested without mounting a modal.
 */
import type { DocumentFilters, DocumentTextResponse, FacetsResponse } from "../../lib";
import type { TranslationKey } from "../../i18n";
import { fill } from "./conversations";

type Translate = (key: TranslationKey) => string;

export type PaletteSection = "ask" | "recent" | "documents" | "actions" | "jump";

export type PaletteAction =
  | { kind: "ask"; query: string }
  | {
      kind: "tab";
      route: "Today" | "Documents" | "Review" | "Taxes" | "Settings";
      /** What the Documents screen should show when this row lands there. */
      applyFilters?: DocumentFilters;
    }
  | { kind: "scan" }
  | { kind: "document"; documentId: string; title: string };

export type PaletteRow = {
  id: string;
  section: PaletteSection;
  label: string;
  icon: string;
  /** What kind of thing the row is, in words. */
  meta?: string;
  action: PaletteAction;
};

export const PALETTE_SECTIONS: PaletteSection[] = ["ask", "recent", "documents", "actions", "jump"];

export function buildPaletteRows({
  query,
  suggestions,
  recents,
  facets,
  cachedDocuments = [],
  pendingReview = 0,
  online,
  t,
}: {
  query: string;
  suggestions: string[];
  recents: string[];
  facets?: Pick<FacetsResponse, "correspondents" | "documentTypes" | "tags">;
  /** Offline only: what the local copy found for the query. */
  cachedDocuments?: Array<{ id: string; title: string }>;
  pendingReview?: number;
  /** Asking needs the server, so offline there is nothing to ask and no question to repeat. */
  online: boolean;
  t: Translate;
}): PaletteRow[] {
  const commandMode = query.startsWith(">");
  const needle = (commandMode ? query.slice(1) : query).trim().toLowerCase();

  const jump: PaletteRow[] = [
    { id: "go-today", section: "jump", label: t("omnibar.goToday"), icon: "weather-sunset-up", action: { kind: "tab", route: "Today" } },
    { id: "go-documents", section: "jump", label: t("omnibar.goDocuments"), icon: "file-multiple-outline", action: { kind: "tab", route: "Documents" } },
    {
      id: "go-review",
      section: "jump",
      label: `${t("omnibar.goReview")}${pendingReview ? ` · ${pendingReview}` : ""}`,
      icon: "clipboard-check-outline",
      action: { kind: "tab", route: "Review" },
    },
    { id: "go-taxes", section: "jump", label: t("omnibar.goTaxes"), icon: "bank-outline", action: { kind: "tab", route: "Taxes" } },
    { id: "go-import", section: "jump", label: t("omnibar.goImport"), icon: "tray-arrow-up", action: { kind: "scan" } },
    { id: "go-settings", section: "jump", label: t("omnibar.goSettings"), icon: "cog-outline", action: { kind: "tab", route: "Settings" } },
  ];

  if (commandMode) {
    return jump
      .map((row) => ({ ...row, section: "actions" as const }))
      .filter((row) => !needle || row.label.toLowerCase().includes(needle));
  }

  if (!needle) {
    if (!online) {
      return jump.slice(0, 4);
    }
    const suggested = [...new Set(suggestions.slice(0, 3))];
    const recent = [...new Set(recents.slice(0, 2))].filter((entry) => !suggested.includes(entry));
    return [
      ...suggested.map((entry, index): PaletteRow => ({
        id: `ask-${index}`,
        section: "ask",
        label: entry,
        icon: "creation",
        action: { kind: "ask", query: entry },
      })),
      ...recent.map((entry, index): PaletteRow => ({
        id: `recent-${index}`,
        section: "recent",
        label: entry,
        icon: "history",
        action: { kind: "ask", query: entry },
      })),
      ...jump.slice(0, 4),
    ];
  }

  // Type-ahead: the ask row first, then matching taxonomy entries and routes.
  const rows: PaletteRow[] = [];
  if (online) {
    rows.push({
      id: "ask-query",
      section: "ask",
      label: query,
      icon: "creation",
      action: { kind: "ask", query },
    });
  }

  const matches = <T extends { name: string }>(list: T[] | undefined) =>
    (list ?? []).filter((entry) => entry.name.toLowerCase().includes(needle)).slice(0, 4);

  for (const correspondent of matches(facets?.correspondents)) {
    rows.push({
      id: `c-${correspondent.id}`,
      section: "documents",
      label: correspondent.name,
      icon: "account-outline",
      meta: t("omnibar.kindCorrespondent"),
      action: { kind: "tab", route: "Documents", applyFilters: { correspondentIds: [correspondent.id] } },
    });
  }
  for (const documentType of matches(facets?.documentTypes)) {
    rows.push({
      id: `t-${documentType.id}`,
      section: "documents",
      label: documentType.name,
      icon: "file-document-outline",
      meta: t("omnibar.kindType"),
      action: { kind: "tab", route: "Documents", applyFilters: { documentTypeIds: [documentType.id] } },
    });
  }
  for (const tag of matches(facets?.tags)) {
    rows.push({
      id: `g-${tag.id}`,
      section: "documents",
      label: tag.name,
      icon: "tag-outline",
      meta: t("omnibar.kindTag"),
      action: { kind: "tab", route: "Documents", applyFilters: { tags: [tag.id] } },
    });
  }
  for (const document of cachedDocuments) {
    rows.push({
      id: `d-${document.id}`,
      section: "documents",
      label: document.title,
      icon: "file-document-outline",
      meta: t("omnibar.kindDocument"),
      action: { kind: "document", documentId: document.id, title: document.title },
    });
  }
  rows.push(...jump.filter((row) => row.label.toLowerCase().includes(needle)));
  return rows;
}

/** The web's suggestions, in its order, from what the archive actually holds. */
export function buildSuggestions(
  facets: (Partial<FacetsResponse> & { amountRange?: { max: number | null } | null }) | undefined,
  insights: { overdueItems?: unknown[]; upcomingDeadlines?: unknown[] } | undefined,
  t: Translate,
): string[] {
  if (!facets && !insights) {
    return [];
  }
  const items: string[] = [];
  if (insights?.overdueItems?.length) items.push(t("omnibar.suggestOverdue"));
  if (insights?.upcomingDeadlines?.length) items.push(t("omnibar.suggestDeadlines"));

  const [topCorrespondent, secondCorrespondent] = facets?.correspondents ?? [];
  if (topCorrespondent) {
    items.push(fill(t("omnibar.suggestSummarize"), { name: topCorrespondent.name }));
  }
  if (secondCorrespondent) {
    items.push(fill(t("omnibar.suggestTopics"), { name: secondCorrespondent.name }));
  }
  const topType = facets?.documentTypes?.[0];
  if (topType) items.push(fill(t("omnibar.suggestType"), { name: topType.name }));
  const topTag = facets?.tags?.[0];
  if (topTag) items.push(fill(t("omnibar.suggestTag"), { name: topTag.name }));

  if (facets?.years && facets.years.length >= 2) {
    const latest = Math.max(...facets.years.map((entry) => entry.year));
    items.push(fill(t("omnibar.suggestCompare"), { year: latest, previous: latest - 1 }));
  }
  if ((facets?.amountRange?.max ?? 0) > 0) {
    items.push(t("omnibar.suggestHighest"));
  }
  return items.slice(0, 5);
}

/** What to ask next, from the question and what it turned up. */
export function buildFollowUps(
  query: string,
  firstResult:
    | { correspondent?: { name: string } | null; documentType?: { name: string } | null }
    | undefined,
  t: Translate,
): string[] {
  const items: string[] = [];
  if (firstResult?.correspondent) {
    items.push(fill(t("omnibar.followUpFrom"), { name: firstResult.correspondent.name }));
  }
  if (firstResult?.documentType) {
    items.push(fill(t("omnibar.followUpSimilar"), { name: firstResult.documentType.name }));
  }
  items.push(fill(t("omnibar.followUpMore"), { query }));
  return items.slice(0, 3);
}

type TextBlock = DocumentTextResponse["blocks"][number];

export function groupBlocksByPage(blocks: TextBlock[]) {
  const pages = new Map<number, TextBlock[]>();
  for (const block of blocks) {
    pages.set(block.page, [...(pages.get(block.page) ?? []), block]);
  }
  return Array.from(pages.entries())
    .sort(([a], [b]) => a - b)
    .map(([page, pageBlocks]) => ({
      page,
      blocks: [...pageBlocks].sort((a, b) => a.lineIndex - b.lineIndex),
    }));
}

/** The page the citation names, or the first one holding the start of its quote. */
export function citedPageOf(
  citation: { pageFrom?: number | null; quote?: string },
  pages: ReturnType<typeof groupBlocksByPage>,
): number | null {
  if (citation.pageFrom) {
    return citation.pageFrom;
  }
  if (!citation.quote) {
    return null;
  }
  const quote = citation.quote.toLowerCase().slice(0, 80);
  for (const page of pages) {
    const text = page.blocks.map((block) => block.text).join(" ").toLowerCase();
    if (text.includes(quote)) {
      return page.page;
    }
  }
  return null;
}

/**
 * Whether a line belongs to the quote. It runs both ways: a quote can span several
 * lines, and a line can hold more than the quote, down to its closing full stop.
 * A very short line says nothing either way; "1" is in most quotes.
 */
export function isCitedBlock(quote: string | undefined, blockText: string): boolean {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  const block = normalize(blockText);
  const cited = normalize(quote ?? "");
  if (block.length < 8 || cited.length < 8) {
    return false;
  }
  return cited.includes(block.slice(0, 40)) || block.includes(cited.slice(0, 40));
}
