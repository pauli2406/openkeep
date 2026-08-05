import { Buffer } from "buffer";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import { PDFDocument } from "pdf-lib";

globalThis.Buffer = globalThis.Buffer ?? Buffer;

export type DocumentStatus = "pending" | "processing" | "ready" | "failed";
export type ReviewStatus = "not_required" | "pending" | "resolved";
export type EmbeddingStatus =
  | "not_configured"
  | "queued"
  | "indexing"
  | "ready"
  | "stale"
  | "failed";
export type ParseProvider =
  | "local-ocr"
  | "google-document-ai-enterprise-ocr"
  | "google-document-ai-gemini-layout-parser"
  | "amazon-textract"
  | "azure-ai-document-intelligence"
  | "mistral-ocr";
export type ReviewReason =
  | "low_confidence"
  | "processing_failed"
  | "ocr_empty"
  | "missing_key_fields"
  | "unsupported_format"
  | "classification_ambiguous"
  | "correspondent_unresolved"
  | "validation_failed";
export type ManualOverrideField =
  | "issueDate"
  | "dueDate"
  | "expiryDate"
  | "amount"
  | "currency"
  | "referenceNumber"
  | "holderName"
  | "issuingAuthority"
  | "correspondentId"
  | "documentTypeId"
  | "tagIds";
export type ProcessingJobStatus = "queued" | "running" | "completed" | "failed";
export type LlmProvider = "openai" | "gemini" | "mistral" | "deterministic";

// ---------------------------------------------------------------------------
// Sub-types for rich metadata
// ---------------------------------------------------------------------------

export type ProcessingJobSummary = {
  id: string;
  status: ProcessingJobStatus;
  attempts: number;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ManualOverrides = {
  lockedFields: ManualOverrideField[];
  values: {
    issueDate?: string | null;
    dueDate?: string | null;
    expiryDate?: string | null;
    amount?: number | null;
    currency?: string | null;
    referenceNumber?: string | null;
    holderName?: string | null;
    issuingAuthority?: string | null;
    correspondentId?: string | null;
    documentTypeId?: string | null;
    tagIds?: string[];
  };
  updatedAt?: string | null;
  updatedByUserId?: string | null;
};

export type ReviewEvidence = {
  documentClass: "invoice" | "generic";
  requiredFields: string[];
  missingFields: string[];
  extracted: Record<string, boolean>;
  activeReasons: ReviewReason[];
  confidence?: number | null;
  confidenceThreshold?: number;
  ocrTextLength?: number;
  ocrEmptyThreshold?: number;
};

export type CorrespondentExtraction = {
  rawName?: string | null;
  rawNameNormalized?: string | null;
  resolvedName?: string | null;
  matchStrategy?: string;
  confidence?: number | null;
  evidenceLines?: string[];
  candidateCorrespondents?: Array<{
    id?: string;
    name: string;
    reason?: string;
    score?: number;
  }>;
  blockedReason?: string | null;
  provider?: LlmProvider;
};

export type IntelligenceRouting = {
  documentType: string | null;
  subtype?: string | null;
  confidence?: number | null;
  reasoningHints?: string[];
  agentVersion?: string;
  provider?: LlmProvider;
  model?: string;
};

export type IntelligenceField = {
  value: string | null;
  confidence?: number | null;
  provider?: LlmProvider;
  model?: string;
};

export type IntelligenceExtraction = {
  documentType?: string | null;
  fields: Record<string, unknown>;
  fieldConfidence: Record<string, number>;
  fieldProvenance: Record<
    string,
    {
      source: string;
      provider?: string;
      page?: number | null;
      lineIndex?: number | null;
      snippet?: string | null;
    }
  >;
  provider?: LlmProvider;
  model?: string;
};

export type IntelligenceTagging = {
  tags: string[];
  confidence?: number | null;
  provider?: LlmProvider;
  model?: string;
};

export type IntelligenceValidation = {
  normalizedFields: Record<string, unknown>;
  errors: string[];
  warnings: string[];
  duplicateSignals: Record<string, unknown>;
};

export type IntelligencePipeline = {
  framework?: string;
  runId?: string;
  status?: string;
  providerOrder?: string[];
  durationsMs: Record<string, number>;
  agentVersions: Record<string, string>;
};

export type DocumentIntelligence = {
  routing?: IntelligenceRouting;
  title?: IntelligenceField;
  summary?: IntelligenceField;
  extraction?: IntelligenceExtraction;
  tagging?: IntelligenceTagging;
  correspondentResolution?: {
    resolvedName: string | null;
    confidence?: number | null;
    strategy?: string;
    provider?: LlmProvider;
    model?: string;
  };
  validation?: IntelligenceValidation;
  pipeline?: IntelligencePipeline;
};

export type DocumentMetadata = {
  extractionStrategy?: string;
  normalizationStrategy?: string;
  parseProvider?: ParseProvider;
  parseStrategy?: string;
  documentTypeName?: string | null;
  detectedKeywords?: string[];
  pageCount?: number;
  chunkCount?: number;
  searchablePdfGenerated?: boolean;
  reviewReasons?: ReviewReason[];
  parse?: {
    provider: ParseProvider;
    strategy: string;
    fallbackUsed?: boolean;
    warnings?: string[];
    keyValueCount?: number;
    tableCount?: number;
    providerMetadata?: Record<string, unknown>;
  };
  chunking?: {
    strategy: string;
    chunkCount: number;
    usedProviderHints?: boolean;
  };
  embedding?: {
    provider?: string;
    model?: string;
    configured?: boolean;
    chunkCount?: number;
  };
  correspondentExtraction?: CorrespondentExtraction;
  reviewEvidence?: ReviewEvidence;
  manual?: ManualOverrides;
  intelligence?: DocumentIntelligence;
  // Legacy/simple fields (kept for backward compatibility)
  summary?: string;
};

// ---------------------------------------------------------------------------
// Main document type — matches the backend DocumentSchema shape
// ---------------------------------------------------------------------------

export type ArchiveDocument = {
  id: string;
  title: string;
  mimeType: string;
  status: DocumentStatus;
  createdAt: string;
  issueDate: string | null;
  dueDate: string | null;
  taskCompletedAt: string | null;
  expiryDate: string | null;
  amount: number | null;
  currency: string | null;
  referenceNumber: string | null;
  holderName: string | null;
  issuingAuthority: string | null;
  correspondent: { id: string; name: string; slug: string } | null;
  documentType: {
    id: string;
    name: string;
    slug: string;
    description?: string | null;
    requiredFields?: string[];
  } | null;
  tags: Array<{ id: string; name: string; slug: string }>;
  confidence: number | null;
  reviewStatus: ReviewStatus;
  reviewReasons: ReviewReason[];
  reviewedAt: string | null;
  reviewNote: string | null;
  searchablePdfAvailable: boolean;
  parseProvider: ParseProvider | null;
  chunkCount: number;
  embeddingStatus: EmbeddingStatus;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  embeddingsStale: boolean;
  lastProcessingError: string | null;
  latestProcessingJob: ProcessingJobSummary | null;
  metadata: DocumentMetadata;
  processedAt: string | null;
  updatedAt: string;
  snippets?: string[];
};

export type SearchDocumentsResponse = {
  items: ArchiveDocument[];
  total: number;
  page: number;
  pageSize: number;
};

export type ReviewQueueResponse = SearchDocumentsResponse;

export type DashboardInsights = {
  stats: {
    totalDocuments: number;
    pendingReview: number;
    documentTypesCount: number;
    correspondentsCount: number;
  };
  recentDocuments: ArchiveDocument[];
  topCorrespondents: Array<{
    id: string;
    name: string;
    slug: string;
    documentCount: number;
    totalAmount: number | null;
    currency: string | null;
    latestDocDate?: string | null;
    documentTypes?: Array<{ name: string; count: number }>;
  }>;
  upcomingDeadlines: Array<{
    documentId: string;
    title: string;
    referenceNumber?: string | null;
    dueDate: string;
    amount: number | null;
    currency: string | null;
    correspondentName: string | null;
    documentTypeName?: string | null;
    taskLabel: string;
    daysUntilDue: number;
    isOverdue: boolean;
  }>;
  overdueItems: Array<{
    documentId: string;
    title: string;
    referenceNumber?: string | null;
    dueDate: string;
    amount: number | null;
    currency: string | null;
    daysUntilDue: number;
    isOverdue: boolean;
    correspondentName: string | null;
    documentTypeName?: string | null;
    taskLabel: string;
  }>;
  monthlyActivity?: Array<{ month: string; count: number }>;
};

export type DocumentTextResponse = {
  documentId: string;
  blocks: Array<{
    documentId: string;
    page: number;
    lineIndex: number;
    text: string;
    boundingBox?: { x: number; y: number; width: number; height: number };
  }>;
};

export type AuditEvent = {
  id: string;
  actorUserId: string | null;
  actorDisplayName?: string | null;
  actorEmail?: string | null;
  documentId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type DocumentHistoryResponse = {
  documentId: string;
  items: AuditEvent[];
};

// ---------------------------------------------------------------------------
// Document Q&A types
// ---------------------------------------------------------------------------

export type DocumentAskCitation = {
  chunkIndex: number;
  pageFrom: number | null;
  pageTo: number | null;
  quote: string;
  score: number;
};

export type QaHistoryEntry = {
  id: string;
  question: string;
  answer: string | null;
  status: "answered" | "insufficient_evidence";
  citations: DocumentAskCitation[];
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Provider health types (for reprocess picker)
// ---------------------------------------------------------------------------

export type ParseProviderAvailability = {
  id: ParseProvider;
  available: boolean;
};

export type HealthProvidersResponse = {
  activeParseProvider: ParseProvider;
  fallbackParseProvider: ParseProvider | null;
  activeChatProvider: string | null;
  activeEmbeddingProvider: string | null;
  parseProviders: ParseProviderAvailability[];
  embeddingProviders: Array<{ id: string; available: boolean; model: string | null }>;
};

export type SemanticSearchResponse = {
  items: Array<{
    document: ArchiveDocument;
    score: number;
    matchedChunks: Array<{
      chunkIndex: number;
      text: string;
      pageFrom: number | null;
      pageTo: number | null;
    }>;
  }>;
  total: number;
};

export type AnswerCitation = {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  quote: string;
  pageFrom: number | null;
  pageTo: number | null;
  /** 1-based excerpt number matching the [n] markers the model cites inline. */
  index?: number;
};

export type AnswerQueryResponse = {
  status: "answered" | "insufficient_evidence";
  route: "semantic" | "structured" | "hybrid";
  answer: string | null;
  citations: AnswerCitation[];
  results: Array<{
    document: ArchiveDocument;
    score: number;
  }>;
  structuredData:
    | {
        kind: "deadline_items";
        title: string;
        description: string | null;
        items: Array<{
          documentId: string;
          title: string;
          referenceNumber: string | null;
          dueDate: string;
          amount: number | null;
          currency: string | null;
          correspondentName: string | null;
          documentTypeName: string | null;
          taskLabel: string;
          daysUntilDue: number;
          isOverdue: boolean;
          taskCompletedAt: string | null;
        }>;
        totalOpenCount: number;
        totalAmount: number | null;
        currency: string | null;
        windowStart: string | null;
        windowEnd: string | null;
      }
    | {
        kind: "pending_review_documents" | "expiring_contracts";
        title: string;
        description: string | null;
        items: ArchiveDocument[];
        totalCount: number;
        windowStart?: string | null;
        windowEnd?: string | null;
      }
    | null;
};

export type FacetsResponse = {
  correspondents: Array<{ id: string; name: string; slug: string; count: number }>;
  documentTypes: Array<{ id: string; name: string; slug: string; count: number }>;
  tags: Array<{ id: string; name: string; slug: string; count: number }>;
  statuses: Array<{ status: string; count: number }>;
  years: Array<{ year: number; count: number }>;
};

// ---------------------------------------------------------------------------
// Taxonomy types
// ---------------------------------------------------------------------------

/**
 * An entry of the taxonomy tables themselves. Unlike the facet lists these also cover entries
 * that are not assigned to any document yet, so they are the correct source for edit pickers.
 */
export type TaxonomyOption = {
  id: string;
  name: string;
  slug: string;
};

export type TaxonomyKind = "correspondents" | "document-types" | "tags";

/** Query key for a taxonomy list, shared by every screen that reads it. */
export function taxonomyQueryKey(apiUrl: string, kind: TaxonomyKind) {
  return ["taxonomies", apiUrl, kind] as const;
}

export async function fetchTaxonomy(
  authFetch: (path: string, init?: RequestInit) => Promise<Response>,
  kind: TaxonomyKind,
  errorMessage: string,
): Promise<TaxonomyOption[]> {
  const response = await authFetch(`/api/taxonomies/${kind}`);
  if (!response.ok) {
    throw new Error(errorMessage);
  }
  return (await response.json()) as TaxonomyOption[];
}

export function sortTaxonomyOptions<T extends { name: string }>(options: T[]): T[] {
  return [...options].sort((left, right) => left.name.localeCompare(right.name));
}

// ---------------------------------------------------------------------------
// Correspondent Dossier types
// ---------------------------------------------------------------------------

export type CorrespondentSummaryStatus = "ready" | "pending" | "unavailable";

export type CorrespondentIntelligenceProfile = {
  category: string | null;
  subcategory?: string | null;
  confidence?: number | null;
  narrative?: string | null;
  keySignals: string[];
};

export type CorrespondentIntelligenceTimelineEvent = {
  date: string | null;
  title: string;
  description: string;
  documentId?: string | null;
  documentTitle?: string | null;
};

export type CorrespondentIntelligenceChange = {
  category: string;
  title: string;
  description: string;
  effectiveDate: string | null;
  direction: "increase" | "decrease" | "update" | "notice" | "unknown";
  valueBefore?: string | null;
  valueAfter?: string | null;
  currency?: string | null;
  documentId?: string | null;
  documentTitle?: string | null;
};

export type CorrespondentIntelligenceFact = {
  label: string;
  value: string;
  asOf?: string | null;
  documentId?: string | null;
  documentTitle?: string | null;
};

export type CorrespondentInsuranceInsight = {
  policyReferences: string[];
  latestPremiumAmount?: number | null;
  latestPremiumCurrency?: string | null;
  premiumChangeSummary?: string | null;
  coverageHighlights: string[];
  renewalDate?: string | null;
  cancellationWindow?: string | null;
};

export type CorrespondentIntelligence = {
  overview: string | null;
  profile?: CorrespondentIntelligenceProfile;
  timeline: CorrespondentIntelligenceTimelineEvent[];
  changes: CorrespondentIntelligenceChange[];
  currentState: CorrespondentIntelligenceFact[];
  domainInsights: {
    insurance?: CorrespondentInsuranceInsight;
  };
  sourceDocumentIds: string[];
  provider?: string | null;
  model?: string | null;
  generatedAt?: string | null;
};

export type CorrespondentTypeCount = {
  name: string;
  count: number;
};

export type CorrespondentTimelinePoint = {
  month: string;
  count: number;
};

export type CorrespondentInsightsResponse = {
  correspondent: {
    id: string;
    name: string;
    slug: string;
    summary?: string | null;
    summaryGeneratedAt?: string | null;
    intelligenceGeneratedAt?: string | null;
  };
  summaryStatus: CorrespondentSummaryStatus;
  summary: string | null;
  intelligenceStatus: CorrespondentSummaryStatus;
  intelligence: CorrespondentIntelligence | null;
  stats: {
    documentCount: number;
    totalAmount: number | null;
    currency: string | null;
    dateRange: {
      from: string | null;
      to: string | null;
    };
    avgConfidence: number | null;
  };
  documentTypeBreakdown: CorrespondentTypeCount[];
  timeline: CorrespondentTimelinePoint[];
  recentDocuments: ArchiveDocument[];
  upcomingDeadlines: Array<{
    documentId: string;
    title: string;
    referenceNumber?: string | null;
    dueDate: string;
    amount: number | null;
    currency: string | null;
    correspondentName: string | null;
    documentTypeName?: string | null;
    taskLabel: string;
    daysUntilDue: number;
    isOverdue: boolean;
  }>;
};

export function formatDate(value: string | null | undefined) {
  // Through `parseArchiveDate`: `issueDate`, `dueDate` and `expiryDate` are
  // date-only, and formatting them from a UTC-midnight Date prints the previous
  // day west of Greenwich. This is the long label — the review card, the detail
  // rows and the dossier all read dates through it.
  const date = parseArchiveDate(value);
  if (!date) {
    return value ? value : "-";
  }

  try {
    return new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  } catch {
    return value ?? "-";
  }
}

/**
 * Parses a date the way the archive means it.
 *
 * `issueDate` and `dueDate` arrive as `YYYY-MM-DD`, and `new Date("2026-08-05")`
 * is UTC midnight — which in any negative-offset zone is the 4th locally. Every
 * comparison and label here is calendar-based, so a date-only value is built as
 * a local date.
 */
export function parseArchiveDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `18.03.` — the trailing date on a dense row. */
export function formatShortDate(value: string | null | undefined) {
  const date = parseArchiveDate(value);
  if (!date) {
    return "-";
  }
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.`;
}

export function formatCurrency(amount: number | null | undefined, currency = "EUR") {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return "-";
  }

  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function titleForDocument(document: ArchiveDocument) {
  return document.title?.trim() || document.referenceNumber?.trim() || "Untitled document";
}

export function toneForStatus(status: string): "soft" | "warn" | "bad" | "ok" | "outline" {
  if (status === "ready" || status === "resolved") {
    return "ok";
  }
  if (status === "failed") {
    return "bad";
  }
  if (status === "pending" || status === "processing") {
    return "warn";
  }
  return "outline";
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatMonthLabel(month: string) {
  const parts = month.split("-");
  const monthIndex = Number.parseInt(parts[1] ?? "0", 10) - 1;
  return MONTH_LABELS[monthIndex] ?? month;
}

export function formatMonthYear(month: string) {
  const parts = month.split("-");
  return parts[0] ?? month;
}

export function formatTaskDateLabel(value: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export async function createPdfFromImages(imageUris: string[]) {
  const pdf = await PDFDocument.create();

  for (const imageUri of imageUris) {
    const normalized = await ImageManipulator.manipulateAsync(
      imageUri,
      [],
      {
        compress: 0.92,
        format: ImageManipulator.SaveFormat.JPEG,
      },
    );

    const base64 = await FileSystem.readAsStringAsync(normalized.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
    const jpg = await pdf.embedJpg(bytes);
    const page = pdf.addPage([jpg.width, jpg.height]);
    page.drawImage(jpg, {
      x: 0,
      y: 0,
      width: jpg.width,
      height: jpg.height,
    });
  }

  const pdfBytes = await pdf.save();
  const uri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}openkeep-scan-${Date.now()}.pdf`;
  await FileSystem.writeAsStringAsync(uri, Buffer.from(pdfBytes).toString("base64"), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return uri;
}

export async function responseToMessage(response: Response) {
  const text = await response.text();
  if (!text) {
    return `Request failed with ${response.status}`;
  }

  try {
    const parsed = JSON.parse(text) as { message?: string | string[] };
    if (typeof parsed.message === "string") {
      return parsed.message;
    }
    if (Array.isArray(parsed.message)) {
      return parsed.message.join(", ");
    }
  } catch {
    return text;
  }

  return text;
}

export async function saveDownloadToFile(response: Response, filename: string) {
  const arrayBuffer = await response.arrayBuffer();
  const uri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, Buffer.from(arrayBuffer).toString("base64"), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return uri;
}

// ---------------------------------------------------------------------------
// Inline citation linking
// ---------------------------------------------------------------------------

/**
 * Rewrites inline citation markers into /documents/{id} links.
 *
 * Primary format: numbered markers ([1], [2][4]) resolved EXACTLY against the
 * citation payload's `index` — the previous fuzzy title matching could link
 * the wrong document. The legacy [Document: "Title", Page: N] format stays
 * supported for one release (exact/substring title matches only).
 *
 * Kept as a local copy: the mobile app deliberately has no workspace package
 * dependencies (see mobile-offline-sync docs), so it cannot import the shared
 * SDK helper.
 */
export function linkifyCitations(
  text: string,
  citations: AnswerCitation[],
  _searchResults: Array<{ document: { id: string; title: string } }>,
): string {
  if (citations.length === 0) return text;

  const byIndex = new Map<number, AnswerCitation>();
  for (const citation of citations) {
    if (typeof citation.index === "number" && !byIndex.has(citation.index)) {
      byIndex.set(citation.index, citation);
    }
  }

  let result = text.replace(/\[(\d+)\]/g, (marker, digits: string) => {
    const citation = byIndex.get(Number(digits));
    if (!citation) {
      return marker;
    }
    const pageSuffix = citation.pageFrom ? `, p.${citation.pageFrom}` : "";
    // The marker number rides along: one document can be cited more than once,
    // and the tap has to resolve to the excerpt that was clicked.
    return `[[${digits}${pageSuffix}]](/documents/${citation.documentId}#c${digits})`;
  });

  // Legacy blocks may contain multiple semicolon-separated references:
  //   [Document: "A", Page: 1; Document: "B", Page: 2]
  const legacyBlock = /\[(?:Document:\s*"[^"]*"(?:,\s*Page:\s*\d+)?(?:;\s*)?)+\]/g;
  const legacyRef = /Document:\s*"([^"]*)"(?:,\s*Page:\s*(\d+))?/g;

  result = result.replace(legacyBlock, (block) => {
    const parts: string[] = [];
    let match: RegExpExecArray | null;
    legacyRef.lastIndex = 0;
    while ((match = legacyRef.exec(block)) !== null) {
      const title = match[1] ?? "";
      const page = match[2];
      const normalizedTitle = title.trim().toLowerCase();
      const citation =
        citations.find((c) => c.documentTitle.trim().toLowerCase() === normalizedTitle) ??
        citations.find((c) => c.documentTitle.trim().toLowerCase().includes(normalizedTitle));
      if (!citation) {
        parts.push(`[Document: "${title}"${page ? `, Page: ${page}` : ""}]`);
        continue;
      }
      const pageSuffix = page ? `, p.${page}` : "";
      const ordinal = citation.index ?? citations.indexOf(citation) + 1;
      parts.push(`[[${ordinal}${pageSuffix}]](/documents/${citation.documentId}#c${ordinal})`);
    }
    return parts.length > 0 ? parts.join(" ") : block;
  });

  return result;
}
