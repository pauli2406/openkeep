import { Inject, Injectable } from "@nestjs/common";
import type { TaxYearDocument, TaxYearResponse, TaxYearTotal } from "@openkeep/types";

import { DatabaseService } from "../common/db/database.service";

// Membership matches the canonical names DocumentTypePolicyService resolves to;
// user-created types with other names participate via the `tax` tag instead.
export const TAX_RELEVANT_TYPE_NAMES = ["Tax Document", "Tax Statement"] as const;

export const TAX_TAG_SLUG = "tax";

interface TaxYearRow {
  id: string;
  title: string;
  issue_date: string | null;
  amount: string | null;
  currency: string | null;
  type_id: string | null;
  type_name: string | null;
  correspondent_name: string | null;
  via_tag: boolean;
  via_type: boolean;
}

// Sums run in integer cents; numeric(12,2) stays far inside Number's safe range.
function parseCents(amount: string): number | null {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  if (!match) {
    return null;
  }
  const sign = match[1] === "-" ? -1 : 1;
  const cents = Number(match[2]) * 100 + Number((match[3] ?? "0").padEnd(2, "0"));
  return sign * cents;
}

class TotalsAccumulator {
  private readonly byCurrency = new Map<string, { cents: number; count: number }>();

  add(currency: string, cents: number): void {
    const entry = this.byCurrency.get(currency) ?? { cents: 0, count: 0 };
    entry.cents += cents;
    entry.count += 1;
    this.byCurrency.set(currency, entry);
  }

  toTotals(): TaxYearTotal[] {
    return [...this.byCurrency.entries()]
      .map(([currency, entry]) => ({
        currency,
        sum: entry.cents / 100,
        count: entry.count,
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
  }
}

@Injectable()
export class TaxesService {
  constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  async getTaxYear(year: number, ownerUserId: string): Promise<TaxYearResponse> {
    const result = await this.databaseService.pool.query<TaxYearRow>(
      `SELECT
         d.id,
         d.title,
         d.issue_date::text AS issue_date,
         d.amount::text AS amount,
         d.currency,
         dt.id AS type_id,
         dt.name AS type_name,
         c.name AS correspondent_name,
         EXISTS(
           SELECT 1 FROM document_tag_links l
           INNER JOIN tags t ON t.id = l.tag_id
           WHERE l.document_id = d.id AND t.slug = $4
         ) AS via_tag,
         coalesce(dt.name = ANY($3::text[]), false) AS via_type
       FROM documents d
       LEFT JOIN document_types dt ON dt.id = d.document_type_id
       LEFT JOIN correspondents c ON c.id = d.correspondent_id
       WHERE d.owner_user_id = $1
         AND coalesce(d.issue_date, d.created_at::date) >= make_date($2, 1, 1)
         AND coalesce(d.issue_date, d.created_at::date) <= make_date($2, 12, 31)
         AND (
           EXISTS(
             SELECT 1 FROM document_tag_links l
             INNER JOIN tags t ON t.id = l.tag_id
             WHERE l.document_id = d.id AND t.slug = $4
           )
           OR coalesce(dt.name = ANY($3::text[]), false)
         )
       ORDER BY coalesce(d.issue_date, d.created_at::date) ASC, d.title ASC`,
      [ownerUserId, year, [...TAX_RELEVANT_TYPE_NAMES], TAX_TAG_SLUG],
    );

    const overall = new TotalsAccumulator();
    let unsummedCount = 0;
    // Keyed by type id, not name: names are not unique across types.
    const groupMap = new Map<
      string | null,
      {
        documentType: string | null;
        documents: TaxYearDocument[];
        totals: TotalsAccumulator;
        unsummedCount: number;
      }
    >();

    for (const row of result.rows) {
      const cents =
        row.amount !== null && row.currency !== null ? parseCents(row.amount) : null;

      const document: TaxYearDocument = {
        id: row.id,
        title: row.title,
        issueDate: row.issue_date,
        correspondentName: row.correspondent_name,
        amount: row.amount === null ? null : Number(row.amount),
        currency: row.currency,
        memberVia: row.via_tag && row.via_type ? "both" : row.via_tag ? "tag" : "type",
      };

      const group = groupMap.get(row.type_id) ?? {
        documentType: row.type_name,
        documents: [],
        totals: new TotalsAccumulator(),
        unsummedCount: 0,
      };
      group.documents.push(document);
      if (cents === null) {
        group.unsummedCount += 1;
        unsummedCount += 1;
      } else {
        group.totals.add(row.currency as string, cents);
        overall.add(row.currency as string, cents);
      }
      groupMap.set(row.type_id, group);
    }

    const groups = [...groupMap.entries()]
      .map(([documentTypeId, group]) => ({
        documentTypeId,
        documentType: group.documentType,
        count: group.documents.length,
        unsummedCount: group.unsummedCount,
        totals: group.totals.toTotals(),
        documents: group.documents,
      }))
      .sort((a, b) => {
        if (a.documentTypeId === null) return 1;
        if (b.documentTypeId === null) return -1;
        return (
          b.count - a.count || (a.documentType ?? "").localeCompare(b.documentType ?? "")
        );
      });

    return {
      year,
      documentCount: result.rows.length,
      unsummedCount,
      totals: overall.toTotals(),
      groups,
    };
  }
}
