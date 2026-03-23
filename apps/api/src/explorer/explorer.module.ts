import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { DocumentsModule } from "../documents/documents.module";
import { ProcessingModule } from "../processing/processing.module";
import { ExplorerController } from "./explorer.controller";
import { ExplorerService } from "./explorer.service";

@Module({
  imports: [AuthModule, DocumentsModule, ProcessingModule],
  controllers: [ExplorerController],
  providers: [ExplorerService],
  exports: [ExplorerService],
})
export class ExplorerModule {}
