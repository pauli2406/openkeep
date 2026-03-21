import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { DocumentsModule } from "../documents/documents.module";
import { SearchController } from "./search.controller";

@Module({
  imports: [AuthModule, DocumentsModule],
  controllers: [SearchController],
})
export class SearchModule {}
