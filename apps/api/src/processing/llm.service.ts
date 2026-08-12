import { Inject, Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../common/config/app-config.service";
import { fetchWithTimeout, isAbortError } from "./http.util";

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Assistant turns that requested tool calls carry them here (content may be ""). */
  toolCalls?: LlmToolCall[];
  /** Tool result turns: id of the assistant tool call this responds to. */
  toolCallId?: string;
  /** Tool result turns: tool name (Gemini's functionResponse requires it). */
  name?: string;
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  /**
   * JSON Schema for the arguments. Gemini's dialect rejects type unions and
   * some keywords ($ref, oneOf) — tool authors must keep schemas to plain
   * objects/arrays/scalars so one definition serves all three providers.
   */
  parameters: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmCompletionOptions {
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  /**
   * Structured output schema. Mistral/OpenAI enforce it via
   * `response_format: { type: "json_schema", ... }`; Gemini's schema dialect differs
   * (no type unions), so it falls back to plain JSON mode there.
   */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  /**
   * Tools the model may call. Tool calls are only surfaced on the streaming
   * path (terminal chunk's `toolCalls`); non-streaming completions accept
   * tool-bearing histories but return text only.
   */
  tools?: LlmToolDefinition[];
  toolChoice?: "auto" | "none" | "required";
  /** Caller abort signal (e.g. SSE client disconnect); composed with the timeout. */
  signal?: AbortSignal;
}

export interface LlmStreamChunk {
  text: string;
  done: boolean;
  error?: string;
  /** Set on the terminal chunk when the model requested tool calls this round. */
  toolCalls?: LlmToolCall[];
  /** Set on the terminal chunk by streamWithFallback: the provider that actually streamed. */
  provider?: LlmProviderId;
  model?: string;
}

export type LlmProviderId = "openai" | "gemini" | "mistral";

export interface LlmCompletionResult {
  text: string | null;
  provider: LlmProviderId | null;
  model: string | null;
}

interface LlmProviderConfig {
  provider: LlmProviderId;
  apiKey: string;
  model: string;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(@Inject(AppConfigService) private readonly configService: AppConfigService) {}

  isConfigured(): boolean {
    return this.getProviderConfig() !== null;
  }

  getProviderInfo(providerOrder?: LlmProviderId[]): { provider: string; model: string } | null {
    const config = this.getProviderConfig(providerOrder);
    if (!config) {
      return null;
    }

    return { provider: config.provider, model: config.model };
  }

  getAvailableProviderInfos(providerOrder?: LlmProviderId[]): Array<{ provider: string; model: string }> {
    return this.getProviderConfigs(providerOrder ?? this.getDefaultProviderOrder()).map((config) => ({
      provider: config.provider,
      model: config.model,
    }));
  }

  async complete(options: LlmCompletionOptions): Promise<string | null> {
    const config = this.getProviderConfig();
    if (!config) {
      this.logger.warn(
        "No LLM provider configured (set OPENAI_API_KEY, GEMINI_API_KEY, or MISTRAL_API_KEY)",
      );
      return null;
    }

    try {
      return await this.completeWithConfig(config, options);
    } catch (error) {
      if (options.signal?.aborted) {
        return null;
      }
      this.logger.warn(
        `${config.provider} completion failed: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  async completeWithFallback(
    options: LlmCompletionOptions,
    providerOrder?: LlmProviderId[],
  ): Promise<LlmCompletionResult> {
    const providers = this.getProviderConfigs(providerOrder ?? this.getDefaultProviderOrder());
    if (providers.length === 0) {
      this.logger.warn(
        "No LLM provider configured (set OPENAI_API_KEY, GEMINI_API_KEY, or MISTRAL_API_KEY)",
      );
      return {
        text: null,
        provider: null,
        model: null,
      };
    }

    for (const provider of providers) {
      let text: string | null = null;
      try {
        text = await this.completeWithConfig(provider, options);
      } catch (error) {
        if (options.signal?.aborted) {
          break;
        }
        this.logger.warn(
          `${provider.provider} completion failed (${error instanceof Error ? error.message : error}) — trying next provider`,
        );
        continue;
      }

      if (text && text.trim().length > 0) {
        return {
          text,
          provider: provider.provider,
          model: provider.model,
        };
      }
    }

    return {
      text: null,
      provider: null,
      model: null,
    };
  }

  private async completeWithConfig(
    config: LlmProviderConfig,
    options: LlmCompletionOptions,
  ): Promise<string | null> {
    if (config.provider === "openai") {
      return this.completeOpenAi(config, options);
    }

    if (config.provider === "gemini") {
      return this.completeGemini(config, options);
    }

    return this.completeMistral(config, options);
  }

  async *stream(options: LlmCompletionOptions): AsyncGenerator<LlmStreamChunk> {
    yield* this.streamWithFallback(options);
  }

  /**
   * Streams from the first configured provider and fails over to the next one
   * when a provider fails BEFORE emitting its first token. After the first token
   * the error is propagated — silently restarting mid-answer would duplicate or
   * contradict already-streamed text.
   */
  async *streamWithFallback(
    options: LlmCompletionOptions,
    providerOrder?: LlmProviderId[],
  ): AsyncGenerator<LlmStreamChunk> {
    const providers = this.getProviderConfigs(providerOrder ?? this.getDefaultProviderOrder());
    if (providers.length === 0) {
      this.logger.warn(
        "No LLM provider configured (set OPENAI_API_KEY, GEMINI_API_KEY, or MISTRAL_API_KEY)",
      );
      yield { text: "", done: true, error: "No LLM provider configured (set OPENAI_API_KEY, GEMINI_API_KEY, or MISTRAL_API_KEY)" };
      return;
    }

    // ONE deadline for the whole fallback chain: a per-provider timeout would let
    // three hanging providers hold the SSE request open for 3x the configured
    // limit instead of the documented hard timeout.
    const deadline = AbortSignal.timeout(this.streamTimeoutMs());
    const streamOptions: LlmCompletionOptions = {
      ...options,
      signal: options.signal
        ? AbortSignal.any([options.signal, deadline])
        : deadline,
    };

    for (let index = 0; index < providers.length; index += 1) {
      const config = providers[index]!;
      const hasNextProvider = index < providers.length - 1;
      let firstTokenSeen = false;

      try {
        for await (const chunk of this.streamWithConfig(config, streamOptions)) {
          if (chunk.done && chunk.error) {
            if (
              !firstTokenSeen &&
              hasNextProvider &&
              !options.signal?.aborted &&
              !deadline.aborted
            ) {
              this.logger.warn(
                `${config.provider} stream failed before first token (${chunk.error}) — failing over to ${providers[index + 1]!.provider}`,
              );
              break;
            }
            yield { ...chunk, provider: config.provider, model: config.model };
            return;
          }

          if (!chunk.done && chunk.text.length > 0) {
            firstTokenSeen = true;
          }
          if (chunk.done) {
            // Attribute the terminal chunk to the provider that actually streamed —
            // after a failover this differs from getProviderInfo()'s first pick.
            yield { ...chunk, provider: config.provider, model: config.model };
            return;
          }
          yield chunk;
        }
      } catch (error) {
        if (options.signal?.aborted) {
          // Client disconnected — stop silently, nothing is listening anymore.
          return;
        }

        const message = error instanceof Error ? error.message : "Unknown streaming error";
        if (!firstTokenSeen && hasNextProvider && !deadline.aborted) {
          this.logger.warn(
            `${config.provider} stream threw before first token (${message}) — failing over to ${providers[index + 1]!.provider}`,
          );
          continue;
        }

        const label = isAbortError(error) ? `${config.provider} request timed out` : message;
        yield { text: "", done: true, error: label };
        return;
      }
    }

    yield { text: "", done: true, error: "All configured LLM providers failed before streaming" };
  }

  private streamWithConfig(
    config: LlmProviderConfig,
    options: LlmCompletionOptions,
  ): AsyncGenerator<LlmStreamChunk> {
    if (config.provider === "openai") {
      return this.streamOpenAi(config, options);
    }
    if (config.provider === "gemini") {
      return this.streamGemini(config, options);
    }
    return this.streamMistral(config, options);
  }

  private streamTimeoutMs(): number {
    return (this.configService.get("LLM_STREAM_TIMEOUT_SECONDS") ?? 120) * 1000;
  }

  /** Terminal stream chunk, carrying any tool calls the model requested this round. */
  private terminalChunk(toolCalls: ToolCallAccumulator): LlmStreamChunk {
    return toolCalls.hasCalls()
      ? { text: "", done: true, toolCalls: toolCalls.toToolCalls() }
      : { text: "", done: true };
  }

  private completionTimeoutMs(): number {
    return (this.configService.get("LLM_TIMEOUT_SECONDS") ?? 45) * 1000;
  }

  /**
   * POST with timeout + caller signal, retrying once on 429/5xx or transient
   * network errors. Used by non-streaming completions only — streams handle
   * failure via provider failover instead.
   */
  private async postJsonWithRetry(
    url: string,
    init: RequestInit,
    options: LlmCompletionOptions,
  ): Promise<Response> {
    const timeoutMs = this.completionTimeoutMs();
    const attempt = () => fetchWithTimeout(url, init, timeoutMs, options.signal);

    let response: Response;
    try {
      response = await attempt();
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error)) {
        throw error;
      }
      await delay(500);
      return attempt();
    }

    if (response.status === 429 || response.status >= 500) {
      // Consume the failed response before retrying — otherwise abandoned
      // bodies hold sockets open until timeout/GC under load. The text is kept
      // so a failed retry can still surface the original error detail (the
      // caller reads response.text() for its log message).
      const failedBody = await response.text().catch(() => "");
      await delay(500);
      try {
        return await attempt();
      } catch {
        return new Response(failedBody, {
          status: response.status,
          statusText: response.statusText,
        });
      }
    }

    return response;
  }

  // ---------------------------------------------------------------------------
  // Provider config resolution
  // ---------------------------------------------------------------------------

  private getProviderConfig(providerOrder?: LlmProviderId[]): LlmProviderConfig | null {
    return this.getProviderConfigs(providerOrder ?? this.getDefaultProviderOrder())[0] ?? null;
  }

  /**
   * The single source of truth for chat-provider ordering: the pinned
   * ACTIVE_CHAT_PROVIDER first (when set), then the remaining providers as
   * failover candidates. Callers that previously hardcoded their own orders
   * (agentic pipeline, correspondent resolution) derive from this instead.
   */
  getDefaultProviderOrder(): LlmProviderId[] {
    const base: LlmProviderId[] = ["openai", "gemini", "mistral"];
    const activeProvider = this.configService?.get("ACTIVE_CHAT_PROVIDER");
    if (!activeProvider) {
      return base;
    }

    return [activeProvider, ...base.filter((provider) => provider !== activeProvider)];
  }

  private getProviderConfigs(providerOrder: LlmProviderId[]): LlmProviderConfig[] {
    return providerOrder
      .map((provider) => this.getProviderConfigById(provider))
      .filter((provider): provider is LlmProviderConfig => provider !== null);
  }

  private getProviderConfigById(provider: LlmProviderId): LlmProviderConfig | null {
    if (provider === "openai") {
      const openAiKey = this.configService.get("OPENAI_API_KEY");
      return openAiKey
        ? {
            provider,
            apiKey: openAiKey,
            model: this.configService.get("OPENAI_MODEL"),
          }
        : null;
    }

    if (provider === "gemini") {
      const geminiKey = this.configService.get("GEMINI_API_KEY");
      return geminiKey
        ? {
            provider,
            apiKey: geminiKey,
            model: this.configService.get("GEMINI_MODEL"),
          }
        : null;
    }

    const mistralKey = this.configService.get("MISTRAL_API_KEY");
    return mistralKey
      ? {
          provider,
          apiKey: mistralKey,
          model: this.configService.get("MISTRAL_MODEL"),
        }
      : null;
  }

  // ---------------------------------------------------------------------------
  // OpenAI – Non-streaming
  // ---------------------------------------------------------------------------

  private async completeOpenAi(
    config: LlmProviderConfig,
    options: LlmCompletionOptions,
  ): Promise<string | null> {
    const body: Record<string, unknown> = {
      model: config.model,
      temperature: options.temperature ?? 0.2,
      messages: toChatCompletionMessages(options.messages),
    };

    if (options.maxTokens) {
      body.max_completion_tokens = options.maxTokens;
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = buildChatCompletionTools(options.tools);
      body.tool_choice = options.toolChoice ?? "auto";
    }

    if (options.jsonSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: options.jsonSchema.name,
          schema: options.jsonSchema.schema,
          strict: true,
        },
      };
    } else if (options.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    const response = await this.postJsonWithRetry(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      options,
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      this.logger.warn(
        `OpenAI completion failed with status ${response.status}: ${errorBody}`,
      );
      return null;
    }

    const result = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
    };
    const content = result.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((item) => (typeof item?.text === "string" ? item.text : ""))
        .join(" ");
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Mistral - Non-streaming
  // ---------------------------------------------------------------------------

  private async completeMistral(
    config: LlmProviderConfig,
    options: LlmCompletionOptions,
  ): Promise<string | null> {
    const body: Record<string, unknown> = {
      model: config.model,
      temperature: options.temperature ?? 0.2,
      messages: toChatCompletionMessages(options.messages),
    };

    if (options.maxTokens) {
      body.max_tokens = options.maxTokens;
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = buildChatCompletionTools(options.tools);
      body.tool_choice = toMistralToolChoice(options.toolChoice ?? "auto");
    }

    if (options.jsonSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: options.jsonSchema.name,
          schema: options.jsonSchema.schema,
          strict: true,
        },
      };
    } else if (options.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    const response = await this.postJsonWithRetry(
      `${this.configService.get("MISTRAL_API_BASE_URL")}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      options,
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      this.logger.warn(
        `Mistral completion failed with status ${response.status}: ${errorBody}`,
      );
      return null;
    }

    const result = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
    };
    return this.extractChatCompletionText(result.choices?.[0]?.message?.content);
  }

  // ---------------------------------------------------------------------------
  // OpenAI – Streaming
  // ---------------------------------------------------------------------------

  private async *streamOpenAi(
    config: LlmProviderConfig,
    options: LlmCompletionOptions,
  ): AsyncGenerator<LlmStreamChunk> {
    const body: Record<string, unknown> = {
      model: config.model,
      temperature: options.temperature ?? 0.2,
      messages: toChatCompletionMessages(options.messages),
      stream: true,
    };

    if (options.maxTokens) {
      body.max_completion_tokens = options.maxTokens;
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = buildChatCompletionTools(options.tools);
      body.tool_choice = options.toolChoice ?? "auto";
    }

    const response = await fetchWithTimeout(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      this.streamTimeoutMs(),
      options.signal,
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      this.logger.warn(
        `OpenAI streaming completion failed with status ${response.status}: ${errorBody}`,
      );
      yield { text: "", done: true, error: `OpenAI request failed (HTTP ${response.status})` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { text: "", done: true, error: "OpenAI response stream unavailable" };
      return;
    }

    const decoder = new TextDecoder();
    const toolCalls = new ToolCallAccumulator();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) {
            continue;
          }

          const data = trimmed.slice(6);
          if (data === "[DONE]") {
            yield this.terminalChunk(toolCalls);
            return;
          }

          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{
                delta?: {
                  content?: string;
                  tool_calls?: Array<{
                    index?: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
                finish_reason?: string | null;
              }>;
            };
            const delta = parsed.choices?.[0]?.delta;
            for (const fragment of delta?.tool_calls ?? []) {
              toolCalls.addFragment(fragment);
            }
            const content = delta?.content;
            if (typeof content === "string" && content.length > 0) {
              yield { text: content, done: false };
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield this.terminalChunk(toolCalls);
  }

  // ---------------------------------------------------------------------------
  // Mistral - Streaming
  // ---------------------------------------------------------------------------

  private async *streamMistral(
    config: LlmProviderConfig,
    options: LlmCompletionOptions,
  ): AsyncGenerator<LlmStreamChunk> {
    const body: Record<string, unknown> = {
      model: config.model,
      temperature: options.temperature ?? 0.2,
      messages: toChatCompletionMessages(options.messages),
      stream: true,
    };

    if (options.maxTokens) {
      body.max_tokens = options.maxTokens;
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = buildChatCompletionTools(options.tools);
      body.tool_choice = toMistralToolChoice(options.toolChoice ?? "auto");
    }

    const response = await fetchWithTimeout(
      `${this.configService.get("MISTRAL_API_BASE_URL")}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      this.streamTimeoutMs(),
      options.signal,
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      this.logger.warn(
        `Mistral streaming completion failed with status ${response.status}: ${errorBody}`,
      );
      yield { text: "", done: true, error: `Mistral request failed (HTTP ${response.status})` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { text: "", done: true, error: "Mistral response stream unavailable" };
      return;
    }

    const decoder = new TextDecoder();
    const toolCalls = new ToolCallAccumulator();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) {
            continue;
          }

          const data = trimmed.slice(6);
          if (data === "[DONE]") {
            yield this.terminalChunk(toolCalls);
            return;
          }

          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{
                delta?: {
                  content?: string;
                  tool_calls?: Array<{
                    index?: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
              }>;
            };
            const delta = parsed.choices?.[0]?.delta;
            for (const fragment of delta?.tool_calls ?? []) {
              toolCalls.addFragment(fragment);
            }
            const content = delta?.content;
            if (typeof content === "string" && content.length > 0) {
              yield { text: content, done: false };
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield this.terminalChunk(toolCalls);
  }

  // ---------------------------------------------------------------------------
  // Gemini – Non-streaming
  // ---------------------------------------------------------------------------

  private async completeGemini(
    config: LlmProviderConfig,
    options: LlmCompletionOptions,
  ): Promise<string | null> {
    const { systemInstruction, contents } = this.toGeminiFormat(options.messages);

    const generationConfig: Record<string, unknown> = {
      temperature: options.temperature ?? 0.2,
    };

    if (options.maxTokens) {
      generationConfig.maxOutputTokens = options.maxTokens;
    }

    if (options.jsonMode || options.jsonSchema) {
      // Gemini's responseSchema dialect rejects JSON-Schema type unions, so schema
      // enforcement stays with Mistral/OpenAI; Gemini gets plain JSON mode and the
      // caller-side Zod validation catches shape violations.
      generationConfig.responseMimeType = "application/json";
    }

    const body: Record<string, unknown> = {
      generationConfig,
      contents,
    };

    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    this.applyGeminiTools(body, options);

    const response = await this.postJsonWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      options,
    );

    if (!response.ok) {
      this.logger.warn(`Gemini completion failed with status ${response.status}`);
      return null;
    }

    const result = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    return (
      result.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim() ?? null
    );
  }

  // ---------------------------------------------------------------------------
  // Gemini – Streaming
  // ---------------------------------------------------------------------------

  private async *streamGemini(
    config: LlmProviderConfig,
    options: LlmCompletionOptions,
  ): AsyncGenerator<LlmStreamChunk> {
    const { systemInstruction, contents } = this.toGeminiFormat(options.messages);

    const generationConfig: Record<string, unknown> = {
      temperature: options.temperature ?? 0.2,
    };

    if (options.maxTokens) {
      generationConfig.maxOutputTokens = options.maxTokens;
    }

    const body: Record<string, unknown> = {
      generationConfig,
      contents,
    };

    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    this.applyGeminiTools(body, options);

    const response = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:streamGenerateContent?alt=sse&key=${config.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      this.streamTimeoutMs(),
      options.signal,
    );

    if (!response.ok) {
      this.logger.warn(`Gemini streaming completion failed with status ${response.status}`);
      yield { text: "", done: true, error: `Gemini request failed (HTTP ${response.status})` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { text: "", done: true, error: "Gemini response stream unavailable" };
      return;
    }

    const decoder = new TextDecoder();
    const toolCalls = new ToolCallAccumulator();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) {
            continue;
          }

          const data = trimmed.slice(6);

          try {
            const parsed = JSON.parse(data) as {
              candidates?: Array<{
                content?: {
                  parts?: Array<{
                    text?: string;
                    functionCall?: { name?: string; args?: Record<string, unknown> };
                  }>;
                };
              }>;
            };
            const parts = parsed.candidates?.[0]?.content?.parts ?? [];
            for (const part of parts) {
              // Gemini emits whole functionCall parts, never argument fragments.
              if (part.functionCall?.name) {
                toolCalls.addComplete(part.functionCall.name, part.functionCall.args ?? {});
              }
            }
            const text = parts.map((part) => part.text ?? "").join("");
            if (text.length > 0) {
              yield { text, done: false };
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield this.terminalChunk(toolCalls);
  }

  // ---------------------------------------------------------------------------
  // Gemini message format conversion
  // ---------------------------------------------------------------------------

  private toGeminiFormat(messages: LlmMessage[]): {
    systemInstruction: { parts: Array<{ text: string }> } | null;
    contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
  } {
    const systemMessages = messages.filter((m) => m.role === "system");
    const conversationMessages = messages.filter((m) => m.role !== "system");

    const systemInstruction =
      systemMessages.length > 0
        ? {
            parts: systemMessages.map((m) => ({ text: m.content })),
          }
        : null;

    const contents = conversationMessages.map((m) => {
      if (m.role === "tool") {
        // Gemini has no tool role: results travel as functionResponse parts in a
        // user turn, keyed by function name (it has no tool-call ids either).
        return {
          role: "user",
          parts: [
            {
              functionResponse: {
                name: m.name ?? "",
                response: toGeminiFunctionResponse(m.content),
              },
            },
          ],
        };
      }

      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        const parts: Array<Record<string, unknown>> = [];
        if (m.content.length > 0) {
          parts.push({ text: m.content });
        }
        for (const call of m.toolCalls) {
          parts.push({ functionCall: { name: call.name, args: call.arguments } });
        }
        return { role: "model", parts };
      }

      return {
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }] as Array<Record<string, unknown>>,
      };
    });

    return { systemInstruction, contents };
  }

  private applyGeminiTools(body: Record<string, unknown>, options: LlmCompletionOptions): void {
    if (!options.tools || options.tools.length === 0) {
      return;
    }

    body.tools = [
      {
        functionDeclarations: options.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
      },
    ];

    const choice = options.toolChoice ?? "auto";
    body.toolConfig = {
      functionCallingConfig: {
        mode: choice === "none" ? "NONE" : choice === "required" ? "ANY" : "AUTO",
      },
    };
  }

  private extractChatCompletionText(
    content: string | Array<{ text?: string }> | undefined,
  ): string | null {
    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((item) => (typeof item?.text === "string" ? item.text : ""))
        .join(" ");
    }

    return null;
  }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Tool-calling wire formats (OpenAI dialect is shared by Mistral)
// ---------------------------------------------------------------------------

/**
 * Serializes LlmMessages into the OpenAI/Mistral chat-completions shape,
 * expanding assistant tool-call turns and tool result turns. Plain
 * system/user/assistant text messages pass through unchanged.
 */
function toChatCompletionMessages(messages: LlmMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId ?? "",
        name: message.name ?? "",
        content: message.content,
      };
    }

    if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: message.content.length > 0 ? message.content : null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      };
    }

    return { role: message.role, content: message.content };
  });
}

function buildChatCompletionTools(tools: LlmToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Mistral predates OpenAI's "required" and uses "any" for the same semantics;
 * both accept "auto"/"none" verbatim.
 */
function toMistralToolChoice(choice: "auto" | "none" | "required"): string {
  return choice === "required" ? "any" : choice;
}

/**
 * Accumulates streamed tool-call fragments. OpenAI/Mistral stream
 * `delta.tool_calls[i]` with id/name on the first fragment and the JSON
 * `arguments` string spread across fragments; Gemini emits whole
 * `functionCall` parts instead (added via addComplete with synthetic ids).
 */
class ToolCallAccumulator {
  private readonly entries = new Map<number, { id: string; name: string; argumentsJson: string }>();

  addFragment(fragment: {
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }): void {
    const index = fragment.index ?? this.entries.size;
    const entry = this.entries.get(index) ?? { id: "", name: "", argumentsJson: "" };
    if (fragment.id) {
      entry.id = fragment.id;
    }
    if (fragment.function?.name) {
      entry.name = fragment.function.name;
    }
    if (typeof fragment.function?.arguments === "string") {
      entry.argumentsJson += fragment.function.arguments;
    }
    this.entries.set(index, entry);
  }

  addComplete(name: string, args: Record<string, unknown>): void {
    const index = this.entries.size;
    this.entries.set(index, {
      id: `call_${index + 1}`,
      name,
      argumentsJson: JSON.stringify(args ?? {}),
    });
  }

  hasCalls(): boolean {
    return this.entries.size > 0;
  }

  /** Fragments with unparseable argument JSON degrade to {} instead of throwing mid-stream. */
  toToolCalls(): LlmToolCall[] {
    return [...this.entries.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(([, entry]) => entry.name.length > 0)
      .map(([index, entry]) => ({
        id: entry.id || `call_${index + 1}`,
        name: entry.name,
        arguments: parseJsonObject(entry.argumentsJson),
      }));
  }
}

/**
 * Gemini's functionResponse.response must be a JSON object; array/scalar/plain-text
 * tool results are wrapped instead of silently degrading to {}.
 */
function toGeminiFunctionResponse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { result: parsed };
  } catch {
    return { result: raw };
  }
}

function parseJsonObject(raw: string): Record<string, unknown> {
  if (!raw || raw.trim().length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
