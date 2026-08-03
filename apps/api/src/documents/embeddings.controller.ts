import { Body, Controller, Inject, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

import { AccessAuthGuard } from "../auth/access-auth.guard";
import { ReindexEmbeddingsDto } from "./dto/document.dto";
import { DocumentsService } from "./documents.service";
import { ValidatedBody } from "../common/validated-params";

@ApiTags("embeddings")
@ApiBearerAuth()
@UseGuards(AccessAuthGuard)
@Controller("embeddings")
export class EmbeddingsController {
  constructor(@Inject(DocumentsService) private readonly documentsService: DocumentsService) {}

  @Post("reindex")
  async reindexEmbeddings(@ValidatedBody(ReindexEmbeddingsDto) body: ReindexEmbeddingsDto) {
    return this.documentsService.reindexEmbeddings(body);
  }
}
