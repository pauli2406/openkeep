import {
  EmbeddingProviderSchema,
  ParseProviderSchema,
  ProcessingModeSchema,
} from "@openkeep/types";
import { z } from "zod";

const BooleanFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  }

  return Boolean(value);
}, z.boolean());

const NumberFromEnv = z.preprocess((value) => {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return Number(value);
  }

  return value;
}, z.number().int().positive());

const PortFromEnv = z.preprocess((value) => {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return Number(value);
  }

  return value;
}, z.number().int().min(0));

const DecimalFromEnv = z.preprocess((value) => {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return Number(value);
  }

  return value;
}, z.number().min(0).max(1));

const EmptyStringToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => {
    if (typeof value === "string" && value.trim().length === 0) {
      return undefined;
    }

    return value;
  }, schema);

export const AppEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: PortFromEnv.default(3000),
  API_BASE_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgres://openkeep:openkeep@localhost:5432/openkeep"),
  PG_BOSS_SCHEMA: z.string().min(1).default("pgboss"),
  MINIO_ENDPOINT: z.string().min(1).default("localhost"),
  MINIO_PORT: NumberFromEnv.default(9000),
  MINIO_USE_SSL: BooleanFromEnv.default(false),
  MINIO_ACCESS_KEY: z.string().min(1).default("openkeep"),
  MINIO_SECRET_KEY: z.string().min(1).default("openkeep123"),
  MINIO_BUCKET: z.string().min(1).default("documents"),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL: z.string().default("30d"),
  OWNER_EMAIL: z.string().email().default("owner@example.com"),
  OWNER_PASSWORD: z.string().min(12).default("change-this-password"),
  OWNER_NAME: z.string().min(1).default("OpenKeep Owner"),
  SKIP_EXTERNAL_INIT: BooleanFromEnv.default(false),
  PROVIDER_MODE: ProcessingModeSchema.default("hybrid"),
  ACTIVE_PARSE_PROVIDER: ParseProviderSchema.default("local-ocr"),
  FALLBACK_PARSE_PROVIDER: EmptyStringToUndefined(ParseProviderSchema.nullable().optional()),
  ACTIVE_EMBEDDING_PROVIDER: EmptyStringToUndefined(
    EmbeddingProviderSchema.nullable().optional(),
  ),
  OPENAI_API_KEY: EmptyStringToUndefined(z.string().optional()),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_EMBEDDING_MODEL: EmptyStringToUndefined(z.string().optional()),
  GEMINI_API_KEY: EmptyStringToUndefined(z.string().optional()),
  GEMINI_MODEL: z.string().default("gemini-2.0-flash"),
  GEMINI_EMBEDDING_MODEL: EmptyStringToUndefined(z.string().optional()),
  VOYAGE_API_KEY: EmptyStringToUndefined(z.string().optional()),
  VOYAGE_API_BASE_URL: z.string().url().default("https://api.voyageai.com/v1"),
  VOYAGE_EMBEDDING_MODEL: EmptyStringToUndefined(z.string().optional()),
  MISTRAL_MODEL: z.string().default("mistral-small-latest"),
  GOOGLE_CLOUD_PROJECT_ID: EmptyStringToUndefined(z.string().optional()),
  GOOGLE_CLOUD_LOCATION: z.string().default("eu"),
  GOOGLE_CLOUD_ACCESS_TOKEN: EmptyStringToUndefined(z.string().optional()),
  GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON: EmptyStringToUndefined(z.string().optional()),
  GOOGLE_DOCUMENT_AI_ENTERPRISE_PROCESSOR_ID: EmptyStringToUndefined(z.string().optional()),
  GOOGLE_DOCUMENT_AI_GEMINI_PROCESSOR_ID: EmptyStringToUndefined(z.string().optional()),
  AWS_REGION: EmptyStringToUndefined(z.string().optional()),
  AWS_ACCESS_KEY_ID: EmptyStringToUndefined(z.string().optional()),
  AWS_SECRET_ACCESS_KEY: EmptyStringToUndefined(z.string().optional()),
  AWS_SESSION_TOKEN: EmptyStringToUndefined(z.string().optional()),
  AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: EmptyStringToUndefined(z.string().url().optional()),
  AZURE_DOCUMENT_INTELLIGENCE_API_KEY: EmptyStringToUndefined(z.string().optional()),
  MISTRAL_API_KEY: EmptyStringToUndefined(z.string().optional()),
  MISTRAL_OCR_BASE_URL: z.string().url().default("https://api.mistral.ai"),
  MISTRAL_OCR_MODEL: z.string().default("mistral-ocr-latest"),
  MISTRAL_EMBEDDING_MODEL: EmptyStringToUndefined(z.string().optional()),
  OCR_LANGUAGES: z.string().default("deu+eng"),
  PARSE_PROVIDER_TIMEOUT_SECONDS: NumberFromEnv.default(120),
  PARSE_PROVIDER_MAX_PAGES: NumberFromEnv.default(300),
  PARSE_PROVIDER_MAX_BYTES: NumberFromEnv.default(52_428_800),
  REVIEW_CONFIDENCE_THRESHOLD: DecimalFromEnv.default(0.65),
  OCR_EMPTY_TEXT_THRESHOLD: NumberFromEnv.default(20),
  PROCESSING_RETRY_LIMIT: NumberFromEnv.default(2),
  PROCESSING_RETRY_DELAY_SECONDS: NumberFromEnv.default(30),
  WATCH_FOLDER_PATH: EmptyStringToUndefined(z.string().optional()),
  MAX_UPLOAD_BYTES: NumberFromEnv.default(67_108_864),
  SEARCH_DEFAULT_PAGE_SIZE: NumberFromEnv.default(20),
  SEARCH_MAX_PAGE_SIZE: NumberFromEnv.default(100),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

export type AppConfig = z.infer<typeof AppEnvSchema>;

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig =>
  AppEnvSchema.parse(env);

export const minioEndpoint = (config: AppConfig): string =>
  `${config.MINIO_USE_SSL ? "https" : "http"}://${config.MINIO_ENDPOINT}:${config.MINIO_PORT}`;

export const providerConfig = (config: AppConfig) => ({
  mode: config.PROVIDER_MODE,
  activeParseProvider: config.ACTIVE_PARSE_PROVIDER,
  fallbackParseProvider: config.FALLBACK_PARSE_PROVIDER ?? null,
  activeEmbeddingProvider: config.ACTIVE_EMBEDDING_PROVIDER ?? null,
  openaiModel: config.OPENAI_MODEL,
  geminiModel: config.GEMINI_MODEL,
  mistralModel: config.MISTRAL_MODEL,
  openaiEmbeddingModel: config.OPENAI_EMBEDDING_MODEL,
  geminiEmbeddingModel: config.GEMINI_EMBEDDING_MODEL,
  voyageEmbeddingModel: config.VOYAGE_EMBEDDING_MODEL,
  mistralEmbeddingModel: config.MISTRAL_EMBEDDING_MODEL,
  hasOpenAiKey: Boolean(config.OPENAI_API_KEY),
  hasGeminiKey: Boolean(config.GEMINI_API_KEY),
  hasMistralKey: Boolean(config.MISTRAL_API_KEY),
  hasVoyageKey: Boolean(config.VOYAGE_API_KEY),
  hasGoogleCloudConfig: Boolean(
    config.GOOGLE_CLOUD_PROJECT_ID &&
      (config.GOOGLE_CLOUD_ACCESS_TOKEN || config.GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON) &&
      (config.GOOGLE_DOCUMENT_AI_ENTERPRISE_PROCESSOR_ID ||
        config.GOOGLE_DOCUMENT_AI_GEMINI_PROCESSOR_ID),
  ),
  hasAwsTextractConfig: Boolean(
    config.AWS_REGION && config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY,
  ),
  hasAzureDocumentIntelligenceConfig: Boolean(
    config.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT &&
      config.AZURE_DOCUMENT_INTELLIGENCE_API_KEY,
  ),
  hasMistralOcrConfig: Boolean(config.MISTRAL_API_KEY),
  hasMistralEmbeddingConfig: Boolean(config.MISTRAL_API_KEY),
});
