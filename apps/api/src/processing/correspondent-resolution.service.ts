import { Inject, Injectable, Logger } from "@nestjs/common";
import { correspondentAliases, correspondents, documents } from "@openkeep/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { AppConfigService } from "../common/config/app-config.service";
import { DatabaseService } from "../common/db/database.service";
import type { MetadataExtractionInput, MetadataExtractionResult } from "./provider.types";
import { normalizeCorrespondentName } from "./normalization.util";

type ResolutionStrategy =
  | "exact"
  | "alias"
  | "fuzzy"
  | "llm_choice"
  | "new"
  | "review"
  | "blocked"
  | "none";

type ResolutionProvider = "openai" | "gemini" | "deterministic";

interface CorrespondentCandidate {
  id: string;
  name: string;
  normalizedName: string;
  reason: string;
  score: number;
}

interface CorrespondentExtractionMetadata {
  rawName: string | null;
  rawNameNormalized: string | null;
  resolvedName: string | null;
  matchStrategy: ResolutionStrategy;
  confidence: number | null;
  evidenceLines: string[];
  candidateCorrespondents: Array<{
    id: string;
    name: string;
    reason: string;
    score: number;
  }>;
  blockedReason: string | null;
  provider: ResolutionProvider;
}

interface ResolveCorrespondentResult {
  correspondentName: string | null;
  metadata: CorrespondentExtractionMetadata;
}

interface LlmResolution {
  rawName: string | null;
  cleanDisplayName: string | null;
  confidence: number | null;
  evidenceLines: string[];
  isLikelyOrganizationOrPerson: boolean;
  shouldCreateNew: boolean;
  selectedCandidateId: string | null;
}

interface PersistAliasInput {
  correspondentId: string;
  alias: string;
  source: "llm" | "manual" | "import";
  confidence?: number | null;
  canonicalName?: string | null;
}

@Injectable()
export class CorrespondentResolutionService {
  private readonly logger = new Logger(CorrespondentResolutionService.name);

  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(AppConfigService) private readonly configService: AppConfigService,
  ) {}

  async resolve(
    input: MetadataExtractionInput,
    deterministicResult: MetadataExtractionResult,
  ): Promise<ResolveCorrespondentResult> {
    const evidenceLines = this.collectEvidenceLines(input);
    const deterministicRaw =
      this.cleanDisplayName(deterministicResult.correspondentName) ??
      this.pickDeterministicRawCandidate(evidenceLines);
    const initialBlockedReason = deterministicRaw
      ? this.blockedReasonForCandidate(deterministicRaw)
      : null;

    const provider = this.getProvider();
    const lexicalSeed =
      !initialBlockedReason && deterministicRaw ? deterministicRaw : evidenceLines[0] ?? null;
    const lexicalCandidates = lexicalSeed
      ? await this.findCandidateCorrespondents(lexicalSeed)
      : [];
    const llmDecision =
      provider && evidenceLines.length > 0
        ? await this.resolveWithLlm(provider, input, evidenceLines, lexicalCandidates)
        : null;

    const rawName =
      this.cleanDisplayName(llmDecision?.rawName) ??
      deterministicRaw ??
      this.pickDeterministicRawCandidate(evidenceLines);
    const cleanedDisplayName =
      this.cleanDisplayName(llmDecision?.cleanDisplayName) ??
      rawName;
    const rawNameNormalized = normalizeCorrespondentName(rawName);
    const blockedReason =
      rawName && !rawNameNormalized
        ? "empty_after_normalization"
        : rawName
          ? this.blockedReasonForCandidate(rawName)
          : initialBlockedReason;

    const candidateCorrespondents = rawNameNormalized
      ? await this.findCandidateCorrespondents(rawName!)
      : lexicalCandidates;

    if (!rawName || !rawNameNormalized) {
      return {
        correspondentName: null,
        metadata: {
          rawName,
          rawNameNormalized,
          resolvedName: null,
          matchStrategy: "none",
          confidence: llmDecision?.confidence ?? null,
          evidenceLines: llmDecision?.evidenceLines?.length
            ? llmDecision.evidenceLines
            : evidenceLines.slice(0, 5),
          candidateCorrespondents: candidateCorrespondents.map((candidate) => ({
            id: candidate.id,
            name: candidate.name,
            reason: candidate.reason,
            score: candidate.score,
          })),
          blockedReason,
          provider: provider?.provider ?? "deterministic",
        },
      };
    }

    if (blockedReason) {
      return {
        correspondentName: null,
        metadata: {
          rawName,
          rawNameNormalized,
          resolvedName: null,
          matchStrategy: "blocked",
          confidence: llmDecision?.confidence ?? null,
          evidenceLines: llmDecision?.evidenceLines?.length
            ? llmDecision.evidenceLines
            : evidenceLines.slice(0, 5),
          candidateCorrespondents: candidateCorrespondents.map((candidate) => ({
            id: candidate.id,
            name: candidate.name,
            reason: candidate.reason,
            score: candidate.score,
          })),
          blockedReason,
          provider: provider?.provider ?? "deterministic",
        },
      };
    }

    const exactCandidate = candidateCorrespondents.find((candidate) => candidate.reason === "exact");
    if (exactCandidate) {
      return this.buildResolvedResult({
        rawName,
        rawNameNormalized,
        resolvedName: exactCandidate.name,
        matchStrategy: "exact",
        confidence: 0.99,
        evidenceLines: llmDecision?.evidenceLines?.length
          ? llmDecision.evidenceLines
          : evidenceLines.slice(0, 5),
        candidateCorrespondents,
        provider: provider?.provider ?? "deterministic",
      });
    }

    const aliasCandidate = candidateCorrespondents.find((candidate) => candidate.reason === "alias");
    if (aliasCandidate) {
      return this.buildResolvedResult({
        rawName,
        rawNameNormalized,
        resolvedName: aliasCandidate.name,
        matchStrategy: "alias",
        confidence: Math.max(0.92, aliasCandidate.score),
        evidenceLines: llmDecision?.evidenceLines?.length
          ? llmDecision.evidenceLines
          : evidenceLines.slice(0, 5),
        candidateCorrespondents,
        provider: provider?.provider ?? "deterministic",
      });
    }

    if (
      llmDecision?.selectedCandidateId &&
      (llmDecision.isLikelyOrganizationOrPerson || candidateCorrespondents.length > 0)
    ) {
      const selected = candidateCorrespondents.find(
        (candidate) => candidate.id === llmDecision.selectedCandidateId,
      );
      if (selected) {
        if ((llmDecision.confidence ?? 0) >= 0.76) {
          return this.buildResolvedResult({
            rawName,
            rawNameNormalized,
            resolvedName: selected.name,
            matchStrategy: "llm_choice",
            confidence: llmDecision.confidence,
            evidenceLines: llmDecision.evidenceLines,
            candidateCorrespondents,
            provider: provider?.provider ?? "deterministic",
          });
        }

        return this.buildReviewResult({
          rawName,
          rawNameNormalized,
          confidence: llmDecision.confidence,
          evidenceLines: llmDecision.evidenceLines,
          candidateCorrespondents,
          provider: provider?.provider ?? "deterministic",
        });
      }
    }

    const fuzzyCandidate = candidateCorrespondents.find(
      (candidate) => candidate.reason === "fuzzy" && candidate.score >= 0.9,
    );
    if (fuzzyCandidate) {
      return this.buildResolvedResult({
        rawName,
        rawNameNormalized,
        resolvedName: fuzzyCandidate.name,
        matchStrategy: "fuzzy",
        confidence: fuzzyCandidate.score,
        evidenceLines: llmDecision?.evidenceLines?.length
          ? llmDecision.evidenceLines
          : evidenceLines.slice(0, 5),
        candidateCorrespondents,
        provider: provider?.provider ?? "deterministic",
      });
    }

    if (
      cleanedDisplayName &&
      (llmDecision?.isLikelyOrganizationOrPerson ?? true) &&
      (llmDecision?.shouldCreateNew ?? provider === null) &&
      (llmDecision?.confidence ?? 0.82) >= 0.76
    ) {
      return this.buildResolvedResult({
        rawName,
        rawNameNormalized,
        resolvedName: cleanedDisplayName,
        matchStrategy: "new",
        confidence: llmDecision?.confidence ?? 0.82,
        evidenceLines: llmDecision?.evidenceLines?.length
          ? llmDecision.evidenceLines
          : evidenceLines.slice(0, 5),
        candidateCorrespondents,
        provider: provider?.provider ?? "deterministic",
      });
    }

    return this.buildReviewResult({
      rawName,
      rawNameNormalized,
      confidence: llmDecision?.confidence ?? candidateCorrespondents[0]?.score ?? 0.45,
      evidenceLines: llmDecision?.evidenceLines?.length
        ? llmDecision.evidenceLines
        : evidenceLines.slice(0, 5),
      candidateCorrespondents,
      provider: provider?.provider ?? "deterministic",
    });
  }

  async persistAlias(input: PersistAliasInput): Promise<void> {
    const alias = input.alias.trim();
    const normalizedAlias = normalizeCorrespondentName(alias);
    if (!normalizedAlias) {
      return;
    }

    const normalizedCanonical = normalizeCorrespondentName(input.canonicalName ?? null);
    if (normalizedCanonical && normalizedCanonical === normalizedAlias) {
      return;
    }

    await this.databaseService.db
      .insert(correspondentAliases)
      .values({
        correspondentId: input.correspondentId,
        alias,
        normalizedAlias,
        source: input.source,
        confidence:
          typeof input.confidence === "number" ? input.confidence.toFixed(2) : null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: correspondentAliases.normalizedAlias,
        set: {
          correspondentId: input.correspondentId,
          alias,
          source: input.source,
          confidence:
            typeof input.confidence === "number" ? input.confidence.toFixed(2) : null,
          updatedAt: new Date(),
        },
      });
  }

  async applyAliasToUnresolvedDocuments(input: {
    correspondentId: string;
    alias: string;
    resolvedName: string;
    confidence?: number | null;
    matchStrategy?: Extract<ResolutionStrategy, "alias" | "llm_choice" | "fuzzy" | "exact">;
  }): Promise<number> {
    const normalizedAlias = normalizeCorrespondentName(input.alias);
    if (!normalizedAlias) {
      return 0;
    }

    const rows = await this.databaseService.db
      .select({
        id: documents.id,
        metadata: documents.metadata,
      })
      .from(documents)
      .where(
        and(
          isNull(documents.correspondentId),
          sql`coalesce(${documents.metadata} -> 'correspondentExtraction' ->> 'rawNameNormalized', '') = ${normalizedAlias}`,
          sql`NOT (coalesce(${documents.metadata} -> 'manual' -> 'lockedFields', '[]'::jsonb) ? 'correspondentId')`,
        ),
      );

    if (rows.length === 0) {
      return 0;
    }

    await this.databaseService.db.transaction(async (tx) => {
      for (const row of rows) {
        const nextMetadata = this.withResolvedMetadata(
          row.metadata ?? {},
          input.resolvedName,
          input.matchStrategy ?? "alias",
          input.confidence ?? null,
        );
        await tx
          .update(documents)
          .set({
            correspondentId: input.correspondentId,
            metadata: nextMetadata,
            updatedAt: new Date(),
          })
          .where(eq(documents.id, row.id));
      }
    });

    return rows.length;
  }

  private buildResolvedResult(input: {
    rawName: string;
    rawNameNormalized: string;
    resolvedName: string;
    matchStrategy: Extract<ResolutionStrategy, "exact" | "alias" | "fuzzy" | "llm_choice" | "new">;
    confidence: number | null;
    evidenceLines: string[];
    candidateCorrespondents: CorrespondentCandidate[];
    provider: ResolutionProvider;
  }): ResolveCorrespondentResult {
    return {
      correspondentName: input.resolvedName,
      metadata: {
        rawName: input.rawName,
        rawNameNormalized: input.rawNameNormalized,
        resolvedName: input.resolvedName,
        matchStrategy: input.matchStrategy,
        confidence: input.confidence,
        evidenceLines: input.evidenceLines.slice(0, 5),
        candidateCorrespondents: input.candidateCorrespondents.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          reason: candidate.reason,
          score: candidate.score,
        })),
        blockedReason: null,
        provider: input.provider,
      },
    };
  }

  private buildReviewResult(input: {
    rawName: string;
    rawNameNormalized: string;
    confidence: number | null;
    evidenceLines: string[];
    candidateCorrespondents: CorrespondentCandidate[];
    provider: ResolutionProvider;
  }): ResolveCorrespondentResult {
    return {
      correspondentName: null,
      metadata: {
        rawName: input.rawName,
        rawNameNormalized: input.rawNameNormalized,
        resolvedName: null,
        matchStrategy: "review",
        confidence: input.confidence,
        evidenceLines: input.evidenceLines.slice(0, 5),
        candidateCorrespondents: input.candidateCorrespondents.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          reason: candidate.reason,
          score: candidate.score,
        })),
        blockedReason: null,
        provider: input.provider,
      },
    };
  }

  private collectEvidenceLines(input: MetadataExtractionInput): string[] {
    const topPageLines = input.parsed.pages
      .slice(0, 1)
      .flatMap((page) => page.lines)
      .map((line) => this.normalizeLine(line.text))
      .filter(Boolean)
      .slice(0, 12);

    const keyValueLines = input.parsed.keyValues
      .flatMap((field) => [field.key, field.value])
      .map((item) => this.normalizeLine(item))
      .filter(Boolean)
      .slice(0, 8);

    return [this.normalizeLine(input.title), ...topPageLines, ...keyValueLines].filter(
      (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index,
    );
  }

  private pickDeterministicRawCandidate(lines: string[]): string | null {
    for (const line of lines) {
      if (!this.blockedReasonForCandidate(line)) {
        return this.cleanDisplayName(line);
      }
    }
    return null;
  }

  private normalizeLine(value: string | null | undefined): string | null {
    if (!value?.trim()) {
      return null;
    }

    return value.replace(/\s+/g, " ").trim().slice(0, 255);
  }

  private cleanDisplayName(raw: string | null | undefined): string | null {
    if (!raw?.trim()) {
      return null;
    }

    let value = raw.replace(/\s+/g, " ").trim();
    value = value.replace(/^[\s\-:;|,.]+|[\s\-:;|,.]+$/g, "");

    const colonIndex = value.indexOf(" : ");
    if (colonIndex >= 0) {
      const left = value.slice(0, colonIndex).trim();
      const right = value.slice(colonIndex + 3).trim();
      if (this.looksLikeAddressOrContact(right)) {
        value = left;
      }
    }

    const taglineMatch = value.match(/^([A-ZÄÖÜ0-9]{2,8})\s+(.+)$/);
    if (taglineMatch && this.looksLikeTagline(taglineMatch[2]!)) {
      value = taglineMatch[1]!;
    }

    return value.length > 0 ? value.slice(0, 255) : null;
  }

  private blockedReasonForCandidate(candidate: string): string | null {
    const value = candidate.trim();
    if (value.length < 2) {
      return "too_short";
    }

    if (/^[+()\-0-9\s/]{6,}$/.test(value)) {
      return "phone_like";
    }

    if (this.looksLikeAddressOrContact(value)) {
      return "address_or_contact";
    }

    if (
      /(invoice|rechnung|kundennummer|rechnungsnummer|datum|date|fällig|due date|amount|betrag|summe|gesamt|iban|bic)/i.test(
        value,
      )
    ) {
      return "document_metadata";
    }

    if (
      value.split(/\s+/).length >= 5 &&
      (value === value.toUpperCase() ||
        /^informationen über/i.test(value) ||
        /beschaffenheit des trinkwassers/i.test(value))
    ) {
      return "headline";
    }

    return null;
  }

  private looksLikeAddressOrContact(value: string): boolean {
    return (
      /@|https?:\/\/|www\./i.test(value) ||
      /\b(?:tel|telefon|fax|mobil|hotline|service)\b/i.test(value) ||
      /\b\d{5}\b/.test(value) ||
      /\b(?:straße|strasse|str\.|weg|allee|platz|gasse|burgplatz|hausnummer|germany|deutschland)\b/i.test(
        value,
      ) ||
      /\b\d{1,4}[a-z]?\s*[-,]?\s*[A-Za-zÄÖÜäöüß]/.test(value)
    );
  }

  private looksLikeTagline(value: string): boolean {
    return (
      /\b(für|fuer|for|ihr|ihre|leben|life|einfach|da|immer|gesund|stark)\b/i.test(value) &&
      value.split(/\s+/).length >= 3 &&
      !/\b(gmbh|ag|kg|e\.v\.|association|versicherung|wasser|bank|holding)\b/i.test(value)
    );
  }

  private getProvider():
    | {
        provider: Exclude<ResolutionProvider, "deterministic">;
        apiKey: string;
        model: string;
      }
    | null {
    const openAiKey = this.configService.get("OPENAI_API_KEY");
    if (openAiKey) {
      return {
        provider: "openai",
        apiKey: openAiKey,
        model: this.configService.get("OPENAI_MODEL"),
      };
    }

    const geminiKey = this.configService.get("GEMINI_API_KEY");
    if (geminiKey) {
      return {
        provider: "gemini",
        apiKey: geminiKey,
        model: this.configService.get("GEMINI_MODEL"),
      };
    }

    return null;
  }

  private async resolveWithLlm(
    provider: {
      provider: "openai" | "gemini";
      apiKey: string;
      model: string;
    },
    input: MetadataExtractionInput,
    evidenceLines: string[],
    candidates: CorrespondentCandidate[],
  ): Promise<LlmResolution | null> {
    const prompt = this.buildPrompt(input, evidenceLines, candidates);
    const rawResponse =
      provider.provider === "openai"
        ? await this.callOpenAi(provider.apiKey, provider.model, prompt)
        : await this.callGemini(provider.apiKey, provider.model, prompt);

    if (!rawResponse) {
      return null;
    }

    const parsed = this.parseLlmResponse(rawResponse);
    if (!parsed) {
      this.logger.warn("Failed to parse correspondent LLM response as JSON");
      return null;
    }

    return {
      rawName:
        typeof parsed.rawName === "string" || parsed.rawName === null
          ? this.cleanDisplayName(parsed.rawName)
          : null,
      cleanDisplayName:
        typeof parsed.cleanDisplayName === "string" || parsed.cleanDisplayName === null
          ? this.cleanDisplayName(parsed.cleanDisplayName)
          : null,
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, Number(parsed.confidence.toFixed(2))))
          : null,
      evidenceLines: Array.isArray(parsed.evidenceLines)
        ? parsed.evidenceLines.filter((value): value is string => typeof value === "string").slice(0, 5)
        : [],
      isLikelyOrganizationOrPerson: parsed.isLikelyOrganizationOrPerson !== false,
      shouldCreateNew: Boolean(parsed.shouldCreateNew),
      selectedCandidateId:
        typeof parsed.selectedCandidateId === "string" ? parsed.selectedCandidateId : null,
    };
  }

  private buildPrompt(
    input: MetadataExtractionInput,
    evidenceLines: string[],
    candidates: CorrespondentCandidate[],
  ): string {
    const candidateLines =
      candidates.length > 0
        ? candidates
            .slice(0, 5)
            .map(
              (candidate, index) =>
                `${index + 1}. id=${candidate.id} | name=${candidate.name} | reason=${candidate.reason} | score=${candidate.score.toFixed(2)}`,
            )
            .join("\n")
        : "NONE";

    return [
      "Return exactly one JSON object and nothing else.",
      "Task: identify the sender/correspondent for a personal document.",
      "The correspondent must be a short business or person name only.",
      "Never return addresses, postal codes, country names, phone numbers, email addresses, websites, invoice labels, or long document headlines.",
      "If a slogan/tagline is attached, strip it and keep only the entity name.",
      "If one of the candidate correspondents matches, set selectedCandidateId to that id and shouldCreateNew=false.",
      "If no candidate is supported by evidence, set selectedCandidateId=null and decide whether shouldCreateNew is true.",
      'JSON schema: {"rawName":string|null,"cleanDisplayName":string|null,"confidence":number,"evidenceLines":string[],"isLikelyOrganizationOrPerson":boolean,"shouldCreateNew":boolean,"selectedCandidateId":string|null}',
      `Document title: ${input.title}`,
      `Mime type: ${input.mimeType}`,
      "Evidence lines:",
      ...evidenceLines.map((line, index) => `${index + 1}. ${line}`),
      "Candidate correspondents:",
      candidateLines,
    ].join("\n");
  }

  private async callOpenAi(
    apiKey: string,
    model: string,
    prompt: string,
  ): Promise<string | null> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: {
          type: "json_object",
        },
        messages: [
          {
            role: "system",
            content:
              "You extract a document correspondent. Output valid JSON only. Be conservative and do not guess.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      this.logger.warn(`OpenAI correspondent extraction failed with status ${response.status}`);
      return null;
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
    };
    const content = body.choices?.[0]?.message?.content;
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

  private async callGemini(
    apiKey: string,
    model: string,
    prompt: string,
  ): Promise<string | null> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
          },
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      this.logger.warn(`Gemini correspondent extraction failed with status ${response.status}`);
      return null;
    }

    const body = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };
    return (
      body.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join(" ")
        .trim() ?? null
    );
  }

  private parseLlmResponse(value: string): Record<string, unknown> | null {
    const trimmed = value.trim();
    const direct = this.tryParseObject(trimmed);
    if (direct) {
      return direct;
    }

    const match = trimmed.match(/\{[\s\S]*\}/);
    return match ? this.tryParseObject(match[0]) : null;
  }

  private tryParseObject(value: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  private async findCandidateCorrespondents(rawName: string): Promise<CorrespondentCandidate[]> {
    const normalized = normalizeCorrespondentName(rawName);
    if (!normalized) {
      return [];
    }

    const exactRows = await this.databaseService.db
      .select({
        id: correspondents.id,
        name: correspondents.name,
        normalizedName: correspondents.normalizedName,
      })
      .from(correspondents)
      .where(eq(correspondents.normalizedName, normalized))
      .limit(1);

    if (exactRows.length > 0) {
      return exactRows.map((row) => ({
        id: row.id,
        name: row.name,
        normalizedName: row.normalizedName,
        reason: "exact",
        score: 1,
      }));
    }

    const aliasRows = await this.databaseService.db
      .select({
        id: correspondents.id,
        name: correspondents.name,
        normalizedName: correspondents.normalizedName,
      })
      .from(correspondentAliases)
      .innerJoin(correspondents, eq(correspondentAliases.correspondentId, correspondents.id))
      .where(eq(correspondentAliases.normalizedAlias, normalized))
      .limit(1);

    if (aliasRows.length > 0) {
      return aliasRows.map((row) => ({
        id: row.id,
        name: row.name,
        normalizedName: row.normalizedName,
        reason: "alias",
        score: 0.98,
      }));
    }

    const allRows = await this.databaseService.db
      .select({
        id: correspondents.id,
        name: correspondents.name,
        normalizedName: correspondents.normalizedName,
      })
      .from(correspondents);

    return allRows
      .map((row) => {
        const score = this.similarityScore(normalized, row.normalizedName);
        return {
          id: row.id,
          name: row.name,
          normalizedName: row.normalizedName,
          reason: "fuzzy",
          score,
        };
      })
      .filter((candidate) => candidate.score >= 0.62)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return left.name.localeCompare(right.name);
      })
      .slice(0, 5);
  }

  private similarityScore(left: string, right: string): number {
    if (left === right) {
      return 1;
    }

    if (left.includes(right) || right.includes(left)) {
      const shorter = Math.min(left.length, right.length);
      return shorter >= 3 ? 0.9 : 0.78;
    }

    const leftTokens = new Set(left.split(" ").filter(Boolean));
    const rightTokens = new Set(right.split(" ").filter(Boolean));
    let overlap = 0;
    for (const token of leftTokens) {
      if (rightTokens.has(token)) {
        overlap += 1;
      }
    }

    const tokenScore = overlap / Math.max(leftTokens.size, rightTokens.size, 1);
    const prefixScore = left[0] === right[0] ? 0.08 : 0;
    return Number(Math.min(0.95, tokenScore * 0.85 + prefixScore).toFixed(2));
  }

  private withResolvedMetadata(
    metadata: Record<string, unknown>,
    resolvedName: string,
    matchStrategy: ResolutionStrategy,
    confidence: number | null,
  ): Record<string, unknown> {
    const existing =
      metadata.correspondentExtraction &&
      typeof metadata.correspondentExtraction === "object" &&
      metadata.correspondentExtraction !== null
        ? (metadata.correspondentExtraction as Record<string, unknown>)
        : {};

    return {
      ...metadata,
      correspondentExtraction: {
        ...existing,
        resolvedName,
        matchStrategy,
        confidence,
      },
    };
  }
}
