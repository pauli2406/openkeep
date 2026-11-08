import { queryAllCachedDocuments } from "../offline-pages";
import type { ArchiveDocument, SearchDocumentsResponse } from "../lib";

function cache(count: number) {
  const all = Array.from({ length: count }, (_, index) => ({ id: `doc-${index}` }) as ArchiveDocument);
  return jest.fn(
    async ({ page = 1, pageSize = 30 }: { page?: number; pageSize?: number }) =>
      ({
        items: all.slice((page - 1) * Math.min(pageSize, 100), page * Math.min(pageSize, 100)),
        total: count,
        page,
        pageSize,
      }) satisfies SearchDocumentsResponse,
  );
}

describe("queryAllCachedDocuments", () => {
  it("reads past the local copy's hundred-row cap", async () => {
    const query = cache(250);
    const result = await queryAllCachedDocuments(query, {});
    expect(result.items).toHaveLength(250);
    expect(result.total).toBe(250);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("stops after one query when everything fits", async () => {
    const query = cache(7);
    expect((await queryAllCachedDocuments(query, {})).items).toHaveLength(7);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
