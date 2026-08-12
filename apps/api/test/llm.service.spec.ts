import { afterEach, describe, expect, it, vi } from "vitest";

import { LlmService } from "../src/processing/llm.service";

const createConfigService = (values: Record<string, string | undefined>) =>
  ({
    get(key: string) {
      return values[key];
    },
  }) as any;

describe("LlmService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers OpenAI over Gemini and Mistral when multiple providers are configured", () => {
    const service = new LlmService(
      createConfigService({
        OPENAI_API_KEY: "openai-key",
        OPENAI_MODEL: "gpt-4.1-mini",
        GEMINI_API_KEY: "gemini-key",
        GEMINI_MODEL: "gemini-2.0-flash",
        MISTRAL_API_KEY: "mistral-key",
        MISTRAL_MODEL: "mistral-small-latest",
        MISTRAL_API_BASE_URL: "https://api.mistral.ai",
      }),
    );

    expect(service.getProviderInfo()).toEqual({
      provider: "openai",
      model: "gpt-4.1-mini",
    });
  });

  it("keeps the remaining providers as failover candidates behind the pinned provider", () => {
    const service = new LlmService(
      createConfigService({
        ACTIVE_CHAT_PROVIDER: "mistral",
        OPENAI_API_KEY: "openai-key",
        OPENAI_MODEL: "gpt-4.1-mini",
        GEMINI_API_KEY: "gemini-key",
        GEMINI_MODEL: "gemini-2.0-flash",
        MISTRAL_API_KEY: "mistral-key",
        MISTRAL_MODEL: "mistral-small-latest",
      }),
    );

    expect(service.getDefaultProviderOrder()).toEqual(["mistral", "openai", "gemini"]);
    expect(service.getAvailableProviderInfos().map((info) => info.provider)).toEqual([
      "mistral",
      "openai",
      "gemini",
    ]);
  });

  it("uses ACTIVE_CHAT_PROVIDER when multiple providers are configured", () => {
    const service = new LlmService(
      createConfigService({
        ACTIVE_CHAT_PROVIDER: "mistral",
        OPENAI_API_KEY: "openai-key",
        OPENAI_MODEL: "gpt-4.1-mini",
        GEMINI_API_KEY: "gemini-key",
        GEMINI_MODEL: "gemini-2.0-flash",
        MISTRAL_API_KEY: "mistral-key",
        MISTRAL_MODEL: "mistral-small-latest",
        MISTRAL_API_BASE_URL: "https://api.mistral.ai",
      }),
    );

    expect(service.getProviderInfo()).toEqual({
      provider: "mistral",
      model: "mistral-small-latest",
    });
  });

  it("uses Mistral when it is the only configured chat provider", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Mistral answer" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const service = new LlmService(
      createConfigService({
        MISTRAL_API_KEY: "mistral-key",
        MISTRAL_MODEL: "mistral-small-latest",
        MISTRAL_API_BASE_URL: "https://api.mistral.ai",
      }),
    );

    const result = await service.complete({
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0.3,
      maxTokens: 128,
    });

    expect(result).toBe("Mistral answer");
    expect(service.getProviderInfo()).toEqual({
      provider: "mistral",
      model: "mistral-small-latest",
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.mistral.ai/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer mistral-key",
        }),
        body: JSON.stringify({
          model: "mistral-small-latest",
          temperature: 0.3,
          messages: [{ role: "user", content: "Hello" }],
          max_tokens: 128,
        }),
      }),
    );
  });

  it("supports explicit provider fallback order", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ candidates: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Mistral answer" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const service = new LlmService(
      createConfigService({
        GEMINI_API_KEY: "gemini-key",
        GEMINI_MODEL: "gemini-2.0-flash",
        MISTRAL_API_KEY: "mistral-key",
        MISTRAL_MODEL: "mistral-small-latest",
        MISTRAL_API_BASE_URL: "https://api.mistral.ai",
      }),
    );

    const result = await service.completeWithFallback(
      {
        messages: [{ role: "user", content: "Hello" }],
        jsonMode: true,
      },
      ["gemini", "mistral"],
    );

    expect(result).toEqual({
      text: "Mistral answer",
      provider: "mistral",
      model: "mistral-small-latest",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("streams Mistral SSE chat completions", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        [
          'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
          'data: {"choices":[{"delta":{"content":" world"}}]}\n',
          "data: [DONE]\n",
        ].join(""),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    );

    const service = new LlmService(
      createConfigService({
        MISTRAL_API_KEY: "mistral-key",
        MISTRAL_MODEL: "mistral-small-latest",
        MISTRAL_API_BASE_URL: "https://api.mistral.ai",
      }),
    );

    const chunks: Array<{ text: string; done: boolean }> = [];
    for await (const chunk of service.stream({
      messages: [{ role: "user", content: "Stream please" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { text: "Hello", done: false },
      { text: " world", done: false },
      { text: "", done: true, provider: "mistral", model: "mistral-small-latest" },
    ]);
  });

  it("attaches an abort signal (timeout) to provider requests", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const service = new LlmService(
      createConfigService({
        MISTRAL_API_KEY: "mistral-key",
        MISTRAL_MODEL: "mistral-small-latest",
        MISTRAL_API_BASE_URL: "https://api.mistral.ai",
      }),
    );

    await service.complete({ messages: [{ role: "user", content: "Hello" }] });

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns null from complete when the provider request times out", async () => {
    const timeoutError = new Error("The operation was aborted due to timeout");
    timeoutError.name = "TimeoutError";
    vi.spyOn(global, "fetch").mockRejectedValue(timeoutError);

    const service = new LlmService(
      createConfigService({
        MISTRAL_API_KEY: "mistral-key",
        MISTRAL_MODEL: "mistral-small-latest",
        MISTRAL_API_BASE_URL: "https://api.mistral.ai",
      }),
    );

    const result = await service.complete({ messages: [{ role: "user", content: "Hello" }] });
    expect(result).toBeNull();
  });

  it("fails over to the next provider when streaming fails before the first token", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response("upstream error", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          ['data: {"choices":[{"delta":{"content":"Hello"}}]}\n', "data: [DONE]\n"].join(""),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      );

    const service = new LlmService(
      createConfigService({
        GEMINI_API_KEY: "gemini-key",
        GEMINI_MODEL: "gemini-2.0-flash",
        MISTRAL_API_KEY: "mistral-key",
        MISTRAL_MODEL: "mistral-small-latest",
        MISTRAL_API_BASE_URL: "https://api.mistral.ai",
      }),
    );

    const chunks: Array<{ text: string; done: boolean; error?: string }> = [];
    for await (const chunk of service.streamWithFallback({
      messages: [{ role: "user", content: "Stream please" }],
    })) {
      chunks.push(chunk);
    }

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(chunks).toEqual([
      { text: "Hello", done: false },
      // The terminal chunk is attributed to the provider that actually streamed.
      { text: "", done: true, provider: "mistral", model: "mistral-small-latest" },
    ]);
  });

  it("propagates errors after the first token instead of silently restarting", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}\n',
            ),
          );
          return;
        }
        controller.error(new Error("connection reset"));
      },
    });

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    );

    const service = new LlmService(
      createConfigService({
        GEMINI_API_KEY: "gemini-key",
        GEMINI_MODEL: "gemini-2.0-flash",
        MISTRAL_API_KEY: "mistral-key",
        MISTRAL_MODEL: "mistral-small-latest",
        MISTRAL_API_BASE_URL: "https://api.mistral.ai",
      }),
    );

    const chunks: Array<{ text: string; done: boolean; error?: string }> = [];
    for await (const chunk of service.streamWithFallback({
      messages: [{ role: "user", content: "Stream please" }],
    })) {
      chunks.push(chunk);
    }

    // Only the failing provider was called — no silent mid-answer restart on Mistral.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(chunks[0]).toEqual({ text: "Hi", done: false });
    const last = chunks.at(-1);
    expect(last?.done).toBe(true);
    expect(last?.error).toContain("connection reset");
  });

  it("stops streaming silently when the caller aborts", async () => {
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    vi.spyOn(global, "fetch").mockRejectedValue(abortError);

    const service = new LlmService(
      createConfigService({
        MISTRAL_API_KEY: "mistral-key",
        MISTRAL_MODEL: "mistral-small-latest",
        MISTRAL_API_BASE_URL: "https://api.mistral.ai",
      }),
    );

    const controller = new AbortController();
    controller.abort();

    const chunks: unknown[] = [];
    for await (const chunk of service.streamWithFallback({
      messages: [{ role: "user", content: "Stream please" }],
      signal: controller.signal,
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([]);
  });

  it("shares one deadline across the whole fallback chain", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    vi.spyOn(global, "fetch").mockImplementation((_input, init) => {
      signals.push((init as RequestInit | undefined)?.signal);
      return Promise.resolve(new Response("upstream error", { status: 503 }));
    });

    const service = new LlmService(
      createConfigService({
        OPENAI_API_KEY: "openai-key",
        OPENAI_MODEL: "gpt-4.1-mini",
        MISTRAL_API_KEY: "mistral-key",
        MISTRAL_MODEL: "mistral-small-latest",
        MISTRAL_API_BASE_URL: "https://api.mistral.ai",
        LLM_STREAM_TIMEOUT_SECONDS: "120",
      }),
    );

    for await (const _chunk of service.streamWithFallback({
      messages: [{ role: "user", content: "Stream please" }],
    })) {
      // drain
    }

    // Both providers were attempted, and every attempt carries a signal that is
    // composed with the shared deadline rather than a fresh per-provider timeout.
    expect(signals).toHaveLength(2);
    for (const signal of signals) {
      expect(signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("sends a json_schema response_format to Mistral when a schema is provided", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const service = new LlmService(
      createConfigService({
        MISTRAL_API_KEY: "mistral-key",
        MISTRAL_MODEL: "mistral-small-latest",
        MISTRAL_API_BASE_URL: "https://api.mistral.ai",
      }),
    );

    await service.complete({
      messages: [{ role: "user", content: "Classify" }],
      jsonMode: true,
      jsonSchema: {
        name: "routing",
        schema: { type: "object", properties: {}, required: [], additionalProperties: false },
      },
    });

    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "routing",
        schema: { type: "object", properties: {}, required: [], additionalProperties: false },
        strict: true,
      },
    });
  });

  it("falls back to plain JSON mode on Gemini when a schema is provided", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const service = new LlmService(
      createConfigService({
        GEMINI_API_KEY: "gemini-key",
        GEMINI_MODEL: "gemini-2.0-flash",
      }),
    );

    await service.complete({
      messages: [{ role: "user", content: "Classify" }],
      jsonSchema: {
        name: "routing",
        schema: { type: "object", properties: {}, required: [], additionalProperties: false },
      },
    });

    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema).toBeUndefined();
  });

  it("accumulates streamed tool-call fragments and returns them on the terminal chunk", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        [
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","function":{"name":"search_documents","arguments":"{\\"year\\""}}]}}]}\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":2025}"}}]}}]}\n',
          "data: [DONE]\n",
        ].join(""),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    );

    const service = new LlmService(
      createConfigService({
        MISTRAL_API_KEY: "mistral-key",
        MISTRAL_MODEL: "mistral-small-latest",
        MISTRAL_API_BASE_URL: "https://api.mistral.ai",
      }),
    );

    const chunks: any[] = [];
    for await (const chunk of service.streamWithFallback({
      messages: [{ role: "user", content: "How many docs from 2025?" }],
      tools: [
        {
          name: "search_documents",
          description: "Search the archive",
          parameters: { type: "object", properties: { year: { type: "integer" } } },
        },
      ],
      toolChoice: "required",
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      {
        text: "",
        done: true,
        toolCalls: [{ id: "call_abc", name: "search_documents", arguments: { year: 2025 } }],
        provider: "mistral",
        model: "mistral-small-latest",
      },
    ]);

    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "search_documents",
          description: "Search the archive",
          parameters: { type: "object", properties: { year: { type: "integer" } } },
        },
      },
    ]);
    // Mistral predates OpenAI's "required" and expects "any".
    expect(body.tool_choice).toBe("any");
  });

  it("parses Gemini functionCall parts into tool calls with synthetic ids", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"semantic_search","args":{"query":"rent"}}}]}}]}\n',
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    );

    const service = new LlmService(
      createConfigService({
        GEMINI_API_KEY: "gemini-key",
        GEMINI_MODEL: "gemini-2.0-flash",
      }),
    );

    const chunks: any[] = [];
    for await (const chunk of service.streamWithFallback({
      messages: [{ role: "user", content: "What does my lease say about rent?" }],
      tools: [
        {
          name: "semantic_search",
          description: "Semantic search",
          parameters: { type: "object", properties: { query: { type: "string" } } },
        },
      ],
      toolChoice: "required",
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      {
        text: "",
        done: true,
        toolCalls: [{ id: "call_1", name: "semantic_search", arguments: { query: "rent" } }],
        provider: "gemini",
        model: "gemini-2.0-flash",
      },
    ]);

    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: "semantic_search",
            description: "Semantic search",
            parameters: { type: "object", properties: { query: { type: "string" } } },
          },
        ],
      },
    ]);
    expect(body.toolConfig).toEqual({ functionCallingConfig: { mode: "ANY" } });
  });

  it("serializes assistant tool calls and tool results in the OpenAI dialect", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "12 documents" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const service = new LlmService(
      createConfigService({
        MISTRAL_API_KEY: "mistral-key",
        MISTRAL_MODEL: "mistral-small-latest",
        MISTRAL_API_BASE_URL: "https://api.mistral.ai",
      }),
    );

    await service.complete({
      messages: [
        { role: "user", content: "How many invoices?" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_abc", name: "search_documents", arguments: { type: "Invoice" } }],
        },
        {
          role: "tool",
          toolCallId: "call_abc",
          name: "search_documents",
          content: '{"totalCount":12}',
        },
      ],
    });

    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.messages).toEqual([
      { role: "user", content: "How many invoices?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_abc",
            type: "function",
            function: { name: "search_documents", arguments: '{"type":"Invoice"}' },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_abc",
        name: "search_documents",
        content: '{"totalCount":12}',
      },
    ]);
  });

  it("serializes tool turns as functionCall/functionResponse parts for Gemini", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "12 documents" }] } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const service = new LlmService(
      createConfigService({
        GEMINI_API_KEY: "gemini-key",
        GEMINI_MODEL: "gemini-2.0-flash",
      }),
    );

    await service.complete({
      messages: [
        { role: "user", content: "How many invoices?" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", name: "search_documents", arguments: { type: "Invoice" } }],
        },
        {
          role: "tool",
          toolCallId: "call_1",
          name: "search_documents",
          content: '{"totalCount":12}',
        },
      ],
    });

    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "How many invoices?" }] },
      {
        role: "model",
        parts: [{ functionCall: { name: "search_documents", args: { type: "Invoice" } } }],
      },
      {
        role: "user",
        parts: [
          { functionResponse: { name: "search_documents", response: { totalCount: 12 } } },
        ],
      },
    ]);
  });

  it("streams interleaved text before tool calls without dropping either", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        [
          'data: {"choices":[{"delta":{"content":"Let me check."}}]}\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search_documents","arguments":"{}"}}]}}]}\n',
          "data: [DONE]\n",
        ].join(""),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    );

    const service = new LlmService(
      createConfigService({
        MISTRAL_API_KEY: "mistral-key",
        MISTRAL_MODEL: "mistral-small-latest",
        MISTRAL_API_BASE_URL: "https://api.mistral.ai",
      }),
    );

    const chunks: any[] = [];
    for await (const chunk of service.streamWithFallback({
      messages: [{ role: "user", content: "How many invoices?" }],
      tools: [
        { name: "search_documents", description: "Search", parameters: { type: "object" } },
      ],
    })) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toEqual({ text: "Let me check.", done: false });
    expect(chunks[1]).toEqual({
      text: "",
      done: true,
      toolCalls: [{ id: "call_1", name: "search_documents", arguments: {} }],
      provider: "mistral",
      model: "mistral-small-latest",
    });
  });

  it("retries a non-streaming completion once on 429 before giving up", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "recovered" } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const service = new LlmService(
      createConfigService({
        MISTRAL_API_KEY: "mistral-key",
        MISTRAL_MODEL: "mistral-small-latest",
        MISTRAL_API_BASE_URL: "https://api.mistral.ai",
      }),
    );

    const result = await service.complete({ messages: [{ role: "user", content: "Hello" }] });
    expect(result).toBe("recovered");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
