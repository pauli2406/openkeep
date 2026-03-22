import { afterEach, describe, expect, it, vi } from "vitest";

import { GeminiEmbeddingProvider } from "../src/processing/gemini-embedding.provider";
import { MistralEmbeddingProvider } from "../src/processing/mistral-embedding.provider";
import { OpenAiEmbeddingProvider } from "../src/processing/openai-embedding.provider";
import { VoyageEmbeddingProvider } from "../src/processing/voyage-embedding.provider";

const createConfigService = (values: Record<string, string | undefined>) =>
  ({
    get(key: string) {
      return values[key];
    },
  }) as any;

describe("Embedding providers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps OpenAI embeddings into the normalized result", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: [0.2, 0.3] },
            { index: 0, embedding: [0.1, 0.4] },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const provider = new OpenAiEmbeddingProvider(
      createConfigService({
        OPENAI_API_KEY: "test",
        OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
      }),
    );

    const result = await provider.embed({
      texts: ["invoice", "contract"],
      inputType: "document",
    });

    expect(result.provider).toBe("openai");
    expect(result.model).toBe("text-embedding-3-small");
    expect(result.dimensions).toBe(2);
    expect(result.embeddings[0]).toEqual([0.1, 0.4]);
  });

  it("maps Gemini batch embeddings into the normalized result", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          embeddings: [{ values: [0.5, 0.1] }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const provider = new GeminiEmbeddingProvider(
      createConfigService({
        GEMINI_API_KEY: "test",
        GEMINI_EMBEDDING_MODEL: "text-embedding-004",
      }),
    );

    const result = await provider.embed({
      texts: ["invoice"],
      inputType: "query",
    });

    expect(result.provider).toBe("google-gemini");
    expect(result.embeddings[0]).toEqual([0.5, 0.1]);
  });

  it("maps Voyage embeddings into the normalized result", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ embedding: [0.7, 0.2, 0.1] }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const provider = new VoyageEmbeddingProvider(
      createConfigService({
        VOYAGE_API_KEY: "test",
        VOYAGE_API_BASE_URL: "https://api.voyageai.com/v1",
        VOYAGE_EMBEDDING_MODEL: "voyage-3-large",
      }),
    );

    const result = await provider.embed({
      texts: ["insurance"],
      inputType: "document",
    });

    expect(result.provider).toBe("voyage");
    expect(result.embeddings[0]).toEqual([0.7, 0.2, 0.1]);
  });

  it("maps Mistral embeddings into the normalized result", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ embedding: [0.6, 0.3] }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const provider = new MistralEmbeddingProvider(
      createConfigService({
        MISTRAL_API_KEY: "test",
        MISTRAL_OCR_BASE_URL: "https://api.mistral.ai",
        MISTRAL_EMBEDDING_MODEL: "mistral-embed",
      }),
    );

    const result = await provider.embed({
      texts: ["tax"],
      inputType: "document",
    });

    expect(result.provider).toBe("mistral");
    expect(result.embeddings[0]).toEqual([0.6, 0.3]);
  });
});
