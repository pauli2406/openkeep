import type { QueryClient } from "@tanstack/react-query";

/**
 * Refreshes every shared surface that can render archive-document state.
 *
 * Keeping the query-key graph behind this interface prevents a mutation on the
 * detail or review route from leaving Today, Explorer, facets, or the review
 * count stale. Callers only declare that a document changed; this module owns
 * where that change is visible.
 */
export async function refreshArchiveDocumentState(
  queryClient: QueryClient,
  documentId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["document", documentId] }),
    queryClient.invalidateQueries({ queryKey: ["document-history", documentId] }),
    queryClient.invalidateQueries({ queryKey: ["documents"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard", "insights"] }),
    queryClient.invalidateQueries({ queryKey: ["correspondent"] }),
  ]);
}

/** Refreshes taxonomy pickers and the document surfaces whose labels changed. */
export async function refreshArchiveTaxonomyState(
  queryClient: QueryClient,
  documentId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["taxonomies"] }),
    refreshArchiveDocumentState(queryClient, documentId),
  ]);
}

/**
 * Evicts resources that can no longer be addressed after a successful delete,
 * while refreshing archive-wide counts and lists.
 */
export async function evictDeletedArchiveDocument(
  queryClient: QueryClient,
  documentId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["documents"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard", "insights"] }),
    queryClient.invalidateQueries({ queryKey: ["correspondent"] }),
  ]);

  for (const queryKey of [
    ["document", documentId],
    ["document-history", documentId],
    ["document-text", documentId],
    ["document-preview", documentId],
  ]) {
    queryClient.removeQueries({ queryKey });
  }
}
