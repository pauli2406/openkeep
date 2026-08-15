import type { TaxYearResponse } from "@openkeep/types";
import { authFetch } from "./api";

export async function fetchTaxYear(year: number): Promise<TaxYearResponse> {
  const response = await authFetch(`/api/taxes/${year}`);
  if (!response.ok) {
    throw new Error("Failed to load the tax year");
  }
  return (await response.json()) as TaxYearResponse;
}

export async function downloadTaxYearExport(year: number): Promise<void> {
  const response = await authFetch(`/api/taxes/${year}/export`);
  if (!response.ok) {
    throw new Error("Failed to export the tax year");
  }
  const blob = await response.blob();
  const anchor = window.document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `tax-year-${year}.zip`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

/** The default view: the last complete calendar year. */
export function defaultTaxYear(now = new Date()): number {
  return now.getFullYear() - 1;
}

export function parseTaxesSearch(search: Record<string, unknown>): { year?: number } {
  const raw = search.year;
  const year = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (Number.isInteger(year) && year >= 1970 && year <= 2100) {
    return { year };
  }
  return {};
}
