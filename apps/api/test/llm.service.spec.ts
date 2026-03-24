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
        MISTRAL_OCR_BASE_URL: "https://api.mistral.ai",
      }),
    );

    expect(service.getProviderInfo()).toEqual({
      provider: "openai",
      model: "gpt-4.1-mini",
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
        MISTRAL_OCR_BASE_URL: "https://api.mistral.ai",
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
        MISTRAL_OCR_BASE_URL: "https://api.mistral.ai",
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
        MISTRAL_OCR_BASE_URL: "https://api.mistral.ai",
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
      { text: "", done: true },
    ]);
  });
});
