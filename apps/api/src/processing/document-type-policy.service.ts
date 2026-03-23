import { Inject, Injectable } from "@nestjs/common";
import { documentTypes } from "@openkeep/db";
import type { ReviewEvidence, ReviewEvidenceField } from "@openkeep/types";
import { asc } from "drizzle-orm";

import { DatabaseService } from "../common/db/database.service";
import { DEFAULT_DOCUMENT_TYPES } from "../taxonomies/default-document-types";

type ReviewEvidenceExtracted = ReviewEvidence["extracted"];

const DOCUMENT_TYPE_ALIASES: Record<string, string> = {
  tax: "Tax Document",
  taxes: "Tax Document",
  utility: "Utility Bill",
  utilities: "Utility Bill",
  bill: "Utility Bill",
  bills: "Utility Bill",
  invoice: "Invoice",
  rechnung: "Invoice",
  statement: "Statement",
  accountstatement: "Statement",
  receipt: "Receipt",
  quittung: "Receipt",
  voucher: "Giftcard",
  gutschein: "Giftcard",
  giftcard: "Giftcard",
  giftvoucher: "Giftcard",
  contract: "Contract",
  insurance: "Insurance",
  warranty: "Warranty",
  manual: "Manual",
  form: "Form",
  notice: "Notice",
  report: "Report",
  certificate: "Certificate",
  id: "ID",
};

function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameKey(value: string): string {
  return normalizeName(value).replace(/\s+/g, "");
}

@Injectable()
export class DocumentTypePolicyService {
  private cache:
    | {
        expiresAt: number;
        types: Array<{ id: string; name: string; slug: string; requiredFields: ReviewEvidenceField[] }>;
      }
    | null = null;

  constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  async listTypes(): Promise<
    Array<{ id: string; name: string; slug: string; requiredFields: ReviewEvidenceField[] }>
  > {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.types;
    }

    const rows = await this.databaseService.db
      .select({
        id: documentTypes.id,
        name: documentTypes.name,
        slug: documentTypes.slug,
        requiredFields: documentTypes.requiredFields,
      })
      .from(documentTypes)
      .orderBy(asc(documentTypes.name));

    const types = rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      requiredFields: Array.isArray(row.requiredFields)
        ? (row.requiredFields as ReviewEvidenceField[])
        : [],
    }));

    this.cache = {
      expiresAt: now + 60_000,
      types,
    };

    return types;
  }

  invalidateCache(): void {
    this.cache = null;
  }

  async resolveCanonicalName(rawName: string | null | undefined): Promise<string | null> {
    if (!rawName?.trim()) {
      return null;
    }

    const knownTypes = await this.listTypes();
    const normalized = normalizeName(rawName);
    const compact = nameKey(rawName);

    const direct =
      knownTypes.find((type) => normalizeName(type.name) === normalized) ??
      knownTypes.find((type) => nameKey(type.name) === compact);
    if (direct) {
      return direct.name;
    }

    const aliased = DOCUMENT_TYPE_ALIASES[compact];
    if (!aliased) {
      return null;
    }

    return knownTypes.find((type) => type.name === aliased)?.name ?? aliased;
  }

  async getPolicy(documentTypeName: string | null | undefined): Promise<{
    documentTypeName: string | null;
    requiredFields: ReviewEvidenceField[];
    documentClass: ReviewEvidence["documentClass"];
  }> {
    const canonicalName = await this.resolveCanonicalName(documentTypeName);
    if (!canonicalName) {
      return {
        documentTypeName: null,
        requiredFields: [],
        documentClass: "generic",
      };
    }

    const knownTypes = await this.listTypes();
    const matching = knownTypes.find((type) => type.name === canonicalName);
    const requiredFields = matching?.requiredFields ?? this.getDefaultRequiredFields(canonicalName);

    return {
      documentTypeName: canonicalName,
      requiredFields,
      documentClass: this.computeDocumentClass(canonicalName, requiredFields),
    };
  }

  buildReviewEvidence(
    policy: {
      documentTypeName: string | null;
      requiredFields: ReviewEvidenceField[];
      documentClass: ReviewEvidence["documentClass"];
    },
    extracted: ReviewEvidenceExtracted,
  ): ReviewEvidence {
    return {
      documentClass: policy.documentClass,
      requiredFields: policy.requiredFields,
      missingFields: policy.requiredFields.filter((field) => !extracted[field]),
      extracted,
      activeReasons: [],
    };
  }

  emptyExtracted(): ReviewEvidenceExtracted {
    return {
      correspondent: false,
      issueDate: false,
      dueDate: false,
      amount: false,
      currency: false,
      referenceNumber: false,
      expiryDate: false,
      holderName: false,
      issuingAuthority: false,
    };
  }

  private getDefaultRequiredFields(name: string): ReviewEvidenceField[] {
    const defaults = DEFAULT_DOCUMENT_TYPES.find((type) => type.name === name);
    return defaults ? [...defaults.requiredFields] : [];
  }

  private computeDocumentClass(
    documentTypeName: string,
    requiredFields: ReviewEvidenceField[],
  ): ReviewEvidence["documentClass"] {
    if (
      documentTypeName === "Invoice" ||
      requiredFields.includes("amount") ||
      requiredFields.includes("currency")
    ) {
      return "invoice";
    }

    return "generic";
  }
}
