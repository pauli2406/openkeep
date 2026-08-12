import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { DocumentsModule } from "../documents/documents.module";
import { ExplorerModule } from "../explorer/explorer.module";
import { ProcessingModule } from "../processing/processing.module";
import { ChatAgentService } from "./chat-agent.service";
import { ChatToolsService } from "./chat-tools.service";
import { SearchController } from "./search.controller";
import { SearchOrchestratorService } from "./search-orchestrator.service";

@Module({
  imports: [AuthModule, DocumentsModule, ExplorerModule, ProcessingModule],
  controllers: [SearchController],
  providers: [SearchOrchestratorService, ChatAgentService, ChatToolsService],
})
export class SearchModule {}
