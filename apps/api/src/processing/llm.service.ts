import { Inject, Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../common/config/app-config.service";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmCompletionOptions {
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface LlmStreamChunk {
  text: string;
  done: boolean;
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

    return this.completeWithConfig(config, options);
  }

  async completeWithFallback(
    options: LlmCompletionOptions,
    providerOrder: LlmProviderId[],
  ): Promise<LlmCompletionResult> {
    const providers = this.getProviderConfigs(providerOrder);
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
      const text = await this.completeWithConfig(provider, options);
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
    const config = this.getProviderConfig();
    if (!config) {
      this.logger.warn(
        "No LLM provider configured (set OPENAI_API_KEY, GEMINI_API_KEY, or MISTRAL_API_KEY)",
      );
      yield { text: "", done: true };
      return;
    }

    if (config.provider === "openai") {
      yield* this.streamOpenAi(config, options);
    } else if (config.provider === "gemini") {
      yield* this.streamGemini(config, options);
    } else {
      yield* this.streamMistral(config, options);
    }
  }

  // ---------------------------------------------------------------------------
  // Provider config resolution
  // ---------------------------------------------------------------------------

  private getProviderConfig(providerOrder?: LlmProviderId[]): LlmProviderConfig | null {
    return this.getProviderConfigs(providerOrder ?? this.getDefaultProviderOrder())[0] ?? null;
  }

  private getDefaultProviderOrder(): LlmProviderId[] {
    const activeProvider = this.configService?.get("ACTIVE_CHAT_PROVIDER");
    return activeProvider ? [activeProvider] : ["openai", "gemini", "mistral"];
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
      messages: options.messages,
    };

    if (options.maxTokens) {
      body.max_completion_tokens = options.maxTokens;
    }

    if (options.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

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
      messages: options.messages,
    };

    if (options.maxTokens) {
      body.max_tokens = options.maxTokens;
    }

    if (options.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    const response = await fetch(
      `${this.configService.get("MISTRAL_OCR_BASE_URL")}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      },
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
      messages: options.messages,
      stream: true,
    };

    if (options.maxTokens) {
      body.max_completion_tokens = options.maxTokens;
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      this.logger.warn(
        `OpenAI streaming completion failed with status ${response.status}: ${errorBody}`,
      );
      yield { text: "", done: true };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { text: "", done: true };
      return;
    }

    const decoder = new TextDecoder();
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
            yield { text: "", done: true };
            return;
          }

          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
            };
            const content = parsed.choices?.[0]?.delta?.content;
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

    yield { text: "", done: true };
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
      messages: options.messages,
      stream: true,
    };

    if (options.maxTokens) {
      body.max_tokens = options.maxTokens;
    }

    const response = await fetch(
      `${this.configService.get("MISTRAL_OCR_BASE_URL")}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      this.logger.warn(
        `Mistral streaming completion failed with status ${response.status}: ${errorBody}`,
      );
      yield { text: "", done: true };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { text: "", done: true };
      return;
    }

    const decoder = new TextDecoder();
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
            yield { text: "", done: true };
            return;
          }

          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const content = parsed.choices?.[0]?.delta?.content;
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

    yield { text: "", done: true };
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

    if (options.jsonMode) {
      generationConfig.responseMimeType = "application/json";
    }

    const body: Record<string, unknown> = {
      generationConfig,
      contents,
    };

    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
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

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:streamGenerateContent?alt=sse&key=${config.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      this.logger.warn(`Gemini streaming completion failed with status ${response.status}`);
      yield { text: "", done: true };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { text: "", done: true };
      return;
    }

    const decoder = new TextDecoder();
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
                content?: { parts?: Array<{ text?: string }> };
              }>;
            };
            const text =
              parsed.candidates?.[0]?.content?.parts
                ?.map((part) => part.text ?? "")
                .join("") ?? "";
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

    yield { text: "", done: true };
  }

  // ---------------------------------------------------------------------------
  // Gemini message format conversion
  // ---------------------------------------------------------------------------

  private toGeminiFormat(messages: LlmMessage[]): {
    systemInstruction: { parts: Array<{ text: string }> } | null;
    contents: Array<{ role: string; parts: Array<{ text: string }> }>;
  } {
    const systemMessages = messages.filter((m) => m.role === "system");
    const conversationMessages = messages.filter((m) => m.role !== "system");

    const systemInstruction =
      systemMessages.length > 0
        ? {
            parts: systemMessages.map((m) => ({ text: m.content })),
          }
        : null;

    const contents = conversationMessages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    return { systemInstruction, contents };
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
