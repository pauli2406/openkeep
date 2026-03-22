import {
  BadRequestException,
  Body,
  Controller,
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
import {
  RequeueDocumentProcessingDto,
  RequeueDocumentProcessingResponseDto,
  ReprocessDocumentDto,
  ResolveReviewDto,
  ReviewDocumentsQueryDto,
  SearchDocumentsQueryDto,
  UpdateDocumentDto,
} from "./dto/document.dto";
import { DocumentsService } from "./documents.service";

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
  async listDocuments(@Query() query: SearchDocumentsQueryDto) {
    return this.documentsService.listDocuments({
      query: query.query,
      filters: {
        year: query.year,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        correspondentId: query.correspondentId,
        documentTypeId: query.documentTypeId,
        status: query.status,
        tags: query.tags,
      },
      sort: query.sort,
      direction: query.direction,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Get("facets")
  async getFacets() {
    return this.documentsService.getBrowseFacets();
  }

  @Get("review")
  @ApiOperation({ summary: "List documents currently waiting for review" })
  @ApiOkResponse({ description: "Review queue response" })
  async listReviewDocuments(@Query() query: ReviewDocumentsQueryDto) {
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
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    return reply.send(stream);
  }

  @Get(":id/download/searchable")
  async downloadSearchableDocument(@Param("id") id: string, @Res() reply: FastifyReply) {
    const { stream, filename, mimeType } =
      await this.documentsService.downloadSearchableDocument(id);
    reply.header("Content-Type", mimeType);
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    return reply.send(stream);
  }

  @Patch(":id")
  @ApiOkResponse({ description: "Updated document" })
  async updateDocument(
    @Param("id") id: string,
    @Body() body: UpdateDocumentDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.documentsService.updateDocument(id, body, principal);
  }

  @Post(":id/review/resolve")
  @ApiOperation({ summary: "Resolve review state for a document" })
  @ApiCreatedResponse({ description: "Updated document after review resolution" })
  async resolveReview(
    @Param("id") id: string,
    @Body() body: ResolveReviewDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.documentsService.resolveReview(id, body, principal);
  }

  @Post(":id/review/requeue")
  @ApiOperation({ summary: "Requeue a document from the review queue for processing" })
  @ApiCreatedResponse({ description: "Queued processing job metadata" })
  async requeueReview(
    @Param("id") id: string,
    @Body() body: RequeueDocumentProcessingDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.documentsService.requeueReview(id, body, principal);
  }

  @Post(":id/reprocess")
  @ApiOperation({ summary: "Reprocess a document with an optional OCR provider override" })
  @ApiCreatedResponse({ description: "Queued processing job metadata" })
  async reprocessDocument(
    @Param("id") id: string,
    @Body() body: ReprocessDocumentDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.documentsService.reprocessDocument(id, principal, body?.parseProvider);
  }

  @Post(":id/reembed")
  async reembedDocument(
    @Param("id") id: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.documentsService.reembedDocument(id, principal);
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
}
