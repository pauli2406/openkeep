import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

import { ArchiveModule } from "./archive/archive.module";
import { AuthModule } from "./auth/auth.module";
import { AppConfigModule } from "./common/config/app-config.module";
import { DatabaseModule } from "./common/db/database.module";
import { MetricsModule } from "./common/metrics/metrics.module";
import { StorageModule } from "./common/storage/storage.module";
import { DocumentsModule } from "./documents/documents.module";
import { EmailIngestModule } from "./email-ingest/email-ingest.module";
import { ExplorerModule } from "./explorer/explorer.module";
import { HealthController } from "./health/health.controller";
import { HealthModule } from "./health/health.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { ProcessingModule } from "./processing/processing.module";
import { SearchModule } from "./search/search.module";
import { TaxesModule } from "./taxes/taxes.module";
import { TaxonomiesModule } from "./taxonomies/taxonomies.module";

@Module({
  imports: [
    // Global baseline rate limit: 300 requests / minute / IP — generous
    // enough for normal app usage (dashboards firing many requests), while
    // still bounding abuse. Auth endpoints override this with a much
    // stricter limit (see AuthController).
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 300,
      },
    ]),
    AppConfigModule,
    DatabaseModule,
    MetricsModule,
    StorageModule,
    ArchiveModule,
    AuthModule,
    ProcessingModule,
    DocumentsModule,
    EmailIngestModule,
    ExplorerModule,
    HealthModule.forProcess("api"),
    NotificationsModule,
    SearchModule,
    TaxesModule,
    TaxonomiesModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
