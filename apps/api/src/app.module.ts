import { Module } from "@nestjs/common";

import { ArchiveModule } from "./archive/archive.module";
import { AuthModule } from "./auth/auth.module";
import { AppConfigModule } from "./common/config/app-config.module";
import { DatabaseModule } from "./common/db/database.module";
import { MetricsModule } from "./common/metrics/metrics.module";
import { StorageModule } from "./common/storage/storage.module";
import { DocumentsModule } from "./documents/documents.module";
import { ExplorerModule } from "./explorer/explorer.module";
import { HealthController } from "./health/health.controller";
import { ProcessingModule } from "./processing/processing.module";
import { SearchModule } from "./search/search.module";
import { TaxonomiesModule } from "./taxonomies/taxonomies.module";

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    MetricsModule,
    StorageModule,
    ArchiveModule,
    AuthModule,
    ProcessingModule,
    DocumentsModule,
    ExplorerModule,
    SearchModule,
    TaxonomiesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
