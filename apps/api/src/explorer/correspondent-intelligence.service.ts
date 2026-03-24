import { Inject, Injectable, Logger, forwardRef } from "@nestjs/common";
import {
  CorrespondentIntelligenceSchema,
  type CorrespondentIntelligence,
  type CorrespondentSummaryStatus,
} from "@openkeep/types";
import { correspondents } from "@openkeep/db";
import { eq } from "drizzle-orm";

import { DatabaseService } from "../common/db/database.service";
import { DocumentsService } from "../documents/documents.service";
import {
  CORRESPONDENT_INTELLIGENCE_QUEUE,
  CORRESPONDENT_SUMMARY_QUEUE,
} from "../processing/constants";
import { BossService } from "../processing/boss.service";
import { LlmService, type LlmProviderId } from "../processing/llm.service";

const ENQUEUE_COOLDOWN_MS = 5 * 60_000;
const PROVIDER_ORDER: LlmProviderId[] = ["mistral", "gemini", "openai"];

type CorrespondentDocumentRow = {
  id: string;
  title: string;
  issueDate: string | null;
  dueDate: string | null;
  expiryDate: string | null;
  amount: string | null;
  currency: string | null;
  typeName: string | null;
  metadata: Record<string, unknown>;
};

@Injectable()
export class CorrespondentIntelligenceService {
  private readonly logger = new Logger(CorrespondentIntelligenceService.name);
  private readonly cooldown = new Map<string, number>();

  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(BossService) private readonly bossService: BossService,
    @Inject(LlmService) private readonly llmService: LlmService,
    @Inject(forwardRef(() => DocumentsService))
    private readonly documentsService: DocumentsService,
  ) {}

  async resolveState(input: {
    correspondentId: string;
    intelligence: Record<string, unknown> | null;
    intelligenceGeneratedAt: Date | null;
    latestActivityAt: Date | null;
  }): Promise<{ status: CorrespondentSummaryStatus; intelligence: CorrespondentIntelligence | null }> {
    const parsed = input.intelligence
      ? CorrespondentIntelligenceSchema.safeParse(input.intelligence)
      : null;
    const intelligence = parsed?.success ? parsed.data : null;
    const hasIntelligence = Boolean(intelligence);
    const isStale =
      !input.intelligenceGeneratedAt ||
      (input.latestActivityAt !== null && input.intelligenceGeneratedAt < input.latestActivityAt);

    if (hasIntelligence) {
      if (isStale && this.llmService.isConfigured()) {
        await this.enqueueRefresh(input.correspondentId);
      }
      return {
        status: "ready",
        intelligence,
      };
    }

    if (!this.llmService.isConfigured()) {
      return {
        status: "unavailable",
        intelligence: null,
      };
    }

    await this.enqueueRefresh(input.correspondentId);
    return {
      status: "pending",
      intelligence: null,
    };
  }

  async enqueueRefresh(correspondentId: string): Promise<void> {
    const now = Date.now();
    const nextAllowed = this.cooldown.get(correspondentId) ?? 0;
    if (nextAllowed > now) {
      return;
    }

    this.cooldown.set(correspondentId, now + ENQUEUE_COOLDOWN_MS);
    try {
      await Promise.all([
        this.bossService.publish(CORRESPONDENT_SUMMARY_QUEUE, { correspondentId }),
        this.bossService.publish(CORRESPONDENT_INTELLIGENCE_QUEUE, { correspondentId }),
      ]);
    } catch (error) {
      this.cooldown.delete(correspondentId);
      this.logger.warn(
        `Failed to enqueue correspondent intelligence refresh for ${correspondentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async refresh(correspondentId: string): Promise<void> {
    const [correspondent] = await this.databaseService.db
      .select()
      .from(correspondents)
      .where(eq(correspondents.id, correspondentId))
      .limit(1);

    if (!correspondent || !this.llmService.isConfigured()) {
      return;
    }

    const docs = await this.loadDocumentContext(correspondentId);
    if (docs.length === 0) {
      return;
    }

    const seed = buildDeterministicIntelligence(correspondent.name, docs);
    const generated = await this.generateIntelligence(correspondent.name, docs, seed);
    const intelligence = normalizeIntelligence(generated ?? seed, docs);
    const now = new Date();

    await this.databaseService.db
      .update(correspondents)
      .set({
        intelligence,
        intelligenceGeneratedAt: now,
        summary: intelligence.overview,
        summaryGeneratedAt: now,
      })
      .where(eq(correspondents.id, correspondentId));
  }

  private async loadDocumentContext(correspondentId: string): Promise<CorrespondentDocumentRow[]> {
    const response = await this.documentsService.listDocuments({
      filters: { correspondentId },
      sort: "createdAt",
      direction: "desc",
      page: 1,
      pageSize: 24,
    });

    return response.items.map((doc) => ({
      id: doc.id,
      title: doc.title,
      issueDate: doc.issueDate,
      dueDate: doc.dueDate,
      expiryDate: doc.expiryDate,
      amount: doc.amount === null ? null : doc.amount.toFixed(2),
      currency: doc.currency,
      typeName: doc.documentType?.name ?? null,
      metadata: doc.metadata,
    }));
  }

  private async generateIntelligence(
    correspondentName: string,
    docs: CorrespondentDocumentRow[],
    seed: CorrespondentIntelligence,
  ): Promise<CorrespondentIntelligence | null> {
    const completion = await this.llmService.completeWithFallback(
      {
        jsonMode: true,
        temperature: 0.15,
        maxTokens: 1600,
        messages: [
          {
            role: "system",
            content:
              "You produce structured correspondent intelligence for a personal document archive. Stay grounded in the provided facts only. Return valid JSON with the requested shape. Prefer concise, factual language.",
          },
          {
            role: "user",
            content: buildIntelligencePrompt(correspondentName, docs, seed),
          },
        ],
      },
      PROVIDER_ORDER,
    );

    if (!completion.text) {
      return null;
    }

    try {
      const parsed = CorrespondentIntelligenceSchema.safeParse({
        ...JSON.parse(completion.text),
        provider: completion.provider ?? undefined,
        model: completion.model ?? undefined,
        generatedAt: new Date().toISOString(),
      });
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}

function buildDeterministicIntelligence(
  correspondentName: string,
  docs: CorrespondentDocumentRow[],
): CorrespondentIntelligence {
  const sourceDocumentIds = docs.map((doc) => doc.id);
  const sortedByDate = [...docs].sort((left, right) => compareDates(left.issueDate, right.issueDate));
  const latestDoc = sortedByDate.at(-1) ?? docs[0]!;
  const insuranceDocs = docs.filter((doc) => normalizeTypeName(doc.typeName) === "insurance");
  const profileCategory = insuranceDocs.length > 0 ? "insurance" : inferGenericCategory(docs);
  const changes = detectChanges(sortedByDate);
  const timeline = sortedByDate
    .slice(-6)
    .reverse()
    .map((doc) => ({
      date: doc.issueDate,
      title: doc.title,
      description: summarizeDoc(doc),
      documentId: doc.id,
      documentTitle: doc.title,
    }));
  const latestPremium = readLatestInsurancePremium(insuranceDocs);
  const currentState = buildCurrentState(latestDoc, insuranceDocs, latestPremium);
  const insuranceInsight =
    insuranceDocs.length > 0
      ? {
          policyReferences: uniqueValues(insuranceDocs.map((doc) => readReferenceNumber(doc)).filter(Boolean)),
          latestPremiumAmount: latestPremium?.amount ?? null,
          latestPremiumCurrency: latestPremium?.currency ?? null,
          premiumChangeSummary:
            changes.find((change) => change.category === "price")?.description ?? null,
          coverageHighlights: uniqueValues(
            insuranceDocs.flatMap((doc) => readCoverageHighlights(doc)),
          ).slice(0, 5),
          renewalDate: latestDoc.expiryDate,
          cancellationWindow: readCancellationWindow(insuranceDocs),
        }
      : undefined;

  return {
    overview: buildOverview(correspondentName, profileCategory, docs, changes),
    profile: {
      category: profileCategory,
      confidence: insuranceDocs.length > 0 ? 0.88 : 0.62,
      narrative:
        profileCategory === "insurance"
          ? `${correspondentName} appears to manage one or more insurance relationships in your archive.`
          : `${correspondentName} appears as a recurring correspondent across your archive.`,
      keySignals: buildKeySignals(docs, changes),
    },
    timeline,
    changes,
    currentState,
    domainInsights: insuranceInsight ? { insurance: insuranceInsight } : {},
    sourceDocumentIds,
    provider: "deterministic",
    model: null,
    generatedAt: new Date().toISOString(),
  };
}

function buildIntelligencePrompt(
  correspondentName: string,
  docs: CorrespondentDocumentRow[],
  seed: CorrespondentIntelligence,
): string {
  const documentLines = docs.map((doc, index) => {
    const intelligence = readDocumentIntelligence(doc);
    return [
      `${index + 1}. ${doc.title}`,
      `Type: ${doc.typeName ?? "Unknown"}`,
      `Issue date: ${doc.issueDate ?? "n/a"}`,
      `Due date: ${doc.dueDate ?? "n/a"}`,
      `Expiry date: ${doc.expiryDate ?? "n/a"}`,
      `Amount: ${doc.amount && doc.currency ? `${doc.amount} ${doc.currency}` : doc.amount ?? "n/a"}`,
      `Reference: ${readReferenceNumber(doc) ?? "n/a"}`,
      `Doc summary: ${intelligence.summary ?? "n/a"}`,
      `Extracted fields: ${JSON.stringify(intelligence.fields)}`,
    ].join(" | ");
  });

  return [
    `Build correspondent intelligence for \"${correspondentName}\".`,
    "Return JSON with keys: overview, profile, timeline, changes, currentState, domainInsights, sourceDocumentIds.",
    "For profile use category/subcategory/confidence/narrative/keySignals.",
    "For timeline use up to 6 events with date, title, description, documentId, documentTitle.",
    "For changes capture notable price, contract, coverage, renewal, or administrative changes over time.",
    "For currentState capture latest known facts as label/value pairs.",
    "If this looks like insurance, populate domainInsights.insurance with policyReferences, latestPremiumAmount, latestPremiumCurrency, premiumChangeSummary, coverageHighlights, renewalDate, cancellationWindow.",
    "Stay grounded in the provided facts only and do not invent values.",
    "Use this deterministic seed as a starting point, but improve it where evidence supports that:",
    JSON.stringify(seed),
    "Documents:",
    ...documentLines,
  ].join("\n");
}

function normalizeIntelligence(
  intelligence: CorrespondentIntelligence,
  docs: CorrespondentDocumentRow[],
): CorrespondentIntelligence {
  if (docs.length === 0) {
    return intelligence;
  }

  const sortedByDate = [...docs].sort((left, right) => compareDates(left.issueDate, right.issueDate));
  const latestDoc = sortedByDate.at(-1) ?? docs[0]!;
  const insuranceDocs = docs.filter((doc) => normalizeTypeName(doc.typeName) === "insurance");
  const latestPremium = readLatestInsurancePremium(insuranceDocs);

  return {
    ...intelligence,
    timeline: [...(intelligence.timeline ?? [])].sort((left, right) => compareDates(right.date, left.date)),
    currentState: buildCurrentState(latestDoc, insuranceDocs, latestPremium),
    domainInsights:
      insuranceDocs.length > 0
        ? {
            ...intelligence.domainInsights,
            insurance: {
              ...intelligence.domainInsights.insurance,
              policyReferences: uniqueValues(insuranceDocs.map((doc) => readReferenceNumber(doc)).filter(Boolean)),
              latestPremiumAmount:
                latestPremium?.amount ?? intelligence.domainInsights.insurance?.latestPremiumAmount ?? null,
              latestPremiumCurrency:
                latestPremium?.currency ?? intelligence.domainInsights.insurance?.latestPremiumCurrency ?? null,
              coverageHighlights: uniqueValues(
                insuranceDocs.flatMap((doc) => readCoverageHighlights(doc)),
              ).slice(0, 5),
              renewalDate: intelligence.domainInsights.insurance?.renewalDate ?? latestDoc.expiryDate,
              cancellationWindow:
                intelligence.domainInsights.insurance?.cancellationWindow ?? readCancellationWindow(insuranceDocs),
            },
          }
        : intelligence.domainInsights,
    sourceDocumentIds: intelligence.sourceDocumentIds?.length > 0 ? intelligence.sourceDocumentIds : docs.map((doc) => doc.id),
  };
}

function readDocumentIntelligence(doc: CorrespondentDocumentRow): {
  summary: string | null;
  fields: Record<string, unknown>;
} {
  const intelligence = asRecord(doc.metadata.intelligence);
  const summary = asRecord(intelligence.summary);
  const extraction = asRecord(intelligence.extraction);
  return {
    summary: asNullableString(summary.value),
    fields: asRecord(extraction.fields),
  };
}

function readReferenceNumber(doc: CorrespondentDocumentRow): string | null {
  const extraction = readDocumentIntelligence(doc).fields;
  return asNullableString(extraction.referenceNumber) ?? asNullableString(extraction.policyNumber) ?? null;
}

function readCoverageHighlights(doc: CorrespondentDocumentRow): string[] {
  const fields = readDocumentIntelligence(doc).fields;
  const values = [
    asNullableString(fields.coverage),
    asNullableString(fields.coverageHighlights),
    asNullableString(fields.insuredObject),
    asNullableString(fields.tariff),
    asNullableString(fields.plan),
  ].filter((value): value is string => Boolean(value));
  return uniqueValues(values);
}

function readCancellationWindow(docs: CorrespondentDocumentRow[]): string | null {
  for (const doc of docs) {
    const fields = readDocumentIntelligence(doc).fields;
    const direct = asNullableString(fields.cancellationWindow) ?? asNullableString(fields.noticePeriod);
    if (direct) {
      return direct;
    }
    const summary = readDocumentIntelligence(doc).summary;
    const match = summary?.match(/(\d+\s+(?:month|months|Monate|weeks|Wochen)[^.,;]*)/i);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function readLatestInsurancePremium(
  docs: CorrespondentDocumentRow[],
): { amount: number; currency: string; asOf: string | null } | null {
  const datedDocs = [...docs].sort((left, right) => compareDates(right.issueDate, left.issueDate));
  const prioritized = datedDocs
    .map((doc) => ({
      doc,
      premium: readInsurancePremiumValue(doc),
      signaled: hasInsurancePremiumSignal(doc),
    }))
    .filter(
      (entry): entry is {
        doc: CorrespondentDocumentRow;
        premium: { amount: number; currency: string };
        signaled: boolean;
      } => entry.premium !== null,
    );

  const preferred = prioritized.find((entry) => entry.signaled) ?? prioritized[0];
  return preferred
    ? {
        amount: preferred.premium.amount,
        currency: preferred.premium.currency,
        asOf: preferred.doc.issueDate,
      }
    : null;
}

function readInsurancePremiumValue(doc: CorrespondentDocumentRow): { amount: number; currency: string } | null {
  const fields = readDocumentIntelligence(doc).fields;
  const fieldAmountCandidates = [
    fields.monthlyPremiumAmount,
    fields.yearlyPremiumAmount,
    fields.annualPremiumAmount,
    fields.premiumAmount,
    fields.monthlyAmount,
    fields.yearlyAmount,
    fields.annualAmount,
    fields.monthlyPremium,
    fields.yearlyPremium,
    fields.annualPremium,
  ];
  const extractedAmount = fieldAmountCandidates.map(asNullableNumber).find((value) => value !== null) ?? null;
  const extractedCurrency = [
    asNullableString(fields.monthlyPremiumCurrency),
    asNullableString(fields.yearlyPremiumCurrency),
    asNullableString(fields.annualPremiumCurrency),
    asNullableString(fields.premiumCurrency),
    doc.currency,
  ].find((value): value is string => Boolean(value));

  if (extractedAmount !== null && extractedCurrency) {
    return { amount: extractedAmount, currency: extractedCurrency };
  }

  if (doc.amount && doc.currency) {
    return { amount: Number(doc.amount), currency: doc.currency };
  }

  return null;
}

function hasInsurancePremiumSignal(doc: CorrespondentDocumentRow): boolean {
  const fields = readDocumentIntelligence(doc).fields;
  const fieldKeys = Object.keys(fields).join(" ").toLowerCase();
  const searchableText = [doc.title, readDocumentIntelligence(doc).summary, fieldKeys]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  return /(premium|contribution|beitrag|beitrags|monthly|monat|monatlich|yearly|annual|jahr|jährlich|jaehrlich)/i.test(
    searchableText,
  );
}

function detectChanges(docs: CorrespondentDocumentRow[]): CorrespondentIntelligence["changes"] {
  const changes: CorrespondentIntelligence["changes"] = [];
  for (let index = 1; index < docs.length; index += 1) {
    const previous = docs[index - 1]!;
    const current = docs[index]!;
    if (previous.amount && current.amount && previous.currency && current.currency && previous.currency === current.currency) {
      const prev = Number(previous.amount);
      const next = Number(current.amount);
      if (Number.isFinite(prev) && Number.isFinite(next) && Math.abs(prev - next) >= 0.01) {
        changes.push({
          category: "price",
          title: next > prev ? "Amount increased" : "Amount decreased",
          description: `${formatAmount(prev, previous.currency)} changed to ${formatAmount(next, current.currency)}.`,
          effectiveDate: current.issueDate,
          direction: next > prev ? "increase" : "decrease",
          valueBefore: formatAmount(prev, previous.currency),
          valueAfter: formatAmount(next, current.currency),
          currency: current.currency,
          documentId: current.id,
          documentTitle: current.title,
        });
      }
    }

    const previousCoverage = readCoverageHighlights(previous).join(" | ");
    const currentCoverage = readCoverageHighlights(current).join(" | ");
    if (previousCoverage && currentCoverage && previousCoverage !== currentCoverage) {
      changes.push({
        category: "coverage",
        title: "Coverage details changed",
        description: currentCoverage,
        effectiveDate: current.issueDate,
        direction: "update",
        valueBefore: previousCoverage,
        valueAfter: currentCoverage,
        documentId: current.id,
        documentTitle: current.title,
      });
    }
  }

  return changes.slice(-8).reverse();
}

function buildCurrentState(
  latestDoc: CorrespondentDocumentRow,
  insuranceDocs: CorrespondentDocumentRow[],
  latestPremium?: { amount: number; currency: string; asOf: string | null } | null,
): CorrespondentIntelligence["currentState"] {
  const fields = readDocumentIntelligence(latestDoc).fields;
  const facts: CorrespondentIntelligence["currentState"] = [];
  const addFact = (label: string, value: string | null | undefined, asOf = latestDoc.issueDate) => {
    if (!value) {
      return;
    }
    facts.push({
      label,
      value,
      asOf,
      documentId: latestDoc.id,
      documentTitle: latestDoc.title,
    });
  };

  addFact("Latest document type", latestDoc.typeName);
  addFact("Reference", readReferenceNumber(latestDoc));
  addFact("Renewal / expiry", latestDoc.expiryDate);
  addFact(
    "Latest amount",
    insuranceDocs.length > 0
      ? latestPremium
        ? formatAmount(latestPremium.amount, latestPremium.currency)
        : null
      : latestDoc.amount && latestDoc.currency
        ? formatAmount(Number(latestDoc.amount), latestDoc.currency)
        : null,
    insuranceDocs.length > 0 ? latestPremium?.asOf ?? latestDoc.issueDate : latestDoc.issueDate,
  );
  addFact("Holder", asNullableString(fields.holderName));
  addFact("Tariff / plan", asNullableString(fields.tariff) ?? asNullableString(fields.plan));

  if (insuranceDocs.length > 0) {
    addFact("Policies in archive", uniqueValues(insuranceDocs.map((doc) => readReferenceNumber(doc)).filter(Boolean)).join(", "));
  }

  return facts.slice(0, 6);
}

function buildKeySignals(
  docs: CorrespondentDocumentRow[],
  changes: CorrespondentIntelligence["changes"],
): string[] {
  const signals = [`${docs.length} documents linked`];
  if (changes.some((change) => change.category === "price")) {
    signals.push("price changes detected");
  }
  if (docs.some((doc) => normalizeTypeName(doc.typeName) === "insurance")) {
    signals.push("insurance-specific records present");
  }
  return signals;
}

function buildOverview(
  correspondentName: string,
  category: string,
  docs: CorrespondentDocumentRow[],
  changes: CorrespondentIntelligence["changes"],
): string {
  const firstDate = docs.at(-1)?.issueDate;
  const lastDate = docs[0]?.issueDate;
  const timeRange = firstDate && lastDate ? `${firstDate} to ${lastDate}` : "the available archive history";
  const changeClause =
    changes.length > 0
      ? ` Notable changes include ${changes
          .slice(0, 2)
          .map((change) => change.title.toLowerCase())
          .join(" and ")}.`
      : "";
  if (category === "insurance") {
    return `${correspondentName} appears to be an insurance relationship tracked across ${docs.length} documents from ${timeRange}.${changeClause}`;
  }
  return `${correspondentName} appears as a recurring ${category} correspondent across ${docs.length} documents from ${timeRange}.${changeClause}`;
}

function summarizeDoc(doc: CorrespondentDocumentRow): string {
  const parts = [doc.typeName ?? "Document"];
  if (doc.amount && doc.currency) {
    parts.push(formatAmount(Number(doc.amount), doc.currency));
  }
  if (doc.expiryDate) {
    parts.push(`expiry ${doc.expiryDate}`);
  }
  return parts.join(" · ");
}

function inferGenericCategory(docs: CorrespondentDocumentRow[]): string {
  const typeCounts = new Map<string, number>();
  for (const doc of docs) {
    const key = normalizeTypeName(doc.typeName);
    typeCounts.set(key, (typeCounts.get(key) ?? 0) + 1);
  }
  return [...typeCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "service";
}

function normalizeTypeName(value: string | null): string {
  if (!value) {
    return "service";
  }
  const normalized = value.toLowerCase();
  if (normalized.includes("insurance")) {
    return "insurance";
  }
  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.replace(/[^\d,.-]/g, "").replace(/\.(?=.*\.)/g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function compareDates(left: string | null, right: string | null): number {
  return (left ?? "").localeCompare(right ?? "");
}

function uniqueValues(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim().length > 0)))];
}
