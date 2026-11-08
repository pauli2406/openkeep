/**
 * Which provider is doing what, derived from the server's two answers. Same rules
 * as the web client's AI providers page.
 */
import type {
  HealthProviders,
  ProcessingJob,
  ProviderConfig,
} from "../../api/admin";

export type ProviderTone =
  | "active"
  | "fallback"
  | "available"
  | "incomplete"
  | "unconfigured";

export type ProviderRow = {
  id: string;
  name: string;
  noteKey: "local" | "cloud" | "onlyText" | "keyStored" | "noKey";
  model: string | null;
  tone: ProviderTone;
};

export type ProviderGroup = {
  id: "parsing" | "embeddings" | "chat";
  activeName: string | null;
  rows: ProviderRow[];
};

const CHAT_LABELS: Record<string, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  mistral: "Mistral",
};
const EMBEDDING_LABELS: Record<string, string> = {
  openai: "OpenAI",
  "google-gemini": "Google Gemini",
  voyage: "Voyage AI",
  mistral: "Mistral",
};
const PARSE_LABELS: Record<string, string> = {
  "local-ocr": "Local OCR",
  "google-document-ai-enterprise-ocr": "Google Doc AI Enterprise",
  "google-document-ai-gemini-layout-parser": "Google Doc AI Gemini",
  "amazon-textract": "Amazon Textract",
  "azure-ai-document-intelligence": "Azure Document Intelligence",
  "mistral-ocr": "Mistral OCR",
};

export function buildProviderGroups(
  cfg: ProviderConfig,
  providers: HealthProviders,
): ProviderGroup[] {
  const parseConfigured: Record<string, boolean> = {
    "local-ocr": true,
    "amazon-textract": cfg.hasAwsTextractConfig,
    "azure-ai-document-intelligence": cfg.hasAzureDocumentIntelligenceConfig,
    "google-document-ai-enterprise-ocr": cfg.hasGoogleCloudConfig,
    "google-document-ai-gemini-layout-parser": cfg.hasGoogleCloudConfig,
    "mistral-ocr": cfg.hasMistralOcrConfig,
  };
  const parseRows = providers.parseProviders.map((provider): ProviderRow => {
    const configured = parseConfigured[provider.id] ?? false;
    return {
      id: provider.id,
      name: PARSE_LABELS[provider.id] ?? provider.id,
      noteKey: provider.id === "local-ocr" ? "local" : "cloud",
      model: provider.id === "local-ocr" ? "tesseract" : provider.id,
      tone: !configured
        ? "unconfigured"
        : !provider.available
          ? "incomplete"
          : provider.id === providers.activeParseProvider
            ? "active"
            : provider.id === providers.fallbackParseProvider
              ? "fallback"
              : "available",
    };
  });

  const embeddingConfigured: Record<string, boolean> = {
    openai: cfg.hasOpenAiKey,
    "google-gemini": cfg.hasGeminiKey,
    voyage: cfg.hasVoyageKey,
    mistral: cfg.hasMistralEmbeddingConfig,
  };
  const embeddingRows = providers.embeddingProviders.map((provider): ProviderRow => {
    const configured = embeddingConfigured[provider.id] ?? false;
    return {
      id: provider.id,
      name: EMBEDDING_LABELS[provider.id] ?? provider.id,
      noteKey: "cloud",
      model: provider.model,
      tone: !configured
        ? "unconfigured"
        : !provider.available
          ? "incomplete"
          : provider.id === providers.activeEmbeddingProvider
            ? "active"
            : "available",
    };
  });

  const chatEntries: Array<[string, boolean, string | undefined]> = [
    ["openai", cfg.hasOpenAiKey, cfg.openaiModel],
    ["gemini", cfg.hasGeminiKey, cfg.geminiModel],
    ["mistral", cfg.hasMistralKey, cfg.mistralModel],
  ];
  const chatRows = chatEntries.map(([id, hasKey, model]): ProviderRow => {
    const active = id === providers.activeChatProvider;
    return {
      id,
      name: CHAT_LABELS[id] ?? id,
      noteKey: hasKey ? (active ? "onlyText" : "keyStored") : "noKey",
      model: model ?? null,
      tone: !hasKey ? "unconfigured" : active ? "active" : "available",
    };
  });

  return [
    { id: "parsing", activeName: providers.activeParseProvider, rows: parseRows },
    { id: "embeddings", activeName: providers.activeEmbeddingProvider, rows: embeddingRows },
    { id: "chat", activeName: providers.activeChatProvider, rows: chatRows },
  ];
}

export function jobDuration(startedAt: string | null, finishedAt: string | null): number | null {
  if (!startedAt || !finishedAt) return null;
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/**
 * The status endpoint returns only the newest jobs, so this counts failures in
 * that window, not across the archive. The tile's label says so.
 */
export function jobStats(jobs: ProcessingJob[]) {
  const failed = jobs.filter((job) => job.status === "failed").length;
  const durations = jobs
    .map((job) => jobDuration(job.startedAt, job.finishedAt))
    .filter((ms): ms is number => ms !== null);
  const avgSeconds = durations.length
    ? (durations.reduce((sum, ms) => sum + ms, 0) / durations.length / 1000).toFixed(1)
    : null;
  return { failed, avgSeconds };
}
