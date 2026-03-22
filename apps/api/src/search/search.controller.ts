import { Body, Controller, Get, Inject, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";

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
}
