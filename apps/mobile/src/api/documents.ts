/**
 * The Documents area's calls to the server, and the pure logic behind its
 * screens: filter state, the offline equivalent of the server's filters, export
 * file names. Screens stay about layout; everything here is testable without
 * rendering.
 */
import {
  buildDocumentsSearchParams,
  parseArchiveDate,
  responseToMessage,
  type ArchiveDocument,
  type CorrespondentInsightsResponse,
  type DocumentFilters,
  type DocumentSortField,
  type FacetsResponse,
  type SearchDocumentsResponse,
  type SortDirection,
} from "../lib";

export type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>;

export type DocumentSort = { field: DocumentSortField; direction: SortDirection };

export const DEFAULT_SORT: DocumentSort = { field: "createdAt", direction: "desc" };

export type DocumentsTimelineResponse = {
  years: Array<{
    year: number;
    count: number;
    months: Array<{
      month: number;
      count: number;
      topCorrespondents: string[];
      topTypes: string[];
    }>;
  }>;
};

// ---------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------

/** How many filter dimensions are set; the toolbar's badge shows this number. */
export function countActiveFilters(filters: DocumentFilters): number {
  return [
    filters.year != null,
    Boolean(filters.correspondentIds?.length),
    Boolean(filters.documentTypeIds?.length),
    Boolean(filters.statuses?.length),
    Boolean(filters.tags?.length),
    Boolean(filters.categoryIds?.length),
    Boolean(filters.uncategorized),
    // != null, not truthiness: an amountMin of 0 is a real filter.
    filters.amountMin != null || filters.amountMax != null,
    Boolean(filters.dateFrom || filters.dateTo),
  ].filter(Boolean).length;
}

export function toggleValue(values: string[] | undefined, value: string): string[] {
  if (!values || values.length === 0) return [value];
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

/** The sheet's `Clear`: every filter goes, the search stays. */
export function clearFacetFilters(filters: DocumentFilters): DocumentFilters {
  return filters.query ? { query: filters.query } : {};
}

/**
 * Offline, category filters are dropped rather than misapplied: the mirror
 * stores documents, and a document does not carry its correspondent's category.
 */
export function withoutServerOnlyFilters(filters: DocumentFilters): DocumentFilters {
  const { categoryIds: _categoryIds, uncategorized: _uncategorized, ...rest } = filters;
  return rest;
}

export type FilterChip = { key: string; label: string; clear: Partial<DocumentFilters> };

/** The active filters as removable chips above the results. */
export function buildFilterChips(
  filters: DocumentFilters,
  facets: FacetsResponse | undefined,
  labels: {
    search: string;
    uncategorized: string;
    status: (status: string) => string;
  },
): FilterChip[] {
  const chips: FilterChip[] = [];
  // The name arrives with the facets. An ellipsis is a better placeholder for
  // that moment than a raw id.
  const nameFor = (list: Array<{ id: string; name: string }> | undefined, id: string) =>
    list?.find((entry) => entry.id === id)?.name ?? "…";
  const without = (values: string[] | undefined, value: string) =>
    (values ?? []).filter((item) => item !== value);

  if (filters.query) {
    chips.push({
      key: "query",
      label: `${labels.search}: ${filters.query}`,
      clear: { query: undefined },
    });
  }
  if (filters.year != null) {
    chips.push({ key: "year", label: String(filters.year), clear: { year: undefined } });
  }
  for (const status of filters.statuses ?? []) {
    chips.push({
      key: `status:${status}`,
      label: labels.status(status),
      clear: { statuses: without(filters.statuses, status) },
    });
  }
  for (const id of filters.documentTypeIds ?? []) {
    chips.push({
      key: `type:${id}`,
      label: nameFor(facets?.documentTypes, id),
      clear: { documentTypeIds: without(filters.documentTypeIds, id) },
    });
  }
  for (const id of filters.categoryIds ?? []) {
    chips.push({
      key: `category:${id}`,
      label: nameFor(facets?.categories, id),
      clear: { categoryIds: without(filters.categoryIds, id) },
    });
  }
  if (filters.uncategorized) {
    chips.push({
      key: "uncategorized",
      label: labels.uncategorized,
      clear: { uncategorized: undefined },
    });
  }
  for (const id of filters.correspondentIds ?? []) {
    chips.push({
      key: `correspondent:${id}`,
      label: nameFor(facets?.correspondents, id),
      clear: { correspondentIds: without(filters.correspondentIds, id) },
    });
  }
  for (const id of filters.tags ?? []) {
    chips.push({
      key: `tag:${id}`,
      label: nameFor(facets?.tags, id),
      clear: { tags: without(filters.tags, id) },
    });
  }
  if (filters.dateFrom || filters.dateTo) {
    chips.push({
      key: "date",
      label: `${filters.dateFrom ?? "…"} – ${filters.dateTo ?? "…"}`,
      clear: { dateFrom: undefined, dateTo: undefined },
    });
  }
  if (filters.amountMin != null || filters.amountMax != null) {
    chips.push({
      key: "amount",
      label: `${filters.amountMin ?? "…"} – ${filters.amountMax ?? "…"}`,
      clear: { amountMin: undefined, amountMax: undefined },
    });
  }
  return chips;
}

/**
 * A typed date, as the date-only value the API wants. The sheet has no native
 * date picker to lean on, so this accepts both ways people write one here, and
 * refuses what the calendar does not have: `2026-02-31` would otherwise roll
 * into March.
 */
export function parseFilterDate(input: string): string | null {
  const value = input.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value);
  const parts = iso
    ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
    : german
      ? { year: Number(german[3]), month: Number(german[2]), day: Number(german[1]) }
      : null;
  if (!parts) return null;

  const date = new Date(parts.year, parts.month - 1, parts.day);
  const real =
    date.getFullYear() === parts.year &&
    date.getMonth() === parts.month - 1 &&
    date.getDate() === parts.day;
  if (!real) return null;

  const pad = (part: number) => String(part).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** A typed amount. A German decimal pad types a comma, and `Number` refuses it. */
export function parseFilterAmount(input: string): number | null {
  const value = input.trim().replace(",", ".");
  if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(value)) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The server's filters without paging or order, for the two aggregate endpoints. */
function aggregateParams(filters: DocumentFilters): string {
  const params = new URLSearchParams(buildDocumentsSearchParams({ ...filters, pageSize: 1 }));
  for (const key of ["page", "pageSize", "sort", "direction"]) {
    params.delete(key);
  }
  return params.toString();
}

export async function fetchDocumentsPage(
  authFetch: AuthFetch,
  input: { filters: DocumentFilters; sort: DocumentSort; page: number; pageSize: number },
): Promise<SearchDocumentsResponse> {
  const params = buildDocumentsSearchParams({
    ...input.filters,
    page: input.page,
    pageSize: input.pageSize,
    sort: input.sort.field,
    direction: input.sort.direction,
  });
  const response = await authFetch(`/api/documents?${params}`);
  if (!response.ok) {
    throw new Error(await responseToMessage(response));
  }
  return (await response.json()) as SearchDocumentsResponse;
}

/** Counts narrow with the active filters, except in the dimension being counted. */
export async function fetchFacets(
  authFetch: AuthFetch,
  filters: DocumentFilters,
): Promise<FacetsResponse> {
  const params = aggregateParams(filters);
  const response = await authFetch(`/api/documents/facets${params ? `?${params}` : ""}`);
  if (!response.ok) {
    throw new Error(await responseToMessage(response));
  }
  return (await response.json()) as FacetsResponse;
}

export async function fetchTimeline(
  authFetch: AuthFetch,
  filters: DocumentFilters,
): Promise<DocumentsTimelineResponse> {
  const params = aggregateParams(filters);
  const response = await authFetch(`/api/documents/timeline${params ? `?${params}` : ""}`);
  if (!response.ok) {
    throw new Error(await responseToMessage(response));
  }
  return (await response.json()) as DocumentsTimelineResponse;
}

/** The next page to ask for, or `undefined` once everything is loaded. */
export function nextDocumentsPage(pages: SearchDocumentsResponse[]): number | undefined {
  const last = pages[pages.length - 1];
  if (!last || last.items.length === 0) return undefined;
  const loaded = pages.reduce((sum, page) => sum + page.items.length, 0);
  return loaded < last.total ? pages.length + 1 : undefined;
}

/**
 * Every loaded document, once. A document arriving while the list is paged
 * shifts the rest down, so the next page can repeat the last row of this one.
 */
export function flattenDocumentPages(pages: SearchDocumentsResponse[]): ArchiveDocument[] {
  const seen = new Set<string>();
  const documents: ArchiveDocument[] = [];
  for (const page of pages) {
    for (const document of page.items) {
      if (!seen.has(document.id)) {
        seen.add(document.id);
        documents.push(document);
      }
    }
  }
  return documents;
}

// ---------------------------------------------------------------------------
// Offline
// ---------------------------------------------------------------------------

type CachedQuery = (options: {
  query?: string;
  year?: number;
  dateFrom?: string;
  dateTo?: string;
  sort?: DocumentSortField;
  direction?: SortDirection;
  page?: number;
  pageSize?: number;
}) => Promise<SearchDocumentsResponse>;

const CACHE_SCAN_PAGE_SIZE = 100;

function hasCachedDocumentFilters(filters: DocumentFilters) {
  return (
    Boolean(filters.statuses?.length) ||
    Boolean(filters.documentTypeIds?.length) ||
    Boolean(filters.correspondentIds?.length) ||
    Boolean(filters.tags?.length) ||
    filters.amountMin != null ||
    filters.amountMax != null
  );
}

/** The filters the mirror has no column for, read off the document itself. */
export function matchesCachedFilters(document: ArchiveDocument, filters: DocumentFilters): boolean {
  if (filters.statuses?.length && !filters.statuses.includes(document.status)) {
    return false;
  }
  if (
    filters.documentTypeIds?.length &&
    !(document.documentType && filters.documentTypeIds.includes(document.documentType.id))
  ) {
    return false;
  }
  if (
    filters.correspondentIds?.length &&
    !(document.correspondent && filters.correspondentIds.includes(document.correspondent.id))
  ) {
    return false;
  }
  // Any of the tags, as the API has it.
  if (filters.tags?.length && !document.tags.some((tag) => filters.tags!.includes(tag.id))) {
    return false;
  }
  if (filters.amountMin != null && !(document.amount != null && document.amount >= filters.amountMin)) {
    return false;
  }
  if (filters.amountMax != null && !(document.amount != null && document.amount <= filters.amountMax)) {
    return false;
  }
  return true;
}

/**
 * One page of the offline mirror under the screen's filters.
 *
 * The search, the year, the dates and the order run in SQL. With nothing else
 * set, that is the whole query and it pages in SQL as it always has. Otherwise
 * the mirror is walked and filtered here: it holds a few hundred documents at
 * most, and `total` has to count matches rather than rows.
 */
export async function queryOfflineDocuments(
  queryCached: CachedQuery,
  input: { filters: DocumentFilters; sort: DocumentSort; page: number; pageSize: number },
): Promise<SearchDocumentsResponse> {
  const { filters, sort, page, pageSize } = input;
  const base = {
    query: filters.query ?? "",
    ...(filters.year != null ? { year: filters.year } : {}),
    ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
    ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
    sort: sort.field,
    direction: sort.direction,
  };

  if (!hasCachedDocumentFilters(filters)) {
    return queryCached({ ...base, page, pageSize });
  }

  const matched: ArchiveDocument[] = [];
  for (let scan = 1; ; scan += 1) {
    const result = await queryCached({ ...base, page: scan, pageSize: CACHE_SCAN_PAGE_SIZE });
    matched.push(...result.items.filter((document) => matchesCachedFilters(document, filters)));
    if (result.items.length === 0 || scan * CACHE_SCAN_PAGE_SIZE >= result.total) break;
  }
  return {
    items: matched.slice((page - 1) * pageSize, page * pageSize),
    total: matched.length,
    page,
    pageSize,
  };
}

// ---------------------------------------------------------------------------
// Bulk actions
// ---------------------------------------------------------------------------

/** What the API will take in one bulk request. */
const BULK_LIMIT = 200;

export type BulkResult = { failed: string[] };

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

/**
 * One request and one audit entry per document, no read-modify-write of each
 * document's fields. A failed request fails its documents rather than throwing:
 * whatever already landed stays landed, and only what failed stays selected.
 */
async function postBulk(
  authFetch: AuthFetch,
  path: string,
  documentIds: string[],
  body: Record<string, unknown>,
): Promise<BulkResult> {
  const failed: string[] = [];
  for (const batch of chunks(documentIds, BULK_LIMIT)) {
    try {
      const response = await authFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentIds: batch, ...body }),
      });
      if (!response.ok) {
        throw new Error(await responseToMessage(response));
      }
      const result = (await response.json()) as { failed: Array<{ id: string }> };
      failed.push(...result.failed.map((entry) => entry.id));
    } catch {
      failed.push(...batch);
    }
  }
  return { failed };
}

export function bulkSetTag(
  authFetch: AuthFetch,
  documentIds: string[],
  tagId: string,
  action: "add" | "remove",
): Promise<BulkResult> {
  return postBulk(authFetch, "/api/documents/bulk/tags", documentIds, { tagId, action });
}

export function bulkSetType(
  authFetch: AuthFetch,
  documentIds: string[],
  documentTypeId: string | null,
): Promise<BulkResult> {
  return postBulk(authFetch, "/api/documents/bulk/type", documentIds, { documentTypeId });
}

/** A failure here is all or nothing: nothing was queued. */
export async function bulkReprocess(authFetch: AuthFetch, documentIds: string[]): Promise<void> {
  const response = await authFetch("/api/documents/reprocess/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "selected", documentIds }),
  });
  if (!response.ok) {
    throw new Error(await responseToMessage(response));
  }
}

async function forEachDocument(
  authFetch: AuthFetch,
  documentIds: string[],
  init: () => RequestInit,
): Promise<BulkResult> {
  const failed: string[] = [];
  for (const id of documentIds) {
    try {
      const response = await authFetch(`/api/documents/${id}`, init());
      if (!response.ok) {
        throw new Error(await responseToMessage(response));
      }
    } catch {
      failed.push(id);
    }
  }
  return { failed };
}

export function bulkDelete(authFetch: AuthFetch, documentIds: string[]): Promise<BulkResult> {
  return forEachDocument(authFetch, documentIds, () => ({ method: "DELETE" }));
}

export function bulkMarkDone(authFetch: AuthFetch, documentIds: string[]): Promise<BulkResult> {
  return forEachDocument(authFetch, documentIds, () => ({
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskCompletedAt: new Date().toISOString() }),
  }));
}

const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/tiff": "tiff",
  "image/webp": "webp",
  "text/plain": "txt",
};

/**
 * The name a document is shared under: the server's, as the web client keeps it,
 * otherwise one built from the id with the right extension. It becomes a path in
 * the app's cache, so nothing that could leave that directory survives.
 */
export function exportFileName(
  contentDisposition: string | null | undefined,
  document: Pick<ArchiveDocument, "id" | "mimeType">,
): string {
  const named = contentDisposition?.match(/filename="?([^";]+)"?/)?.[1]?.trim();
  const safe = named
    ?.split(/[\\/]/)
    .pop()
    ?.replace(/^\.+/, "");
  if (safe) return safe;

  const extension = EXTENSIONS[document.mimeType];
  return extension ? `openkeep-${document.id}.${extension}` : `openkeep-${document.id}`;
}

/**
 * Bulk export is the per-document download endpoint, once per document, as on the
 * web. `deliver` puts one file in front of the user and resolves when they are
 * done with it; the OS share sheet takes one at a time.
 */
export async function exportDocuments(
  authFetch: AuthFetch,
  documents: Array<Pick<ArchiveDocument, "id" | "mimeType">>,
  deliver: (response: Response, filename: string) => Promise<void>,
): Promise<BulkResult> {
  const failed: string[] = [];
  for (const document of documents) {
    try {
      const response = await authFetch(`/api/documents/${document.id}/download`);
      if (!response.ok) {
        throw new Error(await responseToMessage(response));
      }
      await deliver(response, exportFileName(response.headers.get("Content-Disposition"), document));
    } catch {
      failed.push(document.id);
    }
  }
  return { failed };
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/** First and last day of a month, as date-only values. */
export function monthBounds(year: number, month: number): { start: string; end: string } {
  const pad = (part: number) => String(part).padStart(2, "0");
  const last = new Date(year, month, 0).getDate();
  return {
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(last)}`,
  };
}

/**
 * Months with a deadline that has passed unpaid, keyed `year-month`. Read off
 * the date parts: `new Date("2026-03-01")` is UTC midnight, which is February in
 * any zone west of Greenwich.
 */
export function unpaidByMonth(documents: ArchiveDocument[], now: Date): Map<string, number> {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const counts = new Map<string, number>();
  for (const document of documents) {
    if (!document.dueDate || document.taskCompletedAt) continue;
    const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(document.dueDate);
    if (!parts) continue;
    const due = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
    if (due >= startOfToday) continue;
    const key = `${Number(parts[1])}-${Number(parts[2])}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Correspondents
// ---------------------------------------------------------------------------

/** The name goes along, as the web client sends it: the update's body requires one. */
export async function setCorrespondentCategory(
  authFetch: AuthFetch,
  correspondent: { id: string; name: string },
  categoryId: string | null,
): Promise<void> {
  const response = await authFetch(`/api/taxonomies/correspondents/${correspondent.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: correspondent.name, categoryId }),
  });
  if (!response.ok) {
    throw new Error(await responseToMessage(response));
  }
}

export type SmartHighlight = {
  kind: "latestPremium" | "latestAmount" | "latestType" | "topType";
  /** Null when there is nothing to show; `latestPremium` still needs formatting. */
  value: string | null;
  amount?: { value: number; currency: string };
};

/** The dossier's one highlighted figure: the most telling fact this sender has. */
export function smartHighlight(data: CorrespondentInsightsResponse): SmartHighlight {
  const intelligence = data.intelligence;
  const insurance = intelligence?.domainInsights.insurance;
  if (insurance?.latestPremiumAmount != null && insurance.latestPremiumCurrency) {
    return {
      kind: "latestPremium",
      value: null,
      amount: { value: insurance.latestPremiumAmount, currency: insurance.latestPremiumCurrency },
    };
  }

  const fact = (label: string) =>
    intelligence?.currentState.find((item) => item.label.toLowerCase() === label.toLowerCase())
      ?.value ?? null;

  const latestAmount = fact("Latest amount");
  if (latestAmount) return { kind: "latestAmount", value: latestAmount };

  const latestType = fact("Latest document type");
  if (latestType) return { kind: "latestType", value: latestType };

  return { kind: "topType", value: data.documentTypeBreakdown[0]?.name ?? null };
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

/** A stable slot in the eight-colour category palette, as the web's `colorForValue`. */
export function categoryColorIndex(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash) % 8;
}

/** `14.03.2026`, the date column of the web's document table. */
export function formatRowDate(value: string | null | undefined): string {
  const date = parseArchiveDate(value);
  if (!date) return "—";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}
