import { ProcessingModeSchema } from "@openkeep/types";
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
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.0-flash"),
  OCR_LANGUAGES: z.string().default("deu+eng"),
  REVIEW_CONFIDENCE_THRESHOLD: DecimalFromEnv.default(0.65),
  OCR_EMPTY_TEXT_THRESHOLD: NumberFromEnv.default(20),
  PROCESSING_RETRY_LIMIT: NumberFromEnv.default(2),
  PROCESSING_RETRY_DELAY_SECONDS: NumberFromEnv.default(30),
  MAX_UPLOAD_BYTES: NumberFromEnv.default(26_214_400),
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
  openaiModel: config.OPENAI_MODEL,
  geminiModel: config.GEMINI_MODEL,
  hasOpenAiKey: Boolean(config.OPENAI_API_KEY),
  hasGeminiKey: Boolean(config.GEMINI_API_KEY),
});
