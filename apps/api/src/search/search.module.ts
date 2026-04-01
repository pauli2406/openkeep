import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { DocumentsModule } from "../documents/documents.module";
import { ExplorerModule } from "../explorer/explorer.module";
import { SearchController } from "./search.controller";
import { SearchOrchestratorService } from "./search-orchestrator.service";

@Module({
  imports: [AuthModule, DocumentsModule, ExplorerModule],
  controllers: [SearchController],
  providers: [SearchOrchestratorService],
})
export class SearchModule {}
