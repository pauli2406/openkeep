import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ProcessingModule } from "../processing/processing.module";
import { DocumentsController } from "./documents.controller";
import { EmbeddingsController } from "./embeddings.controller";
import { DocumentsService } from "./documents.service";

@Module({
  imports: [AuthModule, ProcessingModule],
  controllers: [DocumentsController, EmbeddingsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
