/**
 * The tax year, against the same endpoints as the web client's `lib/taxes.ts`.
 *
 * The app deliberately has no workspace dependency on `@openkeep/types` (see the
 * mobile-offline-sync docs), so the response types are a local copy of the
 * schema's.
 */
import { formatCurrency, saveDownloadToFile, type FacetsResponse } from "../lib";

type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>;

export type TaxYearMembership = "tag" | "type" | "both";

export type TaxYearDocument = {
  id: string;
  title: string;
  issueDate: string | null;
  correspondentName: string | null;
  amount: number | null;
  currency: string | null;
  memberVia: TaxYearMembership;
};

export type TaxYearTotal = {
  currency: string;
  sum: number;
  count: number;
};

export type TaxYearGroup = {
  documentTypeId: string | null;
  documentType: string | null;
  count: number;
  unsummedCount: number;
  totals: TaxYearTotal[];
  documents: TaxYearDocument[];
};

export type TaxYearResponse = {
  year: number;
  documentCount: number;
  unsummedCount: number;
  totals: TaxYearTotal[];
  groups: TaxYearGroup[];
};

export async function fetchTaxYear(authFetch: AuthFetch, year: number): Promise<TaxYearResponse> {
  const response = await authFetch(`/api/taxes/${year}`);
  if (!response.ok) {
    throw new Error(`Failed to load the tax year (${response.status})`);
  }
  return (await response.json()) as TaxYearResponse;
}

export async function fetchTaxFacets(authFetch: AuthFetch): Promise<FacetsResponse> {
  const response = await authFetch("/api/documents/facets");
  if (!response.ok) {
    throw new Error(`Failed to load the facets (${response.status})`);
  }
  return (await response.json()) as FacetsResponse;
}

/** Writes the year's archive to a local file and returns its uri, for the share sheet. */
export async function downloadTaxYearExport(authFetch: AuthFetch, year: number): Promise<string> {
  const response = await authFetch(`/api/taxes/${year}/export`);
  if (!response.ok) {
    throw new Error(`Failed to export the tax year (${response.status})`);
  }
  return saveDownloadToFile(response, `tax-year-${year}.zip`);
}

/** The default view: the last complete calendar year. */
export function defaultTaxYear(now = new Date()): number {
  return now.getFullYear() - 1;
}

/** Only years that actually hold documents, plus the one in view and the default. */
export function availableTaxYears(
  year: number,
  facetYears: Array<{ year: number }> | undefined,
  now = new Date(),
): number[] {
  const years = new Set<number>([year, defaultTaxYear(now)]);
  for (const entry of facetYears ?? []) {
    years.add(entry.year);
  }
  return [...years].sort((a, b) => b - a);
}

export function formatTaxTotal(total: Pick<TaxYearTotal, "sum" | "currency">): string {
  return formatCurrency(total.sum, total.currency);
}

/** Issue dates are date-only; `new Date(str)` would read them as UTC and can shift the day. */
export function formatIssueDate(value: string | null | undefined, language: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!match) {
    return value ?? null;
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString(
    language === "de" ? "de-DE" : "en-GB",
    { day: "2-digit", month: "2-digit", year: "numeric" },
  );
}

/**
 * What a group's "open in documents" link filters on. An unfiled group has no
 * type to filter by, so it has no link, as on the web.
 */
export function documentsFilterForGroup(
  group: Pick<TaxYearGroup, "documentTypeId">,
  year: number,
): { year: number; documentTypeIds: string[] } | null {
  return group.documentTypeId ? { year, documentTypeIds: [group.documentTypeId] } : null;
}
