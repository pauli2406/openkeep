import { Inject, Injectable } from "@nestjs/common";
import type { ReviewEvidenceField, ReviewReason } from "@openkeep/types";

import { AppConfigService } from "../common/config/app-config.service";
import { CorrespondentResolutionService } from "./correspondent-resolution.service";
import { DeterministicMetadataExtractor } from "./deterministic-metadata.extractor";
import { computeConfidence } from "./normalization.util";
import type {
  MetadataExtractionInput,
  MetadataExtractionResult,
  MetadataExtractor,
} from "./provider.types";

@Injectable()
export class HybridMetadataExtractor implements MetadataExtractor {
  constructor(
    @Inject(DeterministicMetadataExtractor)
    private readonly deterministicExtractor: DeterministicMetadataExtractor,
    @Inject(CorrespondentResolutionService)
    private readonly correspondentResolutionService: CorrespondentResolutionService,
    @Inject(AppConfigService) private readonly configService: AppConfigService,
  ) {}

  async extract(input: MetadataExtractionInput): Promise<MetadataExtractionResult> {
    const result = await this.deterministicExtractor.extract(input);
    const resolution = await this.correspondentResolutionService.resolve(input, result);
    const reviewEvidence = this.normalizeReviewEvidence(
      result.metadata.reviewEvidence as Record<string, unknown> | undefined,
      Boolean(resolution.correspondentName),
    );
    const reviewReasons = this.resolveReviewReasons(result.reviewReasons, reviewEvidence);
    const confidence = this.resolveConfidence(result, resolution.metadata.matchStrategy);

    return {
      ...result,
      correspondentName: resolution.correspondentName,
      confidence,
      reviewReasons,
      metadata: {
        ...result.metadata,
        extractionStrategy: "hybrid",
        providerMode: this.configService.get("PROVIDER_MODE"),
        cloudEnrichmentConfigured:
          Boolean(this.configService.get("OPENAI_API_KEY")) ||
          Boolean(this.configService.get("GEMINI_API_KEY")),
        correspondentExtraction: resolution.metadata,
        reviewEvidence: {
          ...reviewEvidence,
          activeReasons: reviewReasons,
          confidence,
        },
      },
    };
  }

  private normalizeReviewEvidence(
    raw: Record<string, unknown> | undefined,
    correspondentExtracted: boolean,
  ) {
    const requiredFields = Array.isArray(raw?.requiredFields)
      ? (raw!.requiredFields as ReviewEvidenceField[])
      : [];
    const extracted =
      raw?.extracted && typeof raw.extracted === "object" && raw.extracted !== null
        ? (raw.extracted as Record<string, unknown>)
        : {};
    const normalizedExtracted = {
      correspondent: correspondentExtracted,
      issueDate: Boolean(extracted.issueDate),
      amount: Boolean(extracted.amount),
      currency: Boolean(extracted.currency),
    };

    return {
      documentClass: raw?.documentClass === "invoice" ? "invoice" : "generic",
      requiredFields,
      missingFields: requiredFields.filter((field) => !normalizedExtracted[field]),
      extracted: normalizedExtracted,
    };
  }

  private resolveReviewReasons(
    existing: ReviewReason[],
    reviewEvidence: {
    requiredFields: ReviewEvidenceField[];
    missingFields: ReviewEvidenceField[];
  }): ReviewReason[] {
    const reasons = new Set<ReviewReason>(existing);
    if (reviewEvidence.requiredFields.length > 0 && reviewEvidence.missingFields.length > 0) {
      reasons.add("missing_key_fields");
    } else {
      reasons.delete("missing_key_fields");
    }
    return [...reasons];
  }

  private resolveConfidence(
    result: MetadataExtractionResult,
    matchStrategy:
      | "exact"
      | "alias"
      | "fuzzy"
      | "llm_choice"
      | "new"
      | "review"
      | "blocked"
      | "none",
  ): number {
    const confidence = computeConfidence({
      base: result.confidence,
      boosts: [
        matchStrategy === "exact" ? 0.08 : 0,
        matchStrategy === "alias" ? 0.06 : 0,
        matchStrategy === "llm_choice" ? 0.04 : 0,
      ],
      penalties: [
        matchStrategy === "review" ? 0.15 : 0,
        matchStrategy === "blocked" ? 0.2 : 0,
        matchStrategy === "none" ? 0.18 : 0,
      ],
    });

    return confidence;
  }
}
