import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type {
  CorrespondentInsightsResponse,
  CorrespondentSummaryStatus,
  DashboardDeadlineItem,
  DashboardInsightsResponse,
  DocumentsProjectionResponse,
  DocumentsTimelineResponse,
  SearchDocumentsRequest,
} from "@openkeep/types";
import { correspondents } from "@openkeep/db";
import { eq } from "drizzle-orm";
import { UMAP } from "umap-js";

import { AppConfigService } from "../common/config/app-config.service";
import { DatabaseService } from "../common/db/database.service";
import { DocumentsService } from "../documents/documents.service";
import { BossService } from "../processing/boss.service";
import { CORRESPONDENT_SUMMARY_QUEUE } from "../processing/constants";
import { ProcessingService } from "../processing/processing.service";

const SUMMARY_ENQUEUE_COOLDOWN_MS = 5 * 60_000;

type SummaryProvider =
  | { provider: "openai"; apiKey: string; model: string }
  | { provider: "gemini"; apiKey: string; model: string };

@Injectable()
export class ExplorerService {
  private readonly logger = new Logger(ExplorerService.name);
  private readonly projectionCache = new Map<string, DocumentsProjectionResponse>();
  private readonly summaryCooldown = new Map<string, number>();

  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
    @Inject(ProcessingService) private readonly processingService: ProcessingService,
    @Inject(BossService) private readonly bossService: BossService,
    @Inject(AppConfigService) private readonly configService: AppConfigService,
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
           LIMIT 8`,
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

    return {
      correspondent: {
        id: correspondent.id,
        name: correspondent.name,
        slug: correspondent.slug,
        summary: correspondent.summary ?? null,
        summaryGeneratedAt: correspondent.summaryGeneratedAt?.toISOString() ?? null,
      },
      summaryStatus: summaryState.status,
      summary: summaryState.summary,
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

  async getDocumentsProjection(
    filters: SearchDocumentsRequest["filters"] = {},
  ): Promise<DocumentsProjectionResponse> {
    const embeddingConfig = this.processingService.getActiveEmbeddingConfiguration();
    if (!embeddingConfig.provider || !embeddingConfig.model) {
      return { points: [], clusters: [] };
    }

    const cacheKey = await this.buildProjectionCacheKey(
      filters,
      embeddingConfig.provider,
      embeddingConfig.model,
    );
    const cached = this.projectionCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const { whereSql, params } = this.documentsService.buildDocumentFilterQuery(filters);
    const metadataResult = await this.databaseService.pool.query<{
      document_id: string;
      title: string;
      status: string;
      issue_date: string | null;
      year: string | null;
      correspondent_name: string | null;
      correspondent_slug: string | null;
      type_name: string | null;
    }>(
      `SELECT
         d.id AS document_id,
         d.title,
         d.status::text AS status,
         d.issue_date::text AS issue_date,
         extract(year from coalesce(d.issue_date, d.created_at::date))::int::text AS year,
         c.name AS correspondent_name,
         c.slug AS correspondent_slug,
         dt.name AS type_name
       FROM documents d
       LEFT JOIN correspondents c ON c.id = d.correspondent_id
       LEFT JOIN document_types dt ON dt.id = d.document_type_id
       WHERE ${whereSql}
       ORDER BY d.id ASC`,
      params,
    );

    const documentIds = metadataResult.rows.map((row) => row.document_id);
    if (documentIds.length === 0) {
      return { points: [], clusters: [] };
    }

    const tagResult = await this.databaseService.pool.query<{
      document_id: string;
      name: string;
    }>(
      `SELECT dtl.document_id, t.name
       FROM document_tag_links dtl
       INNER JOIN tags t ON t.id = dtl.tag_id
       WHERE dtl.document_id = ANY($1::uuid[])
       ORDER BY dtl.document_id ASC, t.name ASC`,
      [documentIds],
    );

    const tagsByDocument = new Map<string, string[]>();
    for (const row of tagResult.rows) {
      const existing = tagsByDocument.get(row.document_id) ?? [];
      existing.push(row.name);
      tagsByDocument.set(row.document_id, existing);
    }

    const embeddingResult = await this.databaseService.pool.query<{
      document_id: string;
      embedding_text: string;
    }>(
      `SELECT
         e.document_id,
         e.embedding::text AS embedding_text
       FROM document_chunk_embeddings e
       INNER JOIN documents d ON d.id = e.document_id
       WHERE ${whereSql}
         AND e.provider = $${params.length + 1}::embedding_provider
         AND e.model = $${params.length + 2}
       ORDER BY e.document_id ASC, e.chunk_index ASC`,
      [...params, embeddingConfig.provider, embeddingConfig.model],
    );

    const embeddingsByDocument = new Map<string, number[][]>();
    for (const row of embeddingResult.rows) {
      const existing = embeddingsByDocument.get(row.document_id) ?? [];
      existing.push(parseHalfVec(row.embedding_text));
      embeddingsByDocument.set(row.document_id, existing);
    }

    const vectorMetadata: Array<{
      documentId: string;
      title: string;
      status: string;
      issueDate: string | null;
      year: number | null;
      correspondentName: string | null;
      correspondentSlug: string | null;
      typeName: string | null;
      tags: string[];
    }> = [];
    const vectors: number[][] = [];

    for (const row of metadataResult.rows) {
      const documentEmbeddings = embeddingsByDocument.get(row.document_id);
      if (!documentEmbeddings || documentEmbeddings.length === 0) {
        continue;
      }

      vectorMetadata.push({
        documentId: row.document_id,
        title: row.title,
        status: row.status,
        issueDate: row.issue_date,
        year: row.year === null ? null : Number(row.year),
        correspondentName: row.correspondent_name,
        correspondentSlug: row.correspondent_slug,
        typeName: row.type_name,
        tags: tagsByDocument.get(row.document_id) ?? [],
      });
      vectors.push(averageVectors(documentEmbeddings));
    }

    if (vectors.length === 0) {
      return { points: [], clusters: [] };
    }

    const coordinates =
      vectors.length === 1
        ? [[0.5, 0.5]]
        : vectors.length === 2
          ? [
              [0.25, 0.5],
              [0.75, 0.5],
            ]
          : new UMAP({
              nComponents: 2,
              nNeighbors: Math.max(2, Math.min(15, vectors.length - 1)),
              minDist: 0.18,
              spread: 1.1,
            }).fit(vectors);

    const normalizedCoordinates = normalizeCoordinates(coordinates);
    const points = vectorMetadata.map((metadata, index) => ({
      documentId: metadata.documentId,
      x: normalizedCoordinates[index]?.[0] ?? 0.5,
      y: normalizedCoordinates[index]?.[1] ?? 0.5,
      title: metadata.title,
      correspondentName: metadata.correspondentName,
      correspondentSlug: metadata.correspondentSlug,
      typeName: metadata.typeName,
      tags: metadata.tags,
      issueDate: metadata.issueDate,
      year: metadata.year,
      status: metadata.status as
        | "pending"
        | "processing"
        | "ready"
        | "failed",
    }));

    const clusters = buildProjectionClusters(points);
    const response = { points, clusters };
    this.projectionCache.set(cacheKey, response);
    return response;
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
        await this.enqueueSummaryJob(correspondent.id);
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

    await this.enqueueSummaryJob(correspondent.id);
    return {
      status: "pending",
      summary: null,
    };
  }

  private async enqueueSummaryJob(correspondentId: string): Promise<void> {
    const now = Date.now();
    const nextAllowed = this.summaryCooldown.get(correspondentId) ?? 0;
    if (nextAllowed > now) {
      return;
    }

    this.summaryCooldown.set(correspondentId, now + SUMMARY_ENQUEUE_COOLDOWN_MS);
    try {
      await this.bossService.publish(CORRESPONDENT_SUMMARY_QUEUE, {
        correspondentId,
      });
    } catch (error) {
      this.summaryCooldown.delete(correspondentId);
      this.logger.warn(
        `Failed to enqueue summary refresh for correspondent ${correspondentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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

  private async buildProjectionCacheKey(
    filters: SearchDocumentsRequest["filters"],
    provider: string,
    model: string,
  ): Promise<string> {
    const { whereSql, params } = this.documentsService.buildDocumentFilterQuery(filters);
    const result = await this.databaseService.pool.query<{
      document_count: string;
      watermark: string | null;
    }>(
      `SELECT
         count(DISTINCT d.id)::int AS document_count,
         max(
           greatest(
             d.updated_at,
             coalesce(d.processed_at, d.updated_at),
             coalesce(e.updated_at, d.updated_at)
           )
         )::text AS watermark
       FROM documents d
       LEFT JOIN document_chunk_embeddings e
         ON e.document_id = d.id
        AND e.provider = $${params.length + 1}::embedding_provider
        AND e.model = $${params.length + 2}
       WHERE ${whereSql}`,
      [...params, provider, model],
    );

    const row = result.rows[0];
    return JSON.stringify({
      filters,
      provider,
      model,
      documentCount: Number(row?.document_count ?? 0),
      watermark: row?.watermark ?? null,
    });
  }

  private async loadDeadlineItems(
    overdue: boolean,
    correspondentId?: string,
    limit = 6,
  ): Promise<DashboardDeadlineItem[]> {
    const params: unknown[] = [];
    const clauses = [
      "d.due_date IS NOT NULL",
      overdue ? "d.due_date < current_date" : "d.due_date >= current_date",
      "d.status <> 'failed'",
    ];

    if (correspondentId) {
      params.push(correspondentId);
      clauses.push(`d.correspondent_id = $${params.length}::uuid`);
    }

    params.push(limit);

    const result = await this.databaseService.pool.query<{
      document_id: string;
      title: string;
      due_date: string;
      amount: string | null;
      currency: string | null;
      correspondent_name: string | null;
      days_until_due: string;
      is_overdue: boolean;
    }>(
      `SELECT
         d.id AS document_id,
         d.title,
         d.due_date::text AS due_date,
         d.amount::text AS amount,
         d.currency,
         c.name AS correspondent_name,
         (d.due_date - current_date)::int::text AS days_until_due,
         (d.due_date < current_date) AS is_overdue
       FROM documents d
       LEFT JOIN correspondents c ON c.id = d.correspondent_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY d.due_date ASC, d.id DESC
       LIMIT $${params.length}`,
      params,
    );

    return result.rows.map((row) => ({
      documentId: row.document_id,
      title: row.title,
      dueDate: row.due_date,
      amount: toNullableNumber(row.amount),
      currency: row.currency,
      correspondentName: row.correspondent_name,
      daysUntilDue: Number(row.days_until_due),
      isOverdue: row.is_overdue,
    }));
  }
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

function buildProjectionClusters(
  points: DocumentsProjectionResponse["points"],
): DocumentsProjectionResponse["clusters"] {
  const grouped = new Map<
    string,
    {
      totalX: number;
      totalY: number;
      documentIds: string[];
    }
  >();

  for (const point of points) {
    const label = point.correspondentName ?? point.typeName ?? "Unfiled";
    const existing = grouped.get(label) ?? {
      totalX: 0,
      totalY: 0,
      documentIds: [],
    };
    existing.totalX += point.x;
    existing.totalY += point.y;
    existing.documentIds.push(point.documentId);
    grouped.set(label, existing);
  }

  return [...grouped.entries()]
    .filter(([, entry]) => entry.documentIds.length > 1)
    .map(([label, entry]) => ({
      centroidX: entry.totalX / entry.documentIds.length,
      centroidY: entry.totalY / entry.documentIds.length,
      label,
      documentIds: entry.documentIds,
    }))
    .sort((left, right) => right.documentIds.length - left.documentIds.length);
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
