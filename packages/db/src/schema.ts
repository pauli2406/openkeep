import {
  documentSources,
  documentStatuses,
  embeddingProviders,
  embeddingStatuses,
  parseProviders,
  processingJobStatuses,
  reviewStatuses,
} from "@openkeep/types";
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  halfvec,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const documentSourceEnum = pgEnum("document_source", documentSources);
export const documentStatusEnum = pgEnum("document_status", documentStatuses);
export const parseProviderEnum = pgEnum("parse_provider", parseProviders);
export const embeddingProviderEnum = pgEnum("embedding_provider", embeddingProviders);
export const reviewStatusEnum = pgEnum("review_status", reviewStatuses);
export const embeddingStatusEnum = pgEnum("embedding_status", embeddingStatuses);
export const processingJobStatusEnum = pgEnum(
  "processing_job_status",
  processingJobStatuses,
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    isOwner: boolean("is_owner").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailIdx: uniqueIndex("users_email_idx").on(table.email),
  }),
);

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    tokenPrefix: varchar("token_prefix", { length: 32 }).notNull(),
    tokenHash: text("token_hash").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    prefixIdx: uniqueIndex("api_tokens_prefix_idx").on(table.tokenPrefix),
    userIdx: index("api_tokens_user_idx").on(table.userId),
  }),
);

export const correspondents = pgTable(
  "correspondents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    normalizedName: varchar("normalized_name", { length: 255 }).notNull(),
    summary: text("summary"),
    summaryGeneratedAt: timestamp("summary_generated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugIdx: uniqueIndex("correspondents_slug_idx").on(table.slug),
    normalizedNameIdx: uniqueIndex("correspondents_normalized_name_idx").on(
      table.normalizedName,
    ),
  }),
);

export const documentTypes = pgTable(
  "document_types",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugIdx: uniqueIndex("document_types_slug_idx").on(table.slug),
  }),
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugIdx: uniqueIndex("tags_slug_idx").on(table.slug),
  }),
);

export const documentFiles = pgTable(
  "document_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    checksum: varchar("checksum", { length: 64 }).notNull(),
    storageKey: text("storage_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: varchar("mime_type", { length: 255 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    checksumIdx: uniqueIndex("document_files_checksum_idx").on(table.checksum),
    storageKeyIdx: uniqueIndex("document_files_storage_key_idx").on(table.storageKey),
  }),
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => documentFiles.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    source: documentSourceEnum("source").notNull().default("upload"),
    status: documentStatusEnum("status").notNull().default("pending"),
    mimeType: varchar("mime_type", { length: 255 }).notNull(),
    language: varchar("language", { length: 32 }),
    fullText: text("full_text").notNull().default(""),
    pageCount: integer("page_count").notNull().default(0),
    issueDate: date("issue_date", { mode: "date" }),
    dueDate: date("due_date", { mode: "date" }),
    amount: numeric("amount", { precision: 12, scale: 2 }),
    currency: varchar("currency", { length: 3 }),
    referenceNumber: varchar("reference_number", { length: 255 }),
    confidence: numeric("confidence", { precision: 3, scale: 2 }),
    reviewStatus: reviewStatusEnum("review_status").notNull().default("not_required"),
    reviewReasons: jsonb("review_reasons")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    searchablePdfStorageKey: text("searchable_pdf_storage_key"),
    parseProvider: parseProviderEnum("parse_provider"),
    chunkCount: integer("chunk_count").notNull().default(0),
    embeddingStatus: embeddingStatusEnum("embedding_status")
      .notNull()
      .default("not_configured"),
    embeddingProvider: embeddingProviderEnum("embedding_provider"),
    embeddingModel: varchar("embedding_model", { length: 255 }),
    lastProcessingError: text("last_processing_error"),
    correspondentId: uuid("correspondent_id").references(() => correspondents.id, {
      onDelete: "set null",
    }),
    documentTypeId: uuid("document_type_id").references(() => documentTypes.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerIdx: index("documents_owner_idx").on(table.ownerUserId),
    fileIdx: index("documents_file_idx").on(table.fileId),
    statusIdx: index("documents_status_idx").on(table.status),
    reviewStatusIdx: index("documents_review_status_idx").on(table.reviewStatus),
    parseProviderIdx: index("documents_parse_provider_idx").on(table.parseProvider),
    embeddingStatusIdx: index("documents_embedding_status_idx").on(table.embeddingStatus),
    createdAtIdx: index("documents_created_at_idx").on(table.createdAt),
    issueDateIdx: index("documents_issue_date_idx").on(table.issueDate),
    dueDateIdx: index("documents_due_date_idx").on(table.dueDate),
  }),
);

export const documentPages = pgTable(
  "document_pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    width: integer("width"),
    height: integer("height"),
  },
  (table) => ({
    documentPageIdx: uniqueIndex("document_pages_document_page_idx").on(
      table.documentId,
      table.pageNumber,
    ),
  }),
);

export const documentTextBlocks = pgTable(
  "document_text_blocks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    lineIndex: integer("line_index").notNull(),
    boundingBox: jsonb("bounding_box")
      .$type<{ x: number; y: number; width: number; height: number }>()
      .notNull(),
    text: text("text").notNull(),
  },
  (table) => ({
    documentPageLineIdx: uniqueIndex("document_text_blocks_document_page_line_idx").on(
      table.documentId,
      table.pageNumber,
      table.lineIndex,
    ),
    documentIdx: index("document_text_blocks_document_idx").on(table.documentId),
  }),
);

export const documentTagLinks = pgTable(
  "document_tag_links",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.documentId, table.tagId] }),
    tagIdx: index("document_tag_links_tag_idx").on(table.tagId),
  }),
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    heading: text("heading"),
    text: text("text").notNull(),
    pageFrom: integer("page_from"),
    pageTo: integer("page_to"),
    strategyVersion: varchar("strategy_version", { length: 64 }).notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    documentChunkIdx: uniqueIndex("document_chunks_document_chunk_idx").on(
      table.documentId,
      table.chunkIndex,
    ),
    documentIdx: index("document_chunks_document_idx").on(table.documentId),
  }),
);

export const documentChunkEmbeddings = pgTable(
  "document_chunk_embeddings",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    provider: embeddingProviderEnum("provider").notNull(),
    model: varchar("model", { length: 255 }).notNull(),
    dimensions: integer("dimensions").notNull(),
    embedding: halfvec("embedding", { dimensions: 3072 }).notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.documentId, table.chunkIndex, table.provider, table.model],
    }),
    documentIdx: index("document_chunk_embeddings_document_idx").on(table.documentId),
    providerModelIdx: index("document_chunk_embeddings_provider_model_idx").on(
      table.provider,
      table.model,
    ),
  }),
);

export const processingJobs = pgTable(
  "processing_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    queueName: varchar("queue_name", { length: 128 }).notNull(),
    status: processingJobStatusEnum("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    lastError: text("last_error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    documentIdx: index("processing_jobs_document_idx").on(table.documentId),
    statusIdx: index("processing_jobs_status_idx").on(table.status),
  }),
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    documentId: uuid("document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    eventType: varchar("event_type", { length: 128 }).notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    eventTypeIdx: index("audit_events_event_type_idx").on(table.eventType),
  }),
);

export type ProcessingJobStatus = (typeof processingJobStatuses)[number];
