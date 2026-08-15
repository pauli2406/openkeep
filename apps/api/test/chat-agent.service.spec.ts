import { describe, expect, it, vi } from "vitest";

import { ChatAgentService, ChatAgentUnavailableError } from "../src/search/chat-agent.service";
import type { LlmStreamChunk } from "../src/processing/llm.service";

function makeLanguageDb(language: "en" | "de") {
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [{ aiChatLanguage: language }]),
          })),
        })),
      })),
    },
  };
}

function makeChatTools(overrides: Record<string, unknown> = {}) {
  return {
    getToolDefinitions: vi.fn(() => [
      { name: "search_documents", description: "Search", parameters: { type: "object" } },
    ]),
    getTaxonomySummary: vi.fn(async () => ({ documentTypes: ["Invoice"], tags: ["tax"], categories: ["Insurance"] })),
    describeCall: vi.fn(() => "Searching documents"),
    execute: vi.fn(async () => ({ resultForModel: { totalCount: 0, documents: [] } })),
    ...overrides,
  };
}

async function* chunkStream(chunks: LlmStreamChunk[]): AsyncGenerator<LlmStreamChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function makeService(llmRounds: LlmStreamChunk[][], chatTools = makeChatTools()) {
  const streamWithFallback = vi.fn();
  for (const round of llmRounds) {
    streamWithFallback.mockImplementationOnce(() => chunkStream(round));
  }
  const llmService = { isConfigured: () => true, streamWithFallback };

  const service = new ChatAgentService(
    makeLanguageDb("en") as never,
    llmService as never,
    chatTools as never,
  );

  return { service, streamWithFallback, chatTools };
}

async function collect(service: ChatAgentService, query = "test question") {
  const events: string[] = [];
  for await (const chunk of service.streamSse(
    { query, maxDocuments: 5, maxCitations: 6, maxChunkMatches: 6 },
    { userId: "user-1" } as never,
  )) {
    events.push(chunk);
  }
  return events;
}

function parseEvents(raw: string[]): Array<{ event: string; data: any }> {
  return raw.map((entry) => {
    const match = /^event: (\S+)\ndata: (.*)\n\n$/s.exec(entry);
    if (!match) throw new Error(`Unparseable SSE frame: ${entry}`);
    return { event: match[1]!, data: JSON.parse(match[2]!) };
  });
}

describe("ChatAgentService", () => {
  it("streams a direct answer without tool rounds as route=semantic", async () => {
    const { service, streamWithFallback } = makeService([
      [
        { text: "Hello ", done: false },
        { text: "there.", done: false },
        { text: "", done: true, provider: "openai", model: "gpt-4.1-mini" },
      ],
    ]);

    const events = parseEvents(await collect(service));

    expect(streamWithFallback).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.event)).toEqual([
      "answer-token",
      "answer-token",
      "search-results",
      "done",
    ]);
    const done = events.at(-1)!.data;
    expect(done.status).toBe("answered");
    expect(done.route).toBe("semantic");
    expect(done.fullAnswer).toBe("Hello there.");
    expect(done.citations).toEqual([]);
  });

  it("executes tool calls, pins the provider, and emits tool-status plus document_table", async () => {
    const documents = [{ id: "doc-1", title: "Invoice A" }, { id: "doc-2", title: "Invoice B" }];
    const chatTools = makeChatTools({
      execute: vi.fn(async () => ({
        resultForModel: { totalCount: 2 },
        documents,
        documentsTotal: 2,
      })),
    });

    const { service, streamWithFallback } = makeService(
      [
        [
          {
            text: "",
            done: true,
            toolCalls: [{ id: "call_1", name: "search_documents", arguments: { year: 2025 } }],
            provider: "mistral",
            model: "mistral-large-latest",
          },
        ],
        [
          { text: "You have 2 invoices.", done: false },
          { text: "", done: true, provider: "mistral", model: "mistral-large-latest" },
        ],
      ],
      chatTools,
    );

    const events = parseEvents(await collect(service));

    expect(chatTools.execute).toHaveBeenCalledWith(
      { id: "call_1", name: "search_documents", arguments: { year: 2025 } },
      { userId: "user-1" },
    );

    // Provider pinned after round 1: round 2 must receive ["mistral"].
    expect(streamWithFallback).toHaveBeenCalledTimes(2);
    expect(streamWithFallback.mock.calls[1]?.[1]).toEqual(["mistral"]);

    const statusEvents = events.filter((e) => e.event === "tool-status");
    expect(statusEvents.map((e) => e.data.status)).toEqual(["started", "completed"]);

    const done = events.at(-1)!.data;
    expect(done.route).toBe("hybrid");
    expect(done.structuredData).toEqual({
      kind: "document_table",
      title: "Matching documents",
      description: null,
      items: documents,
      totalCount: 2,
    });

    // The tool result must have been appended to the conversation.
    const round2Messages = streamWithFallback.mock.calls[1]?.[0]?.messages;
    expect(round2Messages.at(-2)).toMatchObject({
      role: "assistant",
      toolCalls: [{ id: "call_1", name: "search_documents" }],
    });
    expect(round2Messages.at(-1)).toMatchObject({
      role: "tool",
      toolCallId: "call_1",
      name: "search_documents",
    });
  });

  it("numbers semantic excerpts globally and returns them as citations", async () => {
    const semanticResults = [
      {
        document: {
          id: "22222222-2222-2222-2222-222222222222",
          title: "Lease contract",
          issueDate: "2025-01-01",
          correspondent: { name: "Landlord GmbH" },
          documentType: { name: "Contract" },
        },
        score: 0.8,
        matchedChunks: [
          {
            chunkIndex: 4,
            heading: null,
            text: "The notice period is three months.",
            pageFrom: 2,
            pageTo: 2,
            score: 0.8,
            distance: 0.2,
          },
          // Below the 0.4 relevance threshold — must not become a citation.
          {
            chunkIndex: 9,
            heading: null,
            text: "Unrelated boilerplate.",
            pageFrom: 7,
            pageTo: 7,
            score: 0.1,
            distance: 0.9,
          },
        ],
      },
    ];
    const chatTools = makeChatTools({
      execute: vi.fn(async () => ({ resultForModel: null, semanticResults })),
    });

    const { service, streamWithFallback } = makeService(
      [
        [
          {
            text: "",
            done: true,
            toolCalls: [{ id: "call_1", name: "semantic_search", arguments: { query: "notice" } }],
            provider: "openai",
            model: "gpt-4.1-mini",
          },
        ],
        [
          { text: "Three months [1].", done: false },
          { text: "", done: true, provider: "openai", model: "gpt-4.1-mini" },
        ],
      ],
      chatTools,
    );

    const events = parseEvents(await collect(service));

    const done = events.at(-1)!.data;
    expect(done.citations).toHaveLength(1);
    expect(done.citations[0]).toMatchObject({
      documentId: "22222222-2222-2222-2222-222222222222",
      chunkIndex: 4,
      index: 1,
      pageFrom: 2,
    });

    const searchResults = events.find((e) => e.event === "search-results")!.data;
    expect(searchResults.results).toHaveLength(1);

    // The model must have seen the numbered excerpt (only the relevant one).
    const toolMessage = streamWithFallback.mock.calls[1]?.[0]?.messages.at(-1);
    const payload = JSON.parse(toolMessage.content);
    expect(payload.excerpts).toHaveLength(1);
    expect(payload.excerpts[0]).toMatchObject({ index: 1, page: 2 });
  });

  it("forces an answer with toolChoice none on the final round", async () => {
    const toolCallRound: LlmStreamChunk[] = [
      {
        text: "",
        done: true,
        toolCalls: [{ id: "call_x", name: "search_documents", arguments: {} }],
        provider: "openai",
        model: "gpt-4.1-mini",
      },
    ];
    const { service, streamWithFallback } = makeService([
      toolCallRound,
      toolCallRound,
      toolCallRound,
      [
        { text: "Final answer.", done: false },
        { text: "", done: true, provider: "openai", model: "gpt-4.1-mini" },
      ],
    ]);

    const events = parseEvents(await collect(service));

    expect(streamWithFallback).toHaveBeenCalledTimes(4);
    expect(streamWithFallback.mock.calls[0]?.[0]?.toolChoice).toBe("auto");
    expect(streamWithFallback.mock.calls[3]?.[0]?.toolChoice).toBe("none");
    expect(events.at(-1)!.data.fullAnswer).toBe("Final answer.");
  });

  it("throws ChatAgentUnavailableError when the LLM fails before any output", async () => {
    const { service } = makeService([
      [{ text: "", done: true, error: "OpenAI request failed (HTTP 401)" }],
    ]);

    // Nothing reached the client, so the caller can still fall back to the
    // classic route instead of surfacing an error.
    await expect(collect(service)).rejects.toBeInstanceOf(ChatAgentUnavailableError);
  });

  it("reports a mid-answer failure as an SSE error event instead of throwing", async () => {
    const { service } = makeService([
      [
        { text: "Partial answer", done: false },
        { text: "", done: true, error: "connection reset" },
      ],
    ]);

    const events = parseEvents(await collect(service));
    expect(events.map((e) => e.event)).toEqual(["answer-token", "error"]);
    expect(events[1]!.data.message).toContain("connection reset");
  });

  it("reports a failure after a tool round as an event: the tool status is already out", async () => {
    const { service } = makeService([
      [
        {
          text: "",
          done: true,
          toolCalls: [{ id: "call_1", name: "search_documents", arguments: {} }],
          provider: "openai",
          model: "gpt-4.1-mini",
        },
      ],
      [{ text: "", done: true, error: "provider exploded" }],
    ]);

    const events = parseEvents(await collect(service));
    expect(events.at(-1)!.event).toBe("error");
  });
});
