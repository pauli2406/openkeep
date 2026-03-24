import { Body, Controller, Get, Inject, Post, Query, Res, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import type { FastifyReply } from "fastify";

import { AccessAuthGuard } from "../auth/access-auth.guard";
import {
  AnswerQueryDto,
  SearchDocumentsQueryDto,
  SemanticSearchDto,
} from "../documents/dto/document.dto";
import { DocumentsService } from "../documents/documents.service";

@ApiTags("search")
@ApiBearerAuth()
@UseGuards(AccessAuthGuard)
@Controller("search")
export class SearchController {
  constructor(@Inject(DocumentsService) private readonly documentsService: DocumentsService) {}

  @Get("documents")
  @ApiOkResponse({ description: "Paginated search results" })
  async searchDocuments(@Query() query: SearchDocumentsQueryDto) {
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

  @Post("semantic")
  @ApiCreatedResponse({ description: "Semantic search results" })
  async semanticSearch(@Body() body: SemanticSearchDto) {
    return this.documentsService.semanticSearch(body);
  }

  @Post("answer")
  @ApiCreatedResponse({ description: "Extractive answer with citations" })
  async answerQuery(@Body() body: AnswerQueryDto) {
    return this.documentsService.answerQuery(body);
  }

  @Post("answer/stream")
  @ApiOperation({ summary: "Stream an LLM-generated answer for a search query via SSE" })
  @ApiCreatedResponse({ description: "SSE stream of answer tokens" })
  async streamAnswer(@Body() body: AnswerQueryDto, @Res() reply: FastifyReply) {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    try {
      for await (const chunk of this.documentsService.streamAnswer(body)) {
        reply.raw.write(chunk);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal error";
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
    }

    reply.raw.end();
  }
}
