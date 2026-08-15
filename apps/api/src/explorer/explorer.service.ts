import { forwardRef, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type {
  CorrespondentInsightsResponse,
  CorrespondentSummaryStatus,
  DashboardDeadlineItem,
  DashboardInsightsResponse,
  DocumentsTimelineResponse,
  SearchDocumentsRequest,
} from "@openkeep/types";
import { correspondents } from "@openkeep/db";
import { eq } from "drizzle-orm";

import { AppConfigService } from "../common/config/app-config.service";
import { DatabaseService } from "../common/db/database.service";
import { DocumentsService } from "../documents/documents.service";
import { ProcessingService } from "../processing/processing.service";
import { CorrespondentIntelligenceService } from "./correspondent-intelligence.service";

type SummaryProvider =
  | { provider: "openai"; apiKey: string; model: string }
  | { provider: "gemini"; apiKey: string; model: string };

@Injectable()
export class ExplorerService {
  private readonly logger = new Logger(ExplorerService.name);

  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => DocumentsService))
    private readonly documentsService: DocumentsService,
    @Inject(ProcessingService) private readonly processingService: ProcessingService,
    @Inject(AppConfigService) private readonly configService: AppConfigService,
    @Inject(forwardRef(() => CorrespondentIntelligenceService))
    private readonly correspondentIntelligenceService: CorrespondentIntelligenceService,
  ) {}

  async getDashboardInsights(): Promise<DashboardInsightsResponse> {
    const [statsResult, topCorrespondentsResult, deadlinesResult, overdueResult, recentDocuments] =
      await Promise.all([
        this.databaseService.pool.query<{
          total_documents: string;
          pending_review: string;
          document_types_count: string;
          correspondents_count: string;
        }>(
          `SELECT
             count(*)::int AS total_documents,
             count(*) FILTER (WHERE review_status = 'pending')::int AS pending_review,
             count(DISTINCT document_type_id)::int AS document_types_count,
             count(DISTINCT correspondent_id)::int AS correspondents_count
           FROM documents`,
        ),
        this.databaseService.pool.query<{
          id: string;
          name: string;
          slug: string;
          document_count: string;
          total_amount: string | null;
          currency: string | null;
          latest_doc_date: string | null;
        }>(
          `SELECT
             c.id,
             c.name,
             c.slug,
             count(*)::int AS document_count,
             CASE WHEN count(DISTINCT d.currency) FILTER (WHERE d.currency IS NOT NULL) = 1
               THEN sum(d.amount)::text
               ELSE NULL
             END AS total_amount,
             CASE WHEN count(DISTINCT d.currency) FILTER (WHERE d.currency IS NOT NULL) = 1
               THEN max(d.currency)
               ELSE NULL
             END AS currency,
             max(coalesce(d.issue_date, d.created_at::date))::text AS latest_doc_date
           FROM documents d
           INNER JOIN correspondents c ON c.id = d.correspondent_id
            GROUP BY c.id, c.name, c.slug
            ORDER BY count(*) DESC, max(coalesce(d.issue_date, d.created_at::date)) DESC, c.name ASC
            LIMIT 4`,
        ),
        this.loadDeadlineItems(false, undefined, 6),
        this.loadDeadlineItems(true, undefined, 6),
        this.documentsService
          .listDocuments({
            sort: "createdAt",
            direction: "desc",
            page: 1,
            pageSize: 6,
          })
          .then((response) => response.items),
      ]);

    const topCorrespondentIds = topCorrespondentsResult.rows.map((row) => row.id);
    const typeBreakdownResult =
      topCorrespondentIds.length > 0
        ? await this.databaseService.pool.query<{
            correspondent_id: string;
            name: string;
            count: string;
          }>(
            `SELECT
               d.correspondent_id,
               coalesce(dt.name, 'Unfiled') AS name,
               count(*)::int AS count
             FROM documents d
             LEFT JOIN document_types dt ON dt.id = d.document_type_id
             WHERE d.correspondent_id = ANY($1::uuid[])
             GROUP BY d.correspondent_id, coalesce(dt.name, 'Unfiled')
             ORDER BY d.correspondent_id ASC, count(*) DESC, name ASC`,
            [topCorrespondentIds],
          )
        : { rows: [] };

    const typesByCorrespondent = new Map<string, Array<{ name: string; count: number }>>();
    for (const row of typeBreakdownResult.rows) {
      const existing = typesByCorrespondent.get(row.correspondent_id) ?? [];
      existing.push({ name: row.name, count: Number(row.count) });
      typesByCorrespondent.set(row.correspondent_id, existing);
    }

    const monthlyActivity = await this.databaseService.pool.query<{
      month: string;
      count: string;
    }>(
      `SELECT
         to_char(date_trunc('month', coalesce(issue_date, created_at::date)::timestamp), 'YYYY-MM') AS month,
         count(*)::int AS count
       FROM documents
       WHERE coalesce(issue_date, created_at::date) >= date_trunc('month', current_date) - interval '11 months'
       GROUP BY 1
       ORDER BY 1 ASC`,
    );

    const stats = statsResult.rows[0];

    return {
      stats: {
        totalDocuments: Number(stats?.total_documents ?? 0),
        pendingReview: Number(stats?.pending_review ?? 0),
        documentTypesCount: Number(stats?.document_types_count ?? 0),
        correspondentsCount: Number(stats?.correspondents_count ?? 0),
      },
      topCorrespondents: topCorrespondentsResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        documentCount: Number(row.document_count),
        totalAmount: toNullableNumber(row.total_amount),
        currency: row.currency,
        latestDocDate: row.latest_doc_date,
        documentTypes: (typesByCorrespondent.get(row.id) ?? []).slice(0, 3),
      })),
      upcomingDeadlines: deadlinesResult,
      overdueItems: overdueResult,
      recentDocuments,
      monthlyActivity: monthlyActivity.rows.map((row) => ({
        month: row.month,
        count: Number(row.count),
      })),
    };
  }

  async listDeadlineItems(input: {
    overdue?: boolean;
    correspondentId?: string;
    limit?: number;
    dueDateFrom?: string | null;
    dueDateTo?: string | null;
    invoiceOnly?: boolean;
  }): Promise<DashboardDeadlineItem[]> {
    const params: unknown[] = [];
    const clauses = [
      "d.due_date IS NOT NULL",
      "d.status <> 'failed'",
      "d.task_completed_at IS NULL",
    ];

    if (input.overdue) {
      clauses.push("d.due_date < current_date");
    } else {
      clauses.push("d.due_date >= current_date");
    }

    if (input.dueDateFrom) {
      params.push(input.dueDateFrom);
      clauses.push(`d.due_date >= $${params.length}::date`);
    }

    if (input.dueDateTo) {
      params.push(input.dueDateTo);
      clauses.push(`d.due_date <= $${params.length}::date`);
    }

    if (input.correspondentId) {
      params.push(input.correspondentId);
      clauses.push(`d.correspondent_id = $${params.length}::uuid`);
    }

    if (input.invoiceOnly) {
      clauses.push(
        "(lower(coalesce(dt.slug, '')) LIKE '%invoice%' OR lower(coalesce(dt.name, '')) LIKE '%invoice%' OR lower(coalesce(dt.name, '')) LIKE '%bill%' OR lower(coalesce(dt.name, '')) LIKE '%rechnung%')",
      );
    }

    params.push(input.limit ?? 6);

    const result = await this.databaseService.pool.query<{
      document_id: string;
      title: string;
      reference_number: string | null;
      due_date: string;
      amount: string | null;
      currency: string | null;
      correspondent_name: string | null;
      document_type_name: string | null;
      days_until_due: string;
      is_overdue: boolean;
      task_completed_at: Date | null;
    }>(
      `SELECT
         d.id AS document_id,
         d.title,
         d.reference_number,
         d.due_date::text AS due_date,
         d.amount::text AS amount,
         d.currency,
         c.name AS correspondent_name,
         dt.name AS document_type_name,
         (d.due_date - current_date)::int::text AS days_until_due,
         (d.due_date < current_date) AS is_overdue,
         d.task_completed_at
        FROM documents d
        LEFT JOIN correspondents c ON c.id = d.correspondent_id
        LEFT JOIN document_types dt ON dt.id = d.document_type_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY d.due_date ASC, d.id DESC
        LIMIT $${params.length}`,
      params,
    );

    return result.rows.map((row) => ({
      documentId: row.document_id,
      title: row.title,
      referenceNumber: row.reference_number,
      dueDate: row.due_date,
      amount: toNullableNumber(row.amount),
      currency: row.currency,
      correspondentName: row.correspondent_name,
      documentTypeName: row.document_type_name,
      taskLabel: buildTaskLabel(row.document_type_name, row.is_overdue),
      daysUntilDue: Number(row.days_until_due),
      isOverdue: row.is_overdue,
      taskCompletedAt: row.task_completed_at?.toISOString() ?? null,
    }));
  }

  async getCorrespondentInsightsBySlug(
    slug: string,
  ): Promise<CorrespondentInsightsResponse> {
    const [correspondent] = await this.databaseService.db
      .select()
      .from(correspondents)
      .where(eq(correspondents.slug, slug))
      .limit(1);

    if (!correspondent) {
      throw new NotFoundException("Correspondent not found");
    }

    const [statsResult, typeBreakdownResult, timelineResult, recentDocuments, upcomingDeadlines] =
      await Promise.all([
        this.databaseService.pool.query<{
          document_count: string;
          total_amount: string | null;
          currency: string | null;
          date_from: string | null;
          date_to: string | null;
          avg_confidence: string | null;
          latest_activity_at: string | null;
        }>(
          `SELECT
             count(*)::int AS document_count,
             CASE WHEN count(DISTINCT currency) FILTER (WHERE currency IS NOT NULL) = 1
               THEN sum(amount)::text
               ELSE NULL
             END AS total_amount,
             CASE WHEN count(DISTINCT currency) FILTER (WHERE currency IS NOT NULL) = 1
               THEN max(currency)
               ELSE NULL
             END AS currency,
             min(coalesce(issue_date, created_at::date))::text AS date_from,
             max(coalesce(issue_date, created_at::date))::text AS date_to,
             avg(confidence)::text AS avg_confidence,
             max(coalesce(processed_at, updated_at, created_at))::text AS latest_activity_at
           FROM documents
           WHERE correspondent_id = $1::uuid`,
          [correspondent.id],
        ),
        this.databaseService.pool.query<{
          name: string;
          count: string;
        }>(
          `SELECT
             coalesce(dt.name, 'Unfiled') AS name,
             count(*)::int AS count
           FROM documents d
           LEFT JOIN document_types dt ON dt.id = d.document_type_id
           WHERE d.correspondent_id = $1::uuid
           GROUP BY coalesce(dt.name, 'Unfiled')
           ORDER BY count(*) DESC, name ASC`,
          [correspondent.id],
        ),
        this.databaseService.pool.query<{
          month: string;
          count: string;
        }>(
          `SELECT
             to_char(date_trunc('month', coalesce(issue_date, created_at::date)::timestamp), 'YYYY-MM') AS month,
             count(*)::int AS count
           FROM documents
           WHERE correspondent_id = $1::uuid
           GROUP BY 1
           ORDER BY 1 ASC`,
          [correspondent.id],
        ),
        this.documentsService
          .listDocuments({
            filters: { correspondentId: correspondent.id },
            sort: "createdAt",
            direction: "desc",
            page: 1,
            pageSize: 10,
          })
          .then((response) => response.items),
        this.loadDeadlineItems(false, correspondent.id, 6),
      ]);

    const stats = statsResult.rows[0];
    const latestActivityAt = stats?.latest_activity_at
      ? new Date(stats.latest_activity_at)
      : null;

    const summaryState = await this.resolveSummaryState(
      {
        id: correspondent.id,
        slug: correspondent.slug,
        summary: correspondent.summary ?? null,
        summaryGeneratedAt: correspondent.summaryGeneratedAt ?? null,
      },
      latestActivityAt,
    );
    const intelligenceState = await this.correspondentIntelligenceService.resolveState({
      correspondentId: correspondent.id,
      intelligence: (correspondent.intelligence as Record<string, unknown> | null | undefined) ?? null,
      intelligenceGeneratedAt: correspondent.intelligenceGeneratedAt ?? null,
      latestActivityAt,
    });

    return {
      correspondent: {
        id: correspondent.id,
        name: correspondent.name,
        slug: correspondent.slug,
        summary: correspondent.summary ?? null,
        categoryId: correspondent.categoryId ?? null,
        categoryName: await this.resolveCategoryName(correspondent.categoryId ?? null),
        categorySource: correspondent.categorySource ?? null,
        summaryGeneratedAt: correspondent.summaryGeneratedAt?.toISOString() ?? null,
        intelligenceGeneratedAt: correspondent.intelligenceGeneratedAt?.toISOString() ?? null,
      },
      summaryStatus: summaryState.status,
      summary: summaryState.summary,
      intelligenceStatus: intelligenceState.status,
      intelligence: intelligenceState.intelligence,
      stats: {
        documentCount: Number(stats?.document_count ?? 0),
        totalAmount: toNullableNumber(stats?.total_amount ?? null),
        currency: stats?.currency ?? null,
        dateRange: {
          from: stats?.date_from ?? null,
          to: stats?.date_to ?? null,
        },
        avgConfidence: toNullableNumber(stats?.avg_confidence ?? null),
      },
      documentTypeBreakdown: typeBreakdownResult.rows.map((row) => ({
        name: row.name,
        count: Number(row.count),
      })),
      timeline: timelineResult.rows.map((row) => ({
        month: row.month,
        count: Number(row.count),
      })),
      recentDocuments,
      upcomingDeadlines,
    };
  }

  async getDocumentsTimeline(
    filters: SearchDocumentsRequest["filters"] = {},
  ): Promise<DocumentsTimelineResponse> {
    const { whereSql, params } = this.documentsService.buildDocumentFilterQuery(filters);
    const result = await this.databaseService.pool.query<{
      year: string;
      month: string;
      correspondent_name: string | null;
      type_name: string | null;
    }>(
      `SELECT
         extract(year from coalesce(d.issue_date, d.created_at::date))::int::text AS year,
         extract(month from coalesce(d.issue_date, d.created_at::date))::int::text AS month,
         c.name AS correspondent_name,
         dt.name AS type_name
       FROM documents d
       LEFT JOIN correspondents c ON c.id = d.correspondent_id
       LEFT JOIN document_types dt ON dt.id = d.document_type_id
       WHERE ${whereSql}
       ORDER BY year DESC, month DESC`,
      params,
    );

    const yearMap = new Map<
      number,
      {
        count: number;
        months: Map<
          number,
          {
            count: number;
            correspondents: Map<string, number>;
            types: Map<string, number>;
          }
        >;
      }
    >();

    for (const row of result.rows) {
      const year = Number(row.year);
      const month = Number(row.month);
      const yearEntry = yearMap.get(year) ?? {
        count: 0,
        months: new Map(),
      };
      yearEntry.count += 1;
      const monthEntry = yearEntry.months.get(month) ?? {
        count: 0,
        correspondents: new Map(),
        types: new Map(),
      };
      monthEntry.count += 1;
      if (row.correspondent_name) {
        monthEntry.correspondents.set(
          row.correspondent_name,
          (monthEntry.correspondents.get(row.correspondent_name) ?? 0) + 1,
        );
      }
      if (row.type_name) {
        monthEntry.types.set(row.type_name, (monthEntry.types.get(row.type_name) ?? 0) + 1);
      }
      yearEntry.months.set(month, monthEntry);
      yearMap.set(year, yearEntry);
    }

    return {
      years: [...yearMap.entries()]
        .sort((left, right) => right[0] - left[0])
        .map(([year, yearEntry]) => ({
          year,
          count: yearEntry.count,
          months: [...yearEntry.months.entries()]
            .sort((left, right) => right[0] - left[0])
            .map(([month, monthEntry]) => ({
              month,
              count: monthEntry.count,
              topCorrespondents: topMapKeys(monthEntry.correspondents, 3),
              topTypes: topMapKeys(monthEntry.types, 3),
            })),
        })),
    };
  }

  async refreshCorrespondentSummary(correspondentId: string): Promise<void> {
    const [correspondent] = await this.databaseService.db
      .select()
      .from(correspondents)
      .where(eq(correspondents.id, correspondentId))
      .limit(1);

    if (!correspondent) {
      return;
    }

    const provider = this.getSummaryProvider();
    if (!provider) {
      return;
    }

    const context = await this.databaseService.pool.query<{
      title: string;
      issue_date: string | null;
      due_date: string | null;
      amount: string | null;
      currency: string | null;
      type_name: string | null;
      excerpt: string;
    }>(
      `SELECT
         d.title,
         d.issue_date::text AS issue_date,
         d.due_date::text AS due_date,
         d.amount::text AS amount,
         d.currency,
         dt.name AS type_name,
         left(regexp_replace(coalesce(d.full_text, ''), '\s+', ' ', 'g'), 320) AS excerpt
       FROM documents d
       LEFT JOIN document_types dt ON dt.id = d.document_type_id
       WHERE d.correspondent_id = $1::uuid
       ORDER BY coalesce(d.issue_date, d.created_at::date) DESC, d.id DESC
       LIMIT 12`,
      [correspondentId],
    );

    if (context.rows.length === 0) {
      return;
    }

    const prompt = buildCorrespondentSummaryPrompt(correspondent.name, context.rows);
    const summary = await this.generateSummary(provider, prompt);
    if (!summary) {
      return;
    }

    await this.databaseService.db
      .update(correspondents)
      .set({
        summary,
        summaryGeneratedAt: new Date(),
      })
      .where(eq(correspondents.id, correspondentId));
  }

  private async resolveSummaryState(
    correspondent: {
      id: string;
      slug: string;
      summary: string | null;
      summaryGeneratedAt: Date | null;
    },
    latestActivityAt: Date | null,
  ): Promise<{ status: CorrespondentSummaryStatus; summary: string | null }> {
    const provider = this.getSummaryProvider();
    const hasSummary = Boolean(correspondent.summary?.trim());
    const isStale =
      !correspondent.summaryGeneratedAt ||
      (latestActivityAt !== null && correspondent.summaryGeneratedAt < latestActivityAt);

    if (hasSummary) {
      if (isStale && provider) {
        await this.correspondentIntelligenceService.enqueueRefresh(correspondent.id);
      }
      return {
        status: "ready",
        summary: correspondent.summary,
      };
    }

    if (!provider) {
      return {
        status: "unavailable",
        summary: null,
      };
    }

    await this.correspondentIntelligenceService.enqueueRefresh(correspondent.id);
    return {
      status: "pending",
      summary: null,
    };
  }

  private getSummaryProvider(): SummaryProvider | null {
    const openAiKey = this.configService.get("OPENAI_API_KEY");
    if (openAiKey) {
      return {
        provider: "openai",
        apiKey: openAiKey,
        model: this.configService.get("OPENAI_MODEL"),
      };
    }

    const geminiKey = this.configService.get("GEMINI_API_KEY");
    if (geminiKey) {
      return {
        provider: "gemini",
        apiKey: geminiKey,
        model: this.configService.get("GEMINI_MODEL"),
      };
    }

    return null;
  }

  private async generateSummary(
    provider: SummaryProvider,
    prompt: string,
  ): Promise<string | null> {
    if (provider.provider === "openai") {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          model: provider.model,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content:
                "You summarize personal document correspondents. Return 2 concise sentences, grounded only in the provided metadata and excerpts.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
        }),
      });

      if (!response.ok) {
        this.logger.warn(`OpenAI summary request failed with status ${response.status}`);
        return null;
      }

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
      };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content === "string") {
        return normalizeSummary(content);
      }

      if (Array.isArray(content)) {
        return normalizeSummary(
          content
            .map((item) => (typeof item?.text === "string" ? item.text : ""))
            .join(" "),
        );
      }

      return null;
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent?key=${provider.apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          generationConfig: {
            temperature: 0.2,
          },
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      this.logger.warn(`Gemini summary request failed with status ${response.status}`);
      return null;
    }

    const body = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };
    const text = body.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join(" ");
    return normalizeSummary(text ?? null);
  }

  private async resolveCategoryName(categoryId: string | null): Promise<string | null> {
    if (!categoryId) {
      return null;
    }
    const result = await this.databaseService.pool.query<{ name: string }>(
      `SELECT name FROM categories WHERE id = $1`,
      [categoryId],
    );
    return result.rows[0]?.name ?? null;
  }

  private async loadDeadlineItems(
    overdue: boolean,
    correspondentId?: string,
    limit = 6,
  ): Promise<DashboardDeadlineItem[]> {
    return this.listDeadlineItems({ overdue, correspondentId, limit });
  }
}

function buildTaskLabel(documentTypeName: string | null, isOverdue: boolean): string {
  const normalized = documentTypeName?.trim().toLowerCase() ?? "";
  if (normalized.includes("invoice") || normalized.includes("bill")) {
    return isOverdue ? "Pay immediately" : "Pay";
  }
  if (normalized.includes("contract") || normalized.includes("legal")) {
    return isOverdue ? "Respond immediately" : "Respond";
  }
  if (normalized.includes("insurance")) {
    return isOverdue ? "Review immediately" : "Review";
  }
  return isOverdue ? "Handle immediately" : "Handle";
}

function toNullableNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function parseHalfVec(value: string): number[] {
  return value
    .slice(1, -1)
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item));
}

function averageVectors(vectors: number[][]): number[] {
  const dimensions = vectors[0]?.length ?? 0;
  const totals = new Array<number>(dimensions).fill(0);
  for (const vector of vectors) {
    for (let index = 0; index < dimensions; index += 1) {
      totals[index] += vector[index] ?? 0;
    }
  }
  return totals.map((value) => value / Math.max(vectors.length, 1));
}

function normalizeCoordinates(coordinates: number[][]): number[][] {
  if (coordinates.length === 0) {
    return [];
  }

  const xs = coordinates.map((point) => point[0] ?? 0);
  const ys = coordinates.map((point) => point[1] ?? 0);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = maxX - minX;
  const rangeY = maxY - minY;

  return coordinates.map(([x, y]) => [
    rangeX === 0 ? 0.5 : (x - minX) / rangeX,
    rangeY === 0 ? 0.5 : (y - minY) / rangeY,
  ]);
}

function topMapKeys(map: Map<string, number>, limit: number): string[] {
  return [...map.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .slice(0, limit)
    .map(([key]) => key);
}

function buildCorrespondentSummaryPrompt(
  correspondentName: string,
  rows: Array<{
    title: string;
    issue_date: string | null;
    due_date: string | null;
    amount: string | null;
    currency: string | null;
    type_name: string | null;
    excerpt: string;
  }>,
): string {
  const docLines = rows
    .map((row, index) => {
      const amount =
        row.amount && row.currency ? `${row.amount} ${row.currency}` : row.amount ?? "n/a";
      return [
        `${index + 1}. Title: ${row.title}`,
        `Type: ${row.type_name ?? "Unfiled"}`,
        `Issue date: ${row.issue_date ?? "n/a"}`,
        `Due date: ${row.due_date ?? "n/a"}`,
        `Amount: ${amount}`,
        `Excerpt: ${row.excerpt || "n/a"}`,
      ].join(" | ");
    })
    .join("\n");

  return [
    `Summarize the correspondent "${correspondentName}" in 2 concise sentences.`,
    "Explain what kind of organization or contact it appears to be and summarize the document relationship over time.",
    "Do not guess beyond the evidence.",
    "",
    docLines,
  ].join("\n");
}

function normalizeSummary(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized.slice(0, 600) : null;
}
