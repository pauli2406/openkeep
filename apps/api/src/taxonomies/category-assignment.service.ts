import { Inject, Injectable, Logger } from "@nestjs/common";
import { categories, correspondents } from "@openkeep/db";
import { eq } from "drizzle-orm";

import { DatabaseService } from "../common/db/database.service";
import { DOCUMENT_TYPE_CATEGORY_SLUGS, categorySlug } from "./default-categories";

/**
 * Assigns a life-domain category to correspondents. Three sources with a
 * strict precedence — manual beats llm beats deterministic — and a writer
 * never overwrites a stronger source.
 */
@Injectable()
export class CategoryAssignmentService {
  private readonly logger = new Logger(CategoryAssignmentService.name);

  constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  /**
   * The dominant document type names the domain. Only fills gaps and
   * refreshes earlier deterministic guesses; llm and manual stand.
   */
  async assignDeterministic(correspondentId: string): Promise<void> {
    const result = await this.databaseService.pool.query<{ type_name: string }>(
      `SELECT dt.name AS type_name
       FROM documents d
       INNER JOIN document_types dt ON dt.id = d.document_type_id
       WHERE d.correspondent_id = $1
       GROUP BY dt.name
       ORDER BY count(*) DESC, dt.name ASC
       LIMIT 1`,
      [correspondentId],
    );
    const typeName = result.rows[0]?.type_name;
    const slug = typeName ? DOCUMENT_TYPE_CATEGORY_SLUGS[typeName] : undefined;
    if (!slug) {
      return;
    }

    await this.databaseService.pool.query(
      `UPDATE correspondents c
       SET category_id = cat.id, category_source = 'deterministic'
       FROM categories cat
       WHERE c.id = $1
         AND cat.slug = $2
         AND (
           c.category_source IS NULL
           OR c.category_source = 'deterministic'
           -- A set-nulled category with a leftover source is assignable too.
           OR c.category_id IS NULL
         )`,
      [correspondentId, slug],
    );
  }

  /** Every uncategorized correspondent gets a deterministic pass. Idempotent. */
  async backfillMissing(): Promise<number> {
    const missing = await this.databaseService.pool.query<{ id: string }>(
      `SELECT id FROM correspondents WHERE category_id IS NULL`,
    );
    for (const row of missing.rows) {
      await this.assignDeterministic(row.id);
    }
    const assigned = await this.databaseService.pool.query<{ assigned: string }>(
      `SELECT count(*)::int AS assigned FROM correspondents
       WHERE category_id IS NOT NULL AND id = ANY($1::uuid[])`,
      [missing.rows.map((row) => row.id)],
    );
    const count = Number(assigned.rows[0]?.assigned ?? 0);
    if (count > 0) {
      this.logger.log(`Category backfill: ${count} correspondents categorized`);
    }
    return count;
  }

  /** The current vocabulary, for the intelligence prompt and clients. */
  async listVocabulary(): Promise<Array<{ id: string; name: string; slug: string }>> {
    return this.databaseService.db
      .select({ id: categories.id, name: categories.name, slug: categories.slug })
      .from(categories);
  }

  /**
   * Applies an LLM-suggested category. The suggestion must resolve inside
   * the current vocabulary (by name or slug, case-insensitive) — anything
   * else is discarded, not written. Never touches a manual assignment.
   * Returns the canonical category name, or null when discarded.
   */
  async applyIntelligenceCategory(
    correspondentId: string,
    suggestion: string | null | undefined,
  ): Promise<string | null> {
    if (!suggestion?.trim()) {
      return null;
    }
    const vocabulary = await this.listVocabulary();
    const needle = suggestion.trim().toLowerCase();
    const needleSlug = categorySlug(suggestion);
    const match = vocabulary.find(
      (entry) => entry.name.toLowerCase() === needle || entry.slug === needleSlug,
    );
    if (!match) {
      this.logger.warn(
        `Discarding out-of-vocabulary category suggestion "${suggestion}" for ${correspondentId}`,
      );
      return null;
    }

    await this.databaseService.pool.query(
      `UPDATE correspondents
       SET category_id = $2, category_source = 'llm'
       WHERE id = $1 AND (category_source IS NULL OR category_source <> 'manual')`,
      [correspondentId, match.id],
    );
    return match.name;
  }

  /** A manual choice — the strongest source. Null clears the category. */
  async setManualCategory(correspondentId: string, categoryId: string | null): Promise<void> {
    if (categoryId !== null) {
      const [exists] = await this.databaseService.db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, categoryId))
        .limit(1);
      if (!exists) {
        throw new Error("Category not found");
      }
    }
    await this.databaseService.db
      .update(correspondents)
      .set({
        categoryId,
        categorySource: categoryId === null ? null : "manual",
      })
      .where(eq(correspondents.id, correspondentId));
  }
}
