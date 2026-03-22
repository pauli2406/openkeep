import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  auditEvents,
  correspondents,
  documentTagLinks,
  documentTypes,
  documents,
  tags,
} from "@openkeep/db";
import type {
  Correspondent,
  CreateCorrespondentInput,
  CreateDocumentTypeInput,
  CreateTagInput,
  DocumentType,
  MergeTaxonomyInput,
  Tag,
  UpdateCorrespondentInput,
  UpdateDocumentTypeInput,
  UpdateTagInput,
} from "@openkeep/types";
import { asc, eq, sql } from "drizzle-orm";
import slugify from "slugify";

import type { AuthenticatedPrincipal } from "../auth/auth.types";
import { DatabaseService } from "../common/db/database.service";

@Injectable()
export class TaxonomiesService {
  constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  async listTags(): Promise<Tag[]> {
    return this.databaseService.db.select().from(tags).orderBy(asc(tags.name));
  }

  async createTag(input: CreateTagInput, principal: AuthenticatedPrincipal): Promise<Tag> {
    const [created] = await this.databaseService.db
      .insert(tags)
      .values({
        name: input.name.trim(),
        slug: this.createSlug(input.name),
      })
      .returning();

    await this.recordAudit(principal.userId, "taxonomy.tag_created", {
      tagId: created.id,
      name: created.name,
    });
    return created;
  }

  async updateTag(
    id: string,
    input: UpdateTagInput,
    principal: AuthenticatedPrincipal,
  ): Promise<Tag> {
    await this.requireTag(id);
    const [updated] = await this.databaseService.db
      .update(tags)
      .set({
        name: input.name.trim(),
        slug: this.createSlug(input.name),
      })
      .where(eq(tags.id, id))
      .returning();

    await this.recordAudit(principal.userId, "taxonomy.tag_updated", {
      tagId: id,
      name: updated!.name,
    });
    return updated!;
  }

  async deleteTag(id: string, principal: AuthenticatedPrincipal): Promise<{ deleted: true }> {
    await this.requireTag(id);
    await this.databaseService.db.delete(tags).where(eq(tags.id, id));
    await this.recordAudit(principal.userId, "taxonomy.tag_deleted", {
      tagId: id,
    });
    return { deleted: true };
  }

  async mergeTag(
    sourceId: string,
    input: MergeTaxonomyInput,
    principal: AuthenticatedPrincipal,
  ): Promise<Tag> {
    if (sourceId === input.targetId) {
      throw new BadRequestException("Source and target tag must differ");
    }

    const target = await this.requireTag(input.targetId);
    await this.requireTag(sourceId);

    await this.databaseService.db.transaction(async (tx) => {
      await tx.execute(sql`
        DELETE FROM document_tag_links target
        USING document_tag_links source
        WHERE source.tag_id = ${sourceId}::uuid
          AND target.tag_id = ${input.targetId}::uuid
          AND target.document_id = source.document_id
      `);
      await tx
        .update(documentTagLinks)
        .set({
          tagId: input.targetId,
        })
        .where(eq(documentTagLinks.tagId, sourceId));
      await tx.delete(tags).where(eq(tags.id, sourceId));
    });

    await this.recordAudit(principal.userId, "taxonomy.tag_merged", {
      sourceId,
      targetId: input.targetId,
    });
    return target;
  }

  async listCorrespondents(): Promise<Correspondent[]> {
    return this.databaseService.db.select().from(correspondents).orderBy(asc(correspondents.name));
  }

  async createCorrespondent(
    input: CreateCorrespondentInput,
    principal: AuthenticatedPrincipal,
  ): Promise<Correspondent> {
    const [created] = await this.databaseService.db
      .insert(correspondents)
      .values(this.toCorrespondentInsert(input.name))
      .returning();

    await this.recordAudit(principal.userId, "taxonomy.correspondent_created", {
      correspondentId: created.id,
      name: created.name,
    });
    return created;
  }

  async updateCorrespondent(
    id: string,
    input: UpdateCorrespondentInput,
    principal: AuthenticatedPrincipal,
  ): Promise<Correspondent> {
    await this.requireCorrespondent(id);
    const [updated] = await this.databaseService.db
      .update(correspondents)
      .set(this.toCorrespondentInsert(input.name))
      .where(eq(correspondents.id, id))
      .returning();

    await this.recordAudit(principal.userId, "taxonomy.correspondent_updated", {
      correspondentId: id,
      name: updated!.name,
    });
    return updated!;
  }

  async deleteCorrespondent(
    id: string,
    principal: AuthenticatedPrincipal,
  ): Promise<{ deleted: true }> {
    await this.requireCorrespondent(id);
    await this.databaseService.db.delete(correspondents).where(eq(correspondents.id, id));
    await this.recordAudit(principal.userId, "taxonomy.correspondent_deleted", {
      correspondentId: id,
    });
    return { deleted: true };
  }

  async mergeCorrespondent(
    sourceId: string,
    input: MergeTaxonomyInput,
    principal: AuthenticatedPrincipal,
  ): Promise<Correspondent> {
    if (sourceId === input.targetId) {
      throw new BadRequestException("Source and target correspondent must differ");
    }

    const target = await this.requireCorrespondent(input.targetId);
    await this.requireCorrespondent(sourceId);

    await this.databaseService.db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({
          correspondentId: input.targetId,
        })
        .where(eq(documents.correspondentId, sourceId));
      await tx.delete(correspondents).where(eq(correspondents.id, sourceId));
    });

    await this.recordAudit(principal.userId, "taxonomy.correspondent_merged", {
      sourceId,
      targetId: input.targetId,
    });
    return target;
  }

  async listDocumentTypes(): Promise<DocumentType[]> {
    return this.databaseService.db.select().from(documentTypes).orderBy(asc(documentTypes.name));
  }

  async createDocumentType(
    input: CreateDocumentTypeInput,
    principal: AuthenticatedPrincipal,
  ): Promise<DocumentType> {
    const [created] = await this.databaseService.db
      .insert(documentTypes)
      .values({
        name: input.name.trim(),
        slug: this.createSlug(input.name),
        description: input.description ?? null,
      })
      .returning();

    await this.recordAudit(principal.userId, "taxonomy.document_type_created", {
      documentTypeId: created.id,
      name: created.name,
    });
    return created;
  }

  async updateDocumentType(
    id: string,
    input: UpdateDocumentTypeInput,
    principal: AuthenticatedPrincipal,
  ): Promise<DocumentType> {
    const current = await this.requireDocumentType(id);
    const [updated] = await this.databaseService.db
      .update(documentTypes)
      .set({
        name: input.name?.trim() ?? current.name,
        slug: this.createSlug(input.name?.trim() ?? current.name),
        description: input.description === undefined ? current.description ?? null : input.description,
      })
      .where(eq(documentTypes.id, id))
      .returning();

    await this.recordAudit(principal.userId, "taxonomy.document_type_updated", {
      documentTypeId: id,
      name: updated!.name,
    });
    return updated!;
  }

  async deleteDocumentType(
    id: string,
    principal: AuthenticatedPrincipal,
  ): Promise<{ deleted: true }> {
    await this.requireDocumentType(id);
    await this.databaseService.db.delete(documentTypes).where(eq(documentTypes.id, id));
    await this.recordAudit(principal.userId, "taxonomy.document_type_deleted", {
      documentTypeId: id,
    });
    return { deleted: true };
  }

  async mergeDocumentType(
    sourceId: string,
    input: MergeTaxonomyInput,
    principal: AuthenticatedPrincipal,
  ): Promise<DocumentType> {
    if (sourceId === input.targetId) {
      throw new BadRequestException("Source and target document type must differ");
    }

    const target = await this.requireDocumentType(input.targetId);
    await this.requireDocumentType(sourceId);

    await this.databaseService.db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({
          documentTypeId: input.targetId,
        })
        .where(eq(documents.documentTypeId, sourceId));
      await tx.delete(documentTypes).where(eq(documentTypes.id, sourceId));
    });

    await this.recordAudit(principal.userId, "taxonomy.document_type_merged", {
      sourceId,
      targetId: input.targetId,
    });
    return target;
  }

  private async requireTag(id: string): Promise<Tag> {
    const [row] = await this.databaseService.db.select().from(tags).where(eq(tags.id, id)).limit(1);
    if (!row) {
      throw new NotFoundException("Tag not found");
    }

    return row;
  }

  private async requireCorrespondent(id: string): Promise<Correspondent> {
    const [row] = await this.databaseService.db
      .select()
      .from(correspondents)
      .where(eq(correspondents.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Correspondent not found");
    }

    return row;
  }

  private async requireDocumentType(id: string): Promise<DocumentType> {
    const [row] = await this.databaseService.db
      .select()
      .from(documentTypes)
      .where(eq(documentTypes.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Document type not found");
    }

    return row;
  }

  private toCorrespondentInsert(name: string) {
    const trimmed = name.trim();
    return {
      name: trimmed,
      slug: this.createSlug(trimmed),
      normalizedName: trimmed.toLowerCase().replace(/\s+/g, " "),
    };
  }

  private createSlug(input: string): string {
    return slugify(input, {
      lower: true,
      strict: true,
      trim: true,
    }).slice(0, 255);
  }

  private async recordAudit(
    actorUserId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.databaseService.db.insert(auditEvents).values({
      actorUserId,
      eventType,
      payload,
    });
  }
}
