import { Inject, Injectable } from "@nestjs/common";
import type { ReviewEvidenceField, ReviewReason } from "@openkeep/types";

import { AppConfigService } from "../common/config/app-config.service";
import { CorrespondentResolutionService } from "./correspondent-resolution.service";
import { DeterministicMetadataExtractor } from "./deterministic-metadata.extractor";
import { DocumentTypePolicyService } from "./document-type-policy.service";
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
    @Inject(DocumentTypePolicyService)
    private readonly documentTypePolicyService: DocumentTypePolicyService,
    @Inject(CorrespondentResolutionService)
    private readonly correspondentResolutionService: CorrespondentResolutionService,
    @Inject(AppConfigService) private readonly configService: AppConfigService,
  ) {}

  async extract(input: MetadataExtractionInput): Promise<MetadataExtractionResult> {
    const result = await this.deterministicExtractor.extract(input);
    const resolution = await this.correspondentResolutionService.resolve(input, result);
    const reviewEvidence = await this.normalizeReviewEvidence(
      result,
      resolution.correspondentName,
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

  private async normalizeReviewEvidence(
    result: MetadataExtractionResult,
    correspondentName: string | null,
  ) {
    const policy = await this.documentTypePolicyService.getPolicy(result.documentTypeName);
    const extracted = {
      correspondent: Boolean(correspondentName),
      issueDate: Boolean(result.issueDate),
      dueDate: Boolean(result.dueDate),
      amount: Boolean(result.amount),
      currency: Boolean(result.currency),
      referenceNumber: Boolean(result.referenceNumber),
      expiryDate: Boolean(result.expiryDate),
      holderName: Boolean(result.holderName),
      issuingAuthority: Boolean(result.issuingAuthority),
    };

    return this.documentTypePolicyService.buildReviewEvidence(policy, extracted);
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
