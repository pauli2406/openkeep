import { Module, forwardRef } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { DocumentsModule } from "../documents/documents.module";
import { ProcessingModule } from "../processing/processing.module";
import { CorrespondentIntelligenceService } from "./correspondent-intelligence.service";
import { ExplorerController } from "./explorer.controller";
import { ExplorerService } from "./explorer.service";

@Module({
  imports: [AuthModule, forwardRef(() => DocumentsModule), ProcessingModule],
  controllers: [ExplorerController],
  providers: [ExplorerService, CorrespondentIntelligenceService],
  exports: [ExplorerService, CorrespondentIntelligenceService],
})
export class ExplorerModule {}
