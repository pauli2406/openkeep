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
import { streamSseResponse } from "../common/sse.util";
import { CurrentPrincipal } from "../auth/current-principal.decorator";
import type { AuthenticatedPrincipal } from "../auth/auth.types";
import {
  AnswerQueryDto,
  SearchDocumentsQueryDto,
  SemanticSearchDto,
} from "../documents/dto/document.dto";
import { DocumentsService } from "../documents/documents.service";
import { SearchOrchestratorService } from "./search-orchestrator.service";

@ApiTags("search")
@ApiBearerAuth()
@UseGuards(AccessAuthGuard)
@Controller("search")
export class SearchController {
  constructor(
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
    @Inject(SearchOrchestratorService)
    private readonly searchOrchestratorService: SearchOrchestratorService,
  ) {}

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
  async answerQuery(
    @Body() body: AnswerQueryDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.searchOrchestratorService.answerQuery(body, principal);
  }

  @Post("answer/stream")
  @ApiOperation({ summary: "Stream an LLM-generated answer for a search query via SSE" })
  @ApiCreatedResponse({ description: "SSE stream of answer tokens" })
  async streamAnswer(
    @Body() body: AnswerQueryDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Res() reply: FastifyReply,
  ) {
    await streamSseResponse(reply, (signal) =>
      this.searchOrchestratorService.streamAnswer(body, principal, signal),
    );
  }
}
