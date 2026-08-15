import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { users } from "@openkeep/db";
import type {
  AnswerCitation,
  AnswerQueryRequest,
  AnswerQueryResponse,
  AnswerStructuredPayload,
  SemanticSearchResult,
} from "@openkeep/types";
import { eq } from "drizzle-orm";

import type { AuthenticatedPrincipal } from "../auth/auth.types";
import { AppConfigService } from "../common/config/app-config.service";
import { DatabaseService } from "../common/db/database.service";
import {
  buildCitationQuote,
  finalizeCitations,
} from "../processing/citation-usage.util";
import {
  LlmService,
  type LlmMessage,
  type LlmProviderId,
  type LlmToolCall,
} from "../processing/llm.service";
import { DEFAULT_ANSWER_MIN_CHUNK_SCORE } from "../processing/relevance.constants";
import { ChatToolsService } from "./chat-tools.service";

/**
 * Tool rounds before the model is forced to answer. Each round is one LLM
 * call; typical turns use 1-2 (one search + the answer).
 */
const MAX_TOOL_ROUNDS = 4;
/** Hard cap across all rounds so a looping model cannot hammer the DB. */
const MAX_TOOL_CALLS = 8;
/** Rows carried into the client-side document table. */
const MAX_TABLE_ROWS = 25;

/**
 * Raised when the agent fails before anything reached the client — no tokens,
 * no tool status. The caller can still answer via the classic route (structured
 * router / plain RAG), which degrades gracefully when no LLM is reachable.
 * Once output is on the wire the error is reported as an event instead.
 */
export class ChatAgentUnavailableError extends Error {}

export type ChatAgentEvent =
  | { type: "search-results"; results: SemanticSearchResult[] }
  | {
      type: "tool-status";
      tool: string;
      label: string;
      status: "started" | "completed";
      summary?: string;
    }
  | { type: "token"; text: string }
  | {
      type: "done";
      status: AnswerQueryResponse["status"];
      route: AnswerQueryResponse["route"];
      fullAnswer: string | null;
      citations: AnswerCitation[];
      structuredData: AnswerStructuredPayload | null;
    }
  | { type: "error"; message: string };

/**
 * Tool-calling chat agent over the archive: the model decides per turn whether
 * to hit the metadata filter API (lists, counts, sums), the semantic index
 * (content questions), or both, then answers with [n] citations into the
 * excerpts it retrieved. Replaces the regex intent router for LLM-configured
 * installations.
 */
@Injectable()
export class ChatAgentService {
  private readonly logger = new Logger(ChatAgentService.name);

  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(LlmService) private readonly llmService: LlmService,
    @Inject(ChatToolsService) private readonly chatTools: ChatToolsService,
    @Optional() private readonly configService?: AppConfigService,
  ) {}

  isAvailable(): boolean {
    return this.llmService.isConfigured();
  }

  async *streamSse(
    request: AnswerQueryRequest,
    principal: AuthenticatedPrincipal,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    for await (const event of this.run(request, principal, signal)) {
      switch (event.type) {
        case "search-results":
          yield `event: search-results\ndata: ${JSON.stringify({ results: event.results })}\n\n`;
          break;
        case "tool-status":
          yield `event: tool-status\ndata: ${JSON.stringify({
            tool: event.tool,
            label: event.label,
            status: event.status,
            summary: event.summary ?? null,
          })}\n\n`;
          break;
        case "token":
          yield `event: answer-token\ndata: ${JSON.stringify({ text: event.text })}\n\n`;
          break;
        case "done":
          yield `event: done\ndata: ${JSON.stringify({
            status: event.status,
            route: event.route,
            fullAnswer: event.fullAnswer,
            citations: event.citations,
            structuredData: event.structuredData,
          })}\n\n`;
          break;
        case "error":
          yield `event: error\ndata: ${JSON.stringify({ message: event.message })}\n\n`;
          break;
      }
    }
  }

  async answer(
    request: AnswerQueryRequest,
    principal: AuthenticatedPrincipal,
    signal?: AbortSignal,
  ): Promise<AnswerQueryResponse> {
    let answerText = "";
    let results: SemanticSearchResult[] = [];

    for await (const event of this.run(request, principal, signal)) {
      if (event.type === "token") {
        answerText += event.text;
      } else if (event.type === "search-results") {
        results = event.results;
      } else if (event.type === "error") {
        throw new Error(event.message);
      } else if (event.type === "done") {
        return {
          status: event.status,
          route: event.route,
          answer: event.fullAnswer,
          reasoning: null,
          citations: event.citations,
          results,
          structuredData: event.structuredData,
        };
      }
    }

    return {
      status: answerText.length > 0 ? "answered" : "insufficient_evidence",
      route: "semantic",
      answer: answerText || null,
      reasoning: null,
      citations: [],
      results,
      structuredData: null,
    };
  }

  // ---------------------------------------------------------------------------
  // Agent loop
  // ---------------------------------------------------------------------------

  private async *run(
    request: AnswerQueryRequest,
    principal: AuthenticatedPrincipal,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatAgentEvent> {
    const language = await this.getUserAiChatLanguage(principal.userId);
    const taxonomy = await this.chatTools.getTaxonomySummary(principal.userId);

    const messages: LlmMessage[] = [
      { role: "system", content: this.buildSystemPrompt(language, taxonomy) },
      ...(request.history ?? []).map(
        (turn): LlmMessage => ({ role: turn.role, content: turn.content }),
      ),
      { role: "user", content: request.query },
    ];

    const tools = this.chatTools.getToolDefinitions();
    const citations: AnswerCitation[] = [];
    const seenExcerpts = new Set<string>();
    const semanticResults: SemanticSearchResult[] = [];
    let structuredData: AnswerStructuredPayload | null = null;
    let fullAnswer = "";
    let usedTools = false;
    let totalToolCalls = 0;
    let providerOrder: LlmProviderId[] | undefined;
    // Whether anything has reached the client yet; decides between failing over
    // to the classic route and reporting the error on the wire.
    let emittedOutput = false;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const forceAnswer = round === MAX_TOOL_ROUNDS - 1 || totalToolCalls >= MAX_TOOL_CALLS;
      const stream = this.llmService.streamWithFallback(
        {
          messages,
          tools,
          toolChoice: forceAnswer ? "none" : "auto",
          temperature: 0.1,
          maxTokens: 1024,
          signal,
        },
        providerOrder,
      );

      let roundText = "";
      let toolCalls: LlmToolCall[] | undefined;
      let streamError: string | undefined;

      for await (const chunk of stream) {
        if (chunk.done) {
          streamError = chunk.error;
          toolCalls = chunk.toolCalls;
          if (chunk.provider) {
            // Pin the provider that answered round 1 for the rest of the turn:
            // tool-call ids in the message history are dialect-specific.
            providerOrder = [chunk.provider];
          }
          break;
        }
        if (chunk.text.length > 0) {
          roundText += chunk.text;
          fullAnswer += chunk.text;
          emittedOutput = true;
          yield { type: "token", text: chunk.text };
        }
      }

      if (signal?.aborted) {
        return;
      }

      if (streamError) {
        if (!emittedOutput) {
          throw new ChatAgentUnavailableError(streamError);
        }
        yield { type: "error", message: streamError };
        return;
      }

      if (!toolCalls || toolCalls.length === 0) {
        break;
      }

      usedTools = true;
      messages.push({ role: "assistant", content: roundText, toolCalls });

      for (const call of toolCalls) {
        totalToolCalls += 1;
        const label = this.chatTools.describeCall(call, language);
        emittedOutput = true;
        yield { type: "tool-status", tool: call.name, label, status: "started" };

        const execution = await this.chatTools.execute(call, principal);

        let resultContent: string;
        let summary: string | undefined;
        if (execution.semanticResults) {
          const appended = this.appendExcerpts(
            execution.semanticResults,
            citations,
            seenExcerpts,
            semanticResults,
          );
          resultContent = JSON.stringify(appended.resultForModel);
          summary = appended.summary;
        } else {
          resultContent = JSON.stringify(execution.resultForModel ?? null);
          if (execution.documents && execution.documents.length > 0) {
            structuredData = {
              kind: "document_table",
              title: language === "de" ? "Gefundene Dokumente" : "Matching documents",
              description: null,
              items: execution.documents.slice(0, MAX_TABLE_ROWS),
              totalCount: execution.documentsTotal ?? execution.documents.length,
            };
            summary = `${execution.documentsTotal ?? execution.documents.length}`;
          }
        }

        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: resultContent,
        });
        yield { type: "tool-status", tool: call.name, label, status: "completed", summary };
      }
    }

    yield { type: "search-results", results: semanticResults };
    const answerText = fullAnswer.trim();
    yield {
      type: "done",
      status: answerText.length > 0 ? "answered" : "insufficient_evidence",
      route: usedTools ? "hybrid" : "semantic",
      fullAnswer: answerText.length > 0 ? fullAnswer : null,
      // Used citations always survive; unused excerpts fill up to maxCitations
      // as collapsed "further matches" material.
      citations: finalizeCitations(citations, answerText, request.maxCitations),
      structuredData,
    };
  }

  /**
   * Numbers fresh semantic excerpts into the turn-global citation ledger and
   * builds the tool result the model sees. Chunks below the relevance
   * threshold are dropped — the same guard the classic RAG path applies before
   * prompting (confident answers from irrelevant chunks).
   */
  private appendExcerpts(
    results: SemanticSearchResult[],
    citations: AnswerCitation[],
    seenExcerpts: Set<string>,
    semanticResults: SemanticSearchResult[],
  ): { resultForModel: unknown; summary?: string } {
    const minScore =
      this.configService?.get("ANSWER_MIN_CHUNK_SCORE") ?? DEFAULT_ANSWER_MIN_CHUNK_SCORE;

    const excerpts: Array<Record<string, unknown>> = [];
    for (const result of results) {
      let resultUsed = false;
      for (const chunk of result.matchedChunks) {
        if (chunk.score < minScore) {
          continue;
        }
        const key = `${result.document.id}:${chunk.chunkIndex}`;
        if (seenExcerpts.has(key)) {
          continue;
        }
        seenExcerpts.add(key);
        resultUsed = true;

        const index = citations.length + 1;
        citations.push({
          documentId: result.document.id,
          documentTitle: result.document.title,
          chunkIndex: chunk.chunkIndex,
          pageFrom: chunk.pageFrom,
          pageTo: chunk.pageTo,
          quote: buildCitationQuote(chunk.text),
          score: chunk.score,
          index,
        });
        excerpts.push({
          index,
          document: result.document.title,
          correspondent: result.document.correspondent?.name ?? null,
          type: result.document.documentType?.name ?? null,
          issueDate: result.document.issueDate,
          page: chunk.pageFrom,
          relevance: Math.round(chunk.score * 100),
          text: chunk.text,
        });
      }

      if (resultUsed && !semanticResults.some((r) => r.document.id === result.document.id)) {
        semanticResults.push(result);
      }
    }

    if (excerpts.length === 0) {
      return {
        resultForModel: {
          excerpts: [],
          note: "No sufficiently relevant excerpts found. Say so if you cannot answer from other evidence; do not guess.",
        },
      };
    }

    return {
      resultForModel: {
        excerpts,
        note: "Cite the excerpts you use inline as [n] using the given index.",
      },
      summary: `${excerpts.length}`,
    };
  }

  private buildSystemPrompt(
    language: "en" | "de",
    taxonomy: { documentTypes: string[]; tags: string[]; categories: string[] },
  ): string {
    const today = new Date().toISOString().slice(0, 10);
    const languageInstruction =
      language === "de"
        ? "Answer in German."
        : "Answer in English unless the question is asked in another language — then answer in that language.";

    return [
      "You are OpenKeep's archive assistant. You answer questions about the user's personal document archive using tools.",
      `Today is ${today}.`,
      "",
      "Tool policy:",
      "- Listing/filtering/counting/summing questions (which documents, how many, how much, what is open/overdue/expiring): use search_documents or aggregate_documents. Never answer these from text excerpts or memory.",
      "- Content questions (what a document says, terms, conditions): use semantic_search and base every claim on the returned excerpts, cited inline as [n]. Never fabricate.",
      "- If a type/tag/correspondent filter comes back in unmatchedFilters, look up the exact name with list_taxonomies once and retry.",
      "- Combine tools when needed (e.g. filter first, then read content).",
      "",
      "Answer style:",
      "- Be concise and direct; no preamble.",
      `- ${languageInstruction}`,
      "- Include amounts, dates, and key terms precisely.",
      "- If the evidence is insufficient, say so clearly instead of guessing.",
      "",
      "Archive overview:",
      `- Document types: ${taxonomy.documentTypes.join(", ") || "none yet"}`,
      `- Common tags: ${taxonomy.tags.join(", ") || "none yet"}`,
      `- Life-domain categories (filter with the categories parameter): ${taxonomy.categories.join(", ") || "none yet"}`,
    ].join("\n");
  }

  private async getUserAiChatLanguage(userId: string): Promise<"en" | "de"> {
    const [user] = await this.databaseService.db
      .select({ aiChatLanguage: users.aiChatLanguage })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return user?.aiChatLanguage === "de" ? "de" : "en";
  }
}
