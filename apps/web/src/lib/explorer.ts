import type {
  DashboardInsightsResponse,
  DocumentsProjectionResponse,
  DocumentsTimelineResponse,
  CorrespondentInsightsResponse,
  SearchDocumentsResponse,
} from "@openkeep/types";
import { authFetch } from "./api";

export type ExplorerView = "list" | "timeline" | "galaxy";
export type GalaxyColorBy = "correspondent" | "type" | "status" | "year";

export type ExplorerSearch = {
  query?: string;
  year?: number;
  dateFrom?: string;
  dateTo?: string;
  correspondentIds?: string[];
  documentTypeIds?: string[];
  statuses?: string[];
  tags?: string[];
  amountMin?: number;
  amountMax?: number;
  page?: number;
  pageSize?: number;
  sort?: string;
  direction?: string;
  view?: ExplorerView;
  colorBy?: GalaxyColorBy;
  expanded?: string[];
};

export type ExplorerFacets = {
  years: Array<{ year: number; count: number }>;
  correspondents: Array<{ id: string; name: string; slug: string; count: number }>;
  documentTypes: Array<{ id: string; name: string; slug: string; count: number }>;
  tags: Array<{ id: string; name: string; slug: string; count: number }>;
  amountRange: { min: number | null; max: number | null };
  statuses: Array<{ status: string; count: number }>;
};

function parseCsvValue(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.flatMap((item) => parseCsvValue(item) ?? []);
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return undefined;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function parseExplorerSearch(search: Record<string, unknown>): ExplorerSearch {
  const correspondentIds =
    parseCsvValue(search.correspondentIds) ??
    parseCsvValue(search.correspondentId);
  const documentTypeIds =
    parseCsvValue(search.documentTypeIds) ??
    parseCsvValue(search.documentTypeId);
  const statuses = parseCsvValue(search.statuses) ?? parseCsvValue(search.status);

  const view = search.view;
  const colorBy = search.colorBy;

  return {
    query: typeof search.query === "string" && search.query.trim() ? search.query : undefined,
    year: parseOptionalNumber(search.year),
    dateFrom:
      typeof search.dateFrom === "string" && search.dateFrom.trim()
        ? search.dateFrom
        : undefined,
    dateTo:
      typeof search.dateTo === "string" && search.dateTo.trim() ? search.dateTo : undefined,
    correspondentIds,
    documentTypeIds,
    statuses,
    tags: parseCsvValue(search.tags),
    amountMin: parseOptionalNumber(search.amountMin),
    amountMax: parseOptionalNumber(search.amountMax),
    page: parseOptionalNumber(search.page),
    pageSize: parseOptionalNumber(search.pageSize),
    sort: typeof search.sort === "string" && search.sort ? search.sort : undefined,
    direction:
      search.direction === "asc" || search.direction === "desc"
        ? search.direction
        : undefined,
    view:
      view === "timeline" || view === "galaxy" || view === "list"
        ? view
        : undefined,
    colorBy:
      colorBy === "correspondent" ||
      colorBy === "type" ||
      colorBy === "status" ||
      colorBy === "year"
        ? colorBy
        : undefined,
    expanded: parseCsvValue(search.expanded),
  };
}

export function explorerSearchToParams(search: ExplorerSearch): URLSearchParams {
  const params = new URLSearchParams();
  setParam(params, "query", search.query);
  setParam(params, "year", search.year);
  setParam(params, "dateFrom", search.dateFrom);
  setParam(params, "dateTo", search.dateTo);
  setParam(params, "correspondentIds", search.correspondentIds);
  setParam(params, "documentTypeIds", search.documentTypeIds);
  setParam(params, "statuses", search.statuses);
  setParam(params, "tags", search.tags);
  setParam(params, "amountMin", search.amountMin);
  setParam(params, "amountMax", search.amountMax);
  setParam(params, "page", search.page);
  setParam(params, "pageSize", search.pageSize);
  setParam(params, "sort", search.sort);
  setParam(params, "direction", search.direction);
  return params;
}

function setParam(
  params: URLSearchParams,
  key: string,
  value: string | number | string[] | undefined,
) {
  if (value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    if (value.length > 0) {
      params.set(key, value.join(","));
    }
    return;
  }

  params.set(key, String(value));
}

export function nextExplorerSearch(
  current: ExplorerSearch,
  updates: Partial<ExplorerSearch>,
): ExplorerSearch {
  const next = {
    ...current,
    ...updates,
  };

  return Object.fromEntries(
    Object.entries(next).filter(([, value]) => {
      if (value === undefined || value === null || value === "") {
        return false;
      }
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return true;
    }),
  ) as ExplorerSearch;
}

export async function fetchExplorerFacets(): Promise<ExplorerFacets> {
  const response = await authFetch("/api/documents/facets");
  if (!response.ok) {
    throw new Error("Failed to load explorer facets");
  }

  return (await response.json()) as ExplorerFacets;
}

export async function fetchFilteredDocuments(
  search: ExplorerSearch,
): Promise<SearchDocumentsResponse> {
  const params = explorerSearchToParams(search);
  const response = await authFetch(`/api/documents?${params.toString()}`);
  if (!response.ok) {
    throw new Error("Failed to load documents");
  }
  return (await response.json()) as SearchDocumentsResponse;
}

export async function fetchDocumentsTimeline(
  search: ExplorerSearch,
): Promise<DocumentsTimelineResponse> {
  const params = explorerSearchToParams(search);
  const response = await authFetch(`/api/documents/timeline?${params.toString()}`);
  if (!response.ok) {
    throw new Error("Failed to load timeline");
  }
  return (await response.json()) as DocumentsTimelineResponse;
}

export async function fetchDocumentsProjection(
  search: ExplorerSearch,
): Promise<DocumentsProjectionResponse> {
  const params = explorerSearchToParams(search);
  const response = await authFetch(`/api/documents/projection?${params.toString()}`);
  if (!response.ok) {
    throw new Error("Failed to load projection");
  }
  return (await response.json()) as DocumentsProjectionResponse;
}

export async function fetchDashboardInsights(): Promise<DashboardInsightsResponse> {
  const response = await authFetch("/api/dashboard/insights");
  if (!response.ok) {
    throw new Error("Failed to load dashboard insights");
  }
  return (await response.json()) as DashboardInsightsResponse;
}

export async function fetchCorrespondentInsights(
  slug: string,
): Promise<CorrespondentInsightsResponse> {
  const response = await authFetch(`/api/correspondents/${slug}/insights`);
  if (!response.ok) {
    throw new Error("Failed to load correspondent insights");
  }
  return (await response.json()) as CorrespondentInsightsResponse;
}

export function formatCurrency(
  amount: number | null | undefined,
  currency = "EUR",
): string | null {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return null;
  }

  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function colorForValue(value: string): string {
  const palette = [
    "#b74817",
    "#3854a5",
    "#0c8c78",
    "#8c5d12",
    "#8a2d55",
    "#395f35",
    "#6d4db8",
    "#7d3a24",
  ];
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return palette[Math.abs(hash) % palette.length]!;
}
