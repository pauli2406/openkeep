import { Module, forwardRef } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { DocumentsModule } from "../documents/documents.module";
import { ProcessingModule } from "../processing/processing.module";
import { EmailIngestController } from "./email-ingest.controller";
import { EmailIngestService } from "./email-ingest.service";

@Module({
  imports: [AuthModule, forwardRef(() => DocumentsModule), ProcessingModule],
  controllers: [EmailIngestController],
  providers: [EmailIngestService],
  exports: [EmailIngestService],
})
export class EmailIngestModule {}
