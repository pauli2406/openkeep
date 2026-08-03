import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";

import { CurrentPrincipal } from "../auth/current-principal.decorator";
import { AccessAuthGuard } from "../auth/access-auth.guard";
import type { AuthenticatedPrincipal } from "../auth/auth.types";
import { streamSseResponse } from "../common/sse.util";
import {
  BatchReprocessDocumentsDto,
  BatchReprocessDocumentsResponseDto,
  DocumentAskDto,
  RequeueDocumentProcessingDto,
  RequeueDocumentProcessingResponseDto,
  ReprocessDocumentDto,
  ResolveReviewDto,
  SaveDocumentQaEntryDto,
  ReviewDocumentsQueryDto,
  SearchDocumentsQueryDto,
  UpdateDocumentDto,
} from "./dto/document.dto";
import { DocumentsService } from "./documents.service";
import { BooleanFlagQuery, ValidatedBody, ValidatedQuery } from "../common/validated-params";

@ApiTags("documents")
@ApiBearerAuth()
@UseGuards(AccessAuthGuard)
@Controller("documents")
export class DocumentsController {
  constructor(@Inject(DocumentsService) private readonly documentsService: DocumentsService) {}

  @Post()
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          format: "binary",
        },
        title: {
          type: "string",
        },
        source: {
          type: "string",
          enum: ["upload", "watch-folder", "email", "api"],
        },
      },
      required: ["file"],
    },
  })
  @ApiOperation({ summary: "Upload a document and queue OCR processing" })
  async uploadDocument(
    @Req() request: FastifyRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    const file = await (request as FastifyRequest & { file: () => Promise<any> }).file();
    if (!file) {
      throw new BadRequestException("No file uploaded");
    }

    const buffer = await file.toBuffer();
    const title = this.readMultipartField(file.fields, "title");
    const source = this.readMultipartField(file.fields, "source");

    return this.documentsService.uploadDocument({
      principal,
      buffer,
      filename: file.filename,
      mimeType: file.mimetype,
      metadata: {
        title,
        source: source as "upload" | "watch-folder" | "email" | "api" | undefined,
      },
    });
  }

  @Get()
  @ApiOkResponse({ description: "List documents with structured and full-text filters" })
  async listDocuments(
    @ValidatedQuery(SearchDocumentsQueryDto) query: SearchDocumentsQueryDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.documentsService.listDocuments(
      {
        query: query.query,
        filters: {
          year: query.year,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          correspondentId: query.correspondentId,
          correspondentIds: query.correspondentIds,
          documentTypeId: query.documentTypeId,
          documentTypeIds: query.documentTypeIds,
          status: query.status,
          statuses: query.statuses,
          tags: query.tags,
          amountMin: query.amountMin,
          amountMax: query.amountMax,
        },
        sort: query.sort,
        direction: query.direction,
        page: query.page,
        pageSize: query.pageSize,
      },
      principal.userId,
    );
  }

  @Get("facets")
  async getFacets() {
    return this.documentsService.getBrowseFacets();
  }

  @Get("review")
  @ApiOperation({ summary: "List documents currently waiting for review" })
  @ApiOkResponse({ description: "Review queue response" })
  async listReviewDocuments(@ValidatedQuery(ReviewDocumentsQueryDto) query: ReviewDocumentsQueryDto) {
    return this.documentsService.listReviewDocuments({
      processingStatus: query.processingStatus,
      reason: query.reason,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Get(":id/history")
  @ApiOkResponse({ description: "Document audit history" })
  async getDocumentHistory(@Param("id") id: string) {
    return this.documentsService.getDocumentHistory(id);
  }

  @Get(":id")
  @ApiOkResponse({ description: "Single document" })
  async getDocument(@Param("id") id: string) {
    return this.documentsService.getDocument(id);
  }

  @Get(":id/text")
  @ApiOkResponse({ description: "Extracted text blocks" })
  async getDocumentText(@Param("id") id: string) {
    return this.documentsService.getDocumentText(id);
  }

  @Get(":id/download")
  async downloadDocument(@Param("id") id: string, @Res() reply: FastifyReply) {
    const { stream, filename, mimeType } = await this.documentsService.downloadDocument(id);
    reply.header("Content-Type", mimeType);
    reply.header("Content-Disposition", this.createAttachmentDisposition(filename));
    return reply.send(stream);
  }

  @Get(":id/download/searchable")
  async downloadSearchableDocument(@Param("id") id: string, @Res() reply: FastifyReply) {
    const { stream, filename, mimeType } =
      await this.documentsService.downloadSearchableDocument(id);
    reply.header("Content-Type", mimeType);
    reply.header("Content-Disposition", this.createAttachmentDisposition(filename));
    return reply.send(stream);
  }

  @Patch(":id")
  @ApiOkResponse({ description: "Updated document" })
  async updateDocument(
    @Param("id") id: string,
    @ValidatedBody(UpdateDocumentDto) body: UpdateDocumentDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.documentsService.updateDocument(id, body, principal);
  }

  @Delete(":id")
  @ApiOkResponse({ description: "Document deleted" })
  async deleteDocument(
    @Param("id") id: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.documentsService.deleteDocument(id, principal);
  }

  @Post(":id/review/resolve")
  @ApiOperation({ summary: "Resolve review state for a document" })
  @ApiCreatedResponse({ description: "Updated document after review resolution" })
  async resolveReview(
    @Param("id") id: string,
    @ValidatedBody(ResolveReviewDto) body: ResolveReviewDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.documentsService.resolveReview(id, body, principal);
  }

  @Post(":id/review/requeue")
  @ApiOperation({ summary: "Requeue a document from the review queue for processing" })
  @ApiCreatedResponse({ description: "Queued processing job metadata" })
  async requeueReview(
    @Param("id") id: string,
    @ValidatedBody(RequeueDocumentProcessingDto) body: RequeueDocumentProcessingDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.documentsService.requeueReview(id, body, principal);
  }

  @Post(":id/reprocess")
  @ApiOperation({ summary: "Reprocess a document with an optional OCR provider override" })
  @ApiCreatedResponse({ description: "Queued processing job metadata" })
  async reprocessDocument(
    @Param("id") id: string,
    @ValidatedBody(ReprocessDocumentDto) body: ReprocessDocumentDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.documentsService.reprocessDocument(id, principal, body?.parseProvider);
  }

  @Post("reprocess/bulk")
  @ApiOperation({ summary: "Reprocess multiple documents by selection, filter, or full archive scope" })
  @ApiCreatedResponse({ description: "Bulk reprocess queue result" })
  async batchReprocessDocuments(
    @ValidatedBody(BatchReprocessDocumentsDto) body: BatchReprocessDocumentsDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<BatchReprocessDocumentsResponseDto> {
    return this.documentsService.batchReprocessDocuments(body, principal);
  }

  @Post(":id/reembed")
  async reembedDocument(
    @Param("id") id: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.documentsService.reembedDocument(id, principal);
  }

  @Post(":id/summarize/stream")
  @ApiOperation({ summary: "Stream an AI-generated summary for a document via SSE" })
  @ApiCreatedResponse({ description: "SSE stream of summary tokens" })
  async streamDocumentSummary(
    @Param("id") id: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @BooleanFlagQuery("force") force: boolean,
    @Res() reply: FastifyReply,
  ) {
    await streamSseResponse(reply, (signal) =>
      this.documentsService.streamDocumentSummary(id, principal, force, signal),
    );
  }

  @Post(":id/ask/stream")
  @ApiOperation({ summary: "Stream an AI-generated answer to a question about a document via SSE" })
  @ApiCreatedResponse({ description: "SSE stream of answer tokens" })
  async streamDocumentAnswer(
    @Param("id") id: string,
    @ValidatedBody(DocumentAskDto) body: DocumentAskDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Res() reply: FastifyReply,
  ) {
    await streamSseResponse(reply, (signal) =>
      this.documentsService.streamDocumentAnswer(id, body.question, principal, signal),
    );
  }

  @Get(":id/qa-history")
  @ApiOperation({ summary: "Get Q&A history for a document" })
  @ApiOkResponse({ description: "List of Q&A entries" })
  async getQaHistory(
    @Param("id") id: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.documentsService.getDocumentQaHistory(id, principal.userId);
  }

  @Post(":id/qa-history")
  @ApiOperation({
    summary: "Save a Q&A entry for a document",
    deprecated: true,
    description:
      "Deprecated: entries are persisted server-side at the end of POST :id/ask/stream " +
      "(the done event carries historyEntryId). This endpoint accepted arbitrary answer " +
      "text and remains only for one release of backwards compatibility.",
  })
  @ApiCreatedResponse({ description: "Saved Q&A entry" })
  async saveQaEntry(
    @Param("id") id: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @ValidatedBody(SaveDocumentQaEntryDto) body: SaveDocumentQaEntryDto,
  ) {
    return this.documentsService.saveDocumentQaEntry(
      id,
      principal.userId,
      body.question,
      body.answer,
      body.citations,
      // Legacy clients re-post an answer the server already persisted at stream
      // end; only this path deduplicates.
      { deduplicateRecent: true },
    );
  }

  @Delete(":id/qa-history")
  @ApiOperation({ summary: "Clear Q&A history for a document" })
  @ApiOkResponse({ description: "Q&A history cleared" })
  async clearQaHistory(
    @Param("id") id: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    await this.documentsService.deleteDocumentQaHistory(id, principal.userId);
    return { success: true };
  }

  private readMultipartField(
    fields: Record<string, any> | undefined,
    name: string,
  ): string | undefined {
    if (!fields) {
      return undefined;
    }

    const field = fields[name];
    const value = Array.isArray(field) ? field[0]?.value : field?.value;
    return typeof value === "string" ? value : undefined;
  }

  private createAttachmentDisposition(filename: string): string {
    const fallback = filename
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7E]+/g, "_")
      .replace(/[/\\"]/g, "_")
      .replace(/[;\r\n]/g, "_")
      .trim() || "download";

    return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
  }
}
