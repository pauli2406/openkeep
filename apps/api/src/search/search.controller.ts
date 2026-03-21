import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

import { AccessAuthGuard } from "../auth/access-auth.guard";
import { SearchDocumentsQueryDto } from "../documents/dto/document.dto";
import { DocumentsService } from "../documents/documents.service";

@ApiTags("search")
@ApiBearerAuth()
@UseGuards(AccessAuthGuard)
@Controller("search")
export class SearchController {
  constructor(@Inject(DocumentsService) private readonly documentsService: DocumentsService) {}

  @Get("documents")
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
}
