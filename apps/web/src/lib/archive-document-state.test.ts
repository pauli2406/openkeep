import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  evictDeletedArchiveDocument,
  refreshArchiveDocumentState,
  refreshArchiveTaxonomyState,
} from "./archive-document-state";

function queryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

describe("archive document state", () => {
  it("invalidates every shared document surface through one interface", async () => {
    const client = queryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    await refreshArchiveDocumentState(client, "document-1");

    expect(invalidate.mock.calls.map(([filter]) => filter.queryKey)).toEqual([
      ["document", "document-1"],
      ["document-history", "document-1"],
      ["documents"],
      ["dashboard", "insights"],
      ["correspondent"],
    ]);
  });

  it("includes taxonomy state when a classified document changes", async () => {
    const client = queryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    await refreshArchiveTaxonomyState(client, "document-2");

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["taxonomies"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["documents"] });
  });

  it("removes every document-owned resource after deletion", async () => {
    const client = queryClient();
    const remove = vi.spyOn(client, "removeQueries");

    await evictDeletedArchiveDocument(client, "document-3");

    expect(remove.mock.calls.map(([filter]) => filter.queryKey)).toEqual([
      ["document", "document-3"],
      ["document-history", "document-3"],
      ["document-text", "document-3"],
      ["document-preview", "document-3"],
    ]);
  });
});
