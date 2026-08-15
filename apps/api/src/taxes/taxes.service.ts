import { Inject, Injectable, Logger } from "@nestjs/common";
import type { TaxYearDocument, TaxYearResponse, TaxYearTotal } from "@openkeep/types";
import { auditEvents } from "@openkeep/db";
import { ZipArchive, type Archiver } from "archiver";

import { DatabaseService } from "../common/db/database.service";
import { ObjectStorageService } from "../common/storage/storage.service";

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

interface TaxExportRow extends TaxYearRow {
  storage_key: string;
  original_filename: string;
  searchable_pdf_storage_key: string | null;
}

const WINDOWS_RESERVED_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

/** Safe on Windows and in a ZIP: no separators, no reserved names, bounded length. */
function sanitizeFilenamePart(value: string, fallback: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[/\\:*?"<>|;\r\n]+/g, "_")
    .replace(/[^\x20-\x7E]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[\s._]+|[\s._]+$/g, "")
    .slice(0, 80)
    .trim();
  if (!cleaned) {
    return fallback;
  }
  return WINDOWS_RESERVED_NAMES.has(cleaned.toUpperCase()) ? `_${cleaned}` : cleaned;
}

function csvField(value: string | number | null): string {
  if (value === null) {
    return "";
  }
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function extensionFor(row: TaxExportRow): string {
  if (row.searchable_pdf_storage_key) {
    return "pdf";
  }
  const fromName = /\.([A-Za-z0-9]{1,5})$/.exec(row.original_filename)?.[1]?.toLowerCase();
  return fromName ?? "bin";
}

export interface TaxYearExportSummary {
  exported: number;
  missing: number;
}

@Injectable()
export class TaxesService {
  private readonly logger = new Logger(TaxesService.name);

  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(ObjectStorageService) private readonly storageService: ObjectStorageService,
  ) {}

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

  /**
   * Build the tax-year ZIP: one folder per document type, the searchable PDF
   * where one exists (original bytes otherwise), and an index.csv listing
   * every member — including the ones whose file is missing from storage,
   * which are reported in the CSV rather than silently omitted.
   *
   * The archive is a stream; entries are appended lazily so a year of
   * hundreds of documents never sits in memory at once. The returned
   * `completion` resolves after finalize and records the audit trail.
   */
  async exportTaxYear(
    year: number,
    ownerUserId: string,
  ): Promise<{ archive: Archiver; completion: Promise<TaxYearExportSummary> }> {
    const result = await this.databaseService.pool.query<TaxExportRow>(
      `SELECT
         d.id,
         d.title,
         d.issue_date::text AS issue_date,
         d.amount::text AS amount,
         d.currency,
         dt.id AS type_id,
         dt.name AS type_name,
         c.name AS correspondent_name,
         f.storage_key,
         f.original_filename,
         d.searchable_pdf_storage_key,
         false AS via_tag,
         false AS via_type
       FROM documents d
       INNER JOIN document_files f ON f.id = d.file_id
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

    const archive = new ZipArchive({ zlib: { level: 6 } });

    const completion = (async (): Promise<TaxYearExportSummary> => {
      const usedNames = new Set<string>();
      const csvLines = [
        ["date", "correspondent", "type", "title", "amount", "currency", "filename", "status"].join(","),
      ];
      const exportedIds: string[] = [];
      let missing = 0;

      for (const row of result.rows) {
        const folder = sanitizeFilenamePart(row.type_name ?? "Unfiled", "Unfiled");
        const base = [
          row.issue_date ?? "undated",
          sanitizeFilenamePart(row.correspondent_name ?? "", "unknown"),
          sanitizeFilenamePart(row.title, "document"),
        ]
          .filter(Boolean)
          .join("_");
        const extension = extensionFor(row);

        let entryName = `${folder}/${base}.${extension}`;
        for (let counter = 2; usedNames.has(entryName); counter += 1) {
          entryName = `${folder}/${base}-${counter}.${extension}`;
        }
        usedNames.add(entryName);

        const storageKey = row.searchable_pdf_storage_key ?? row.storage_key;
        let stream: NodeJS.ReadableStream | null = null;
        try {
          stream = (await this.storageService.getObjectStream(
            storageKey,
          )) as NodeJS.ReadableStream | null;
        } catch {
          stream = null;
        }

        const status = stream ? "exported" : "missing-file";
        if (stream) {
          archive.append(stream as never, { name: entryName });
          // Wait until the archive has consumed this entry before fetching
          // the next object, so storage streams never idle in a long queue.
          await new Promise<void>((resolveEntry, rejectEntry) => {
            const onEntry = () => {
              cleanup();
              resolveEntry();
            };
            const onError = (error: Error) => {
              cleanup();
              rejectEntry(error);
            };
            const cleanup = () => {
              archive.off("entry", onEntry);
              archive.off("error", onError);
            };
            archive.once("entry", onEntry);
            archive.once("error", onError);
          });
          exportedIds.push(row.id);
        } else {
          missing += 1;
          this.logger.warn(`Tax export ${year}: file missing from storage for document ${row.id}`);
        }

        csvLines.push(
          [
            csvField(row.issue_date),
            csvField(row.correspondent_name),
            csvField(row.type_name ?? "Unfiled"),
            csvField(row.title),
            csvField(row.amount),
            csvField(row.currency),
            csvField(status === "exported" ? entryName : ""),
            csvField(status),
          ].join(","),
        );
      }

      archive.append(csvLines.join("\n"), { name: "index.csv" });
      await archive.finalize();

      if (exportedIds.length > 0) {
        await this.databaseService.db.insert(auditEvents).values(
          exportedIds.map((documentId) => ({
            actorUserId: ownerUserId,
            documentId,
            eventType: "document.tax_year_exported",
            payload: { taxYear: year },
          })),
        );
      }

      return { exported: exportedIds.length, missing };
    })();

    completion.catch((error) => {
      this.logger.error(`Tax export ${year} failed: ${String(error)}`);
      archive.destroy(error instanceof Error ? error : new Error(String(error)));
    });

    return { archive, completion };
  }
}
