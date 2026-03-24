import { Inject, Injectable } from "@nestjs/common";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { ReviewEvidenceField, ReviewReason } from "@openkeep/types";

import { AppConfigService } from "../common/config/app-config.service";
import { CorrespondentResolutionService } from "./correspondent-resolution.service";
import {
  DOCUMENT_TYPE_DEFINITIONS,
  TYPE_KEYWORDS,
  getDocumentTypeDefinition,
  getRelevantFieldNames,
  type SupportedDocumentType,
} from "./document-intelligence.registry";
import { DocumentTypePolicyService } from "./document-type-policy.service";
import { LlmService, type LlmProviderId } from "./llm.service";
import {
  computeConfidence,
  dateToIso,
  normalizeAmountValue,
  normalizeCurrencyCode,
  parseDateOnly,
} from "./normalization.util";
import type { MetadataExtractionInput, MetadataExtractionResult } from "./provider.types";
import { getTypeSpecificExtractor } from "./type-specific-extractors";

type AgentProvider = LlmProviderId | "deterministic";

interface RoutingResult {
  documentType: SupportedDocumentType;
  subtype: string | null;
  confidence: number;
  reasoningHints: string[];
  provider: AgentProvider;
  model: string | null;
}

interface TitleSummaryResult {
  title: string | null;
  titleConfidence: number | null;
  summary: string | null;
  summaryConfidence: number | null;
  provider: AgentProvider;
  model: string | null;
}

interface ExtractionFieldProvenance {
  source: string;
  provider?: string;
  page?: number | null;
  lineIndex?: number | null;
  snippet?: string | null;
}

interface ExtractionResult {
  documentType: SupportedDocumentType;
  canonicalDocumentTypeName: string | null;
  fields: Record<string, unknown>;
  fieldConfidence: Record<string, number>;
  fieldProvenance: Record<string, ExtractionFieldProvenance>;
  provider: AgentProvider;
  model: string | null;
}

interface TaggingResult {
  tags: string[];
  confidence: number | null;
  provider: AgentProvider;
  model: string | null;
}

interface ValidationResult {
  normalizedFields: Record<string, unknown>;
  warnings: string[];
  errors: string[];
  duplicateSignals: Record<string, unknown>;
}

interface DocumentEvidenceMatch {
  page: number | null;
  lineIndex: number | null;
  snippet: string | null;
}

const WorkflowState = Annotation.Root({
  input: Annotation<MetadataExtractionInput | null>({
    reducer: (_previous, next) => next,
    default: () => null,
  }),
  routing: Annotation<RoutingResult | null>({
    reducer: (_previous, next) => next,
    default: () => null,
  }),
  titleSummary: Annotation<TitleSummaryResult | null>({
    reducer: (_previous, next) => next,
    default: () => null,
  }),
  extraction: Annotation<ExtractionResult | null>({
    reducer: (_previous, next) => next,
    default: () => null,
  }),
  correspondentResolution: Annotation<
    Awaited<ReturnType<CorrespondentResolutionService["resolve"]>> | null
  >({
    reducer: (_previous, next) => next,
    default: () => null,
  }),
  tagging: Annotation<TaggingResult | null>({
    reducer: (_previous, next) => next,
    default: () => null,
  }),
  validation: Annotation<ValidationResult | null>({
    reducer: (_previous, next) => next,
    default: () => null,
  }),
  durationsMs: Annotation<Record<string, number>>({
    reducer: (previous, next) => ({ ...previous, ...next }),
    default: () => ({}),
  }),
});

type WorkflowStateValue = typeof WorkflowState.State;

const AGENT_FRAMEWORK = "langgraph-ready";
const AGENT_VERSION = "v1";
const DEFAULT_PROVIDER_ORDER: LlmProviderId[] = ["mistral", "gemini", "openai"];


@Injectable()
export class AgenticDocumentIntelligenceService {
  constructor(
    @Inject(LlmService) private readonly llmService: LlmService,
    @Inject(DocumentTypePolicyService)
    private readonly documentTypePolicyService: DocumentTypePolicyService,
    @Inject(CorrespondentResolutionService)
    private readonly correspondentResolutionService: CorrespondentResolutionService,
    @Inject(AppConfigService) private readonly configService: AppConfigService,
  ) {}

  async extract(input: MetadataExtractionInput): Promise<MetadataExtractionResult> {
    const startedAt = Date.now();
    const workflow = this.createWorkflow().compile();
    const state = await workflow.invoke({
      input,
    });
    const routing = this.requireState(state.routing, "routing");
    const titleSummary = this.requireState(state.titleSummary, "titleSummary");
    const extracted = this.requireState(state.extraction, "extraction");
    const correspondentResolution = this.requireState(
      state.correspondentResolution,
      "correspondentResolution",
    );
    const tagging = this.requireState(state.tagging, "tagging");
    const validation = this.requireState(state.validation, "validation");
    const durationsMs = {
      ...state.durationsMs,
      total: Date.now() - startedAt,
    };

    const documentTypePolicy = await this.documentTypePolicyService.getPolicy(
      extracted.canonicalDocumentTypeName,
    );
    const reviewEvidence = this.documentTypePolicyService.buildReviewEvidence(documentTypePolicy, {
      correspondent: Boolean(validation.normalizedFields.correspondentName),
      issueDate: Boolean(validation.normalizedFields.issueDate),
      dueDate: Boolean(validation.normalizedFields.dueDate),
      amount: typeof validation.normalizedFields.amount === "number",
      currency: Boolean(validation.normalizedFields.currency),
      referenceNumber: Boolean(validation.normalizedFields.referenceNumber),
      expiryDate: Boolean(validation.normalizedFields.expiryDate),
      holderName: Boolean(validation.normalizedFields.holderName),
      issuingAuthority: Boolean(validation.normalizedFields.issuingAuthority),
    });

    const reviewReasons = this.resolveReviewReasons(
      input,
      routing,
      correspondentResolution.correspondentName,
      validation,
      reviewEvidence,
    );
    const confidence = this.resolveOverallConfidence(
      routing,
      titleSummary,
      extracted,
      tagging,
      correspondentResolution.metadata.confidence,
      reviewReasons,
    );

    return {
      title:
        this.asNullableString(validation.normalizedFields.title) ??
        titleSummary.title ??
        input.title,
      summary: this.asNullableString(validation.normalizedFields.summary) ?? titleSummary.summary,
      language: input.parsed.language,
      issueDate: this.asDate(validation.normalizedFields.issueDate),
      dueDate: this.asDate(validation.normalizedFields.dueDate),
      expiryDate: this.asDate(validation.normalizedFields.expiryDate),
      amount: this.asNullableNumber(validation.normalizedFields.amount),
      currency: this.asNullableString(validation.normalizedFields.currency),
      referenceNumber: this.asNullableString(validation.normalizedFields.referenceNumber),
      holderName: this.asNullableString(validation.normalizedFields.holderName),
      issuingAuthority: this.asNullableString(validation.normalizedFields.issuingAuthority),
      correspondentName: correspondentResolution.correspondentName,
      documentTypeName: extracted.canonicalDocumentTypeName,
      tags: tagging.tags,
      confidence,
      reviewReasons,
      metadata: {
        extractionStrategy: "agentic",
        normalizationStrategy: "agentic-validator-v1",
        documentTypeName: extracted.canonicalDocumentTypeName,
        detectedKeywords: routing.reasoningHints,
        correspondentExtraction: {
          ...correspondentResolution.metadata,
          provider: correspondentResolution.metadata.provider,
        },
        reviewEvidence: {
          ...reviewEvidence,
          activeReasons: reviewReasons,
          confidence,
          confidenceThreshold: this.configService.get("REVIEW_CONFIDENCE_THRESHOLD"),
          ocrTextLength: input.parsed.text.trim().length,
          ocrEmptyThreshold: this.configService.get("OCR_EMPTY_TEXT_THRESHOLD"),
        },
        intelligence: {
          routing: {
            documentType: routing.documentType,
            subtype: routing.subtype,
            confidence: routing.confidence,
            reasoningHints: routing.reasoningHints,
            agentVersion: AGENT_VERSION,
            provider: routing.provider,
            model: routing.model ?? undefined,
          },
          title: {
            value: titleSummary.title,
            confidence: titleSummary.titleConfidence,
            provider: titleSummary.provider,
            model: titleSummary.model ?? undefined,
          },
          summary: {
            value: titleSummary.summary,
            confidence: titleSummary.summaryConfidence,
            provider: titleSummary.provider,
            model: titleSummary.model ?? undefined,
          },
          extraction: {
            documentType: routing.documentType,
            fields: extracted.fields,
            fieldConfidence: extracted.fieldConfidence,
            fieldProvenance: extracted.fieldProvenance,
            provider: extracted.provider,
            model: extracted.model ?? undefined,
          },
          tagging: {
            tags: tagging.tags,
            confidence: tagging.confidence,
            provider: tagging.provider,
            model: tagging.model ?? undefined,
          },
          correspondentResolution: {
            resolvedName: correspondentResolution.correspondentName,
            confidence: correspondentResolution.metadata.confidence,
            strategy: correspondentResolution.metadata.matchStrategy,
            provider: correspondentResolution.metadata.provider,
          },
          validation: {
            normalizedFields: validation.normalizedFields,
            errors: validation.errors,
            warnings: validation.warnings,
            duplicateSignals: validation.duplicateSignals,
          },
          pipeline: {
            framework: AGENT_FRAMEWORK,
            runId: `${input.documentId}:${Date.now()}`,
            status: validation.errors.length > 0 ? "completed_with_errors" : "completed",
            providerOrder: DEFAULT_PROVIDER_ORDER,
            durationsMs,
            agentVersions: {
              routing: AGENT_VERSION,
              titleSummary: AGENT_VERSION,
              extraction: AGENT_VERSION,
              tagging: AGENT_VERSION,
              correspondentResolution: AGENT_VERSION,
              validation: AGENT_VERSION,
            },
          },
        },
      },
    };
  }

  private createWorkflow() {
    return new StateGraph(WorkflowState)
      .addNode("route", async (state) => {
        const input = this.requireState(state.input, "input");
        return this.measureNode("routing", async () => ({
          routing: await this.routeDocument(input),
        }));
      })
      .addNode("generateTitleSummary", async (state) => {
        const input = this.requireState(state.input, "input");
        const routing = this.requireState(state.routing, "routing");
        return this.measureNode("titleSummary", async () => ({
          titleSummary: await this.generateTitleSummary(input, routing),
        }));
      })
      .addNode("extractTypedMetadata", async (state) => {
        const input = this.requireState(state.input, "input");
        const routing = this.requireState(state.routing, "routing");
        return this.measureNode("typedExtraction", async () => ({
          extraction: await this.extractTypedMetadata(input, routing),
        }));
      })
      .addNode("resolveCorrespondent", async (state) => {
        const input = this.requireState(state.input, "input");
        const routing = this.requireState(state.routing, "routing");
        const titleSummary = this.requireState(state.titleSummary, "titleSummary");
        const extraction = this.requireState(state.extraction, "extraction");
        return this.measureNode("correspondentResolution", async () => ({
          correspondentResolution: await this.correspondentResolutionService.resolve(input, {
            ...this.buildResolutionSeed(input, routing, titleSummary, extraction),
            correspondentName:
              this.asNullableString(extraction.fields.correspondentName) ??
              this.asNullableString(extraction.fields.correspondent) ??
              null,
          }),
        }));
      })
      .addNode("generateTags", async (state) => {
        const input = this.requireState(state.input, "input");
        const routing = this.requireState(state.routing, "routing");
        const extraction = this.requireState(state.extraction, "extraction");
        const correspondentResolution = this.requireState(
          state.correspondentResolution,
          "correspondentResolution",
        );
        return this.measureNode("tagging", async () => ({
          tagging: await this.generateTags(
            input,
            routing,
            extraction,
            correspondentResolution,
          ),
        }));
      })
      .addNode("normalizeAndValidate", async (state) => {
        const input = this.requireState(state.input, "input");
        const routing = this.requireState(state.routing, "routing");
        const titleSummary = this.requireState(state.titleSummary, "titleSummary");
        const extraction = this.requireState(state.extraction, "extraction");
        const tagging = this.requireState(state.tagging, "tagging");
        const correspondentResolution = this.requireState(
          state.correspondentResolution,
          "correspondentResolution",
        );
        return this.measureNode("validation", async () => ({
          validation: await this.normalizeAndValidate(
            input,
            routing,
            titleSummary,
            extraction,
            tagging,
            correspondentResolution,
          ),
        }));
      })
      .addEdge(START, "route")
      .addEdge("route", "generateTitleSummary")
      .addEdge("generateTitleSummary", "extractTypedMetadata")
      .addEdge("extractTypedMetadata", "resolveCorrespondent")
      .addEdge("resolveCorrespondent", "generateTags")
      .addEdge("generateTags", "normalizeAndValidate")
      .addEdge("normalizeAndValidate", END);
  }

  private async measureNode(
    key: string,
    action: () => Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const startedAt = Date.now();
    const result = await action();
    return {
      ...result,
      durationsMs: {
        [key]: Date.now() - startedAt,
      },
    };
  }

  private requireState<T>(value: T | null | undefined, key: string): T {
    if (value == null) {
      throw new Error(`Missing workflow state: ${key}`);
    }

    return value;
  }

  private async routeDocument(input: MetadataExtractionInput): Promise<RoutingResult> {
    const fallback = this.routeDeterministically(input);
    const providerInfos = this.llmService.getAvailableProviderInfos(DEFAULT_PROVIDER_ORDER);
    if (providerInfos.length === 0) {
      return fallback;
    }

    const providerResult = await this.llmService.completeWithFallback(
      {
        messages: [
          {
            role: "system",
            content: [
              "You classify personal archive documents.",
              "Return JSON only.",
              'Schema: {"documentType":string,"subtype":string|null,"confidence":number,"reasoningHints":string[]}',
              `Allowed documentType values: ${Object.keys(DOCUMENT_TYPE_DEFINITIONS).join(", ")}`,
              "Be conservative. If uncertain, use generic_letter.",
            ].join("\n"),
          },
          {
            role: "user",
            content: this.buildDocumentPrompt(input),
          },
        ],
        temperature: 0,
        maxTokens: 250,
        jsonMode: true,
      },
      DEFAULT_PROVIDER_ORDER,
    );

    const parsed = this.parseJsonObject(providerResult.text);
    const documentType = this.toSupportedDocumentType(parsed?.documentType);
    if (!parsed || !documentType) {
      return fallback;
    }

    return {
      documentType,
      subtype: this.asNullableString(parsed.subtype),
      confidence: this.normalizeConfidence(parsed.confidence, fallback.confidence),
      reasoningHints: this.asStringArray(parsed.reasoningHints, fallback.reasoningHints),
      provider: providerResult.provider ?? fallback.provider,
      model: providerResult.model,
    };
  }

  private async generateTitleSummary(
    input: MetadataExtractionInput,
    routing: RoutingResult,
  ): Promise<TitleSummaryResult> {
    const fallback = this.buildDeterministicTitleSummary(input, routing);
    const providerResult = await this.llmService.completeWithFallback(
      {
        messages: [
          {
            role: "system",
            content: [
              "You generate a clean archive title and a short summary.",
              "Return JSON only.",
              'Schema: {"title":string,"titleConfidence":number,"summary":string,"summaryConfidence":number}',
              "The title must be concise, neutral, and useful in a document list.",
              "The summary must be 1-2 sentences, factual, and under 240 characters.",
              "Do not invent missing facts.",
            ].join("\n"),
          },
          {
            role: "user",
            content: `${this.buildDocumentPrompt(input)}\n\nDetected type: ${routing.documentType}`,
          },
        ],
        temperature: 0.1,
        maxTokens: 300,
        jsonMode: true,
      },
      DEFAULT_PROVIDER_ORDER,
    );

    const parsed = this.parseJsonObject(providerResult.text);
    if (!parsed) {
      return fallback;
    }

    return {
      title: this.asNullableString(parsed.title) ?? fallback.title,
      titleConfidence: this.normalizeOptionalConfidence(parsed.titleConfidence, fallback.titleConfidence),
      summary: this.asNullableString(parsed.summary) ?? fallback.summary,
      summaryConfidence: this.normalizeOptionalConfidence(
        parsed.summaryConfidence,
        fallback.summaryConfidence,
      ),
      provider: providerResult.provider ?? fallback.provider,
      model: providerResult.model,
    };
  }

  private async extractTypedMetadata(
    input: MetadataExtractionInput,
    routing: RoutingResult,
  ): Promise<ExtractionResult> {
    const fallback = await this.extractTypedMetadataDeterministically(input, routing);
    const typeSpecificExtractor = getTypeSpecificExtractor(routing.documentType);
    const providerResult = await this.llmService.completeWithFallback(
      {
        messages: [
          {
            role: "system",
            content: [
              "You extract normalized metadata from a document.",
              "Return JSON only.",
              'Schema: {"fields":Record<string,unknown>,"fieldConfidence":Record<string,number>}',
              "Extract only fields relevant for the given document type.",
              "Use null for unknown values.",
              "Dates must stay in original text form if uncertain.",
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              `Document type: ${routing.documentType}`,
              `Canonical type: ${getDocumentTypeDefinition(routing.documentType).canonicalName}`,
              `Relevant fields: ${getRelevantFieldNames(routing.documentType).join(", ")}`,
              `Extraction focus: ${typeSpecificExtractor.promptFocus}`,
              this.buildDocumentPrompt(input),
            ].join("\n\n"),
          },
        ],
        temperature: 0,
        maxTokens: 500,
        jsonMode: true,
      },
      DEFAULT_PROVIDER_ORDER,
    );

    const parsed = this.parseJsonObject(providerResult.text);
    if (!parsed || typeof parsed.fields !== "object" || parsed.fields === null) {
      return fallback;
    }

    const fields = {
      ...fallback.fields,
      ...(parsed.fields as Record<string, unknown>),
    };
    const refinedFields = typeSpecificExtractor.refineFields?.(input, fields) ?? fields;
    const fieldConfidence = {
      ...fallback.fieldConfidence,
      ...this.normalizeFieldConfidenceMap(parsed.fieldConfidence),
    };

    return {
      ...fallback,
      fields: refinedFields,
      fieldConfidence,
      fieldProvenance: this.buildFieldProvenance(
        input,
        refinedFields,
        providerResult.provider ?? fallback.provider,
        fallback.fieldProvenance,
      ),
      provider: providerResult.provider ?? fallback.provider,
      model: providerResult.model,
    };
  }

  private async generateTags(
    input: MetadataExtractionInput,
    routing: RoutingResult,
    extraction: ExtractionResult,
    correspondentResolution: Awaited<ReturnType<CorrespondentResolutionService["resolve"]>>,
  ): Promise<TaggingResult> {
    const deterministicTags = new Set<string>();
    deterministicTags.add(routing.documentType.replace(/_/g, "-"));
    if (routing.documentType === "invoice" || routing.documentType === "receipt") {
      deterministicTags.add("finance");
    }
    if (routing.documentType === "contract") {
      deterministicTags.add("agreement");
    }
    if (routing.documentType === "tax_document") {
      deterministicTags.add("tax");
    }
    if (routing.documentType === "utility_bill") {
      deterministicTags.add("utilities");
    }
    if (extraction.fields.dueDate) {
      deterministicTags.add("deadline");
    }
    if (correspondentResolution.correspondentName) {
      deterministicTags.add(
        this.slugLike(correspondentResolution.correspondentName).slice(0, 64),
      );
    }

    const fallback = {
      tags: [...deterministicTags].filter(Boolean),
      confidence: 0.72,
      provider: "deterministic" as const,
      model: null,
    };

    const providerResult = await this.llmService.completeWithFallback(
      {
        messages: [
          {
            role: "system",
            content: [
              "You assign concise archive tags.",
              "Return JSON only.",
              'Schema: {"tags":string[],"confidence":number}',
              "Use 2-6 tags.",
              "Prefer specific, reusable tags over generic adjectives.",
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              `Document type: ${routing.documentType}`,
              `Current deterministic tags: ${fallback.tags.join(", ")}`,
              `Correspondent: ${correspondentResolution.correspondentName ?? "unknown"}`,
              this.buildDocumentPrompt(input),
            ].join("\n\n"),
          },
        ],
        temperature: 0.1,
        maxTokens: 200,
        jsonMode: true,
      },
      DEFAULT_PROVIDER_ORDER,
    );

    const parsed = this.parseJsonObject(providerResult.text);
    if (!parsed) {
      return fallback;
    }

    return {
      tags: [...new Set([...fallback.tags, ...this.asStringArray(parsed.tags, [])])].slice(0, 8),
      confidence: this.normalizeOptionalConfidence(parsed.confidence, fallback.confidence),
      provider: providerResult.provider ?? fallback.provider,
      model: providerResult.model,
    };
  }

  private async normalizeAndValidate(
    input: MetadataExtractionInput,
    routing: RoutingResult,
    titleSummary: TitleSummaryResult,
    extraction: ExtractionResult,
    tagging: TaggingResult,
    correspondentResolution: Awaited<ReturnType<CorrespondentResolutionService["resolve"]>>,
  ): Promise<ValidationResult> {
    const fields = extraction.fields;
    const normalizedIssueDate = this.normalizeDateField(fields.issueDate);
    const normalizedDueDate = this.normalizeDateField(fields.dueDate);
    const normalizedExpiryDate = this.normalizeDateField(fields.expiryDate);
    let normalizedAmount = this.normalizeAmountField(fields.amount);
    let normalizedCurrency = this.normalizeCurrencyField(fields.currency, fields.amount);
    if (routing.documentType === "insurance_document") {
      const insuranceAmount = this.resolveInsurancePremiumAmount(input.parsed.text);
      if (insuranceAmount === null) {
        normalizedAmount = null;
        normalizedCurrency = null;
      } else {
        normalizedAmount = insuranceAmount.amount;
        normalizedCurrency = insuranceAmount.currency;
      }
    }
    const normalizedReferenceNumber = this.cleanReferenceNumber(fields.referenceNumber);
    const normalizedHolderName = this.cleanNullableString(fields.holderName);
    const normalizedIssuingAuthority = this.cleanNullableString(fields.issuingAuthority);
    const normalizedCorrespondentName =
      correspondentResolution.correspondentName ??
      this.cleanNullableString(fields.correspondentName) ??
      this.cleanNullableString(fields.correspondent);
    const normalizedTitle =
      this.cleanNullableString(titleSummary.title) ?? this.buildDeterministicTitleSummary(input, routing).title;
    const normalizedSummary = this.cleanNullableString(titleSummary.summary);

    const normalizedFields = {
      title: normalizedTitle,
      summary: normalizedSummary,
      issueDate: dateToIso(normalizedIssueDate),
      dueDate: dateToIso(normalizedDueDate),
      expiryDate: dateToIso(normalizedExpiryDate),
      amount: normalizedAmount,
      currency: normalizedCurrency,
      referenceNumber: normalizedReferenceNumber,
      holderName: normalizedHolderName,
      issuingAuthority: normalizedIssuingAuthority,
      correspondentName: normalizedCorrespondentName,
      documentTypeName: extraction.canonicalDocumentTypeName,
      tags: tagging.tags,
    } satisfies Record<string, unknown>;

    const warnings: string[] = [];
    const errors: string[] = [];
    if (normalizedAmount !== null && !normalizedCurrency) {
      warnings.push("amount_without_currency");
    }
    if (routing.confidence < this.configService.get("REVIEW_CONFIDENCE_THRESHOLD")) {
      warnings.push("routing_low_confidence");
    }
    if (!normalizedCorrespondentName && getDocumentTypeDefinition(routing.documentType).requiredFields.includes("correspondent")) {
      warnings.push("correspondent_missing");
    }
    if (!normalizedTitle) {
      errors.push("title_missing");
    }

    const duplicateSignals: Record<string, unknown> = {
      referenceNumber: normalizedReferenceNumber,
      amountCurrencyDateKey:
        normalizedAmount !== null || normalizedCurrency || normalizedIssueDate
          ? [normalizedAmount ?? "", normalizedCurrency ?? "", dateToIso(normalizedIssueDate) ?? ""]
              .join("|")
              .replace(/^\|+|\|+$/g, "") || null
          : null,
      correspondentNormalized: normalizedCorrespondentName
        ? this.slugLike(normalizedCorrespondentName)
        : null,
    };

    return {
      normalizedFields,
      warnings,
      errors,
      duplicateSignals,
    };
  }

  private routeDeterministically(input: MetadataExtractionInput): RoutingResult {
    const sample = `${input.title}\n${input.parsed.text}`;
    const match = TYPE_KEYWORDS.find((candidate) =>
      candidate.patterns.some((pattern) => pattern.test(sample)),
    );
    const documentType = match?.type ?? "generic_letter";

    return {
      documentType,
      subtype: null,
      confidence: match ? 0.78 : 0.52,
      reasoningHints: match
        ? [`keyword:${match.type}`]
        : ["fallback:generic_letter"],
      provider: "deterministic",
      model: null,
    };
  }

  private buildDeterministicTitleSummary(
    input: MetadataExtractionInput,
    routing: RoutingResult,
  ): TitleSummaryResult {
    const firstMeaningfulLine = input.parsed.pages
      .flatMap((page) => page.lines)
      .map((line) => line.text.trim())
      .find((line) => line.length > 3);
    const canonicalName = getDocumentTypeDefinition(routing.documentType).canonicalName;
    const title =
      this.cleanNullableString(firstMeaningfulLine) ??
      this.cleanNullableString(input.title) ??
      canonicalName;

    return {
      title,
      titleConfidence: 0.7,
      summary: `${canonicalName}: ${getDocumentTypeDefinition(routing.documentType).summary}`,
      summaryConfidence: 0.62,
      provider: "deterministic",
      model: null,
    };
  }

  private async extractTypedMetadataDeterministically(
    input: MetadataExtractionInput,
    routing: RoutingResult,
  ): Promise<ExtractionResult> {
    const typeSpecificExtractor = getTypeSpecificExtractor(routing.documentType);
    const definition = getDocumentTypeDefinition(routing.documentType);
    const canonicalDocumentTypeName = definition.canonicalName;
    const fields = typeSpecificExtractor.extractFields(input, {
      findDateByLabels: this.findDateByLabels.bind(this),
      findAmount: this.findAmount.bind(this),
      findCurrency: this.findCurrency.bind(this),
      findReferenceNumber: this.findReferenceNumber.bind(this),
      findValueByLabels: this.findValueByLabels.bind(this),
      findCorrespondentCandidate: this.findCorrespondentCandidate.bind(this),
    });

    const fieldConfidence: Record<string, number> = {};
    const fieldProvenance: Record<string, ExtractionFieldProvenance> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === null || value === undefined || value === "") {
        continue;
      }
      const evidence = this.findEvidenceMatch(input, value);
      fieldConfidence[key] = 0.7;
      fieldProvenance[key] = {
        source: "deterministic_parse",
        provider: input.parsed.provider,
        page: evidence.page,
        lineIndex: evidence.lineIndex,
        snippet:
          evidence.snippet ??
          (typeof value === "string" ? value.slice(0, 200) : JSON.stringify(value).slice(0, 200)),
      };
    }

    return {
      documentType: routing.documentType,
      canonicalDocumentTypeName,
      fields,
      fieldConfidence,
      fieldProvenance,
      provider: "deterministic",
      model: null,
    };
  }

  private buildResolutionSeed(
    input: MetadataExtractionInput,
    routing: RoutingResult,
    titleSummary: TitleSummaryResult,
    extraction: ExtractionResult,
  ): MetadataExtractionResult {
    return {
      title: titleSummary.title ?? input.title,
      summary: titleSummary.summary,
      language: input.parsed.language,
      issueDate: this.asDate(extraction.fields.issueDate),
      dueDate: this.asDate(extraction.fields.dueDate),
      expiryDate: this.asDate(extraction.fields.expiryDate),
      amount: this.asNullableNumber(extraction.fields.amount),
      currency: this.asNullableString(extraction.fields.currency),
      referenceNumber: this.asNullableString(extraction.fields.referenceNumber),
      holderName: this.asNullableString(extraction.fields.holderName),
      issuingAuthority: this.asNullableString(extraction.fields.issuingAuthority),
      correspondentName: this.asNullableString(extraction.fields.correspondentName),
      documentTypeName: getDocumentTypeDefinition(routing.documentType).canonicalName,
      tags: [],
      confidence: computeConfidence({
        base: routing.confidence,
        boosts: [titleSummary.title ? 0.03 : 0, titleSummary.summary ? 0.02 : 0],
      }),
      reviewReasons: [],
      metadata: {
        intelligence: {
          routing: {
            documentType: routing.documentType,
          },
        },
      },
    };
  }

  private resolveReviewReasons(
    input: MetadataExtractionInput,
    routing: RoutingResult,
    correspondentName: string | null,
    validation: ValidationResult,
    reviewEvidence: {
      missingFields: ReviewEvidenceField[];
    },
  ): ReviewReason[] {
    const reasons = new Set<ReviewReason>(input.parsed.reviewReasons);

    if (input.parsed.text.trim().length < this.configService.get("OCR_EMPTY_TEXT_THRESHOLD")) {
      reasons.add("ocr_empty");
    }
    if (routing.confidence < this.configService.get("REVIEW_CONFIDENCE_THRESHOLD")) {
      reasons.add("low_confidence");
    }
    if (routing.confidence < 0.55) {
      reasons.add("classification_ambiguous");
    }
    if (reviewEvidence.missingFields.length > 0) {
      reasons.add("missing_key_fields");
    }
    if (!correspondentName && getDocumentTypeDefinition(routing.documentType).requiredFields.includes("correspondent")) {
      reasons.add("correspondent_unresolved");
    }
    if (validation.errors.length > 0) {
      reasons.add("validation_failed");
    }

    return [...reasons];
  }

  private resolveOverallConfidence(
    routing: RoutingResult,
    titleSummary: TitleSummaryResult,
    extraction: ExtractionResult,
    tagging: TaggingResult,
    correspondentConfidence: number | null,
    reviewReasons: ReviewReason[],
  ): number {
    const fieldScores = Object.values(extraction.fieldConfidence);
    const extractionAverage =
      fieldScores.length > 0
        ? fieldScores.reduce((sum, value) => sum + value, 0) / fieldScores.length
        : 0.58;

    return computeConfidence({
      base: (routing.confidence * 0.35) + (extractionAverage * 0.4) + ((titleSummary.summaryConfidence ?? 0.6) * 0.1) + (((tagging.confidence ?? 0.6) * 0.05)) + (((correspondentConfidence ?? 0.6) * 0.1)),
      penalties: [
        reviewReasons.includes("missing_key_fields") ? 0.12 : 0,
        reviewReasons.includes("classification_ambiguous") ? 0.12 : 0,
        reviewReasons.includes("correspondent_unresolved") ? 0.08 : 0,
        reviewReasons.includes("validation_failed") ? 0.1 : 0,
      ],
    });
  }

  private buildDocumentPrompt(input: MetadataExtractionInput): string {
    const firstLines = input.parsed.pages
      .flatMap((page) => page.lines)
      .slice(0, 40)
      .map((line) => line.text.trim())
      .filter(Boolean)
      .join("\n");
    const keyValues = input.parsed.keyValues
      .slice(0, 20)
      .map((entry) => `${entry.key}: ${entry.value}`)
      .join("\n");
    const textExcerpt = input.parsed.text.slice(0, 4000);

    return [
      `Filename/title: ${input.title}`,
      keyValues ? `Key values:\n${keyValues}` : null,
      firstLines ? `First lines:\n${firstLines}` : null,
      `Text excerpt:\n${textExcerpt}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private parseJsonObject(raw: string | null): Record<string, unknown> | null {
    if (!raw?.trim()) {
      return null;
    }

    const trimmed = raw.trim();
    const candidates = [trimmed];
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
    }

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // ignore
      }
    }

    return null;
  }

  private toSupportedDocumentType(value: unknown): SupportedDocumentType | null {
    if (typeof value !== "string") {
      return null;
    }

    const normalized = value.trim().toLowerCase();
    return (Object.keys(DOCUMENT_TYPE_DEFINITIONS) as SupportedDocumentType[]).find(
      (candidate) => candidate === normalized,
    ) ?? null;
  }

  private normalizeFieldConfidenceMap(value: unknown): Record<string, number> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    const result: Record<string, number> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "number") {
        result[key] = this.normalizeConfidence(entry, 0.65);
      }
    }
    return result;
  }

  private normalizeConfidence(value: unknown, fallback: number): number {
    return typeof value === "number"
      ? Math.max(0, Math.min(1, Number(value.toFixed(2))))
      : fallback;
  }

  private normalizeOptionalConfidence(value: unknown, fallback: number | null): number | null {
    if (typeof value !== "number") {
      return fallback;
    }
    return this.normalizeConfidence(value, fallback ?? 0.6);
  }

  private asStringArray(value: unknown, fallback: string[]): string[] {
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : fallback;
  }

  private normalizeDateField(value: unknown): Date | null {
    if (value instanceof Date) {
      return value;
    }
    if (typeof value === "string") {
      return parseDateOnly(value);
    }
    return null;
  }

  private normalizeAmountField(value: unknown): number | null {
    if (typeof value === "number") {
      return Number(value.toFixed(2));
    }
    if (typeof value === "string") {
      const direct = normalizeAmountValue(value);
      if (direct !== null) {
        return direct;
      }

      const numericMatch = value.match(/\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?/);
      return normalizeAmountValue(numericMatch?.[0]);
    }
    return null;
  }

  private normalizeCurrencyField(currency: unknown, amountSource: unknown): string | null {
    if (typeof currency === "string") {
      return normalizeCurrencyCode(currency);
    }
    if (typeof amountSource === "string") {
      return normalizeCurrencyCode(amountSource);
    }
    return null;
  }

  private cleanReferenceNumber(value: unknown): string | null {
    const text = this.cleanNullableString(value);
    return text ? text.replace(/\s+/g, " ").trim() : null;
  }

  private cleanNullableString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private slugLike(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 128);
  }

  private asNullableString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private asNullableNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  private asDate(value: unknown): Date | null {
    if (value instanceof Date) {
      return value;
    }
    if (typeof value === "string") {
      return parseDateOnly(value);
    }
    return null;
  }

  private findDateByLabels(input: MetadataExtractionInput, labels: string[]): string | null {
    const structuredField = input.parsed.keyValues.find((field) =>
      labels.some((label) => field.key.toLowerCase().includes(label.toLowerCase())),
    );
    if (structuredField?.value) {
      return structuredField.value.trim();
    }

    const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const match = input.parsed.text.match(
      new RegExp(
        `(?:${escaped.join("|")})\\s*[:\\-]?\\s*([0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}|[0-9]{4}-[0-9]{2}-[0-9]{2})`,
        "i",
      ),
    );

    return match?.[1] ?? null;
  }

  private findAmount(input: MetadataExtractionInput): string | null {
    const structuredField = input.parsed.keyValues.find((field) =>
      /betrag|gesamt|summe|total|amount due|zu zahlen/i.test(field.key),
    );
    if (structuredField?.value) {
      return structuredField.value.trim();
    }

    const match = input.parsed.text.match(
      /(?:betrag|gesamt(?:betrag)?|summe|total(?: due)?|amount due|zu zahlen)\s*[:\-]?\s*((?:€|eur|\$|usd)?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?(?:\s*(?:€|eur|\$|usd))?)/i,
    );
    return match?.[1]?.trim() ?? null;
  }

  private findCurrency(input: MetadataExtractionInput): string | null {
    const amount = this.findAmount(input);
    return normalizeCurrencyCode(amount);
  }

  private findReferenceNumber(input: MetadataExtractionInput, labels: string[]): string | null {
    const structuredField = input.parsed.keyValues.find((field) =>
      labels.length > 0
        ? labels.some((label) => field.key.toLowerCase().includes(label.toLowerCase()))
        : /invoice number|invoice no\.?|reference|referenz|kundennummer|rechnungsnummer|vertragsnummer|policy number|document no\.?/i.test(
            field.key,
          ),
    );
    if (structuredField?.value) {
      return structuredField.value.trim();
    }

    const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const match = input.parsed.text.match(
      escaped.length > 0
        ? new RegExp(`(?:${escaped.join("|")})\\s*[:#-]?\\s*([A-Z0-9\\-\\/]+)`, "i")
        : /(?:invoice number|invoice no\.?|reference|referenz|kundennummer|rechnungsnummer|vertragsnummer|policy number|document no\.?)\s*[:#-]?\s*([A-Z0-9\-\/]+)/i,
    );
    return match?.[1] ?? null;
  }

  private findValueByLabels(input: MetadataExtractionInput, labels: string[]): string | null {
    const structuredField = input.parsed.keyValues.find((field) =>
      labels.some((label) => field.key.toLowerCase().includes(label.toLowerCase())),
    );
    if (structuredField?.value) {
      return structuredField.value.trim();
    }
    return null;
  }

  private findCorrespondentCandidate(input: MetadataExtractionInput): string | null {
    const lines = input.parsed.pages
      .flatMap((page) => page.lines)
      .map((line) => line.text.trim())
      .filter(Boolean)
      .slice(0, 8);

    return (
      lines.find(
        (line) =>
          line.length > 2 &&
          !/invoice|rechnung|date|datum|due|fällig|faellig|zahlbar|amount|betrag|statement|reference|referenz/i.test(
            line,
          ),
      ) ?? null
    );
  }

  private resolveInsurancePremiumAmount(
    text: string,
  ): { amount: number; currency: string } | null {
    const normalized = text.replace(/\u00a0/g, " ");
    const activePremiumPatterns = [
      /(?:gesamtmonatsbeitrag|monatsbeitrag(?:\s+f(?:ü|ue)r\s+den\s+gesamten\s+vertrag)?|ihr neuer beitrag ab [^\n]*|neuer beitrag ab [^\n]*).*?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:,\d{2})?)\s*(EUR|€)/i,
      /(?:monatliche(?:n)?\s+beitr(?:a|ä)ge|monatlicher\s+beitrag|h(?:ö|oe)he der monatlichen beitr(?:a|ä)ge).*?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:,\d{2})?)\s*(EUR|€)/i,
    ];

    for (const pattern of activePremiumPatterns) {
      const match = normalized.match(pattern);
      if (match?.[1]) {
        return {
          amount: Number(match[1].replace(/\./g, "").replace(",", ".")),
          currency: match[2] === "€" ? "EUR" : match[2].trim().toUpperCase(),
        };
      }
    }

    const lineBasedMonthly = normalized.match(
      /(?:gesamtmonatsbeitrag\s+ab\s+\d{2}\.\d{2}\.\d{2,4}|monatsbeitrag\s+f(?:ü|ue)r\s+den\s+gesamten\s+vertrag\s+ab\s+\d{2}\.\d{2}\.\d{2,4})[^\n]*?((?:\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:,\d{2})?))(?:\s*(EUR|€))?/i,
    );
    if (lineBasedMonthly?.[1]) {
      return {
        amount: Number(lineBasedMonthly[1].replace(/\./g, "").replace(",", ".")),
        currency: lineBasedMonthly[2] === "€" || !lineBasedMonthly[2] ? "EUR" : lineBasedMonthly[2].trim().toUpperCase(),
      };
    }

    const hasTotalsOnly = /(gesamtbeitrag in\s+20\d{2}|arbeitgeberzuschuss|vorsorgebeitrag|steuer|elstam)/i.test(
      normalized,
    );
    return hasTotalsOnly ? null : null;
  }

  private buildFieldProvenance(
    input: MetadataExtractionInput,
    fields: Record<string, unknown>,
    provider: AgentProvider,
    fallback: Record<string, ExtractionFieldProvenance>,
  ): Record<string, ExtractionFieldProvenance> {
    const next: Record<string, ExtractionFieldProvenance> = { ...fallback };
    for (const [key, value] of Object.entries(fields)) {
      if (value === null || value === undefined || value === "") {
        continue;
      }

      const evidence = this.findEvidenceMatch(input, value);
      next[key] = {
        source: provider === "deterministic" ? "deterministic_parse" : "llm_structured_extraction",
        provider,
        page: evidence.page,
        lineIndex: evidence.lineIndex,
        snippet:
          evidence.snippet ??
          fallback[key]?.snippet ??
          (typeof value === "string" ? value.slice(0, 200) : JSON.stringify(value).slice(0, 200)),
      };
    }

    return next;
  }

  private findEvidenceMatch(input: MetadataExtractionInput, value: unknown): DocumentEvidenceMatch {
    const searchTerms = this.buildEvidenceSearchTerms(value);
    if (searchTerms.length === 0) {
      return { page: null, lineIndex: null, snippet: null };
    }

    for (const page of input.parsed.pages) {
      for (const line of page.lines) {
        const candidate = line.text.trim();
        const normalizedCandidate = candidate.toLowerCase();
        if (searchTerms.some((term) => normalizedCandidate.includes(term))) {
          return {
            page: page.pageNumber,
            lineIndex: line.lineIndex,
            snippet: candidate.slice(0, 240),
          };
        }
      }
    }

    return { page: null, lineIndex: null, snippet: null };
  }

  private buildEvidenceSearchTerms(value: unknown): string[] {
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (!normalized) {
        return [];
      }

      return [...new Set([normalized, ...normalized.split(/\s+/).filter((term) => term.length >= 4)])];
    }

    if (typeof value === "number") {
      return [value.toFixed(2), String(value), String(value).replace(".", ",")].map((entry) =>
        entry.toLowerCase(),
      );
    }

    return [];
  }
}
