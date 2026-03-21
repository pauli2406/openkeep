import { Module } from "@nestjs/common";

import { AuthModule } from "./auth/auth.module";
import { AppConfigModule } from "./common/config/app-config.module";
import { DatabaseModule } from "./common/db/database.module";
import { MetricsModule } from "./common/metrics/metrics.module";
import { StorageModule } from "./common/storage/storage.module";
import { DocumentsModule } from "./documents/documents.module";
import { HealthController } from "./health/health.controller";
import { ProcessingModule } from "./processing/processing.module";
import { SearchModule } from "./search/search.module";

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    MetricsModule,
    StorageModule,
    AuthModule,
    ProcessingModule,
    DocumentsModule,
    SearchModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
