import { Module, forwardRef } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ExplorerModule } from "../explorer/explorer.module";
import { ProcessingModule } from "../processing/processing.module";
import { DocumentsController } from "./documents.controller";
import { EmbeddingsController } from "./embeddings.controller";
import { DocumentsService } from "./documents.service";
import { DOCUMENTS_SERVICE } from "./documents.tokens";

@Module({
  imports: [AuthModule, ProcessingModule, forwardRef(() => ExplorerModule)],
  controllers: [DocumentsController, EmbeddingsController],
  // The token aliases the same instance, so services that cannot import the
  // class without closing a runtime cycle can still depend on it.
  providers: [DocumentsService, { provide: DOCUMENTS_SERVICE, useExisting: DocumentsService }],
  exports: [DocumentsService, DOCUMENTS_SERVICE],
})
export class DocumentsModule {}
