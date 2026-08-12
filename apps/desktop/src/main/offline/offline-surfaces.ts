import { parseDateOnlyLocal } from "@openkeep/types";
import type { OfflineCacheColumns } from "./offline-cache-store";

/**
 * Derived offline surfaces: Today, facets, timeline, correspondents, review
 * indicators, and text search — everything the shared UI aggregates
 * server-side, recomputed client-side over the cached documents only.
 *
 * All of it is derivation, none of it is state: the cached records stay the
 * single source, exactly like the mobile app derives its offline dashboard and
 * facets. The departures are the ones the cache schema was built for: date
 * arithmetic uses local dates (mobile's offline Today shows documents due
 * today as overdue west of Greenwich, #151), and due/year filtering works
 * because the dates are queryable columns (mobile had to remove those chips
 * offline, #152).
 */

type LoadRecord = (documentId: string) => Promise<{
  version: number;
  document: unknown | null;
  text: unknown | null;
  history: unknown | null;
} | null>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Cached rows that can honestly appear on an offline surface. */
export function visibleRows(columns: OfflineCacheColumns[]): OfflineCacheColumns[] {
  return columns.filter((row) => row.hasDocument);
}

function localDate(value: string | null): Date | null {
  return value ? parseDateOnlyLocal(value) : null;
}

function startOfLocalDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate());
}

export function daysUntilDue(dueDate: string, now: Date): number | null {
  const due = localDate(dueDate);
  if (!due) return null;
  const dayMs = 24 * 60 * 60 * 1_000;
  return Math.round(
    (startOfLocalDay(due).getTime() - startOfLocalDay(now).getTime()) / dayMs,
  );
}

export function rowYear(row: OfflineCacheColumns): number | null {
  const date = localDate(row.issueDate) ?? localDate(row.createdAt);
  return date ? date.getFullYear() : null;
}

function rowMonth(row: OfflineCacheColumns): string | null {
  const date = localDate(row.issueDate) ?? localDate(row.createdAt);
  if (!date) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

async function loadDocuments(
  rows: OfflineCacheColumns[],
  loadRecord: LoadRecord,
): Promise<unknown[]> {
  const documents: unknown[] = [];
  for (const row of rows) {
    const record = await loadRecord(row.id);
    if (record?.document) documents.push(record.document);
  }
  return documents;
}

function deadlineItem(row: OfflineCacheColumns, now: Date) {
  const days = row.dueDate ? daysUntilDue(row.dueDate, now) : null;
  if (row.dueDate === null || days === null) return null;
  return {
    documentId: row.id,
    title: row.title,
    referenceNumber: null,
    dueDate: row.dueDate,
    amount: null,
    currency: null,
    correspondentName: row.correspondentName,
    documentTypeName: row.documentTypeName,
    taskLabel: row.documentTypeName ?? row.title,
    daysUntilDue: days,
    isOverdue: days < 0,
    taskCompletedAt: null,
  };
}

/** `GET /api/dashboard/insights`, over cached documents only. */
export async function deriveDashboard(
  columns: OfflineCacheColumns[],
  loadRecord: LoadRecord,
  now: Date,
) {
  const rows = visibleRows(columns);
  const deadlines = rows
    .map((row) => deadlineItem(row, now))
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue);

  const monthly = new Map<string, number>();
  for (const row of rows) {
    const month = rowMonth(row);
    if (month) monthly.set(month, (monthly.get(month) ?? 0) + 1);
  }

  const byCorrespondent = new Map<string, OfflineCacheColumns[]>();
  for (const row of rows) {
    if (!row.correspondentId) continue;
    const group = byCorrespondent.get(row.correspondentId) ?? [];
    group.push(row);
    byCorrespondent.set(row.correspondentId, group);
  }

  const recentRows = [...rows]
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 5);

  return {
    stats: {
      totalDocuments: rows.length,
      pendingReview: rows.filter((row) => row.reviewStatus === "pending").length,
      documentTypesCount: new Set(
        rows.map((row) => row.documentTypeId).filter(Boolean),
      ).size,
      correspondentsCount: byCorrespondent.size,
    },
    topCorrespondents: [...byCorrespondent.values()]
      .sort((a, b) => b.length - a.length)
      .slice(0, 5)
      .map((group) => {
        const first = group[0]!;
        const typeCounts = new Map<string, number>();
        for (const row of group) {
          if (row.documentTypeName) {
            typeCounts.set(
              row.documentTypeName,
              (typeCounts.get(row.documentTypeName) ?? 0) + 1,
            );
          }
        }
        return {
          id: first.correspondentId!,
          name: first.correspondentName ?? "Unknown",
          slug: first.correspondentSlug ?? first.correspondentId!,
          documentCount: group.length,
          totalAmount: null,
          currency: null,
          latestDocDate: group
            .map((row) => row.issueDate ?? row.createdAt)
            .filter((value): value is string => value !== null)
            .sort()
            .at(-1) ?? null,
          documentTypes: [...typeCounts.entries()].map(([name, count]) => ({
            name,
            count,
          })),
        };
      }),
    upcomingDeadlines: deadlines.filter((item) => !item.isOverdue).slice(0, 10),
    overdueItems: deadlines.filter((item) => item.isOverdue).slice(0, 10),
    recentDocuments: await loadDocuments(recentRows, loadRecord),
    monthlyActivity: [...monthly.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => ({ month, count })),
  };
}

/** `GET /api/documents/facets`, over cached documents only. */
export function deriveFacets(columns: OfflineCacheColumns[]) {
  const rows = visibleRows(columns);
  const years = new Map<number, number>();
  const correspondents = new Map<
    string,
    { name: string; slug: string; count: number; types: Map<string, number> }
  >();
  const documentTypes = new Map<string, { name: string; slug: string; count: number }>();
  const tags = new Map<string, { name: string; slug: string; count: number }>();
  const statuses = new Map<string, number>();

  for (const row of rows) {
    const year = rowYear(row);
    if (year !== null) years.set(year, (years.get(year) ?? 0) + 1);
    if (row.status) statuses.set(row.status, (statuses.get(row.status) ?? 0) + 1);
    if (row.correspondentId) {
      const entry = correspondents.get(row.correspondentId) ?? {
        name: row.correspondentName ?? "Unknown",
        slug: row.correspondentSlug ?? row.correspondentId,
        count: 0,
        types: new Map<string, number>(),
      };
      entry.count += 1;
      if (row.documentTypeName) {
        entry.types.set(
          row.documentTypeName,
          (entry.types.get(row.documentTypeName) ?? 0) + 1,
        );
      }
      correspondents.set(row.correspondentId, entry);
    }
    if (row.documentTypeId) {
      const entry = documentTypes.get(row.documentTypeId) ?? {
        name: row.documentTypeName ?? "Unknown",
        slug: row.documentTypeSlug ?? row.documentTypeId,
        count: 0,
      };
      entry.count += 1;
      documentTypes.set(row.documentTypeId, entry);
    }
    for (const tag of row.tags ?? []) {
      const entry = tags.get(tag.id) ?? { name: tag.name, slug: tag.slug, count: 0 };
      entry.count += 1;
      tags.set(tag.id, entry);
    }
  }

  return {
    years: [...years.entries()]
      .sort(([a], [b]) => b - a)
      .map(([year, count]) => ({ year, count })),
    correspondents: [...correspondents.entries()]
      .sort(([, a], [, b]) => b.count - a.count)
      .map(([id, entry]) => ({
        id,
        name: entry.name,
        slug: entry.slug,
        count: entry.count,
        dominantTypeName:
          [...entry.types.entries()].sort(([, a], [, b]) => b - a)[0]?.[0] ?? null,
      })),
    documentTypes: [...documentTypes.entries()].map(([id, entry]) => ({
      id,
      ...entry,
    })),
    tags: [...tags.entries()].map(([id, entry]) => ({ id, ...entry })),
    amountRange: { min: null, max: null },
    statuses: [...statuses.entries()].map(([status, count]) => ({ status, count })),
  };
}

/** `GET /api/documents/timeline`, over cached documents only. */
export function deriveTimeline(columns: OfflineCacheColumns[]) {
  const rows = visibleRows(columns);
  const years = new Map<
    number,
    Map<number, { count: number; correspondents: Map<string, number>; types: Map<string, number> }>
  >();

  for (const row of rows) {
    const date = localDate(row.issueDate) ?? localDate(row.createdAt);
    if (!date) continue;
    const yearMap = years.get(date.getFullYear()) ?? new Map();
    const month = yearMap.get(date.getMonth() + 1) ?? {
      count: 0,
      correspondents: new Map<string, number>(),
      types: new Map<string, number>(),
    };
    month.count += 1;
    if (row.correspondentName) {
      month.correspondents.set(
        row.correspondentName,
        (month.correspondents.get(row.correspondentName) ?? 0) + 1,
      );
    }
    if (row.documentTypeName) {
      month.types.set(
        row.documentTypeName,
        (month.types.get(row.documentTypeName) ?? 0) + 1,
      );
    }
    yearMap.set(date.getMonth() + 1, month);
    years.set(date.getFullYear(), yearMap);
  }

  const top = (entries: Map<string, number>) =>
    [...entries.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([name]) => name);

  return {
    years: [...years.entries()]
      .sort(([a], [b]) => b - a)
      .map(([year, months]) => ({
        year,
        count: [...months.values()].reduce((total, month) => total + month.count, 0),
        months: [...months.entries()]
          .sort(([a], [b]) => a - b)
          .map(([month, entry]) => ({
            month,
            count: entry.count,
            topCorrespondents: top(entry.correspondents),
            topTypes: top(entry.types),
          })),
      })),
  };
}

/** `GET /api/correspondents/:slug/insights`, over cached documents only. */
export async function deriveCorrespondentInsights(
  slug: string,
  columns: OfflineCacheColumns[],
  loadRecord: LoadRecord,
  now: Date,
) {
  const rows = visibleRows(columns).filter((row) => row.correspondentSlug === slug);
  const first = rows[0];
  if (!first || !first.correspondentId) return null;

  const typeCounts = new Map<string, number>();
  const monthly = new Map<string, number>();
  for (const row of rows) {
    if (row.documentTypeName) {
      typeCounts.set(
        row.documentTypeName,
        (typeCounts.get(row.documentTypeName) ?? 0) + 1,
      );
    }
    const month = rowMonth(row);
    if (month) monthly.set(month, (monthly.get(month) ?? 0) + 1);
  }
  const dates = rows
    .map((row) => row.issueDate ?? row.createdAt)
    .filter((value): value is string => value !== null)
    .sort();
  const recentRows = [...rows]
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 5);
  const deadlines = rows
    .map((row) => deadlineItem(row, now))
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .filter((item) => !item.isOverdue)
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue)
    .slice(0, 5);

  return {
    correspondent: {
      id: first.correspondentId,
      name: first.correspondentName ?? "Unknown",
      slug,
      summaryGeneratedAt: null,
      intelligenceGeneratedAt: null,
    },
    // AI summaries need a live archive; "unavailable" is the honest state
    // rather than an empty summary that looks generated.
    summaryStatus: "unavailable" as const,
    summary: null,
    intelligenceStatus: "unavailable" as const,
    intelligence: null,
    stats: {
      documentCount: rows.length,
      totalAmount: null,
      currency: null,
      dateRange: { from: dates[0] ?? null, to: dates.at(-1) ?? null },
      avgConfidence: null,
    },
    documentTypeBreakdown: [...typeCounts.entries()].map(([name, count]) => ({
      name,
      count,
    })),
    timeline: [...monthly.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => ({ month, count })),
    recentDocuments: await loadDocuments(recentRows, loadRecord),
    upcomingDeadlines: deadlines,
  };
}

/**
 * `POST /api/search/semantic`, degraded honestly: keyword matching over cached
 * titles, taxonomy names, and OCR text, with the matching blocks quoted. Every
 * result is openable offline by construction — it came from the cache.
 */
export async function searchCachedDocuments(
  query: string,
  columns: OfflineCacheColumns[],
  loadRecord: LoadRecord,
  page: number,
  pageSize: number,
) {
  const needle = query.trim().toLowerCase();
  const results: Array<{ document: unknown; matchedChunks: unknown[]; score: number }> =
    [];
  if (needle) {
    for (const row of visibleRows(columns)) {
      const record = await loadRecord(row.id);
      if (!record?.document) continue;

      const columnMatch = [
        row.title,
        row.correspondentName,
        row.documentTypeName,
        ...(row.tags ?? []).map((tag) => tag.name),
      ]
        .filter((value): value is string => value !== null)
        .some((value) => value.toLowerCase().includes(needle));

      const blocks =
        isRecord(record.text) && Array.isArray(record.text.blocks)
          ? record.text.blocks
          : [];
      const matchedBlocks = blocks
        .filter(
          (block): block is Record<string, unknown> =>
            isRecord(block) &&
            typeof block.text === "string" &&
            block.text.toLowerCase().includes(needle),
        )
        .slice(0, 3);

      if (!columnMatch && matchedBlocks.length === 0) continue;
      results.push({
        document: record.document,
        score: columnMatch ? 1 : 0.5,
        matchedChunks: matchedBlocks.map((block, index) => ({
          chunkIndex: index,
          heading: null,
          text: String(block.text),
          pageFrom: typeof block.page === "number" ? block.page : null,
          pageTo: typeof block.page === "number" ? block.page : null,
          score: 0.5,
          distance: null,
        })),
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return {
    items: results
      .slice((page - 1) * pageSize, page * pageSize)
      .map((result) => ({
        document: result.document,
        score: result.score,
        semanticScore: null,
        keywordScore: result.score,
        matchedChunks: result.matchedChunks,
      })),
    total: results.length,
    page,
    pageSize,
    appliedFilters: {},
  };
}
