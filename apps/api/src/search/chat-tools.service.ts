import { Inject, Injectable, Logger } from "@nestjs/common";
import type {
  Document,
  SearchDocumentsFilters,
  SemanticSearchResult,
} from "@openkeep/types";

import type { AuthenticatedPrincipal } from "../auth/auth.types";
import { DatabaseService } from "../common/db/database.service";
import { DocumentsService } from "../documents/documents.service";
import type { LlmToolCall, LlmToolDefinition } from "../processing/llm.service";

/** Result rows are capped so a broad filter cannot flood the prompt. */
const MAX_SEARCH_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 25;
const MAX_SEMANTIC_DOCUMENTS = 8;
const DEFAULT_SEMANTIC_DOCUMENTS = 5;
const TAXONOMY_LOOKUP_LIMIT = 40;

export interface ChatToolExecution {
  /** Compact JSON payload appended to the conversation as the tool result. */
  resultForModel: unknown;
  /** Full documents backing a search_documents result, for the client-side table. */
  documents?: Document[];
  documentsTotal?: number;
  /** Raw semantic hits; the agent numbers excerpts and builds citations from these. */
  semanticResults?: SemanticSearchResult[];
}

interface SearchDocumentsArgs {
  query?: string;
  documentTypes?: string[];
  tags?: string[];
  correspondents?: string[];
  year?: number;
  dateFrom?: string;
  dateTo?: string;
  dueDateFrom?: string;
  dueDateTo?: string;
  expiryDateFrom?: string;
  expiryDateTo?: string;
  openTasksOnly?: boolean;
  amountMin?: number;
  amountMax?: number;
  sort?: "createdAt" | "issueDate" | "dueDate" | "title";
  sortDirection?: "asc" | "desc";
  limit?: number;
}

interface AggregateDocumentsArgs extends Omit<SearchDocumentsArgs, "sort" | "sortDirection" | "limit" | "query"> {
  groupBy: "documentType" | "correspondent" | "year" | "currency";
  metric?: "count" | "sum_amount";
}

/**
 * The chat agent's tool belt: thin executors over the existing filter/search
 * services. Filter values arrive as human-readable names (the model never sees
 * UUIDs) and are resolved case-insensitively; unresolved names are reported
 * back to the model so it can consult list_taxonomies and retry.
 */
@Injectable()
export class ChatToolsService {
  private readonly logger = new Logger(ChatToolsService.name);

  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
  ) {}

  getToolDefinitions(): LlmToolDefinition[] {
    const dateProperty = (description: string) => ({
      type: "string",
      description: `${description} (YYYY-MM-DD)`,
    });
    const nameListProperty = (description: string) => ({
      type: "array",
      items: { type: "string" },
      description,
    });

    // Shared filter properties for search + aggregate. Kept to plain
    // objects/arrays/scalars — Gemini's schema dialect rejects unions.
    const filterProperties: Record<string, unknown> = {
      documentTypes: nameListProperty('Document type names, e.g. ["Invoice", "Tax Statement"]'),
      tags: nameListProperty('Tag names, e.g. ["tax", "insurance"]'),
      correspondents: nameListProperty("Correspondent (sender) names"),
      year: { type: "integer", description: "Filter by issue year" },
      dateFrom: dateProperty("Earliest issue date"),
      dateTo: dateProperty("Latest issue date"),
      dueDateFrom: dateProperty("Earliest due date"),
      dueDateTo: dateProperty("Latest due date"),
      expiryDateFrom: dateProperty("Earliest expiry date"),
      expiryDateTo: dateProperty("Latest expiry date"),
      openTasksOnly: {
        type: "boolean",
        description: "Only documents with a due date that are not marked done (open invoices/tasks)",
      },
      amountMin: { type: "number" },
      amountMax: { type: "number" },
    };

    return [
      {
        name: "search_documents",
        description:
          "Search the archive by structured metadata. Use for every list/filter/lookup question " +
          "(documents of a type, from a sender, in a date range, with open due dates, by amount). " +
          "Returns matching documents with their metadata plus the total match count.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Optional full-text keywords to match in the document text",
            },
            ...filterProperties,
            sort: {
              type: "string",
              enum: ["createdAt", "issueDate", "dueDate", "title"],
            },
            sortDirection: { type: "string", enum: ["asc", "desc"] },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: MAX_SEARCH_LIMIT,
              description: `Max rows to return (default ${DEFAULT_SEARCH_LIMIT})`,
            },
          },
        },
      },
      {
        name: "aggregate_documents",
        description:
          "Count documents or sum their amounts, grouped by document type, correspondent, year, or currency. " +
          "Use for how-many/how-much questions instead of listing documents. Sums are always reported per currency.",
        parameters: {
          type: "object",
          properties: {
            groupBy: {
              type: "string",
              enum: ["documentType", "correspondent", "year", "currency"],
            },
            metric: {
              type: "string",
              enum: ["count", "sum_amount"],
              description: "count (default) or sum_amount",
            },
            ...filterProperties,
          },
          required: ["groupBy"],
        },
      },
      {
        name: "semantic_search",
        description:
          "Search document CONTENT for a question and get back numbered text excerpts. " +
          "Use for questions about what documents say (terms, conditions, statements). " +
          "Cite the excerpts you use inline as [n]. Not for listing or counting documents.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The content question or key phrase" },
            maxDocuments: {
              type: "integer",
              minimum: 1,
              maximum: MAX_SEMANTIC_DOCUMENTS,
              description: `How many documents to pull excerpts from (default ${DEFAULT_SEMANTIC_DOCUMENTS})`,
            },
          },
          required: ["query"],
        },
      },
      {
        name: "list_taxonomies",
        description:
          "List the archive's document types, tags, or correspondents with document counts. " +
          "Use to resolve exact names when a filter value did not match anything.",
        parameters: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: ["document_types", "tags", "correspondents"],
            },
            query: { type: "string", description: "Optional name fragment to narrow the list" },
          },
          required: ["kind"],
        },
      },
    ];
  }

  /** Short human-readable label for the tool-status SSE event. */
  describeCall(call: LlmToolCall, language: "en" | "de"): string {
    const de = language === "de";
    switch (call.name) {
      case "search_documents":
        return de ? "Durchsuche Dokumente nach Metadaten" : "Searching documents by metadata";
      case "aggregate_documents":
        return de ? "Berechne Kennzahlen über Dokumente" : "Aggregating document metrics";
      case "semantic_search":
        return de ? "Durchsuche Dokumentinhalte" : "Searching document contents";
      case "list_taxonomies":
        return de ? "Lade Archiv-Kategorien" : "Loading archive taxonomy";
      default:
        return call.name;
    }
  }

  /**
   * Executes a tool call. Failures are returned as `{ error }` tool results
   * instead of thrown — the model can recover (retry, different tool) while a
   * thrown error would abort the whole answer.
   */
  async execute(call: LlmToolCall, principal: AuthenticatedPrincipal): Promise<ChatToolExecution> {
    try {
      switch (call.name) {
        case "search_documents":
          return await this.searchDocuments(call.arguments as SearchDocumentsArgs, principal);
        case "aggregate_documents":
          return await this.aggregateDocuments(
            call.arguments as unknown as AggregateDocumentsArgs,
            principal,
          );
        case "semantic_search":
          return await this.semanticSearch(call.arguments, principal);
        case "list_taxonomies":
          return await this.listTaxonomies(call.arguments, principal);
        default:
          return { resultForModel: { error: `Unknown tool: ${call.name}` } };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool execution failed";
      this.logger.warn(`Chat tool ${call.name} failed: ${message}`);
      return { resultForModel: { error: message } };
    }
  }

  // ---------------------------------------------------------------------------
  // search_documents
  // ---------------------------------------------------------------------------

  private async searchDocuments(
    args: SearchDocumentsArgs,
    principal: AuthenticatedPrincipal,
  ): Promise<ChatToolExecution> {
    const { filters, unmatched } = await this.resolveFilters(args);
    const limit = clampLimit(args.limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);

    const response = await this.documentsService.listDocuments(
      {
        query: args.query,
        filters,
        sort: args.sort ?? "createdAt",
        direction: args.sortDirection ?? "desc",
        page: 1,
        pageSize: limit,
      },
      principal.userId,
    );

    return {
      resultForModel: {
        totalCount: response.total,
        returnedCount: response.items.length,
        ...(unmatched.length > 0 ? { unmatchedFilters: unmatched } : {}),
        documents: response.items.map((item) => this.toCompactRow(item)),
      },
      documents: response.items,
      documentsTotal: response.total,
    };
  }

  private toCompactRow(document: Document): Record<string, unknown> {
    return {
      id: document.id,
      title: document.title,
      type: document.documentType?.name ?? null,
      correspondent: document.correspondent?.name ?? null,
      issueDate: document.issueDate,
      dueDate: document.dueDate,
      expiryDate: document.expiryDate,
      amount: document.amount,
      currency: document.currency,
      tags: document.tags.map((tag) => tag.name),
    };
  }

  // ---------------------------------------------------------------------------
  // aggregate_documents
  // ---------------------------------------------------------------------------

  private async aggregateDocuments(
    args: AggregateDocumentsArgs,
    principal: AuthenticatedPrincipal,
  ): Promise<ChatToolExecution> {
    const { filters, unmatched } = await this.resolveFilters(args);
    const metric = args.metric ?? "count";
    const { whereSql, params } = this.documentsService.buildDocumentFilterQuery(
      filters,
      principal.userId,
    );

    const groupExpressions: Record<AggregateDocumentsArgs["groupBy"], { select: string; join: string }> = {
      documentType: {
        select: `coalesce(dt.name, 'Unfiled')`,
        join: `LEFT JOIN document_types dt ON dt.id = d.document_type_id`,
      },
      correspondent: {
        select: `coalesce(c.name, 'Unknown')`,
        join: `LEFT JOIN correspondents c ON c.id = d.correspondent_id`,
      },
      year: {
        select: `extract(year from coalesce(d.issue_date, d.created_at::date))::int::text`,
        join: "",
      },
      currency: {
        select: `coalesce(d.currency, 'none')`,
        join: "",
      },
    };
    const group = groupExpressions[args.groupBy];
    if (!group) {
      return { resultForModel: { error: `Unsupported groupBy: ${String(args.groupBy)}` } };
    }

    // Sums without a currency dimension would silently add EUR to USD, so
    // sum_amount always carries the currency in the group key.
    const withCurrency = metric === "sum_amount" && args.groupBy !== "currency";
    const currencySelect = withCurrency ? `, coalesce(d.currency, 'none') AS currency` : "";
    const currencyGroup = withCurrency ? `, coalesce(d.currency, 'none')` : "";
    const sumSelect = metric === "sum_amount" ? `, sum(d.amount)::float AS total_amount` : "";

    const result = await this.databaseService.pool.query<{
      group_key: string;
      currency?: string;
      count: number;
      total_amount?: number | null;
    }>(
      `SELECT ${group.select} AS group_key${currencySelect}, count(*)::int AS count${sumSelect}
       FROM documents d
       ${group.join}
       WHERE ${whereSql}
       GROUP BY ${group.select}${currencyGroup}
       ORDER BY count DESC
       LIMIT 100`,
      params,
    );

    return {
      resultForModel: {
        groupBy: args.groupBy,
        metric,
        ...(unmatched.length > 0 ? { unmatchedFilters: unmatched } : {}),
        groups: result.rows.map((row) => ({
          group: row.group_key,
          ...(row.currency !== undefined ? { currency: row.currency } : {}),
          count: row.count,
          ...(metric === "sum_amount" ? { totalAmount: row.total_amount ?? 0 } : {}),
        })),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // semantic_search
  // ---------------------------------------------------------------------------

  private async semanticSearch(
    args: Record<string, unknown>,
    principal: AuthenticatedPrincipal,
  ): Promise<ChatToolExecution> {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) {
      return { resultForModel: { error: "semantic_search requires a non-empty query" } };
    }

    const maxDocuments = clampLimit(
      typeof args.maxDocuments === "number" ? args.maxDocuments : undefined,
      DEFAULT_SEMANTIC_DOCUMENTS,
      MAX_SEMANTIC_DOCUMENTS,
    );

    const results = await this.documentsService.semanticSearch(
      {
        query,
        page: 1,
        pageSize: maxDocuments,
        maxChunkMatches: 6,
      },
      principal.userId,
    );

    // The agent numbers the excerpts and serializes the tool result itself —
    // excerpt indices are global across all semantic_search calls of one turn.
    return { resultForModel: null, semanticResults: results.items };
  }

  // ---------------------------------------------------------------------------
  // list_taxonomies
  // ---------------------------------------------------------------------------

  private async listTaxonomies(
    args: Record<string, unknown>,
    principal: AuthenticatedPrincipal,
  ): Promise<ChatToolExecution> {
    const kind = typeof args.kind === "string" ? args.kind : "";
    const fragment = typeof args.query === "string" ? args.query.trim() : "";

    const queries: Record<string, { sql: string }> = {
      document_types: {
        sql: `SELECT dt.name, count(d.id)::int AS count
              FROM document_types dt
              LEFT JOIN documents d ON d.document_type_id = dt.id AND d.owner_user_id = $1
              WHERE ($2 = '' OR dt.name ILIKE '%' || $2 || '%')
              GROUP BY dt.name ORDER BY count DESC, dt.name ASC LIMIT ${TAXONOMY_LOOKUP_LIMIT}`,
      },
      tags: {
        sql: `SELECT t.name, count(dtl.document_id)::int AS count
              FROM tags t
              LEFT JOIN document_tag_links dtl ON dtl.tag_id = t.id
              LEFT JOIN documents d ON d.id = dtl.document_id AND d.owner_user_id = $1
              WHERE ($2 = '' OR t.name ILIKE '%' || $2 || '%')
              GROUP BY t.name ORDER BY count DESC, t.name ASC LIMIT ${TAXONOMY_LOOKUP_LIMIT}`,
      },
      correspondents: {
        sql: `SELECT c.name, count(d.id)::int AS count
              FROM correspondents c
              LEFT JOIN documents d ON d.correspondent_id = c.id AND d.owner_user_id = $1
              WHERE ($2 = '' OR c.name ILIKE '%' || $2 || '%')
              GROUP BY c.name ORDER BY count DESC, c.name ASC LIMIT ${TAXONOMY_LOOKUP_LIMIT}`,
      },
    };

    const entry = queries[kind];
    if (!entry) {
      return {
        resultForModel: { error: `Unknown taxonomy kind: ${kind}. Use document_types, tags, or correspondents.` },
      };
    }

    const result = await this.databaseService.pool.query<{ name: string; count: number }>(
      entry.sql,
      [principal.userId, fragment],
    );

    return { resultForModel: { kind, entries: result.rows } };
  }

  // ---------------------------------------------------------------------------
  // Taxonomy summary for the system prompt
  // ---------------------------------------------------------------------------

  /** Compact archive overview injected into the system prompt (types are few; tags capped). */
  async getTaxonomySummary(userId: string): Promise<{ documentTypes: string[]; tags: string[] }> {
    const [typesResult, tagsResult] = await Promise.all([
      this.databaseService.pool.query<{ name: string }>(
        `SELECT dt.name
         FROM document_types dt
         LEFT JOIN documents d ON d.document_type_id = dt.id AND d.owner_user_id = $1
         GROUP BY dt.name ORDER BY count(d.id) DESC, dt.name ASC LIMIT 40`,
        [userId],
      ),
      this.databaseService.pool.query<{ name: string }>(
        `SELECT t.name
         FROM tags t
         LEFT JOIN document_tag_links dtl ON dtl.tag_id = t.id
         LEFT JOIN documents d ON d.id = dtl.document_id AND d.owner_user_id = $1
         GROUP BY t.name ORDER BY count(d.id) DESC, t.name ASC LIMIT 30`,
        [userId],
      ),
    ]);

    return {
      documentTypes: typesResult.rows.map((row) => row.name),
      tags: tagsResult.rows.map((row) => row.name),
    };
  }

  // ---------------------------------------------------------------------------
  // Name → id resolution
  // ---------------------------------------------------------------------------

  private async resolveFilters(
    args: SearchDocumentsArgs | AggregateDocumentsArgs,
  ): Promise<{ filters: SearchDocumentsFilters; unmatched: string[] }> {
    const unmatched: string[] = [];

    const [documentTypeIds, tagIds, correspondentIds] = await Promise.all([
      this.resolveNames("document_types", args.documentTypes, unmatched),
      this.resolveNames("tags", args.tags, unmatched),
      this.resolveNames("correspondents", args.correspondents, unmatched),
    ]);

    const filters: SearchDocumentsFilters = {
      year: args.year,
      dateFrom: args.dateFrom,
      dateTo: args.dateTo,
      dueDateFrom: args.dueDateFrom,
      dueDateTo: args.dueDateTo,
      expiryDateFrom: args.expiryDateFrom,
      expiryDateTo: args.expiryDateTo,
      openTasksOnly: args.openTasksOnly,
      amountMin: args.amountMin,
      amountMax: args.amountMax,
      documentTypeIds: documentTypeIds.length > 0 ? documentTypeIds : undefined,
      tags: tagIds.length > 0 ? tagIds : undefined,
      correspondentIds: correspondentIds.length > 0 ? correspondentIds : undefined,
    };

    return { filters, unmatched };
  }

  /**
   * Case-insensitive name→id resolution against exact name/slug matches first,
   * then a contains-match as fallback. Names that resolve to nothing are
   * collected for the model instead of silently dropping the filter — an
   * unmatched type would otherwise widen the query and return wrong results.
   */
  private async resolveNames(
    table: "document_types" | "tags" | "correspondents",
    names: string[] | undefined,
    unmatched: string[],
  ): Promise<string[]> {
    if (!names || names.length === 0) {
      return [];
    }

    const ids = new Set<string>();
    for (const rawName of names) {
      const name = rawName.trim();
      if (!name) {
        continue;
      }

      const exact = await this.databaseService.pool.query<{ id: string }>(
        `SELECT id FROM ${table} WHERE lower(name) = lower($1) OR slug = lower($1) LIMIT 1`,
        [name],
      );
      if (exact.rows[0]) {
        ids.add(exact.rows[0].id);
        continue;
      }

      const partial = await this.databaseService.pool.query<{ id: string }>(
        `SELECT id FROM ${table} WHERE name ILIKE '%' || $1 || '%' ORDER BY length(name) ASC LIMIT 2`,
        [name],
      );
      // A fragment matching several entries is ambiguous — report it instead of
      // guessing (e.g. "Versicherung" matching two insurers).
      if (partial.rows.length === 1) {
        ids.add(partial.rows[0]!.id);
      } else {
        unmatched.push(name);
      }
    }

    return [...ids];
  }
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.min(Math.floor(value), max);
}
