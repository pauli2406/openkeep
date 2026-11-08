import type { SearchDocumentsResponse } from "./lib";

/** The local copy answers at most this many rows per query. */
const CACHED_PAGE_SIZE = 100;

/**
 * Every cached document matching `options`, read page by page. A single query is
 * capped, so asking for a large page silently returns only the first hundred.
 */
export async function queryAllCachedDocuments<Options extends { page?: number; pageSize?: number }>(
  query: (options: Options) => Promise<SearchDocumentsResponse>,
  options: Omit<Options, "page" | "pageSize">,
): Promise<SearchDocumentsResponse> {
  const items: SearchDocumentsResponse["items"] = [];
  let total = 0;
  for (let page = 1; ; page += 1) {
    const response = await query({ ...options, page, pageSize: CACHED_PAGE_SIZE } as Options);
    total = response.total;
    items.push(...response.items);
    if (response.items.length === 0 || items.length >= total) break;
  }
  return { items, total, page: 1, pageSize: items.length };
}
